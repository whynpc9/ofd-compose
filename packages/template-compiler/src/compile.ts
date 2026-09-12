import {
  type BlockNode,
  type Diagnostic,
  type DynamicText,
  type ExpressionSource,
  hasErrors,
  modelVersion,
  type Provenance,
  type TemplateSettings,
  type TemplateSource,
  type TextStyle,
  type ValidateTemplateSourceOptions,
  validateTemplateSource,
} from "@ofd-compose/document-model";
import {
  type ExpressionAst,
  type ExpressionLanguageVersion,
  type ExpressionSourceMap,
  expressionLanguageVersion,
} from "./ast.js";
import { ExpressionCompileError } from "./errors.js";
import { type CompiledExpression, compileLegacyExpression } from "./legacy-parser.js";
import { compileStructuredExpression } from "./structured.js";

export const compiledTemplateFormat = "ofd-compose/compiled-template@0" as const;

export interface CompiledBinding {
  readonly nodeId: string;
  readonly bindingId: string;
  readonly ast: ExpressionAst;
  readonly sourceMap: ExpressionSourceMap;
  readonly styleId?: string;
  readonly styleInheritance: "inherit-paragraph" | "explicit";
}

export interface CompiledTemplate {
  readonly format: typeof compiledTemplateFormat;
  readonly modelVersion: typeof modelVersion;
  readonly expressionLanguageVersion: ExpressionLanguageVersion;
  readonly documentId: string;
  readonly revisionId: string;
  readonly settings: TemplateSettings;
  readonly styles: Readonly<Record<string, TextStyle>>;
  readonly body: readonly BlockNode[];
  /** 按 bindingId 索引的已编译绑定。 */
  readonly bindings: Readonly<Record<string, CompiledBinding>>;
  readonly provenance?: Provenance;
}

export type CompileResult =
  | {
      readonly ok: true;
      readonly template: CompiledTemplate;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly template?: undefined;
      readonly diagnostics: readonly Diagnostic[];
    };

export type CompileOptions = ValidateTemplateSourceOptions;

/** 单条表达式（任一来源形态）→ AST + 来源映射。失败抛 ExpressionCompileError。 */
export function compileExpression(expression: ExpressionSource): CompiledExpression {
  return expression.kind === "legacy"
    ? compileLegacyExpression(expression.text)
    : compileStructuredExpression(expression);
}

function* dynamicTexts(body: readonly BlockNode[]): Generator<DynamicText> {
  for (const block of body) {
    for (const inline of block.inlines) {
      if (inline.kind === "dynamic-text") yield inline;
    }
  }
}

/**
 * compile(TemplateSource) → CompiledTemplate + Diagnostics（spec §2）。
 * 先做文档模型校验；再编译每个 DynamicText 的表达式，全部诊断一次返回（不在首个错误处停止）。
 */
export function compile(input: unknown, options: CompileOptions = {}): CompileResult {
  const validation = validateTemplateSource(input, options);
  if (!validation.ok) {
    return { ok: false, diagnostics: validation.diagnostics };
  }
  const template: TemplateSource = validation.template;
  const diagnostics: Diagnostic[] = [...validation.diagnostics];
  const bindings: Record<string, CompiledBinding> = {};

  for (const node of dynamicTexts(template.body)) {
    try {
      const compiled = compileExpression(node.expression);
      bindings[node.bindingId] = {
        nodeId: node.nodeId,
        bindingId: node.bindingId,
        ast: compiled.ast,
        sourceMap: compiled.sourceMap,
        ...(node.styleId === undefined ? {} : { styleId: node.styleId }),
        styleInheritance: node.styleInheritance ?? "inherit-paragraph",
      };
    } catch (error) {
      if (!(error instanceof ExpressionCompileError)) throw error;
      diagnostics.push({
        code: error.code,
        severity: "error",
        phase: "compile",
        nodeId: node.nodeId,
        bindingId: node.bindingId,
        message: error.message,
        details: {
          ...error.details,
          expression: node.expression.kind === "legacy" ? node.expression.text : node.expression,
        },
      });
    }
  }

  if (hasErrors(diagnostics)) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    diagnostics,
    template: {
      format: compiledTemplateFormat,
      modelVersion,
      expressionLanguageVersion,
      documentId: template.documentId,
      revisionId: template.revisionId,
      settings: template.settings,
      styles: template.styles,
      body: template.body,
      bindings,
      ...(template.provenance === undefined ? {} : { provenance: template.provenance }),
    },
  };
}
