import {
  type BlockNode,
  type Diagnostic,
  type DynamicText,
  defaultMaxStructureDepth,
  type ExpressionSource,
  hasErrors,
  isStructureBinding,
  isStructureContainer,
  modelVersion,
  type Provenance,
  type RepeatKey,
  type StructureBinding,
  type TemplateSettings,
  type TemplateSource,
  type TextStyle,
  type ValidateTemplateSourceOptions,
  validateTemplateSource,
  walkTemplateNodes,
} from "@ofd-compose/document-model";
import {
  type ExpressionAst,
  type ExpressionLanguageVersion,
  type ExpressionSourceMap,
  expressionLanguageVersion,
  type PathSegment,
} from "./ast.js";
import { ExpressionCompileError } from "./errors.js";
import { type CompiledExpression, compileLegacyExpression } from "./legacy-parser.js";
import { segmentsOf } from "./path.js";
import { compileStructuredExpression } from "./structured.js";

export const compiledTemplateFormat = "ofd-compose/compiled-template@0" as const;

/** 编译期预算（spec §5）。超限产生 `RESOURCE_LIMIT`（phase compile）。 */
export interface CompileLimits {
  /** 表达式文本（规范化旧管道文本）最大 UTF-16 长度。 */
  readonly maxExpressionLength: number;
  /** 单条表达式最多的管道步骤数。 */
  readonly maxPipelineSteps: number;
  /** 结构节点（ConditionalBlock / RepeatBlock / Table / RepeatRowGroup）最大嵌套深度。 */
  readonly maxStructureDepth: number;
}

export const defaultCompileLimits: CompileLimits = {
  maxExpressionLength: 1024,
  maxPipelineSteps: 32,
  maxStructureDepth: defaultMaxStructureDepth,
};

export type CompiledRepeatKey =
  | { readonly kind: "path"; readonly text: string; readonly segments: readonly PathSegment[] }
  | { readonly kind: "ordinal" };

interface CompiledBindingBase {
  readonly nodeId: string;
  readonly bindingId: string;
  readonly ast: ExpressionAst;
  readonly sourceMap: ExpressionSourceMap;
}

/** 一个绑定 = 一个持有表达式的模板节点：DynamicText、ConditionalBlock、RepeatBlock、RepeatRowGroup。 */
export type CompiledBinding =
  | (CompiledBindingBase & {
      readonly role: "dynamic-text";
      readonly styleId?: string;
      readonly styleInheritance: "inherit-paragraph" | "explicit";
    })
  | (CompiledBindingBase & { readonly role: "conditional-block" })
  | (CompiledBindingBase & {
      readonly role: "repeat-block" | "repeat-row-group";
      readonly repeatKey: CompiledRepeatKey;
    });

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

/** `maxStructureDepth` 统一由 `limits.maxStructureDepth` 给出，并同时用于模型校验前的嵌套深度预检。 */
export interface CompileOptions extends Omit<ValidateTemplateSourceOptions, "maxStructureDepth"> {
  readonly limits?: Partial<CompileLimits>;
}

function resolveLimits(limits: Partial<CompileLimits> | undefined): CompileLimits {
  // 逐字段 `??`：显式 undefined 不得关闭预算。
  return {
    maxExpressionLength: limits?.maxExpressionLength ?? defaultCompileLimits.maxExpressionLength,
    maxPipelineSteps: limits?.maxPipelineSteps ?? defaultCompileLimits.maxPipelineSteps,
    maxStructureDepth: limits?.maxStructureDepth ?? defaultCompileLimits.maxStructureDepth,
  };
}

/** 单条表达式（任一来源形态）→ AST + 来源映射。失败抛 ExpressionCompileError。 */
export function compileExpression(expression: ExpressionSource): CompiledExpression {
  return expression.kind === "legacy"
    ? compileLegacyExpression(expression.text)
    : compileStructuredExpression(expression);
}

function compileRepeatKey(key: RepeatKey): CompiledRepeatKey {
  if (key.kind === "ordinal") return { kind: "ordinal" };
  const text = key.path.trim();
  const segments = text === "." ? [] : segmentsOf(text, "repeatKey.path");
  if (segments.length === 0) {
    throw new ExpressionCompileError(
      "EXPRESSION_UNSUPPORTED",
      "repeatKey.path must address a scalar inside the item (use kind 'ordinal' for positional identity)",
      { repeatKey: key },
    );
  }
  return { kind: "path", text, segments };
}

class TemplateCompiler {
  readonly diagnostics: Diagnostic[];
  readonly bindings: Record<string, CompiledBinding> = {};
  private readonly limits: CompileLimits;

  constructor(
    private readonly template: TemplateSource,
    options: CompileOptions,
    validationDiagnostics: readonly Diagnostic[],
  ) {
    this.diagnostics = [...validationDiagnostics];
    this.limits = resolveLimits(options.limits);
  }

  private resourceLimit(
    node: { nodeId: string; bindingId?: string },
    message: string,
    details: Record<string, unknown>,
  ): void {
    this.diagnostics.push({
      code: "RESOURCE_LIMIT",
      severity: "error",
      phase: "compile",
      nodeId: node.nodeId,
      ...(node.bindingId === undefined ? {} : { bindingId: node.bindingId }),
      message,
      details,
    });
  }

