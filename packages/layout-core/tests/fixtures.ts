import { bind, type ResolvedDocument } from "@ofd-compose/binding-core";
import type { Paragraph, TemplateSource } from "@ofd-compose/document-model";
import { compile } from "@ofd-compose/template-compiler";
import { loadFontFile } from "#font-loader";
import manifest from "../../typography-core/fonts/manifest.json";
import type { LayoutFont, LayoutOptions } from "../src/index.js";

export const options: LayoutOptions = {
  page: { width: 210, height: 297, contentBox: { x: 20, y: 20, width: 170, height: 257 } },
  defaultStyle: { fontFamily: "Noto", fontSize: 12 },
  formattingPolicy: {
    version: "binding-1",
    locale: "zh-CN",
    timeZone: "UTC",
    tzdataVersion: "2026a",
    rounding: "half-up",
  },
};
export async function fonts(): Promise<LayoutFont[]> {
  return Promise.all(
    [0, 1, 3, 4].map(async (index) => {
      const entry = manifest[index];
      if (!entry) throw new Error("Missing font fixture");
      return {
        family: "Noto",
        weight: index === 1 || index === 4 ? 700 : 400,
        italic: index >= 3,
        sha256: entry.sha256,
        bytes: await loadFontFile(entry.file),
      };
    }),
  );
}
export function document(
  paragraphs: Paragraph[],
  styles: TemplateSource["styles"] = {},
  data = {},
): ResolvedDocument {
  const source: TemplateSource = {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "test",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles,
    body: paragraphs,
  };
  const compiled = compile(source);
  if (!compiled.ok || !compiled.template) throw new Error(JSON.stringify(compiled.diagnostics));
  const result = bind(compiled.template, data);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
export const p = (text: string, nodeId = "p", layout?: Paragraph["layout"]): Paragraph => ({
  kind: "paragraph",
  nodeId,
  inlines: [{ kind: "text", nodeId: `${nodeId}-text`, text }],
  ...(layout ? { layout } : {}),
});
export function narrative() {
  return document(
    [
      {
        kind: "paragraph",
        nodeId: "narrative",
        inlines: [
          { kind: "text", nodeId: "before", text: "营收最高的是" },
          {
            kind: "dynamic-text",
            nodeId: "name",
            bindingId: "name-binding",
            expression: { kind: "legacy", text: "institutions|maxby:revenue|get:name" },
          },
          {
            kind: "text",
            nodeId: "after",
            text: "，收入为 100.00 元。Chinese and English share the same paragraph.",
          },
        ],
      },
    ],
    {},
    {
      institutions: [
        { name: "甲公司", revenue: 100 },
        { name: "乙公司", revenue: 80 },
      ],
    },
  );
}
