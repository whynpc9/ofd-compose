import type { BindingPolicyVersion, Diagnostic } from "@ofd-compose/document-model";
import {
  type DatePattern,
  type ExpressionAst,
  FormatPatternError,
  type NumberPattern,
  type OperationNode,
  type PathRef,
  type PathSegment,
  parseDatePattern,
  parseNumberPattern,
  pathRefToText,
  pathSegmentsToText,
} from "@ofd-compose/template-compiler";
import { toDateTimeParts } from "./date.js";
import { formatDateTime, formatDecimal } from "./format.js";
import { evaluateTruthiness } from "./truthiness.js";
import {
  compareValues,
  isJsonArray,
  isJsonObject,
  isMissing,
  type JsonValue,
  MISSING,
  toDecimal,
  toText,
  type Value,
} from "./values.js";

/** 作用域链：当前项 / 父级 / 根。issue 04 只有根作用域；重复展开（issue 05）会压入子作用域。 */
export interface Scope {
  readonly current: JsonValue;
  readonly parent?: Scope;
  readonly root: JsonValue;
}

export interface EvaluationContext {
  readonly policy: BindingPolicyVersion;
  readonly timeZone: string;
  readonly scope: Scope;
  readonly nodeId: string;
  readonly bindingId: string;
  /** 已解析格式模式缓存（同一模板内共享）。 */
  readonly patternCache: Map<string, NumberPattern | DatePattern>;
}

export type ValueState = "value" | "null" | "missing";

export interface EvaluationResult {
  readonly value: Value;
  readonly text: string;
  readonly valueState: ValueState;
  /** 结果对应的数据路径（尽力：sort/take 后仍可追踪原始下标）。 */
  readonly dataPath?: string;
  readonly diagnostics: readonly Diagnostic[];
}

interface State {
  value: Value;
  /** 当前值的数据路径；派生值（count/if/format）沿用来源路径。 */
  dataPath: string | undefined;
  /** 数组值中每个元素在原始数据数组中的下标（sort/take 后保持可追踪）。 */
  indices: number[] | undefined;
  /** 首次变为 Missing 时的路径。 */
  missingAt: string | undefined;
}

/** 数组值的初始下标表（0..n-1）；非数组没有可追踪的元素。 */
function identityIndices(value: Value): number[] | undefined {
  return isJsonArray(value) ? value.map((_, i) => i) : undefined;
}

class Evaluator {
  readonly diagnostics: Diagnostic[] = [];

  constructor(private readonly ctx: EvaluationContext) {}

  private diag(diagnostic: Omit<Diagnostic, "phase" | "nodeId" | "bindingId">): void {
    this.diagnostics.push({
      ...diagnostic,
      phase: "bind",
      nodeId: this.ctx.nodeId,
      bindingId: this.ctx.bindingId,
    });
  }

  private legacyChange(rule: string, message: string, dataPath: string | undefined): void {
    this.diag({
      code: "LEGACY_SEMANTIC_CHANGE",
      severity: "info",
      message,
      ...(dataPath === undefined ? {} : { dataPath }),
      details: { rule, bindingPolicyVersion: this.ctx.policy },
    });
  }

  private resolveSegments(
    start: Value,
    segments: readonly PathSegment[],
    basePath: string | undefined,
  ): { value: Value; dataPath: string | undefined; missingAt: string | undefined } {
    let cursor = start;
    let dataPath = basePath;
    const append = (segment: PathSegment): void => {
      const text = pathSegmentsToText([segment]);
      dataPath =
        dataPath === undefined || dataPath.length === 0
          ? text
          : segment.kind === "index"
            ? `${dataPath}${text}`
            : `${dataPath}.${text}`;
    };
    for (const segment of segments) {
      append(segment);
      if (isMissing(cursor)) return { value: MISSING, dataPath, missingAt: dataPath };
      if (segment.kind === "index") {
        if (!isJsonArray(cursor) || segment.index < 0 || segment.index >= cursor.length) {
          return { value: MISSING, dataPath, missingAt: dataPath };
        }
        cursor = cursor[segment.index] as JsonValue;
        continue;
      }
      if (!isJsonObject(cursor) || !Object.hasOwn(cursor, segment.name)) {
        return { value: MISSING, dataPath, missingAt: dataPath };
      }
      cursor = cursor[segment.name] as JsonValue;
    }
    return { value: cursor, dataPath, missingAt: undefined };
  }