  /** 编译一条表达式并施加长度/步骤数预算；失败时记诊断并返回 undefined。 */
  private expression(node: DynamicText | StructureBinding): CompiledExpression | undefined {
    const { expression } = node;
    const { maxExpressionLength, maxPipelineSteps } = this.limits;
    const rawLength =
      expression.kind === "legacy" ? expression.text.length : JSON.stringify(expression).length;
    if (rawLength > maxExpressionLength) {
      this.resourceLimit(
        node,
        `expression is ${rawLength} characters long; the budget is ${maxExpressionLength}`,
        { limit: "maxExpressionLength", actual: rawLength, max: maxExpressionLength },
      );
      return undefined;
    }
    try {
      const compiled = compileExpression(expression);
      const steps = compiled.ast.steps.length;
      if (steps > maxPipelineSteps) {
        this.resourceLimit(
          node,
          `expression has ${steps} pipeline steps; the budget is ${maxPipelineSteps}`,
          { limit: "maxPipelineSteps", actual: steps, max: maxPipelineSteps },
        );
        return undefined;
      }
      const canonicalLength = compiled.sourceMap.legacyText.length;
      if (canonicalLength > maxExpressionLength) {
        this.resourceLimit(
          node,
          `expression canonical text is ${canonicalLength} characters long; the budget is ${maxExpressionLength}`,
          { limit: "maxExpressionLength", actual: canonicalLength, max: maxExpressionLength },
        );
        return undefined;
      }
      return compiled;
    } catch (error) {
      if (!(error instanceof ExpressionCompileError)) throw error;
      this.diagnostics.push({
        code: error.code,
        severity: "error",
        phase: "compile",
        nodeId: node.nodeId,
        bindingId: node.bindingId,
        message: error.message,
        details: {
          ...error.details,
          expression: expression.kind === "legacy" ? expression.text : expression,
        },
      });
      return undefined;
    }
  }

  private repeatKey(node: Extract<StructureBinding, { repeatKey: RepeatKey }>) {
    try {
      return compileRepeatKey(node.repeatKey);
    } catch (error) {
      if (!(error instanceof ExpressionCompileError)) throw error;
      this.diagnostics.push({
        code: error.code,
        severity: "error",
        phase: "compile",
        nodeId: node.nodeId,
        bindingId: node.bindingId,
        message: error.message,
        details: error.details,
      });
      return undefined;
    }
  }

  run(): void {
    const { maxStructureDepth } = this.limits;
    for (const { node, structureDepth } of walkTemplateNodes(this.template.body)) {
      // 第 maxStructureDepth+1 层结构容器越界：在该容器上报告一次，其子树（更深）静默跳过。
      if (structureDepth > maxStructureDepth) continue;
      if (structureDepth === maxStructureDepth && isStructureContainer(node)) {
        this.resourceLimit(
          node,
          `structure nesting depth ${structureDepth + 1} exceeds the budget of ${maxStructureDepth}`,
          { limit: "maxStructureDepth", actual: structureDepth + 1, max: maxStructureDepth },
        );
        continue;
      }
      if (node.kind === "dynamic-text") {
        const compiled = this.expression(node);
        if (compiled === undefined) continue;
        this.bindings[node.bindingId] = {
          role: "dynamic-text",
          nodeId: node.nodeId,
          bindingId: node.bindingId,
          ast: compiled.ast,
          sourceMap: compiled.sourceMap,
          ...(node.styleId === undefined ? {} : { styleId: node.styleId }),
          styleInheritance: node.styleInheritance ?? "inherit-paragraph",
        };
      } else if (isStructureBinding(node)) {
        const compiled = this.expression(node);
        if (compiled === undefined) continue;
        const base = {
          nodeId: node.nodeId,
          bindingId: node.bindingId,
          ast: compiled.ast,
          sourceMap: compiled.sourceMap,
        };
        if (node.kind === "conditional-block") {
          this.bindings[node.bindingId] = { role: "conditional-block", ...base };
        } else {
          const repeatKey = this.repeatKey(node);
          if (repeatKey === undefined) continue;
          this.bindings[node.bindingId] = { role: node.kind, ...base, repeatKey };
        }
      }
    }
  }
}

/**
 * compile(TemplateSource) → CompiledTemplate + Diagnostics（spec §2）。
 * 先做文档模型校验；再编译每个 DynamicText / ConditionalBlock / RepeatBlock / RepeatRowGroup 的表达式，
 * 施加编译期预算，全部诊断一次返回（不在首个错误处停止）。
 */
export function compile(input: unknown, options: CompileOptions = {}): CompileResult {
  const validation = validateTemplateSource(input, {
    ...options,
    maxStructureDepth: resolveLimits(options.limits).maxStructureDepth,
  });
  if (!validation.ok) {
    return { ok: false, diagnostics: validation.diagnostics };
  }
  const template: TemplateSource = validation.template;
  const compiler = new TemplateCompiler(template, options, validation.diagnostics);
  compiler.run();
  const { diagnostics, bindings } = compiler;

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
