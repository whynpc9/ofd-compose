import {
  type BindingPolicyVersion,
  type BlockNode,
  type ConditionalBlock,
  type Diagnostic,
  documentModelSchemaVersion,
  hasErrors,
  type InlineNode,
  modelVersion,
  type Paragraph,
  type RepeatBlock,
  type RepeatRowGroup,
  type Table,
  type TableCell,
  type TableRow,
} from "@ofd-compose/document-model";
import {
  type CompiledBinding,
  type CompiledRepeatKey,
  type CompiledTemplate,
  type PathSegment,
  pathSegmentsToText,
} from "@ofd-compose/template-compiler";
import { isValidTimeZone } from "./date.js";
import {
  type EvaluationBudget,
  type EvaluationConsumer,
  type EvaluationContext,
  type EvaluationResult,
  evaluateExpression,
  type Scope,
} from "./evaluate.js";
import {
  type RepeatInstance,
  type ResolvedBlock,
  type ResolvedDocument,
  type ResolvedFragment,
  type ResolvedParagraph,
  type ResolvedRepeat,
  type ResolvedStructure,
  type ResolvedTable,
  type ResolvedTableCell,
  type ResolvedTableRow,
  resolvedDocumentFormat,
} from "./resolved-document.js";
import { detectTemporalRuntime, type TemporalRuntime } from "./runtime.js";
import { evaluateTruthiness } from "./truthiness.js";
import {
  isJsonArray,
  isJsonObject,
  isMissing,
  type JsonValue,
  MISSING,
  toText,
  type Value,
} from "./values.js";

/** 绑定期预算（spec §5）。超限：重复实例 / 展开节点 → `REPEAT_LIMIT`；排序次数 → `RESOURCE_LIMIT`。 */
export interface BindBudgets {
  /** 单个 RepeatBlock / RepeatRowGroup 一次求值最多展开的实例数。 */
  readonly maxRepeatInstances: number;
  /** 整份文档最多的展开节点数（块、行、片段各计 1）。 */
  readonly maxExpandedNodes: number;
  /** 整份文档最多的排序 / 极值操作次数。 */
  readonly maxSortOperations: number;
}

export const defaultBindBudgets: BindBudgets = {
  maxRepeatInstances: 10_000,
  maxExpandedNodes: 200_000,
  maxSortOperations: 10_000,
};

export interface BindingPolicy {
  /** 覆盖模板 settings.bindingPolicyVersion（如迁移差分时同一模板双跑）。 */
  readonly bindingPolicyVersion?: BindingPolicyVersion;
  readonly budgets?: Partial<BindBudgets>;
  /** 覆盖运行期探测结果（宿主已知镜像内 tzdata 版本时）。 */
  readonly runtime?: TemporalRuntime;
}

export interface BindResult {
  /** 无 error 级诊断。文档在有诊断时仍然产出（供设计器预览定位）。 */
  readonly ok: boolean;
  readonly document: ResolvedDocument;
  readonly diagnostics: readonly Diagnostic[];
}

const fallbackTimeZone = "UTC";

interface RepeatItem {
  readonly value: JsonValue;
  readonly dataPath: string | undefined;
}

interface RepeatExpansion {
  readonly instances: readonly { scope: Scope; instance: RepeatInstance }[];
  /** 已推入 `structure.repeats` 的记录；绑定缺失时为 undefined。 */
  readonly record: ResolvedRepeat | undefined;
}

/** 一次 bind() 调用内所有节点共享的状态与展开逻辑。 */
class Binder {
  readonly diagnostics: Diagnostic[] = [];
  readonly structure: ResolvedStructure = { conditionals: [], repeats: [] };
  private readonly patternCache: EvaluationContext["patternCache"] = new Map();
  private readonly budget: EvaluationBudget;
  private expandedNodes = 0;
  /** 展开节点预算已耗尽：停止一切进一步展开。 */
  private exhausted = false;

  constructor(
    private readonly compiled: CompiledTemplate,
    readonly policy: BindingPolicyVersion,
    /** 经校验的时区；模板时区非法时回退 UTC（已记 error 诊断，文档仍产出供预览）。 */
    private readonly timeZone: string,
    private readonly budgets: BindBudgets,
  ) {
    this.budget = {
      maxSortOperations: budgets.maxSortOperations,
      counters: { sortOperations: 0 },
    };
  }

