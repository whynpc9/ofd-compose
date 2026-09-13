import type { BarcodeOptions } from "@ofd-compose/document-model";
import { digestCanonical, type LayoutIR } from "@ofd-compose/layout-ir";
import bwip from "bwip-js/generic";
import { fail, MediaBudget, MediaError } from "./budget.js";
import { physical } from "./dimensions.js";

export const barcodeGeneratorVersion = "bwip-js@4.11.4/drawing-context@1";
export type PathObject = Extract<LayoutIR["pages"][number]["objects"][number], { kind: "path" }>;
export interface PreparedBarcode {
  readonly value: string;
  readonly symbology: "code128" | "ean13";
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
  if (!options || (options.symbology !== "code128" && options.symbology !== "ean13"))
    fail("UNSUPPORTED_FEATURE", "P0 supports only code128/ean13");
  if (options.pure !== undefined && options.pure !== true)
    fail(
      "UNSUPPORTED_FEATURE",
      "P0 pure=true emits bars only; human-readable labels require the shaped-text profile",
    );
  if (!value.length || (options.symbology === "code128" && !/^[\x20-\x7e]+$/.test(value)))
    fail(
      "BARCODE_VALUE_INVALID",
      "Code128 P0 requires nonempty printable ASCII (no FNC escape interpretation)",
    );
  if (options.symbology === "ean13") {
    if (!/^\d{13}$/.test(value))
      fail("BARCODE_VALUE_INVALID", "EAN13 requires exactly 13 digits including check digit");
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(value[i]) * (i % 2 ? 3 : 1);
    if ((10 - (sum % 10)) % 10 !== Number(value[12]))
      fail("BARCODE_VALUE_INVALID", "Invalid EAN13 check digit");
  }
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
        bcid: options.symbology,
        text: value,
        scale: 2,
        height: 10,
        includetext: false,
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
  const quietModules = options.symbology === "ean13" ? 11 : 10;
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
    symbology: options.symbology,
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
    symbology: options.symbology,
    generatorVersion: barcodeGeneratorVersion,
    width,
    height,
    quietZone,
    pure: true,
    geometryDigest,
    path,
  });
}
