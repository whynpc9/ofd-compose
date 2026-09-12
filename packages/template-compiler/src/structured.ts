import type { StructuredExpression, StructuredStep } from "@ofd-compose/document-model";
import {
  type ExpressionAst,
  expressionLanguageVersion,
  type Normalization,
  type OperationNode,
  toLegacyExpression,
} from "./ast.js";
import { withStepContext } from "./errors.js";
import { buildFormatSpec } from "./format-spec.js";
import type { CompiledExpression } from "./legacy-parser.js";
import { segmentsOf, sourceOf } from "./path.js";

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
  const source = sourceOf(expression.source);

  const normalizations: Normalization[] = [];
  const steps = expression.steps.map((step, index) => {
    const astPath = `steps[${index}]` as const;
    return withStepContext(
      () => compileStep(step, (from, to) => normalizations.push({ astPath, from, to })),
      { step, astPath },
    );
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