  private resolveSource(path: PathRef): State {
    const { scope, policy } = this.ctx;
    const text = pathRefToText(path);
    const finish = (
      value: Value,
      dataPath: string | undefined,
      missingAt: string | undefined,
    ): State => ({
      value,
      dataPath,
      indices: identityIndices(value),
      missingAt,
    });

    if (path.scope === "root") {
      const r = this.resolveSegments(scope.root, path.segments, "$");
      return finish(r.value, r.dataPath, r.missingAt);
    }
    if (path.scope === "current") {
      const r = this.resolveSegments(scope.current, path.segments, ".");
      return finish(r.value, r.dataPath, r.missingAt);
    }

    const fromCurrent = this.resolveSegments(scope.current, path.segments, undefined);
    if (policy === "strict-1") {
      return finish(fromCurrent.value, fromCurrent.dataPath, fromCurrent.missingAt);
    }

    // legacy-compat-1：当前项取不到（Missing 或 null）时回溯父级，最后到根。
    if (!isMissing(fromCurrent.value) && fromCurrent.value !== null) {
      return finish(fromCurrent.value, fromCurrent.dataPath, fromCurrent.missingAt);
    }
    let parent = scope.parent;
    let depth = 0;
    while (parent !== undefined) {
      depth++;
      const r = this.resolveSegments(parent.current, path.segments, undefined);
      if (!isMissing(r.value) && r.value !== null) {
        this.legacyChange(
          "scope-fallback",
          `path '${text}' resolved from an ancestor scope (${depth} level(s) up); strict-1 would resolve against the current item only`,
          r.dataPath,
        );
        return finish(r.value, r.dataPath, r.missingAt);
      }
      parent = parent.parent;
    }
    if (scope.parent !== undefined) {
      const r = this.resolveSegments(scope.root, path.segments, undefined);
      if (!isMissing(r.value) && r.value !== null) {
        this.legacyChange(
          "scope-fallback",
          `path '${text}' resolved from the root scope; strict-1 would resolve against the current item only`,
          r.dataPath,
        );
        return finish(r.value, r.dataPath, r.missingAt);
      }
    }
    return finish(fromCurrent.value, fromCurrent.dataPath, fromCurrent.missingAt);
  }

  /**
   * 逐项解析 sort/maxby/minby 的键。键缺失（区别于显式 null）不能直接进入比较——Missing 会被当成最小值而选错项。
   * strict-1：任一项键缺失 → 整体 Missing，诊断指向首个缺失键的原始数据路径；
   * legacy-compat-1：按旧引擎把缺失键当 null 比较，并记 LEGACY_SEMANTIC_CHANGE（rule `missing-as-null`）。
   */
  private itemKeys(
    state: State,
    array: readonly JsonValue[],
    key: readonly PathSegment[],
    op: "sort" | "maxby" | "minby",
  ): { keys: Value[]; missingAt: undefined } | { keys: undefined; missingAt: string } {
    const keys: Value[] = [];
    let firstMissing: string | undefined;
    let missingCount = 0;
    for (let i = 0; i < array.length; i++) {
      const original = state.indices?.[i] ?? i;
      const itemPath = `${state.dataPath ?? ""}[${original}]`;
      const r = this.resolveSegments(array[i] as JsonValue, key, itemPath);
      if (r.missingAt === undefined) {
        keys.push(r.value);
        continue;
      }
      if (this.ctx.policy === "strict-1") return { keys: undefined, missingAt: r.missingAt };
      firstMissing ??= r.missingAt;
      missingCount++;
      keys.push(null);
    }
    if (firstMissing !== undefined) {
      this.diag({
        code: "LEGACY_SEMANTIC_CHANGE",
        severity: "info",
        message: `'${op}' key '${pathSegmentsToText(key)}' is missing on ${missingCount} item(s) and compared as null (legacy); strict-1 reports BINDING_MISSING instead`,
        dataPath: firstMissing,
        details: {
          rule: "missing-as-null",
          op,
          missingCount,
          bindingPolicyVersion: this.ctx.policy,
        },
      });
    }
    return { keys, missingAt: undefined };
  }