  private diag(
    node: { nodeId: string; bindingId?: string },
    diagnostic: Omit<Diagnostic, "phase" | "nodeId" | "bindingId">,
  ): void {
    this.diagnostics.push({
      ...diagnostic,
      phase: "bind",
      nodeId: node.nodeId,
      ...(node.bindingId === undefined ? {} : { bindingId: node.bindingId }),
    });
  }

  private legacyChange(
    node: { nodeId: string; bindingId: string },
    rule: string,
    message: string,
    dataPath: string | undefined,
    extra: Record<string, unknown> = {},
  ): void {
    this.diag(node, {
      code: "LEGACY_SEMANTIC_CHANGE",
      severity: "info",
      message,
      ...(dataPath === undefined ? {} : { dataPath }),
      details: { rule, bindingPolicyVersion: this.policy, ...extra },
    });
  }

  /** 计一个展开节点；超出 `maxExpandedNodes` 时报 REPEAT_LIMIT（一次）并进入耗尽状态。 */
  private charge(node: { nodeId: string; bindingId?: string }): boolean {
    if (this.exhausted) return false;
    this.expandedNodes++;
    if (this.expandedNodes <= this.budgets.maxExpandedNodes) return true;
    this.exhausted = true;
    this.diag(node, {
      code: "REPEAT_LIMIT",
      severity: "error",
      message: `document expansion exceeded the budget of ${this.budgets.maxExpandedNodes} node(s); remaining content was not expanded`,
      details: { limit: "maxExpandedNodes", max: this.budgets.maxExpandedNodes },
    });
    return false;
  }

  private binding(node: { nodeId: string; bindingId: string }): CompiledBinding | undefined {
    const binding = this.compiled.bindings[node.bindingId];
    if (binding !== undefined) return binding;
    // compile() 成功时不可能发生；防御性诊断而不是抛异常，保持文档可产出。
    this.diag(node, {
      code: "MODEL_INVALID",
      severity: "error",
      message: `compiled template has no binding '${node.bindingId}'`,
    });
    return undefined;
  }

  private evaluate(
    binding: CompiledBinding,
    scope: Scope,
    consumer: EvaluationConsumer,
  ): EvaluationResult {
    const result = evaluateExpression(binding.ast, {
      policy: this.policy,
      timeZone: this.timeZone,
      scope,
      nodeId: binding.nodeId,
      bindingId: binding.bindingId,
      patternCache: this.patternCache,
      consumer,
      budget: this.budget,
    });
    this.diagnostics.push(...result.diagnostics);
    return result;
  }

  // ---- 正文块 -------------------------------------------------------------

  expandBlocks(
    blocks: readonly BlockNode[],
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): ResolvedBlock[] {
    const out: ResolvedBlock[] = [];
    for (const block of blocks) {
      if (this.exhausted) break;
      switch (block.kind) {
        case "paragraph": {
          const paragraph = this.paragraph(block, scope, instancePath);
          if (paragraph) out.push(paragraph);
          break;
        }
        case "table": {
          const table = this.table(block, scope, instancePath);
          if (table) out.push(table);
          break;
        }
        case "conditional-block":
          if (this.charge(block) && this.conditional(block, scope, instancePath)) {
            out.push(...this.expandBlocks(block.children, scope, instancePath));
          }
          break;
        case "repeat-block": {
          if (!this.charge(block)) break;
          const expansion = this.instances(block, scope, instancePath);
          for (const { scope: itemScope, instance } of expansion.instances) {
            if (!this.charge(block)) {
              this.truncateByNodeBudget(expansion.record, instance.ordinal);
              break;
            }
            out.push(...this.expandBlocks(block.children, itemScope, [...instancePath, instance]));
            if (this.exhausted) {
              // 预算在该实例（可能是最后一个）内部耗尽：该实例不完整，同样是截断。
              this.truncateByNodeBudget(expansion.record, instance.ordinal + 1);
              break;
            }
          }
          break;
        }
      }
    }
    return out;
  }

