import type { BarcodeOptions } from "@ofd-compose/document-model";
import { digestCanonical, type LayoutIR } from "@ofd-compose/layout-ir";
import bwip from "bwip-js/generic";
import { fail, MediaBudget, MediaError } from "./budget.js";
import { barcodeCapabilities, barcodeGeneratorVersion } from "./capabilities.js";
import { physical } from "./dimensions.js";

export { barcodeGeneratorVersion } from "./capabilities.js";
export type PathObject = Extract<LayoutIR["pages"][number]["objects"][number], { kind: "path" }>;
export interface PreparedBarcode {
  readonly value: string;
  readonly symbology: BarcodeOptions["symbology"];
  readonly declaredSymbology: BarcodeOptions["symbology"];
  readonly inputValue: string;
  readonly encodedValue: string;
  readonly normalizationPolicy: NonNullable<BarcodeOptions["normalizationPolicy"]>;
  readonly generatorVersion: typeof barcodeGeneratorVersion;
  readonly width: number;
  readonly height: number;
  readonly quietZone: number;
  readonly pure: true;
  readonly geometryDigest: string;
  /** Fixed local mm geometry; placement layer must assign its own object/state IDs. */
  readonly path: PathObject;
}
export function barcode(
  value: string,
  options: BarcodeOptions,
  budget = new MediaBudget(),
): PreparedBarcode {
  if (typeof value !== "string") fail("BARCODE_VALUE_INVALID", "Barcode value must be a string");
  if (value.length > budget.limits.barcodeCharacters)
    fail("RESOURCE_LIMIT", "Barcode value exceeds character budget");
  if (
    !options ||
    !Object.hasOwn(barcodeCapabilities, options.symbology) ||
    barcodeCapabilities[options.symbology].status !== "passed"
  )
    fail("UNSUPPORTED_FEATURE", "Barcode symbology is outside the linear barcode profile");
  if (options.pure !== undefined && options.pure !== true)
    fail(
      "UNSUPPORTED_FEATURE",
      "pure=true emits bars only; human-readable labels require the shaped-text profile",
    );
  const inputValue = value;
  const normalizationPolicy = options.normalizationPolicy ?? "strict-1";
  let symbology = options.symbology;
  if (
    normalizationPolicy !== "strict-1" &&
    !(normalizationPolicy === "legacy-upca-to-ean13-1" && symbology === "upca") &&
    !(normalizationPolicy === "legacy-itf-pad-left-1" && symbology === "itf")
  )
    fail("MODEL_INVALID", "Normalization policy does not apply to the declared symbology");
  if (symbology === "itf" && normalizationPolicy === "legacy-itf-pad-left-1" && value.length % 2)
    value = `0${value}`;
  validateValue(value, symbology);
  if (normalizationPolicy === "legacy-upca-to-ean13-1") {
    value = `0${value}`;
    symbology = "ean13";
  }
  if (value.length > budget.limits.barcodeCharacters)
    fail("RESOURCE_LIMIT", "Normalized barcode exceeds character budget");
  const width = physical(options.width),
    height = physical(options.height);
  if (width > 1000 || height > 1000 || height < 1)
    fail("MODEL_INVALID", "Barcode dimensions must fit 1000 mm and height must be at least 1 mm");
  const requestedQuiet = options.quietZone === undefined ? undefined : physical(options.quietZone);
  if (requestedQuiet !== undefined && 2 * requestedQuiet >= width)
    fail("MODEL_INVALID", "Quiet zones consume the barcode width");
  // Reserve a conservative upper bound BEFORE BWIPP allocates its command queue.
  const maxBars = 6 * value.length + 30;
  budget.charge("pathCommands", maxBars * 5);
  budget.charge("workUnits", 10000 + value.length * value.length * 16);
  const bars: { x: number; y: number; width: number; height: number }[] = [];
  const unsupported = (): never =>
    fail("UNSUPPORTED_FEATURE", "Unexpected non-rectangular barcode drawing operation");
  const drawing: bwip.DrawingContext<void> = {
    scale: (sx, sy) => [sx, sy],
    measure: unsupported,
    init: () => {},
    line(x0, y0, x1, y1, lineWidth, rgb) {
      if (bars.length >= maxBars) fail("RESOURCE_LIMIT", "Barcode path budget exceeded");
      if (
        x0 !== x1 ||
        y0 === y1 ||
        rgb !== "000000" ||
        ![x0, y0, x1, y1, lineWidth].every(Number.isFinite) ||
        lineWidth <= 0
      )
        unsupported();
      bars.push({
        x: x0 - lineWidth / 2,
        y: Math.min(y0, y1),
        width: lineWidth,
        height: Math.abs(y1 - y0),
      });
    },
    polygon: unsupported,
    hexagon: unsupported,
    ellipse: unsupported,
    text: unsupported,
    fill: (rgb) => {
      if (rgb !== "000000") unsupported();
    },
    end: () => {},
  };
  try {
    bwip.render(
      {
        bcid: barcodeCapabilities[symbology].generator,
        text: value,
        scale: 2,
        height: 10,
        includetext: false,
        // Code93 requires both C/K checks; BWIPP defaults includecheck to false.
        includecheck: symbology === "code93",
        parse: false,
        parsefnc: false,
        guardwhitespace: false,
      },
      drawing,
    );
  } catch (error) {
    if (error instanceof MediaError) throw error;
    return fail("BARCODE_VALUE_INVALID", "Barcode generator rejected the value");
  }
  if (!bars.length) fail("BARCODE_VALUE_INVALID", "Barcode generator returned no bars");
  let left = Infinity,
    right = -Infinity,
    top = Infinity,
    bottom = -Infinity;
  for (const b of bars) {
    left = Math.min(left, b.x);
    right = Math.max(right, b.x + b.width);
    top = Math.min(top, b.y);
    bottom = Math.max(bottom, b.y + b.height);
  }
  // scale=2 fixes one BWIPP module at two drawing units; no upstream width rounding.
  const modules = (right - left) / 2;
  const quietModules = barcodeCapabilities[symbology].quietZoneModules;
  const quietZone = requestedQuiet ?? (width * quietModules) / (modules + 2 * quietModules);
  const moduleWidth = (width - 2 * quietZone) / modules;
  if (moduleWidth < 0.1 || quietZone + 1e-9 < quietModules * moduleWidth)
    fail("MODEL_INVALID", "Barcode needs module width >=0.1 mm and its minimum quiet zone");
  const sx = (width - 2 * quietZone) / (right - left),
    sy = height / (bottom - top);
  const commands: PathObject["commands"] = [];
  for (const b of bars) {
    const x = quietZone + (b.x - left) * sx,
      y = (b.y - top) * sy,
      r = x + b.width * sx,
      bottomY = y + b.height * sy;
    commands.push(
      { op: "move", x, y },
      { op: "line", x: r, y },
      { op: "line", x: r, y: bottomY },
      { op: "line", x, y: bottomY },
      { op: "close" },
    );
  }
  for (const command of commands) Object.freeze(command);
  Object.freeze(commands);
  const geometryDigest = digestCanonical({
    generatorVersion: barcodeGeneratorVersion,
    symbology,
    value,
    width,
    height,
    quietZone,
    pure: true,
    commands,
  });
  const path: PathObject = {
    id: `media-barcode-${geometryDigest}`,
    stateId: "media-black",
    drawOrder: 0,
    kind: "path",
    coordinateSpace: "local",
    bounds: Object.freeze({ x: 0, y: 0, width, height }),
    commands,
    fillRule: "nonzero",
    fill: true,
    stroke: false,
  };
  Object.freeze(path);
  return Object.freeze({
    value,
    inputValue,
    encodedValue: value,
    declaredSymbology: options.symbology,
    normalizationPolicy,
    symbology,
    generatorVersion: barcodeGeneratorVersion,
    width,
    height,
    quietZone,
    pure: true,
    geometryDigest,
    path,
  });
}