  private pattern(kind: "number" | "date", pattern: string): NumberPattern | DatePattern {
    const key = `${kind}:${pattern}`;
    let parsed = this.ctx.patternCache.get(key);
    if (parsed === undefined) {
      parsed = kind === "number" ? parseNumberPattern(pattern) : parseDatePattern(pattern);
      this.ctx.patternCache.set(key, parsed);
    }
    return parsed;
  }

  private pickIndex(state: State, index: number): State {
    if (!isJsonArray(state.value)) return state;
    const array = state.value;
    const normalized = index < 0 ? array.length + index : index;
    if (normalized < 0 || normalized >= array.length) {
      const at = `${state.dataPath ?? ""}[${index}]`;
      return { value: MISSING, dataPath: at, indices: undefined, missingAt: at };
    }
    const original = state.indices?.[normalized] ?? normalized;
    const value = array[normalized] as JsonValue;
    return {
      value,
      dataPath: `${state.dataPath ?? ""}[${original}]`,
      indices: identityIndices(value),
      missingAt: undefined,
    };
  }

  private apply(state: State, step: OperationNode): State {
    if (isMissing(state.value)) {
      // 旧引擎不区分 Missing 与 null：`if` 视缺失为假、`count` 视缺失为 0。
      // legacy-compat-1 复刻该行为并标记语义变化；strict-1 让 Missing 一路传播（诊断只报首个缺失路径）。
      if (this.ctx.policy === "legacy-compat-1" && (step.op === "if" || step.op === "count")) {
        this.legacyChange(
          "missing-as-null",
          `'${step.op}' consumed a missing value as null (legacy); strict-1 reports BINDING_MISSING instead`,
          state.missingAt ?? state.dataPath,
        );
        return this.apply({ ...state, value: null, missingAt: undefined }, step);
      }
      return state;
    }
    const value = state.value;

    switch (step.op) {
      case "sort": {
        if (!isJsonArray(value)) return state;
        const resolved = this.itemKeys(state, value, step.key, "sort");
        if (resolved.keys === undefined) {
          return {
            value: MISSING,
            dataPath: resolved.missingAt,
            indices: undefined,
            missingAt: resolved.missingAt,
          };
        }
        const { keys } = resolved;
        const order = value.map((_, i) => i);
        const sign = step.direction === "desc" ? -1 : 1;
        // 稳定排序：相等键按输入序号 tie-break（spec §6），desc 只取反比较器而不反转序列。
        order.sort((a, b) => sign * compareValues(keys[a] as Value, keys[b] as Value) || a - b);
        return {
          value: order.map((i) => value[i] as JsonValue),
          dataPath: state.dataPath,
          indices: order.map((i) => state.indices?.[i] ?? i),
          missingAt: undefined,
        };
      }
      case "take": {
        if (!isJsonArray(value)) return state;
        return {
          value: value.slice(0, step.count),
          dataPath: state.dataPath,
          indices: (state.indices ?? value.map((_, i) => i)).slice(0, step.count),
          missingAt: undefined,
        };
      }
      case "first":
        return this.pickIndex(state, 0);
      case "last":
        return this.pickIndex(state, -1);
      case "nth":
        return this.pickIndex(state, step.rank - 1);
      case "at":
        return this.pickIndex(state, step.index);
      case "maxby":
      case "minby": {
        if (!isJsonArray(value)) return state;
        if (value.length === 0) return this.pickIndex(state, 0); // 空列表无极值项 → Missing
        const resolved = this.itemKeys(state, value, step.key, step.op);
        if (resolved.keys === undefined) {
          return {
            value: MISSING,
            dataPath: resolved.missingAt,
            indices: undefined,
            missingAt: resolved.missingAt,
          };
        }
        const { keys } = resolved;
        let best = 0;
        for (let i = 1; i < value.length; i++) {
          const cmp = compareValues(keys[i] as Value, keys[best] as Value);
          if ((step.op === "maxby" && cmp > 0) || (step.op === "minby" && cmp < 0)) best = i;
        }
        return this.pickIndex(state, best);
      }
      case "get": {
        if (step.path.length === 0) return state;
        const r = this.resolveSegments(value, step.path, state.dataPath);
        return {
          value: r.value,
          dataPath: r.dataPath,
          indices: identityIndices(r.value),
          missingAt: r.missingAt,
        };
      }
      case "count": {
        let count: number;
        if (value === null) count = 0;
        else if (isJsonArray(value)) count = value.length;
        else if (this.ctx.policy === "strict-1") {
          // strict-1：count 要求数组（spec §6 把对象属性数/字符串长度/标量为 1 列为兼容语义）。
          this.diag({
            code: "EXPRESSION_UNSUPPORTED",
            severity: "error",
            message: `count requires an array under strict-1 (got ${isJsonObject(value) ? "object" : typeof value})`,
            ...(state.dataPath === undefined ? {} : { dataPath: state.dataPath }),
            details: { op: "count", rule: "count-non-array" },
          });
          return { value: "", dataPath: state.dataPath, indices: undefined, missingAt: undefined };
        } else {
          count = isJsonObject(value)
            ? Object.keys(value).length
            : typeof value === "string"
              ? value.length
              : 1;
          this.legacyChange(
            "count-non-array",
            `count applied to a non-array value (${typeof value}); legacy counts object keys / string length / scalar as 1`,
            state.dataPath,
          );
        }
        return { value: count, dataPath: state.dataPath, indices: undefined, missingAt: undefined };
      }
      case "if": {
        const truth = evaluateTruthiness(value, this.ctx.policy);
        if (truth.legacyDiverged) {
          this.legacyChange(
            "string-truthiness",
            `string '${String(value)}' is truthy under legacy-compat-1 but falsy under strict-1`,
            state.dataPath,
          );
        }
        return {
          value: truth.value ? step.whenTrue : step.whenFalse,
          dataPath: state.dataPath,
          indices: undefined,
          missingAt: undefined,
        };
      }
      case "format":
        return { ...state, value: this.format(value, step), indices: undefined };
    }
  }

