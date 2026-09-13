import type { ImageOptions } from "@ofd-compose/document-model";
import { fail } from "./budget.js";

export const mediaVersion = "ofd-compose/media@1";
/** Reject sub-micrometre dimensions which collapse during IR canonicalization. */
export function physical(value: unknown, legacy = false): number {
  let result: number;
  if (typeof value === "number") result = value * (legacy ? 25.4 / 96 : 1);
  else if (typeof value === "string" && value.length <= 64) {
    const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|in|inch|pt|px)\s*$/i.exec(value);
    if (!match) return fail("MODEL_INVALID", "Length requires a positive value and physical unit");
    const factors: Record<string, number> = {
      mm: 1,
      cm: 10,
      in: 25.4,
      inch: 25.4,
      pt: 25.4 / 72,
      px: 25.4 / 96,
    };
    result = Number(match[1]) * (factors[(match[2] as string).toLowerCase()] as number);
  } else return fail("MODEL_INVALID", "Invalid physical length");
  if (!Number.isFinite(result) || result < 0.001 || result > 1000000)
    fail("MODEL_INVALID", "Physical length is outside 0.001..1000000 mm");
  return result;
}
export function imageDimensions(
  pixelWidth: number,
  pixelHeight: number,
  options: ImageOptions = {},
) {
  if (options.legacyPixelDpi !== undefined && options.legacyPixelDpi !== 96)
    fail("MODEL_INVALID", "Only legacyPixelDpi=96 is supported");
  if (options.preserveAspectRatio !== undefined && typeof options.preserveAspectRatio !== "boolean")
    fail("MODEL_INVALID", "preserveAspectRatio must be boolean");
  const legacy = options.legacyPixelDpi === 96;
  const dimension = (
    primary: "width" | "height" | "maxWidth" | "maxHeight",
    alias: "w" | "h" | "maxwidth" | "maxheight",
  ) => {
    const a = options[primary] === undefined ? undefined : physical(options[primary], legacy);
    const b = options[alias] === undefined ? undefined : physical(options[alias], legacy);
    if (a !== undefined && b !== undefined && Math.abs(a - b) > 1e-9)
      fail("MODEL_INVALID", `Conflicting image dimension aliases: ${primary}/${alias}`);
    return a ?? b;
  };
  const width = dimension("width", "w"),
    height = dimension("height", "h");
  const maxWidth = dimension("maxWidth", "maxwidth"),
    maxHeight = dimension("maxHeight", "maxheight");
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1000)
    fail("MODEL_INVALID", "scale must be in (0,1000]");
  const preserve = options.preserveAspectRatio ?? true;
  let w = (pixelWidth * 25.4) / 96,
    h = (pixelHeight * 25.4) / 96;
  if (preserve) {
    const fit =
      width !== undefined && height !== undefined
        ? Math.min(width / w, height / h)
        : width !== undefined
          ? width / w
          : height !== undefined
            ? height / h
            : 1;
    w *= fit;
    h *= fit;
  } else {
    w = width ?? w;
    h = height ?? h;
  }
  w *= scale;
  h *= scale;
  if (preserve) {
    const fit = Math.min(1, (maxWidth ?? w) / w, (maxHeight ?? h) / h);
    w *= fit;
    h *= fit;
  } else {
    w = Math.min(w, maxWidth ?? w);
    h = Math.min(h, maxHeight ?? h);
  }
  return { width: physical(w), height: physical(h) };
}
