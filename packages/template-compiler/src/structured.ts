import type { StructuredExpression, StructuredStep } from "@ofd-compose/document-model";
import {
  type ExpressionAst,
  expressionLanguageVersion,
  type Normalization,
  type OperationNode,
  type PathSegment,
  toLegacyExpression,
} from "./ast.js";
import { ExpressionCompileError } from "./errors.js";
import { buildFormatSpec } from "./format-spec.js";
import type { CompiledExpression } from "./legacy-parser.js";
import { PathSyntaxError, parsePathRef, parsePathSegments } from "./path.js";

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

function compileStep(
  step: StructuredStep,
  record: (from: string, to: string) => void,
): OperationNode {
  switch (step.op) {
    case "sort":
      return {
        op: "sort",
        key: segmentsOf(step.key, "sort key"),
        direction: step.direction ?? "asc",
      };
    case "take":
      return { op: "take", count: step.count };
    case "first":
    case "last":
    case "count":
      return { op: step.op };
    case "nth":
      return { op: "nth", rank: step.rank };
    case "at":
      return { op: "at", index: step.index };
    case "maxby":
    case "minby":
      return { op: step.op, key: segmentsOf(step.key, `${step.op} key`) };
    case "get":
    case "pick": {
      if (step.op === "pick") record("pick", "get");
      const path = step.path.trim();
      return { op: "get", path: path === "." ? [] : segmentsOf(path, "get path") };
    }
    case "if":
      return { op: "if", whenTrue: step.whenTrue, whenFalse: step.whenFalse ?? "" };
    case "format": {
      const built = buildFormatSpec(step.kind, step.pattern);
      if (built.normalizedFrom !== undefined) record(built.normalizedFrom, built.spec.kind);
      return { op: "format", format: built.spec };
    }
  }
}

/** 结构化配置（可视化面板）→ 与旧文本语法相同的版本化 AST；同时生成规范化旧文本以保持三方映射。 */
export function compileStructuredExpression(expression: StructuredExpression): CompiledExpression {
  let source: ExpressionAst["source"];
  try {
    source = parsePathRef(expression.source);
  } catch (error) {
    if (error instanceof PathSyntaxError) {
      throw new ExpressionCompileError("EXPRESSION_UNSUPPORTED", error.message, {
        path: expression.source,
      });
    }
    throw error;
  }

  const normalizations: Normalization[] = [];
  const steps = expression.steps.map((step, index) => {
    const astPath = `steps[${index}]` as const;
    try {
      return compileStep(step, (from, to) => normalizations.push({ astPath, from, to }));
    } catch (error) {
      if (error instanceof ExpressionCompileError) {
        throw new ExpressionCompileError(error.code, error.message, {
          ...error.details,
          step,
          astPath,
        });
      }
      throw error;
    }
  });

  const ast: ExpressionAst = { version: expressionLanguageVersion, source, steps };
  const legacy = toLegacyExpression(ast);
  return {
    ast,
    sourceMap: {
      origin: "structured",
      legacyText: legacy.text,
      spans: legacy.spans,
      normalizations,
    },
  };
}