  private paragraph(
    paragraph: Paragraph,
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): ResolvedParagraph | undefined {
    if (!this.charge(paragraph)) return undefined;
    const fragments: ResolvedFragment[] = [];
    for (const inline of paragraph.inlines) {
      if (!this.charge(inline)) break;
      fragments.push(this.inline(inline, paragraph, scope));
    }
    return {
      kind: "paragraph",
      nodeId: paragraph.nodeId,
      ...(paragraph.styleId === undefined ? {} : { styleId: paragraph.styleId }),
      ...(instancePath.length === 0 ? {} : { instancePath: [...instancePath] }),
      ...(paragraph.layout === undefined ? {} : { layout: paragraph.layout }),
      fragments,
    };
  }

  private inline(inline: InlineNode, paragraph: Paragraph, scope: Scope): ResolvedFragment {
    switch (inline.kind) {
      case "text":
        return {
          kind: "text",
          text: inline.text,
          ...(inline.styleId === undefined ? {} : { styleId: inline.styleId }),
          origin: { kind: "static", nodeId: inline.nodeId },
        };
      case "input-control":
        return inline; // 输入控件不参与绑定，原样进入产物。
      case "dynamic-text": {
        const binding = this.binding(inline);
        if (binding === undefined || binding.role !== "dynamic-text") {
          return {
            kind: "text",
            text: "",
            origin: {
              kind: "dynamic-text",
              nodeId: inline.nodeId,
              bindingId: inline.bindingId,
              expression: "",
              valueState: "missing",
            },
          };
        }
        const result = this.evaluate(binding, scope, "text");
        const styleId =
          binding.styleId ??
          (binding.styleInheritance === "inherit-paragraph" ? paragraph.styleId : undefined);
        return {
          kind: "text",
          text: result.text,
          ...(binding.styleInheritance === "explicit"
            ? { styleInheritance: "explicit" as const }
            : {}),
          ...(styleId === undefined ? {} : { styleId }),
          origin: {
            kind: "dynamic-text",
            nodeId: inline.nodeId,
            bindingId: inline.bindingId,
            expression: binding.sourceMap.legacyText,
            ...(result.dataPath === undefined ? {} : { dataPath: result.dataPath }),
            valueState: result.valueState,
          },
        };
      }
    }
  }

  // ---- 表格 ---------------------------------------------------------------

  private table(
    table: Table,
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): ResolvedTable | undefined {
    if (!this.charge(table)) return undefined;
    const rows: ResolvedTableRow[] = [];
    for (const rowNode of table.rows) {
      if (this.exhausted) break;
      if (rowNode.kind === "table-row") {
        const row = this.row(rowNode, scope, instancePath);
        if (row) rows.push(row);
        continue;
      }
      if (!this.charge(rowNode)) break;
      const expansion = this.instances(rowNode, scope, instancePath);
      for (const { scope: itemScope, instance } of expansion.instances) {
        if (!this.charge(rowNode)) {
          this.truncateByNodeBudget(expansion.record, instance.ordinal);
          break;
        }
        for (const templateRow of rowNode.rows) {
          const row = this.row(templateRow, itemScope, [...instancePath, instance]);
          if (row) rows.push(row);
        }
        if (this.exhausted) {
          this.truncateByNodeBudget(expansion.record, instance.ordinal + 1);
          break;
        }
      }
    }
    return {
      kind: "table",
      nodeId: table.nodeId,
      ...(table.styleId === undefined ? {} : { styleId: table.styleId }),
      ...(instancePath.length === 0 ? {} : { instancePath: [...instancePath] }),
      rows,
    };
  }

  private row(
    row: TableRow,
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): ResolvedTableRow | undefined {
    if (!this.charge(row)) return undefined;
    const cells: ResolvedTableCell[] = [];
    for (const cell of row.cells) {
      if (!this.charge(cell)) break;
      cells.push(this.cell(cell, scope, instancePath));
    }
    // 预算耗尽在首个单元格之前：整行丢弃，保持 ResolvedTableRow.cells minItems 1 的契约。
    if (cells.length === 0) return undefined;
    return {
      kind: "table-row",
      nodeId: row.nodeId,
      ...(instancePath.length === 0 ? {} : { instancePath: [...instancePath] }),
      cells,
    };
  }

