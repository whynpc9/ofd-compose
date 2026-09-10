import { describe, expect, it } from "vitest";
import {
  type TemplateSource,
  TemplateSourceSchema,
  toJsonSchemaDocument,
  validateTemplateSource,
} from "../src/index.js";

function narrativeTemplate(): TemplateSource {
  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "doc-narrative",
    revisionId: "r1",
    settings: { locale: "zh-CN", timeZone: "Asia/Shanghai", bindingPolicyVersion: "strict-1" },
    styles: { body: { fontFamily: "Noto Sans CJK SC", fontSize: 10.5 }, em: { bold: true } },
    body: [
      {
        kind: "paragraph",
        nodeId: "p1",
        styleId: "body",
        inlines: [
          { kind: "text", nodeId: "t1", text: "营收最高的是" },
          {
            kind: "dynamic-text",
            nodeId: "d1",
            bindingId: "b-top-name",
            styleId: "em",
            expression: { kind: "legacy", text: "institutions|maxby:revenue|get:name" },
          },
          { kind: "text", nodeId: "t2", text: "，收入为" },
          {
            kind: "dynamic-text",
            nodeId: "d2",
            bindingId: "b-top-revenue",
            expression: {
              kind: "structured",
              source: "institutions",
              steps: [
                { op: "maxby", key: "revenue" },
                { op: "get", path: "revenue" },
                { op: "format", kind: "number", pattern: "#,##0" },
              ],
            },
          },
          { kind: "text", nodeId: "t3", text: "元。" },
        ],
      },
    ],
  };
}

describe("validateTemplateSource", () => {
  it("accepts a narrative paragraph with static text and both DynamicText forms", () => {
    const result = validateTemplateSource(narrativeTemplate());
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects unknown top-level properties and wrong schemaVersion with MODEL_INVALID", () => {
    const input = {
      ...narrativeTemplate(),
      schemaVersion: "ofd-compose/document-model@9",
      extra: 1,
    };
    const result = validateTemplateSource(input);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain("MODEL_INVALID");
    expect(result.diagnostics.every((d) => d.phase === "model")).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes("/schemaVersion"))).toBe(true);
  });

  it("rejects duplicate nodeId and duplicate bindingId, locating each diagnostic", () => {
    const template = narrativeTemplate();
    const [p] = template.body;
    if (!p) throw new Error("fixture");
    p.inlines.push(
      { kind: "text", nodeId: "t1", text: "dup" },
      {
        kind: "dynamic-text",
        nodeId: "d9",
        bindingId: "b-top-name",
        expression: { kind: "legacy", text: "x" },
      },
    );
    const result = validateTemplateSource(template);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MODEL_INVALID", nodeId: "t1" }),
        expect.objectContaining({ code: "MODEL_INVALID", nodeId: "d9", bindingId: "b-top-name" }),
      ]),
    );
  });

  it("rejects a styleId that is not in the style table", () => {
    const template = narrativeTemplate();
    const [p] = template.body;
    if (!p) throw new Error("fixture");
    p.styleId = "missing-style";
    const result = validateTemplateSource(template);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "MODEL_INVALID",
        nodeId: "p1",
        details: { styleId: "missing-style" },
      }),
    );
  });

  it("refuses an unknown required extension instead of dropping it", () => {
    const template: TemplateSource = {
      ...narrativeTemplate(),
      extensions: { "vendor/x": { required: true, data: { a: 1 } } },
    };
    const result = validateTemplateSource(template);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "UNSUPPORTED_FEATURE",
        severity: "error",
        phase: "model",
        details: { namespace: "vendor/x" },
      }),
    ]);
  });

  it("passes through unknown optional extensions and accepts known required ones", () => {
    const template: TemplateSource = {
      ...narrativeTemplate(),
      extensions: {
        "vendor/optional": { required: false, data: "keep-me" },
        "ofd-compose/designer": { required: true, data: { zoom: 1 } },
      },
    };
    const result = validateTemplateSource(template, {
      knownExtensionNamespaces: ["ofd-compose/designer"],
    });
    expect(result.ok).toBe(true);
    expect(result.template?.extensions?.["vendor/optional"]).toEqual({
      required: false,
      data: "keep-me",
    });
  });

  it("keeps nodeId and bindingId as separate identities (same string allowed on different axes)", () => {
    const template = narrativeTemplate();
    const [p] = template.body;
    const dyn = p?.inlines[1];
    if (dyn?.kind !== "dynamic-text") throw new Error("fixture");
    dyn.bindingId = "d1"; // equals its own nodeId: legal, the axes are independent
    expect(validateTemplateSource(template).ok).toBe(true);
  });

  it("rejects a numeric InputControl default expressed as a float", () => {
    const template = narrativeTemplate();
    const [p] = template.body;
    if (!p) throw new Error("fixture");
    p.inlines.push({
      kind: "input-control",
      nodeId: "c1",
      controlId: "amount",
      controlType: "number",
      defaultValue: 12.5 as unknown as string,
    });
    expect(validateTemplateSource(template).ok).toBe(false);
  });
});

describe("JSON Schema export", () => {
  it("emits a 2020-12 document with the frozen $id and no symbol keys", () => {
    const doc = toJsonSchemaDocument(TemplateSourceSchema);
    expect(doc.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(doc.$id).toBe(
      "https://ofd-compose.local/schemas/document-model/template-source.schema.json",
    );
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
    expect((doc.required as string[]).sort()).toEqual(
      ["body", "documentId", "revisionId", "schemaVersion", "settings", "styles"].sort(),
    );
  });
});
