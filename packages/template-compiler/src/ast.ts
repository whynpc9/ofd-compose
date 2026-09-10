/**
 * 版本化显示表达式 AST（spec §5 P0 操作集）。
 * 旧管道文本与结构化配置都编译为这一形态；Binding Core 只消费 AST，不再解析文本。
 */

export const expressionLanguageVersion = "expr-1" as const;
export type ExpressionLanguageVersion = typeof expressionLanguageVersion;

export type PathSegment =
  | { readonly kind: "property"; readonly name: string }
  | { readonly kind: "index"; readonly index: number };

/**
 * 数据路径引用。
 * - `implicit`：裸路径（`institutions`），作用域由 bindingPolicy 决定（strict：当前项；legacy-compat：当前项→父级→根回溯）；
 * - `current`：`.`；
 * - `root`：`$` / `$.a.b`。
 */
export interface PathRef {
  readonly scope: "implicit" | "current" | "root";
  readonly segments: readonly PathSegment[];
}

export type FormatSpec =
  | { readonly kind: "number"; readonly pattern: string }
  | { readonly kind: "percent"; readonly pattern: string }
  | { readonly kind: "permille"; readonly pattern: string }
  | { readonly kind: "date"; readonly pattern: string };

export type OperationNode =
  | {
      readonly op: "sort";
      readonly key: readonly PathSegment[];
      readonly direction: "asc" | "desc";
    }
  | { readonly op: "take"; readonly count: number }
  | { readonly op: "first" }
  | { readonly op: "last" }
  | { readonly op: "nth"; readonly rank: number }
  | { readonly op: "at"; readonly index: number }
  | { readonly op: "maxby"; readonly key: readonly PathSegment[] }
  | { readonly op: "minby"; readonly key: readonly PathSegment[] }
  | { readonly op: "get"; readonly path: readonly PathSegment[] }
  | { readonly op: "count" }
  | { readonly op: "if"; readonly whenTrue: string; readonly whenFalse: string }
  | { readonly op: "format"; readonly format: FormatSpec };

export type OperationName = OperationNode["op"];

export interface ExpressionAst {
  readonly version: ExpressionLanguageVersion;
  readonly source: PathRef;
  readonly steps: readonly OperationNode[];
}

export type AstPath = "source" | `steps[${number}]`;

export interface SourceSpan {
  readonly astPath: AstPath;
  /** `legacyText` 中的 UTF-16 起止偏移（半开区间）。 */
  readonly start: number;
  readonly end: number;
}

export interface Normalization {
  readonly astPath: AstPath;
  readonly from: string;
  readonly to: string;
}

/** 模板位置（nodeId/bindingId 由 CompiledBinding 持有）↔ 旧表达式文本 ↔ AST 节点 的映射。 */
export interface ExpressionSourceMap {
  readonly origin: "legacy" | "structured";
  /** 旧管道文本。结构化配置也生成规范化文本，保证映射三方完整。 */
  readonly legacyText: string;
  readonly spans: readonly SourceSpan[];
  /** 别名规范化记录（pick→get、numeric→number、percentage→percent……）。 */
  readonly normalizations: readonly Normalization[];
}

export function pathSegmentsToText(segments: readonly PathSegment[]): string {
  let text = "";
  for (const segment of segments) {
    if (segment.kind === "index") {
      text += `[${segment.index}]`;
    } else {
      text += text.length === 0 ? segment.name : `.${segment.name}`;
    }
  }
  return text;
}

export function pathRefToText(path: PathRef): string {
  const body = pathSegmentsToText(path.segments);
  switch (path.scope) {
    case "current":
      return body.length === 0 ? "." : `.${body}`;
    case "root":
      return body.length === 0 ? "$" : body.startsWith("[") ? `$${body}` : `$.${body}`;
    default:
      return body;
  }
}

export function operationToText(step: OperationNode): string {
  switch (step.op) {
    case "sort":
      return `sort:${pathSegmentsToText(step.key)}:${step.direction}`;
    case "take":
      return `take:${step.count}`;
    case "first":
    case "last":
    case "count":
      return step.op;
    case "nth":
      return `nth:${step.rank}`;
    case "at":
      return `at:${step.index}`;
    case "maxby":
    case "minby":
      return `${step.op}:${pathSegmentsToText(step.key)}`;
    case "get":
      return step.path.length === 0 ? "get:." : `get:${pathSegmentsToText(step.path)}`;
    case "if":
      return step.whenFalse.length === 0
        ? `if:${step.whenTrue}`
        : `if:${step.whenTrue}:${step.whenFalse}`;
    case "format":
      return `format:${step.format.kind}:${step.format.pattern}`;
  }
}

/** 生成规范化旧管道文本及每个 AST 节点在其中的区间。 */
export function toLegacyExpression(ast: ExpressionAst): {
  text: string;
  spans: SourceSpan[];
} {
  const spans: SourceSpan[] = [];
  let text = pathRefToText(ast.source);
  spans.push({ astPath: "source", start: 0, end: text.length });
  ast.steps.forEach((step, index) => {
    const stepText = operationToText(step);
    const start = text.length + 1;
    text = `${text}|${stepText}`;
    spans.push({ astPath: `steps[${index}]`, start, end: start + stepText.length });
  });
  return { text, spans };
}