  private cell(
    cell: TableCell,
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): ResolvedTableCell {
    return {
      kind: "table-cell",
      nodeId: cell.nodeId,
      ...(cell.styleId === undefined ? {} : { styleId: cell.styleId }),
      blocks: this.expandBlocks(cell.blocks, scope, instancePath),
    };
  }

  // ---- 结构节点 -----------------------------------------------------------

  /** ConditionalBlock：按绑定策略的 truthiness 表决定显隐；Missing 在 strict-1 下为 BINDING_MISSING 且隐藏。 */
  private conditional(
    block: ConditionalBlock,
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): boolean {
    const binding = this.binding(block);
    if (binding === undefined) return false;
    const result = this.evaluate(binding, scope, "condition");
    let visible = false;
    if (result.valueState !== "missing") {
      const truth = evaluateTruthiness(result.value, this.policy);
      if (truth.legacyDiverged) {
        this.legacyChange(
          block,
          "string-truthiness",
          `string '${String(result.value)}' is truthy under legacy-compat-1 but falsy under strict-1`,
          result.dataPath,
        );
      }
      visible = truth.value;
    }
    this.structure.conditionals.push({
      nodeId: block.nodeId,
      bindingId: block.bindingId,
      expression: binding.sourceMap.legacyText,
      visible,
      valueState: result.valueState,
      ...(result.dataPath === undefined ? {} : { dataPath: result.dataPath }),
      ...(instancePath.length === 0 ? {} : { instancePath: [...instancePath] }),
    });
    return visible;
  }

  /** RepeatBlock / RepeatRowGroup：求值为序列 → 每项一个实例（作用域 + 身份）。 */
  private instances(
    node: RepeatBlock | RepeatRowGroup,
    scope: Scope,
    instancePath: readonly RepeatInstance[],
  ): RepeatExpansion {
    const binding = this.binding(node);
    if (
      binding === undefined ||
      binding.role === "dynamic-text" ||
      binding.role === "conditional-block"
    ) {
      return { instances: [], record: undefined };
    }
    const result = this.evaluate(binding, scope, "sequence");
    let items = this.sequenceItems(node, result);

    let truncated = false;
    if (items.length > this.budgets.maxRepeatInstances) {
      truncated = true;
      this.diag(node, {
        code: "REPEAT_LIMIT",
        severity: "error",
        message: `repeat produced ${items.length} instance(s); the budget is ${this.budgets.maxRepeatInstances}. Only the first ${this.budgets.maxRepeatInstances} were expanded`,
        ...(result.dataPath === undefined ? {} : { dataPath: result.dataPath }),
        details: {
          limit: "maxRepeatInstances",
          max: this.budgets.maxRepeatInstances,
          actual: items.length,
        },
      });
      items = items.slice(0, this.budgets.maxRepeatInstances);
    }

    const keys = this.repeatKeys(node, binding.repeatKey, items);
    const record: ResolvedRepeat = {
      nodeId: node.nodeId,
      bindingId: node.bindingId,
      kind: node.kind,
      expression: binding.sourceMap.legacyText,
      valueState: result.valueState,
      ...(result.dataPath === undefined ? {} : { dataPath: result.dataPath }),
      instanceCount: items.length,
      ...(truncated ? { truncated: true as const } : {}),
      ...(instancePath.length === 0 ? {} : { instancePath: [...instancePath] }),
    };
    this.structure.repeats.push(record);

    const instances = items.map((item, ordinal) => ({
      scope: {
        current: item.value,
        parent: scope,
        root: scope.root,
        ...(item.dataPath === undefined ? {} : { dataPath: item.dataPath }),
      },
      instance: {
        nodeId: node.nodeId,
        bindingId: node.bindingId,
        key: keys[ordinal] ?? String(ordinal),
        keyKind: binding.repeatKey.kind,
        ordinal,
        ...(item.dataPath === undefined ? {} : { dataPath: item.dataPath }),
      },
    }));
    return { instances, record };
  }