  private format(value: JsonValue, step: Extract<OperationNode, { op: "format" }>): JsonValue {
    const { format } = step;
    try {
      if (format.kind === "date") {
        const parts = toDateTimeParts(value, this.ctx.timeZone);
        if (parts)
          return formatDateTime(parts, this.pattern("date", format.pattern) as DatePattern);
      } else {
        const decimal = toDecimal(value);
        if (decimal) {
          return formatDecimal(decimal, this.pattern("number", format.pattern) as NumberPattern);
        }
      }
    } catch (error) {
      if (error instanceof FormatPatternError) {
        this.diag({
          code: "FORMAT_PATTERN_UNSUPPORTED",
          severity: "error",
          message: error.message,
          details: { formatKind: format.kind, pattern: format.pattern },
        });
        return this.text(value);
      }
      throw error;
    }
    // 值不是数字/日期：与旧引擎一致，退回纯文本。
    return this.text(value);
  }

  private text(value: Value): string {
    if (typeof value === "boolean" && this.ctx.policy === "legacy-compat-1") {
      this.legacyChange(
        "boolean-text",
        "boolean rendered as 'True'/'False' (legacy); strict-1 renders 'true'/'false'",
        undefined,
      );
      return toText(value, "pascal");
    }
    return toText(value, "lower");
  }

  evaluate(ast: ExpressionAst): EvaluationResult {
    let state = this.resolveSource(ast.source);
    for (const step of ast.steps) {
      state = this.apply(state, step);
    }

    let valueState: ValueState = "value";
    if (isMissing(state.value)) {
      valueState = "missing";
      const missingPath = state.missingAt ?? state.dataPath ?? pathRefToText(ast.source);
      this.diag({
        code: "BINDING_MISSING",
        severity: this.ctx.policy === "strict-1" ? "error" : "warning",
        message: `data path '${missingPath}' is missing (distinct from an explicit null)`,
        dataPath: missingPath,
        details: { expression: pathRefToText(ast.source) },
      });
    } else if (state.value === null) {
      valueState = "null";
    }

    return {
      value: state.value,
      text: this.text(state.value),
      valueState,
      ...(state.dataPath === undefined ? {} : { dataPath: state.dataPath }),
      diagnostics: this.diagnostics,
    };
  }
}

export function evaluateExpression(ast: ExpressionAst, ctx: EvaluationContext): EvaluationResult {
  return new Evaluator(ctx).evaluate(ast);
}
