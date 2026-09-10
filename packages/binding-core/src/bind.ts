import {
  type BindingPolicyVersion,
  type Diagnostic,
  documentModelSchemaVersion,
  hasErrors,
  type InlineNode,
  modelVersion,
  type Paragraph,
} from "@ofd-compose/document-model";
import type { CompiledBinding, CompiledTemplate } from "@ofd-compose/template-compiler";
import { type EvaluationContext, evaluateExpression } from "./evaluate.js";
import {
  type ResolvedDocument,
  type ResolvedFragment,
  type ResolvedParagraph,
  resolvedDocumentFormat,
} from "./resolved-document.js";
import type { JsonValue } from "./values.js";

export interface BindingPolicy {
  /** 覆盖模板 settings.bindingPolicyVersion（如迁移差分时同一模板双跑）。 */
  readonly bindingPolicyVersion?: BindingPolicyVersion;
}

export interface BindResult {
  /** 无 error 级诊断。文档在有诊断时仍然产出（供设计器预览定位）。 */
  readonly ok: boolean;
  readonly document: ResolvedDocument;
  readonly diagnostics: readonly Diagnostic[];
}

function resolveInline(
  inline: InlineNode,
  paragraph: Paragraph,
  compiled: CompiledTemplate,
  policy: BindingPolicyVersion,
  data: JsonValue,
  patternCache: EvaluationContext["patternCache"],
  diagnostics: Diagnostic[],
): ResolvedFragment {
  switch (inline.kind) {
    case "text":
      return {
        kind: "text",
        text: inline.text,
        ...(inline.styleId === undefined ? {} : { styleId: inline.styleId }),
        origin: { kind: "static", nodeId: inline.nodeId },
      };
    case "input-control": {
      const { kind, ...rest } = inline;
      return { kind, ...rest };
    }
    case "dynamic-text": {
      const binding: CompiledBinding | undefined = compiled.bindings[inline.bindingId];
      if (binding === undefined) {
        // compile() 成功时不可能发生；防御性诊断而不是抛异常，保持文档可产出。
        diagnostics.push({
          code: "MODEL_INVALID",
          severity: "error",
          phase: "bind",
          nodeId: inline.nodeId,
          bindingId: inline.bindingId,
          message: `compiled template has no binding '${inline.bindingId}'`,
        });
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
      const result = evaluateExpression(binding.ast, {
        policy,
        timeZone: compiled.settings.timeZone,
        scope: { current: data, root: data },
        nodeId: inline.nodeId,
        bindingId: inline.bindingId,
        patternCache,
      });
      diagnostics.push(...result.diagnostics);
      const styleId =
        binding.styleId ??
        (binding.styleInheritance === "inherit-paragraph" ? paragraph.styleId : undefined);
      return {
        kind: "text",
        text: result.text,
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

/**
 * bind(CompiledTemplate, Data, BindingPolicy) → ResolvedDocument + Diagnostics（spec §2）。
 * 叙述句中的 DynamicText 以行内片段出现在同一段落，不产生额外段落。
 */
export function bind(
  compiled: CompiledTemplate,
  data: JsonValue,
  policy: BindingPolicy = {},
): BindResult {
  const bindingPolicyVersion =
    policy.bindingPolicyVersion ?? compiled.settings.bindingPolicyVersion;
  const diagnostics: Diagnostic[] = [];
  const patternCache: EvaluationContext["patternCache"] = new Map();

  const body: ResolvedParagraph[] = compiled.body.map((block) => ({
    kind: "paragraph",
    nodeId: block.nodeId,
    ...(block.styleId === undefined ? {} : { styleId: block.styleId }),
    fragments: block.inlines.map((inline) =>
      resolveInline(inline, block, compiled, bindingPolicyVersion, data, patternCache, diagnostics),
    ),
  }));

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
    ...(compiled.provenance === undefined ? {} : { provenance: compiled.provenance }),
  };

  return { ok: !hasErrors(diagnostics), document, diagnostics };
}