  /**
   * 全文档节点预算在重复中途耗尽：结构记录只保留实际进入展开的实例数（含不完整的最后一个）并标注 truncated。
   * 预算恰好在最后一个实例的子树内耗尽时也会标注——只要该重复的某个实例不完整，记录就不能宣称完整。
   */
  private truncateByNodeBudget(record: ResolvedRepeat | undefined, expandedCount: number): void {
    if (record === undefined) return;
    record.instanceCount = expandedCount;
    record.truncated = true;
  }

  /**
   * 序列语义：数组 → 逐项；null / Missing → 零项；非数组：strict-1 报 EXPRESSION_UNSUPPORTED（Repeat 要求数组），
   * legacy-compat-1 复刻旧引擎「truthy 非数组循环一次」并记 LEGACY_SEMANTIC_CHANGE。
   */
  private sequenceItems(
    node: RepeatBlock | RepeatRowGroup,
    result: EvaluationResult,
  ): RepeatItem[] {
    const { value } = result;
    if (isMissing(value) || value === null) return [];
    if (isJsonArray(value)) {
      return value.map((item, i) => ({
        value: item,
        dataPath: result.elementDataPaths?.[i] ?? `${result.dataPath ?? ""}[${i}]`,
      }));
    }
    const kind = isJsonObject(value) ? "object" : typeof value;
    if (this.policy === "strict-1") {
      this.diag(node, {
        code: "EXPRESSION_UNSUPPORTED",
        severity: "error",
        message: `repeat requires an array under strict-1 (got ${kind}); legacy-compat-1 would loop once over a truthy non-array value`,
        ...(result.dataPath === undefined ? {} : { dataPath: result.dataPath }),
        details: { rule: "repeat-non-array", valueKind: kind },
      });
      return [];
    }
    const truth = evaluateTruthiness(value, this.policy);
    if (truth.value) {
      this.legacyChange(
        node,
        "repeat-non-array-once",
        `repeat over a truthy non-array value (${kind}) loops once with that value as the current item (legacy); strict-1 requires an array`,
        result.dataPath,
        { valueKind: kind },
      );
      return [{ value, dataPath: result.dataPath }];
    }
    this.legacyChange(
      node,
      "repeat-non-array-skipped",
      `repeat over a falsy non-array value (${kind}) produced no instances (legacy); strict-1 requires an array`,
      result.dataPath,
      { valueKind: kind },
    );
    return [];
  }

  /** 重复键：path 键必须是同一重复内唯一的标量；缺失 → BINDING_MISSING，null/非标量/重复 → REPEAT_KEY_INVALID。 */
  private repeatKeys(
    node: RepeatBlock | RepeatRowGroup,
    repeatKey: CompiledRepeatKey,
    items: readonly RepeatItem[],
  ): string[] {
    const keys: string[] = [];
    if (repeatKey.kind === "ordinal") {
      for (let i = 0; i < items.length; i++) keys.push(String(i));
      return keys;
    }
    const seen = new Map<string, number>();
    const keyText = pathSegmentsToText(repeatKey.segments);
    items.forEach((item, ordinal) => {
      const keyPath =
        item.dataPath === undefined || keyText.startsWith("[")
          ? `${item.dataPath ?? ""}${keyText}`
          : `${item.dataPath}.${keyText}`;
      const raw = resolveKey(item.value, repeatKey.segments);
      let key: string;
      if (isMissing(raw)) {
        this.diag(node, {
          code: "BINDING_MISSING",
          severity: "error",
          message: `repeat key '${repeatKey.text}' is missing on instance ${ordinal}; the ordinal was used as a fallback identity`,
          dataPath: keyPath,
          details: { repeatKey: repeatKey.text, ordinal },
        });
        key = `#${ordinal}`;
      } else if (raw === null || isJsonArray(raw) || isJsonObject(raw)) {
        this.diag(node, {
          code: "REPEAT_KEY_INVALID",
          severity: "error",
          message: `repeat key '${repeatKey.text}' must be a scalar; instance ${ordinal} has ${raw === null ? "null" : isJsonArray(raw) ? "an array" : "an object"}`,
          dataPath: keyPath,
          details: {
            rule: raw === null ? "null" : "non-scalar",
            repeatKey: repeatKey.text,
            ordinal,
          },
        });
        key = `#${ordinal}`;
      } else {
        key = toText(raw, "lower");
      }
      // 占位键也参与唯一性检查：合法键 "#1" 与占位 "#1" 相撞同样是身份歧义。
      const first = seen.get(key);
      if (first !== undefined) {
        this.diag(node, {
          code: "REPEAT_KEY_INVALID",
          severity: "error",
          message: `repeat key '${repeatKey.text}' value '${key}' is duplicated (instances ${first} and ${ordinal}); instance identity is ambiguous`,
          dataPath: keyPath,
          details: {
            rule: "duplicate",
            repeatKey: repeatKey.text,
            key,
            firstOrdinal: first,
            ordinal,
          },
        });
      } else {
        seen.set(key, ordinal);
      }
      keys.push(key);
    });
    return keys;
  }
}

