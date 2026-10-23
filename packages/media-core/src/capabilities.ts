import type { BarcodeOptions } from "@ofd-compose/document-model";

export const barcodeGeneratorVersion = "bwip-js@4.11.4/drawing-context@1";
export type BarcodeAdmission = "passed" | "failed" | "not-verified";
export interface BarcodeCapability {
  readonly status: BarcodeAdmission;
  readonly generator: string;
  readonly quietZoneModules: number;
  readonly characterSet: string;
  readonly checksum: string;
}
/** Experimental bars-only admission. Evidence and decoder caveats: tests/barcodes/README.md.
 * This is shared data for future capability discovery; it does not implement an HTTP API.
 */
export const barcodeCapabilities: Readonly<Record<BarcodeOptions["symbology"], BarcodeCapability>> =
  Object.freeze({
    code128: Object.freeze({
      status: "passed",
      generator: "code128",
      quietZoneModules: 10,
      characterSet: "printable ASCII; no FNC/parse escapes",
      checksum: "generated internally",
    }),
    ean13: Object.freeze({
      status: "passed",
      generator: "ean13",
      quietZoneModules: 11,
      characterSet: "13 digits including check digit",
      checksum: "validated input check digit",
    }),
    code39: Object.freeze({
      status: "passed",
      generator: "code39",
      quietZoneModules: 10,
      characterSet: "A-Z, 0-9, space, -.$/+%; no start/stop input",
      checksum: "no optional checksum",
    }),
    code93: Object.freeze({
      status: "passed",
      generator: "code93",
      quietZoneModules: 10,
      characterSet: "A-Z, 0-9, space, -.$/+%; no extended shifts",
      checksum: "C/K generated internally",
    }),
    codabar: Object.freeze({
      status: "passed",
      generator: "rationalizedCodabar",
      quietZoneModules: 10,
      characterSet: "A-D guards and at least two characters from 0-9 and -$:/.+",
      checksum: "no optional checksum",
    }),
    ean8: Object.freeze({
      status: "passed",
      generator: "ean8",
      quietZoneModules: 7,
      characterSet: "8 digits including check digit",
      checksum: "validated input check digit",
    }),
    upca: Object.freeze({
      status: "passed",
      generator: "upca",
      quietZoneModules: 9,
      characterSet: "12 digits including check digit",
      checksum: "validated input check digit",
    }),
    itf: Object.freeze({
      status: "passed",
      generator: "interleaved2of5",
      quietZoneModules: 10,
      characterSet: "even number of digits, at least two",
      checksum: "no optional checksum",
    }),
  });
export const availableBarcodeSymbologies = Object.freeze(
  (Object.keys(barcodeCapabilities) as BarcodeOptions["symbology"][]).filter(
    (symbology) => barcodeCapabilities[symbology].status === "passed",
  ),
);
export const barcodePreparationProfile = Object.freeze({
  version: "ofd-compose/barcodes@0",
  generatorVersion: barcodeGeneratorVersion,
  output: "vector-rectangles",
  pure: true,
  humanReadableLabels: "unsupported",
  minimumModuleWidthMm: 0.1,
  minimumHeightMm: 1,
  maximumDimensionMm: 1000,
  maximumCharacters: 256,
  normalizationPolicies: Object.freeze([
    "strict-1",
    "legacy-upca-to-ean13-1",
    "legacy-itf-pad-left-1",
  ]),
});
