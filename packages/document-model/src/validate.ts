import { Value } from "@sinclair/typebox/value";
import type { Diagnostic } from "./diagnostics.js";
import { type TemplateSource, TemplateSourceSchema } from "./schema.js";
import { isStructureBinding, walkTemplateNodes } from "./walk.js";

export interface ValidateTemplateSourceOptions {
  /**
   * 本运行时认识的扩展命名空间。`extensions` 中 `required: true` 且不在此列的条目导致拒绝；
   * 未知但 `required: false` 的条目原样保留（透传）。
   */
  readonly knownExtensionNamespaces?: readonly string[];
}

export type ValidateTemplateSourceResult =
  | {
      readonly ok: true;
      readonly template: TemplateSource;
      readonly diagnostics: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly template?: undefined;
      readonly diagnostics: readonly Diagnostic[];
    };

function modelInvalid(message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  return { code: "MODEL_INVALID", severity: "error", phase: "model", message, ...extra };
}

/**
 * 校验 TemplateSource：schema、nodeId/bindingId/controlId 唯一性（含结构节点与表格内部）、styleId 引用、扩展命名空间。
 * 不做任何修复或丢弃；任何 error 级诊断即 `ok: false`。
 */
export function validateTemplateSource(
  input: unknown,
  options: ValidateTemplateSourceOptions = {},
): ValidateTemplateSourceResult {
  const diagnostics: Diagnostic[] = [];

  if (!Value.Check(TemplateSourceSchema, input)) {
    for (const error of Value.Errors(TemplateSourceSchema, input)) {
      diagnostics.push(
        modelInvalid(`${error.path || "/"}: ${error.message}`, {
          details: { path: error.path, schemaError: error.message },
        }),
      );
    }
    return { ok: false, diagnostics };
  }
  const template = input;

  const nodeIds = new Set<string>();
  const bindingIds = new Set<string>();
  const controlIds = new Set<string>();
  const seenNode = (nodeId: string): void => {
    if (nodeIds.has(nodeId)) {
      diagnostics.push(modelInvalid(`duplicate nodeId '${nodeId}'`, { nodeId }));
    }
    nodeIds.add(nodeId);
  };
  const checkStyle = (styleId: string | undefined, nodeId: string): void => {
    if (styleId !== undefined && !Object.hasOwn(template.styles, styleId)) {
      diagnostics.push(
        modelInvalid(`node '${nodeId}' references unknown styleId '${styleId}'`, {
          nodeId,
          details: { styleId },
        }),
      );
    }
  };

  const seenBinding = (nodeId: string, bindingId: string): void => {
    if (bindingIds.has(bindingId)) {
      diagnostics.push(modelInvalid(`duplicate bindingId '${bindingId}'`, { nodeId, bindingId }));
    }
    bindingIds.add(bindingId);
  };

  for (const { node } of walkTemplateNodes(template.body)) {
    seenNode(node.nodeId);
    if ("styleId" in node) checkStyle(node.styleId, node.nodeId);
    if (node.kind === "dynamic-text" || isStructureBinding(node)) {
      seenBinding(node.nodeId, node.bindingId);
    } else if (node.kind === "input-control") {
      if (controlIds.has(node.controlId)) {
        diagnostics.push(
          modelInvalid(`duplicate controlId '${node.controlId}'`, {
            nodeId: node.nodeId,
            details: { controlId: node.controlId },
          }),
        );
      }
      controlIds.add(node.controlId);
    }
  }

  const known = new Set(options.knownExtensionNamespaces ?? []);
  for (const [namespace, entry] of Object.entries(template.extensions ?? {})) {
    if (entry.required && !known.has(namespace)) {
      diagnostics.push({
        code: "UNSUPPORTED_FEATURE",
        severity: "error",
        phase: "model",
        message: `required extension namespace '${namespace}' is not supported by this runtime; refusing to load rather than drop it`,
        details: { namespace },
      });
    }
  }

  if (diagnostics.some((d) => d.severity === "error")) {
    return { ok: false, diagnostics };
  }
  return { ok: true, template, diagnostics };
}