function resolveKey(item: JsonValue, segments: readonly PathSegment[]): Value {
  let cursor: Value = item;
  for (const segment of segments) {
    if (isMissing(cursor)) return MISSING;
    if (segment.kind === "index") {
      if (!isJsonArray(cursor) || segment.index < 0 || segment.index >= cursor.length)
        return MISSING;
      cursor = cursor[segment.index] as JsonValue;
    } else {
      if (!isJsonObject(cursor) || !Object.hasOwn(cursor, segment.name)) return MISSING;
      cursor = cursor[segment.name] as JsonValue;
    }
  }
  return cursor;
}

/**
 * bind(CompiledTemplate, Data, BindingPolicy) → ResolvedDocument + Diagnostics（spec §2）。
 * 叙述句中的 DynamicText 以行内片段出现在同一段落；ConditionalBlock / RepeatBlock / RepeatRowGroup 在此展开。
 */
export function bind(
  compiled: CompiledTemplate,
  data: JsonValue,
  policy: BindingPolicy = {},
): BindResult {
  const bindingPolicyVersion =
    policy.bindingPolicyVersion ?? compiled.settings.bindingPolicyVersion;
  const { timeZone } = compiled.settings;
  const timeZoneValid = isValidTimeZone(timeZone);
  const binder = new Binder(
    compiled,
    bindingPolicyVersion,
    timeZoneValid ? timeZone : fallbackTimeZone,
    {
      // 逐字段 `??`：宿主转发可选配置时显式的 undefined 不得关闭或反转预算。
      maxRepeatInstances:
        policy.budgets?.maxRepeatInstances ?? defaultBindBudgets.maxRepeatInstances,
      maxExpandedNodes: policy.budgets?.maxExpandedNodes ?? defaultBindBudgets.maxExpandedNodes,
      maxSortOperations: policy.budgets?.maxSortOperations ?? defaultBindBudgets.maxSortOperations,
    },
  );
  if (!timeZoneValid) {
    // document-model 只能校验非空字符串；时区表的归属方是 binding-core（temporal-polyfill），
    // 所以在这里以模板级诊断拦截，而不是让 RangeError 从 bind() 抛出。
    binder.diagnostics.push({
      code: "MODEL_INVALID",
      severity: "error",
      phase: "bind",
      message: `settings.timeZone '${timeZone}' is not a recognized IANA time zone; zoned date values were formatted in ${fallbackTimeZone} for this preview`,
      details: { setting: "timeZone", timeZone, fallbackTimeZone },
    });
  }

  const body = binder.expandBlocks(compiled.body, { current: data, root: data }, []);

  const document: ResolvedDocument = {
    format: resolvedDocumentFormat,
    modelVersion,
    templateSchemaVersion: documentModelSchemaVersion,
    expressionLanguageVersion: compiled.expressionLanguageVersion,
    bindingPolicyVersion,
    documentId: compiled.documentId,
    revisionId: compiled.revisionId,
    settings: compiled.settings,
    styles: compiled.styles,
    body,
    structure: binder.structure,
    runtime: policy.runtime ?? detectTemporalRuntime(),
    ...(compiled.provenance === undefined ? {} : { provenance: compiled.provenance }),
  };

  return { ok: !hasErrors(binder.diagnostics), document, diagnostics: binder.diagnostics };
}
