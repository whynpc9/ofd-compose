import type { TemplateSource } from "@ofd-compose/document-model";
import { fontDigest } from "@ofd-compose/typography-core";
import { loadFontFile, loadSubsetWasm } from "#font-loader";
import manifest from "../../typography-core/fonts/manifest.json";
import type { RenderProfile, ResourcePack } from "../src/index.js";
export const profile: RenderProfile = {
  version: "ofd-compose/render@0",
  layout: {
    page: { width: 210, height: 297, contentBox: { x: 20, y: 20, width: 170, height: 257 } },
    defaultStyle: { fontFamily: "Noto", fontSize: 12 },
    formattingPolicy: {
      version: "binding-1",
      locale: "zh-CN",
      timeZone: "UTC",
      tzdataVersion: "2026a",
      rounding: "half-up",
    },
  },
};
export function textSource(text = "中文 office é"): TemplateSource {
  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "render-poc",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body: [{ kind: "paragraph", nodeId: "p", inlines: [{ kind: "text", nodeId: "t", text }] }],
  };
}
export async function resources(index = 0): Promise<ResourcePack> {
  const entry = manifest[index]!;
  const bytes = await loadFontFile(entry.file),
    wasm = await loadSubsetWasm();
  return {
    fonts: [
      {
        family: "Noto",
        weight: 400,
        italic: false,
        sha256: entry.sha256,
        byteLength: bytes.length,
        bytes,
      },
    ],
    subsetWasm: { byteLength: wasm.length, bytes: wasm },
  };
}
const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0,
  0, 31, 21, 196, 137, 0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 96, 0, 2, 0, 0, 5, 0, 1, 122, 94,
  171, 63, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
]);
export async function combined() {
  const source = textSource();
  source.body = [
    {
      kind: "paragraph",
      nodeId: "narrative",
      inlines: [
        { kind: "text", nodeId: "prefix", text: "营收最高的是" },
        {
          kind: "dynamic-text",
          nodeId: "winner",
          bindingId: "winner-binding",
          expression: { kind: "legacy", text: "institutions|maxby:revenue|get:name" },
        },
        { kind: "text", nodeId: "middle", text: "，占比" },
        {
          kind: "dynamic-text",
          nodeId: "rate",
          bindingId: "rate-binding",
          expression: { kind: "legacy", text: "ratio|format:percentage:0.00" },
        },
      ],
    },
    {
      kind: "table",
      nodeId: "table",
      layout: {
        columns: [
          { kind: "fixed", value: 60 },
          { kind: "fixed", value: 60 },
        ],
      },
      rows: [
        {
          kind: "repeat-row-group",
          nodeId: "repeat",
          bindingId: "repeat-binding",
          expression: { kind: "legacy", text: "institutions" },
          repeatKey: { kind: "ordinal", orderDependentIdentity: true },
          rows: [
            {
              kind: "table-row",
              nodeId: "row",
              cells: ["name", "revenue"].map((key) => ({
                kind: "table-cell" as const,
                nodeId: `cell-${key}`,
                blocks: [
                  {
                    kind: "paragraph" as const,
                    nodeId: `p-${key}`,
                    inlines: [
                      {
                        kind: "dynamic-text" as const,
                        nodeId: `d-${key}`,
                        bindingId: `b-${key}`,
                        expression: { kind: "legacy" as const, text: key },
                      },
                    ],
                  },
                ],
              })),
            },
          ],
        },
      ],
    },
    {
      kind: "image-binding",
      nodeId: "image",
      bindingId: "image-binding",
      expression: { kind: "legacy", text: "picture" },
      options: { width: "10mm" },
    },
    ...(["code128", "ean13"] as const).map((symbology) => ({
      kind: "barcode-binding" as const,
      nodeId: symbology,
      bindingId: `${symbology}-binding`,
      expression: { kind: "legacy" as const, text: symbology },
      options: { symbology, width: 60, height: 15 },
    })),
  ];
  const data = {
    institutions: Array.from({ length: 100 }, (_, i) => ({ name: `机构${i}`, revenue: 1000 - i })),
    ratio: 0.25,
    picture: { resourceId: "picture" },
    code128: "OFD-2026",
    ean13: "5901234123457",
  };
  const pack = await resources();
  pack.images = [{ id: "picture", sha256: fontDigest(png), byteLength: png.length, bytes: png }];
  return { source, data, pack };
}
