import { bind } from "@ofd-compose/binding-core";
import type { BarcodeOptions, TemplateSource } from "@ofd-compose/document-model";
import { compile } from "@ofd-compose/template-compiler";
import { beforeAll, expect, it } from "vitest";
import { type ReadInputBarcodeFormat, readBarcodes } from "zxing-wasm/reader";
import { prepareDecoder } from "#decoder";
import cases from "../../../tests/barcodes/cases.json";
import {
  availableBarcodeSymbologies,
  barcode,
  barcodeCapabilities,
  MediaError,
  prepareMedia,
} from "../src/index.js";
import { raster } from "./raster.js";

beforeAll(prepareDecoder);
function barcodeSource(
  symbology: BarcodeOptions["symbology"],
  extra: Partial<BarcodeOptions> = {},
): TemplateSource {
  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "barcodes",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body: [
      {
        kind: "barcode-binding",
        nodeId: "bar",
        bindingId: "bb",
        expression: { kind: "legacy", text: "value" },
        options: { symbology, width: 80, height: 20, ...extra },
      },
    ],
  };
}
function run(source: TemplateSource, value: string) {
  const compiled = compile(source);
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const bound = bind(compiled.template, { value });
  if (!bound.ok) throw Error(JSON.stringify(bound.diagnostics));
  return prepareMedia(bound.document);
}
it.each(cases)("decodes actual rectangles: $name", async (sample) => {
  expect(availableBarcodeSymbologies).toContain(sample.symbology);
  expect(barcodeCapabilities[sample.symbology as BarcodeOptions["symbology"]].status).toBe(
    "passed",
  );
  const options = (
    sample.normalizationPolicy ? { normalizationPolicy: sample.normalizationPolicy } : {}
  ) as Partial<BarcodeOptions>;
  const result = run(
    barcodeSource(sample.symbology as BarcodeOptions["symbology"], options),
    sample.inputValue,
  );
  expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
  const code = result.blocks[0]?.barcode;
  if (!code) throw Error("Missing barcode");
  expect(code.inputValue).toBe(sample.inputValue);
  expect(code.encodedValue).toBe(sample.encodedValue);
  expect(code.path.bounds).toEqual({ x: 0, y: 0, width: 80, height: 20 });
  const decoded = await readBarcodes(raster(code), {
    formats: [
      (sample.expectedFormat === "Code39"
        ? "Code39Std"
        : sample.expectedFormat) as ReadInputBarcodeFormat,
    ],
    tryHarder: true,
    minLineCount: 1,
    textMode: "Plain",
  });
  expect(decoded.map((d) => ({ value: d.text, format: d.format }))).toEqual([
    {
      value: sample.expectedFormat === "UPCA" ? `0${sample.encodedValue}` : sample.encodedValue,
      format: sample.expectedFormat,
    },
  ]);
  // zxing-wasm 3.1.3 returns UPCA with its 13-digit EAN representation.
  if (sample.expectedFormat === "UPCA") expect(decoded[0]?.text.slice(1)).toBe(code.encodedValue);
  expect(code.geometryDigest).toMatchSnapshot();
  if (sample.normalizationPolicy) {
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "BARCODE_NORMALIZED",
        severity: "warning",
        nodeId: "bar",
        bindingId: "bb",
        dataPath: "value",
        details: expect.objectContaining({
          inputValue: sample.inputValue,
          encodedValue: sample.encodedValue,
          normalizationPolicy: sample.normalizationPolicy,
        }),
      }),
    ]);
  } else expect(result.diagnostics).toEqual([]);
});
const invalid: [BarcodeOptions["symbology"], string][] = [
  ["code39", ""],
  ["code39", "lower"],
  ["code39", "A*B"],
  ["code39", "中"],
  ["code93", ""],
  ["code93", "lower"],
  ["code93", "A*B"],
  ["code93", "\n"],
  ["codabar", "1234"],
  ["codabar", "a123B"],
  ["codabar", "A1B"],
  ["codabar", "A1XB"],
  ["ean8", "9638507"],
  ["ean8", "96385075"],
  ["ean8", "96385X74"],
  ["upca", "03600029145"],
  ["upca", "036000291453"],
  ["upca", "03600029145X"],
  ["itf", ""],
  ["itf", "123"],
  ["itf", "12.3"],
];
it.each(invalid)("rejects %s value %j with located diagnostic", (symbology, value) => {
  const result = run(barcodeSource(symbology), value);
  expect(result.ok).toBe(false);
  expect(result.blocks).toEqual([]);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      code: "BARCODE_VALUE_INVALID",
      phase: "media",
      nodeId: "bar",
      bindingId: "bb",
      dataPath: "value",
    }),
  ]);
});
const six = ["code39", "code93", "codabar", "ean8", "upca", "itf"] as const;
it.each(six)("enforces physical/quiet/pure/budget bounds for %s", (symbology) => {
  const value = cases.find((c) => c.symbology === symbology)?.inputValue;
  if (!value) throw Error("Missing case");
  for (const extra of [
    { width: 1 },
    { width: 1001 },
    { height: 0.9 },
    { quietZone: 0.01 },
    { quietZone: 40 },
  ])
    expect(run(barcodeSource(symbology, extra), value).diagnostics[0]?.code).toBe("MODEL_INVALID");
  expect(run(barcodeSource(symbology, { pure: false }), value).diagnostics[0]?.code).toBe(
    "UNSUPPORTED_FEATURE",
  );
  const code = barcode(value, { symbology, width: 100, height: 1, quietZone: 15, pure: true });
  expect(code.width).toBe(100);
  expect(code.height).toBe(1);
  expect(code.quietZone).toBe(15);
  expect(() => barcode("A".repeat(257), { symbology, width: 80, height: 20 })).toThrow(MediaError);
  const compiled = compile(barcodeSource(symbology));
  if (!compiled.ok) throw Error("compile");
  const bound = bind(compiled.template, { value });
  expect(prepareMedia(bound.document, { limits: { pathCommands: 1 } }).diagnostics[0]?.code).toBe(
    "RESOURCE_LIMIT",
  );
});
it("rejects mismatched normalization policies without changing strict defaults", () => {
  expect(
    run(barcodeSource("code39", { normalizationPolicy: "legacy-upca-to-ean13-1" }), "ABC")
      .diagnostics[0]?.code,
  ).toBe("MODEL_INVALID");
  expect(
    run(barcodeSource("itf", { normalizationPolicy: "legacy-itf-pad-left-1" }), "ABC")
      .diagnostics[0]?.code,
  ).toBe("BARCODE_VALUE_INVALID");
});
it("rejects unsupported two-dimensional types at the model boundary", () => {
  for (const symbology of ["qrcode", "datamatrix"])
    expect(compile(barcodeSource(symbology as BarcodeOptions["symbology"])).ok).toBe(false);
});
it("charges the encoded length after explicit UPC-A normalization", () => {
  const compiled = compile(
    barcodeSource("upca", { normalizationPolicy: "legacy-upca-to-ean13-1" }),
  );
  if (!compiled.ok) throw Error("compile");
  const bound = bind(compiled.template, { value: "036000291452" });
  const result = prepareMedia(bound.document, { limits: { barcodeCharacters: 12 } });
  expect(result.ok).toBe(false);
  expect(result.diagnostics[0]?.code).toBe("RESOURCE_LIMIT");
});
