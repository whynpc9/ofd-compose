import type { BarcodeOptions, BlockNode } from "@ofd-compose/document-model";
import { digestCanonical } from "@ofd-compose/layout-ir";
import { beforeAll, expect, it } from "vitest";
import { type ReadInputBarcodeFormat, readBarcodes } from "zxing-wasm/reader";
import { prepareDecoder } from "#decoder";
import cases from "../../../tests/barcodes/cases.json";
import { raster } from "../../media-core/tests/raster.js";
import { type ResourcePack, render } from "../src/index.js";
import { profile, resources, textSource } from "./fixtures.js";

let pack: ResourcePack;
beforeAll(async () => {
  await prepareDecoder();
  pack = await resources();
});
const basics = cases.filter((c) => c.name.endsWith("-basic"));
function block(sample: (typeof basics)[number]): BlockNode {
  return {
    kind: "barcode-binding",
    nodeId: "barcode",
    bindingId: "bb",
    expression: { kind: "legacy", text: "value" },
    placement: { alignment: "center" },
    options: { symbology: sample.symbology as BarcodeOptions["symbology"], width: 80, height: 20 },
  };
}
it.each(basics)(
  "renders centered repeated list values and decodes each $symbology",
  async (sample) => {
    const source = textSource();
    source.body = [
      {
        kind: "repeat-block",
        nodeId: "repeat",
        bindingId: "rb",
        expression: { kind: "legacy", text: "rows" },
        repeatKey: { kind: "ordinal", orderDependentIdentity: true },
        children: [block(sample)],
      },
    ];
    const result = await render(
      source,
      { rows: [{ value: sample.inputValue }, { value: sample.inputValue }] },
      pack,
      profile,
    );
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
    const paths = result.ir.pages.flatMap((p) => p.objects).filter((p) => p.kind === "path");
    expect(paths).toHaveLength(2);
    expect(paths.map((p) => p.bounds)).toEqual([
      { x: 65000, y: 20000, width: 80000, height: 20000 },
      { x: 65000, y: 40000, width: 80000, height: 20000 },
    ]);
    const mappings = result.ir.semantics.filter((s) => s.nodeId === "barcode");
    expect(mappings).toHaveLength(2);
    expect(mappings[0]?.repeatInstance).not.toEqual(mappings[1]?.repeatInstance);
    for (const path of paths) {
      const commands = path.commands.map((c) =>
        c.op === "move" || c.op === "line" ? { ...c, x: c.x / 1000, y: c.y / 1000 } : c,
      );
      const decoded = await readBarcodes(
        raster({ width: 80, height: 20, path: { ...path, commands } }),
        {
          formats: [
            (sample.expectedFormat === "Code39"
              ? "Code39Std"
              : sample.expectedFormat) as ReadInputBarcodeFormat,
          ],
          textMode: "Plain",
        },
      );
      expect(decoded.map((d) => ({ text: d.text, format: d.format }))).toEqual([
        {
          text: sample.expectedFormat === "UPCA" ? `0${sample.inputValue}` : sample.inputValue,
          format: sample.expectedFormat,
        },
      ]);
    }
    expect(digestCanonical(result.ir)).toMatchSnapshot();
  },
);
it.each(basics)("rejects direct list values and unsafe scaling for $symbology", async (sample) => {
  const source = textSource();
  source.body = [block(sample)];
  const array = await render(
    source,
    { value: [sample.inputValue, sample.inputValue] },
    pack,
    profile,
  );
  expect(array.ok).toBe(false);
  expect(array.diagnostics).toContainEqual(
    expect.objectContaining({ code: "BARCODE_VALUE_INVALID", nodeId: "barcode", bindingId: "bb" }),
  );
  source.body = [
    {
      kind: "region",
      nodeId: "region",
      layout: {
        mode: "fixed",
        box: { x: 20, y: 20, width: 80, height: 0.5 },
        overflow: { kind: "scale", minScale: 0.01 },
      },
      children: [block(sample)],
    },
  ];
  const scaled = await render(source, { value: sample.inputValue }, pack, profile);
  expect(scaled.ok).toBe(false);
  expect(scaled.diagnostics).toContainEqual(expect.objectContaining({ code: "LAYOUT_OVERFLOW" }));
});
