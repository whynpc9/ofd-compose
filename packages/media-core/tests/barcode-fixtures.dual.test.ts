import { beforeAll, expect, it } from "vitest";
import { type ReadInputBarcodeFormat, readBarcodes } from "zxing-wasm/reader";
import { prepareDecoder } from "#decoder";
import fixtures from "../../../tests/barcodes/fixtures.json";
import type { PreparedBarcode } from "../src/index.js";
import { raster } from "./raster.js";

beforeAll(prepareDecoder);
it.each(fixtures)("decodes real Worker IR shared with ZXing.Net: $name", async (f) => {
  const decoded = await readBarcodes(
    raster({
      width: f.width,
      height: f.height,
      path: f.path as Pick<PreparedBarcode["path"], "commands">,
    }),
    {
      formats: [
        (f.expectedFormat === "Code39" ? "Code39Std" : f.expectedFormat) as ReadInputBarcodeFormat,
      ],
      textMode: "Plain",
    },
  );
  expect(decoded.map((d) => ({ text: d.text, format: d.format }))).toEqual([
    {
      text: f.expectedFormat === "UPCA" ? `0${f.encodedValue}` : f.encodedValue,
      format: f.expectedFormat,
    },
  ]);
});
it("rejects a white image in the independent decoder", async () => {
  const data = new Uint8ClampedArray(800 * 200 * 4).fill(255);
  expect(
    await readBarcodes(
      { data, width: 800, height: 200, colorSpace: "srgb" },
      { formats: ["AllLinear"] },
    ),
  ).toEqual([]);
});
