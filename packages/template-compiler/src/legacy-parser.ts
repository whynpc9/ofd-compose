import {
  type ExpressionAst,
  type ExpressionSourceMap,
  expressionLanguageVersion,
  type Normalization,
  type OperationNode,
  type PathSegment,
  type SourceSpan,
} from "./ast.js";
import { ExpressionCompileError } from "./errors.js";
import { buildFormatSpec } from "./format-spec.js";
import { PathSyntaxError, parsePathRef, parsePathSegments } from "./path.js";

export interface CompiledExpression {
  readonly ast: ExpressionAst;
  readonly sourceMap: ExpressionSourceMap;
}

interface RawStep {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** 按旧引擎规则切分管道：`|` 分隔、两端去空白、空段丢弃；同时记录每段在原文中的区间。 */
function splitPipeline(text: string): RawStep[] {
  const steps: RawStep[] = [];
  let segmentStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "|") {
      const raw = text.slice(segmentStart, i);
      const leading = raw.length - raw.trimStart().length;
      const trimmed = raw.trim();
      if (trimmed.length > 0) {
        steps.push({
          text: trimmed,
          start: segmentStart + leading,
          end: segmentStart + leading + trimmed.length,
        });
      }
      segmentStart = i + 1;
    }
  }
  return steps;
}

function parseInteger(text: string, what: string): number {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new ExpressionCompileError(
      "EXPRESSION_UNSUPPORTED",
      `${what} requires an integer, got '${text}'`,
    );
  }
  return Number.parseInt(trimmed, 10);
}

function segmentsOf(path: string, what: string): PathSegment[] {
  try {
    return parsePathSegments(path.trim());
  } catch (error) {
    if (error instanceof PathSyntaxError) {
      throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", `${what}: ${error.message}`);
    }
    throw error;
  }
}

function requireArity(parts: readonly string[], op: string, max: number): void {
  if (parts.length - 1 > max) {
    throw new ExpressionCompileError(
      "EXPRESSION_UNSUPPORTED",
      `operation '${op}' takes at most ${max} argument(s), got ${parts.length - 1}`,
      { operation: op },
    );
  }
}

/**
 * 解析一个管道步骤（`name:arg1:arg2…`）。参数拼接规则与旧引擎一致：
 * `get`/`maxby`/`minby` 的路径与 `if` 的 false 分支、`format` 的模式允许包含 `:`（按原样重新拼接）。
 */
function parseOperation(step: string, record: (from: string, to: string) => void): OperationNode {
  const parts = step.split(":");
  const command = (parts[0] ?? "").trim().toLowerCase();
  const rest = (from: number): string => parts.slice(from).join(":");

  switch (command) {
    case "sort": {
      requireArity(parts, command, 2);
      const key = (parts[1] ?? "").trim();
      if (key.length === 0) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          "sort requires a key path: sort:key[:asc|desc]",
        );
      }
      const directionRaw = (parts[2] ?? "asc").trim();
      const direction = directionRaw.toLowerCase();
      if (direction !== "asc" && direction !== "desc") {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          `sort direction must be asc or desc, got '${directionRaw}'`,
        );
      }
      if (directionRaw !== direction) record(directionRaw, direction);
      return { op: "sort", key: segmentsOf(key, "sort key"), direction };
    }
    case "take": {
      requireArity(parts, command, 1);
      if (parts.length < 2) {
        throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", "take requires a count: take:N");
      }
      const count = parseInteger(parts[1] ?? "", "take");
      if (count < 0) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          `take count must be >= 0, got ${count}`,
        );
      }
      return { op: "take", count };
    }
    case "first":
    case "last":
    case "count":
      requireArity(parts, command, 0);
      return { op: command };
    case "nth": {
      requireArity(parts, command, 1);
      if (parts.length < 2) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          "nth requires a 1-based rank: nth:N",
        );
      }
      const rank = parseInteger(parts[1] ?? "", "nth");
      if (rank <= 0) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          `nth rank must be >= 1, got ${rank}`,
        );
      }
      return { op: "nth", rank };
    }
    case "at": {
      requireArity(parts, command, 1);
      if (parts.length < 2) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          "at requires a 0-based index: at:index",
        );
      }
      return { op: "at", index: parseInteger(parts[1] ?? "", "at") };
    }
    case "get":
    case "pick": {
      if (parts.length < 2) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          `${command} requires a path: ${command}:path`,
        );
      }
      if (command === "pick") record("pick", "get");
      const path = rest(1).trim();
      const segments = path.length === 0 || path === "." ? [] : segmentsOf(path, "get path");
      return { op: "get", path: segments };
    }
    case "maxby":
    case "minby": {
      const key = rest(1).trim();
      if (parts.length < 2 || key.length === 0) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          `${command} requires a key path: ${command}:key`,
        );
      }
      return { op: command, key: segmentsOf(key, `${command} key`) };
    }
    case "if": {
      if (parts.length < 2) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          "if requires at least the true branch: if:trueText[:falseText]",
        );
      }
      return { op: "if", whenTrue: parts[1] ?? "", whenFalse: parts.length >= 3 ? rest(2) : "" };
    }
    case "format": {
      if (parts.length < 2) {
        throw new ExpressionCompileError(
          "EXPRESSION_UNSUPPORTED",
          "format requires a kind: format:number:0.00",
        );
      }
      const built = buildFormatSpec(parts[1] ?? "", parts.length >= 3 ? rest(2) : undefined);
      if (built.normalizedFrom !== undefined) record(built.normalizedFrom, built.spec.kind);
      return { op: "format", format: built.spec };
    }
    default:
      throw new ExpressionCompileError(
        "EXPRESSION_UNSUPPORTED",
        `unsupported operation '${parts[0] ?? ""}'`,
        { operation: parts[0] ?? "" },
      );
  }
}

/** 旧 NDocxTemplater 管道文本 → 版本化 AST + 来源映射。 */
export function compileLegacyExpression(text: string): CompiledExpression {
  const rawSteps = splitPipeline(text);
  const [head, ...rest] = rawSteps;
  if (head === undefined) {
    throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", "expression is empty");
  }

  const spans: SourceSpan[] = [];
  const normalizations: Normalization[] = [];

  let source: ExpressionAst["source"];
  try {
    source = parsePathRef(head.text);
  } catch (error) {
    if (error instanceof PathSyntaxError) {
      throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", error.message, {
        path: head.text,
      });
    }
    throw error;
  }
  spans.push({ astPath: "source", start: head.start, end: head.end });

  const steps: OperationNode[] = rest.map((raw, index) => {
    const astPath = `steps[${index}]` as const;
    spans.push({ astPath, start: raw.start, end: raw.end });
    try {
      return parseOperation(raw.text, (from, to) => normalizations.push({ astPath, from, to }));
    } catch (error) {
      if (error instanceof ExpressionCompileError) {
        throw new ExpressionCompileError(error.code, error.message, {
          ...error.details,
          step: raw.text,
          astPath,
          span: { start: raw.start, end: raw.end },
        });
      }
      throw error;
    }
  });

  return {
    ast: { version: expressionLanguageVersion, source, steps },
    sourceMap: { origin: "legacy", legacyText: text, spans, normalizations },
  };
}
