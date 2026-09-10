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

/** 执行 `compileStep`，把编译错误补上所在步骤的位置信息（astPath / step / span）后重抛。 */
export function withStepContext<T>(
  compileStep: () => T,
  context: Readonly<Record<string, unknown>>,
): T {
  try {
    return compileStep();
  } catch (error) {
    if (error instanceof ExpressionCompileError) {
      throw new ExpressionCompileError(error.code, error.message, { ...error.details, ...context });
    }
    throw error;
  }
}
