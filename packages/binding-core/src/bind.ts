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
import { isValidTimeZone } from "./date.js";
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

/** 一次 bind() 调用内所有片段共享的状态。 */
interface BindContext {
  readonly compiled: CompiledTemplate;
  readonly policy: BindingPolicyVersion;
  /** 经校验的时区；模板时区非法时回退 UTC（已记 error 诊断，文档仍产出供预览）。 */
  readonly timeZone: string;
  readonly data: JsonValue;
  readonly patternCache: EvaluationContext["patternCache"];
  readonly diagnostics: Diagnostic[];
}

const fallbackTimeZone = "UTC";

function resolveInline(
  inline: InlineNode,
  paragraph: Paragraph,
  ctx: BindContext,
): ResolvedFragment {
  const { compiled, diagnostics } = ctx;
  switch (inline.kind) {
    case "text":
      return {
        kind: "text",
        text: inline.text,
        ...(inline.styleId === undefined ? {} : { styleId: inline.styleId }),
        origin: { kind: "static", nodeId: inline.nodeId },
      };
    case "input-control":
      return inline; // 输入控件不参与绑定，原样进入产物。
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
        policy: ctx.policy,
        timeZone: ctx.timeZone,
        scope: { current: ctx.data, root: ctx.data },
        nodeId: inline.nodeId,
        bindingId: inline.bindingId,
        patternCache: ctx.patternCache,
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
  const { timeZone } = compiled.settings;
  const timeZoneValid = isValidTimeZone(timeZone);
  if (!timeZoneValid) {
    // document-model 只能校验非空字符串；时区表的归属方是 binding-core（temporal-polyfill），
    // 所以在这里以模板级诊断拦截，而不是让 RangeError 从 bind() 抛出。
    diagnostics.push({
      code: "MODEL_INVALID",
      severity: "error",
      phase: "bind",
      message: `settings.timeZone '${timeZone}' is not a recognized IANA time zone; zoned date values were formatted in ${fallbackTimeZone} for this preview`,
      details: { setting: "timeZone", timeZone, fallbackTimeZone },
    });
  }
  const ctx: BindContext = {
    compiled,
    policy: bindingPolicyVersion,
    timeZone: timeZoneValid ? timeZone : fallbackTimeZone,
    data,
    patternCache: new Map(),
    diagnostics,
  };

  const body: ResolvedParagraph[] = compiled.body.map((block) => ({
    kind: "paragraph",
    nodeId: block.nodeId,
    ...(block.styleId === undefined ? {} : { styleId: block.styleId }),
    fragments: block.inlines.map((inline) => resolveInline(inline, block, ctx)),
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

  return { ok: !hasErrors(ctx.diagnostics), document, diagnostics: ctx.diagnostics };
}