function validateValue(value: string, symbology: BarcodeOptions["symbology"]): void {
  if (symbology === "code128") {
    if (!/^[\x20-\x7e]+$/.test(value))
      fail(
        "BARCODE_VALUE_INVALID",
        "Code128 requires nonempty printable ASCII without FNC interpretation",
      );
  } else if (symbology === "code39" || symbology === "code93") {
    if (!/^[A-Z0-9 .$/+%-]+$/.test(value))
      fail(
        "BARCODE_VALUE_INVALID",
        "Code39/Code93 profile requires basic uppercase characters; no extended encoding or start/stop input",
      );
  } else if (symbology === "codabar") {
    if (!/^[ABCD][0-9$:+./-]{2,}[ABCD]$/.test(value))
      fail(
        "BARCODE_VALUE_INVALID",
        "Codabar requires uppercase A-D start/end and at least two data characters (digits or -$:/.+)",
      );
  } else if (symbology === "itf") {
    if (!/^(?:[0-9]{2})+$/.test(value))
      fail(
        "BARCODE_VALUE_INVALID",
        "ITF requires a nonempty even number of digits; no implicit padding or checksum",
      );
  } else {
    const length = symbology === "ean13" ? 13 : symbology === "ean8" ? 8 : 12;
    if (value.length !== length || !/^[0-9]+$/.test(value))
      fail(
        "BARCODE_VALUE_INVALID",
        `${symbology} requires exactly ${length} digits including check digit`,
      );
    let sum = 0;
    for (let i = length - 2, weight = 3; i >= 0; i--, weight = 4 - weight)
      sum += Number(value[i]) * weight;
    if ((10 - (sum % 10)) % 10 !== Number(value[length - 1]))
      fail("BARCODE_VALUE_INVALID", `Invalid ${symbology} check digit`);
  }
}
