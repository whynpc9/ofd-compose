import { bind } from "@ofd-compose/binding-core";
import { compile } from "@ofd-compose/template-compiler";

/** Real public Compiler -> Binding Core path; runtime metadata differs in Node/browser. */
export function boundDocumentFixture() {
  const compiled = compile({
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "identity-bound-document",
    revisionId: "r1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body: [
      {
        kind: "paragraph",
        nodeId: "p1",
        inlines: [
          {
            kind: "dynamic-text",
            nodeId: "t1",
            bindingId: "b1",
            expression: { kind: "legacy", text: "value" },
          },
        ],
      },
    ],
  });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const result = bind(compiled.template, { value: "跨运行时 identity" });
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
