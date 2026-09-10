import type { DiagnosticCode } from "@ofd-compose/document-model";

export type ExpressionErrorCode = Extract<
  DiagnosticCode,
  "EXPRESSION_UNSUPPORTED" | "FORMAT_PATTERN_UNSUPPORTED"
>;

/** 表达式编译失败；由 compile() 转成节点级诊断。 */
export class ExpressionCompileError extends Error {
  constructor(
    readonly code: ExpressionErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ExpressionCompileError";
  }
}
