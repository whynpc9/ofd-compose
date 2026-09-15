// biome-ignore-all lint/style/noNonNullAssertion: Fixed-cardinality corpus fixtures are checked by their explicit inventory tests.
import type { JsonValue } from "@ofd-compose/binding-core";
import type { BarcodeOptions, BlockNode, ImageOptions } from "@ofd-compose/document-model";
import { fontDigest } from "@ofd-compose/typography-core";
import { beforeAll, expect, it } from "vitest";
import { type ResourcePack, render } from "../src/index.js";
import { profile, resources, textSource } from "./fixtures.js";

const files = import.meta.glob<Record<string, unknown>>(
  "../../../tests/golden-corpus/library/**/data.json",
  { eager: true, import: "default" },
);
const semantics = import.meta.glob<{
  paragraphs?: string[];
  media?: { widthPx: number; heightPx: number }[];
  barcodes?: unknown[];
}>("../../../tests/golden-corpus/library/**/expected/semantics.json", {
  eager: true,
  import: "default",
});
// Explicit native reconstructions of all nine media cases; this test adapter is not a DOCX importer.
const recipes = [
  ["docx-tests/09-inline-image-data-uri", ["Report logo"]],
  ["docx-tests/10-block-image-centered", []],
  ["docx-tests/11-images-in-loop", []],
  ["docx-tests/12-real-png-scaling", ["File path image", "Data URI image", "Fit box image"]],
  ["docx-tests/13-barcodes-code128-ean13", ["Code128", "EAN13 centered"]],
  ["docx-tests/14-barcodes-upca-itf", []],
  ["examples/06-images", ["Inline logo", "Gallery"]],
  [
    "examples/11-images-file-and-datauri-scaling",
    [
      "图片（文件路径 + maxWidth 等比缩放）",
      "图片（data URI + scale 等比缩放）",
      "图片（在固定宽高盒子中等比缩放，不拉伸变形）",
    ],
  ],
  ["examples/12-barcodes", ["Code128 条形码（由模板参数指定类型和尺寸）", "EAN13 条形码（居中）"]],
] as const;
let pack: ResourcePack;
beforeAll(async () => {
  pack = await resources();
});
it.each(recipes)("renders native media reconstruction %s", async (name, labels) => {
  const dir = `../../../tests/golden-corpus/library/${name}`,
    input = files[`${dir}/data.json`]!,
    expected = semantics[`${dir}/expected/semantics.json`]!;
  const source = textSource();
  const blocks: BlockNode[] = labels.map((text, i) => ({
    kind: "paragraph",
    nodeId: `label${i}`,
    inlines: [{ kind: "text", nodeId: `labeltext${i}`, text }],
  }));
  const data: Record<string, JsonValue> = {};
  const images: NonNullable<ResourcePack["images"]>[number][] = [];
  const descriptors: { src: string; [key: string]: unknown }[] = [];
  for (const value of Object.values(input)) {
    if (Array.isArray(value)) for (const item of value) descriptors.push(item.photo);
    else if (value && typeof value === "object" && "src" in value)
      descriptors.push(value as (typeof descriptors)[number]);
  }
  const encoded = descriptors.find((d) => d.src.startsWith("data:"))?.src;
  for (const [i, descriptor] of descriptors.entries()) {
    const { src, ...options } = descriptor;
    const id = `image${i}`;
    if (src.startsWith("assets/")) {
      if (!encoded) throw new Error("Corpus has no byte-identical embedded partner");
      const bytes = Uint8Array.from(atob(encoded.slice(encoded.indexOf(",") + 1)), (c) =>
        c.charCodeAt(0),
      );
      // The corpus records these two sources as byte-identical. Authorize a fixed resource ID.
      images.push({ id, bytes, byteLength: bytes.length, sha256: fontDigest(bytes) });
      data[id] = { resourceId: id };
    } else data[id] = src;
    blocks.push({
      kind: "image-binding",
      nodeId: id,
      bindingId: `b${id}`,
      expression: { kind: "legacy", text: id },
      options: { ...(options as ImageOptions), legacyPixelDpi: 96 },
    });
  }
  if (input.barcodes)
    for (const [i, [symbology, value]] of Object.entries(input.barcodes).entries()) {
      data[`barcode${i}`] = value as string;
      blocks.push({
        kind: "barcode-binding",
        nodeId: `barcode${i}`,
        bindingId: `bb${i}`,
        expression: { kind: "legacy", text: `barcode${i}` },
        options: {
          symbology: symbology as BarcodeOptions["symbology"],
          width: 95.25,
          height: 26.458333,
        },
      });
    }
  source.body = blocks;
  const result = await render(source, data, { ...pack, images }, profile);
  const rejected = new Set([
    "docx-tests/09-inline-image-data-uri",
    "docx-tests/10-block-image-centered",
    "docx-tests/11-images-in-loop",
    "examples/06-images",
    "docx-tests/14-barcodes-upca-itf",
  ]);
  if (rejected.has(name)) {
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("ir");
    expect(result.diagnostics[0]?.code).toBe("MODEL_INVALID");
    expect(result.diagnostics[0]?.message).toContain(
      name.endsWith("14-barcodes-upca-itf") ? "Expected union" : "CRC mismatch",
    );
    return;
  }
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const objects = result.ir.pages.flatMap((p) => p.objects);
  expect(
    objects
      .filter((o) => o.kind === "text")
      .map((o) => o.logicalText)
      .join(""),
  ).toBe((expected.paragraphs ?? []).join(""));
  const imageObjects = objects.filter((o) => o.kind === "image");
  expect(imageObjects).toHaveLength(expected.media?.length ?? 0);
  for (const [i, item] of imageObjects.entries()) {
    expect(item.bounds.width / 1000).toBeCloseTo((expected.media![i]!.widthPx * 25.4) / 96, 2);
    expect(item.bounds.height / 1000).toBeCloseTo((expected.media![i]!.heightPx * 25.4) / 96, 2);
  }
  expect(objects.filter((o) => o.kind === "path")).toHaveLength(expected.barcodes?.length ?? 0);
});
