/**
 * 结构化诊断（spec §12：最低字段 code / severity / phase / nodeId / bindingId / dataPath / pageIndex / message）。
 * 所有 TS 内核模块（Document Model、Template Compiler、Binding Core……）共用同一形状。
 */

/**
 * spec §12 首版错误码 + 本仓库补充码：
 * - `MODEL_INVALID`：文档模型 schema 校验失败（issue 04）；
 * - `REPEAT_KEY_INVALID`：重复键重复 / 为 null / 非标量（issue 05；spec §4「键重复报错」，§12 未列独立码位）。
 */
export const diagnosticCodes = [
  "FONT_MISSING",
  "GLYPH_MISSING",
  "BINDING_MISSING",
  "EXPRESSION_UNSUPPORTED",
  "FORMAT_PATTERN_UNSUPPORTED",
  "SCOPE_AMBIGUOUS",
  "REPEAT_LIMIT",
  "RESOURCE_FORBIDDEN",
  "BARCODE_VALUE_INVALID",
  "BARCODE_NORMALIZED",
  "LEGACY_SEMANTIC_CHANGE",
  "UNSUPPORTED_FEATURE",
  "LAYOUT_OVERFLOW",
  "PAGINATION_NOT_CONVERGED",
  "RESOURCE_LIMIT",
  "IR_VERSION_UNSUPPORTED",
  "SIGNATURE_INVALIDATED",
  "MODEL_INVALID",
  "REPEAT_KEY_INVALID",
] as const;

export type DiagnosticCode = (typeof diagnosticCodes)[number];

export type DiagnosticSeverity = "error" | "warning" | "info";

/** 产生诊断的阶段。排版/写出阶段由后续票追加。 */
export type DiagnosticPhase = "model" | "compile" | "bind";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly phase: DiagnosticPhase;
  readonly message: string;
  /** 模板节点稳定标识（结构身份）。 */
  readonly nodeId?: string;
  /** 绑定标识（与 nodeId 分离）。 */
  readonly bindingId?: string;
  /** 数据路径（如 `institutions[1].revenue`）。 */
  readonly dataPath?: string;
  /** 页索引（排版阶段才有）。 */
  readonly pageIndex?: number;
  /** 机器可读的补充信息（如旧表达式、被拒绝的模式）。 */
  readonly details?: Readonly<Record<string, unknown>>;
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
