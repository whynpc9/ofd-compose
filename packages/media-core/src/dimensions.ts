import type { ImageOptions } from "@ofd-compose/document-model";
import { fail, mediaLimits } from "./budget.js";

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
  if (
    !Number.isSafeInteger(pixelWidth) ||
    !Number.isSafeInteger(pixelHeight) ||
    pixelWidth < 1 ||
    pixelHeight < 1 ||
    pixelWidth > mediaLimits.pixelDimension ||
    pixelHeight > mediaLimits.pixelDimension ||
    pixelWidth * pixelHeight > mediaLimits.pixels
  )
    fail("RESOURCE_LIMIT", "Invalid or excessive intrinsic image dimensions");
  if (options.legacyPixelDpi !== undefined && options.legacyPixelDpi !== 96)
    fail("MODEL_INVALID", "Only legacyPixelDpi=96 is supported");
  const legacy = options.legacyPixelDpi === 96;
  const pixelMm = 25.4 / 96;
  const coordinate = (mm: number | undefined): number | undefined => {
    if (mm === undefined || !legacy) return mm;
    const pixels = mm / pixelMm;
    const integer = Math.round(pixels);
    if (Math.abs(pixels - integer) > 1e-7 || integer < 1)
      fail("MODEL_INVALID", "Legacy targets and bounds must map to whole 96-dpi pixels");
    return integer;
  };
  const dimension = (
    primary: "width" | "height" | "maxWidth" | "maxHeight",
    alias: "w" | "h" | "maxwidth" | "maxheight",
    pixelAlias: "widthPx" | "heightPx" | "maxWidthPx" | "maxHeightPx",
  ) => {
    const values = [
      options[primary] === undefined ? undefined : physical(options[primary], legacy),
      options[alias] === undefined ? undefined : physical(options[alias], legacy),
    ];
    const px = options[pixelAlias];
    if (px !== undefined) {
      if (typeof px !== "number") fail("MODEL_INVALID", "Pixel aliases must be numeric");
      values.push(physical(px, true));
    }
    let value: number | undefined;
    for (const candidate of values) {
      if (candidate === undefined) continue;
      if (value !== undefined && Math.abs(value - candidate) > 1e-9)
        fail("MODEL_INVALID", `Conflicting image dimension aliases: ${primary}`);
      value = candidate;
    }
    return coordinate(value);
  };
  const width = dimension("width", "w", "widthPx"),
    height = dimension("height", "h", "heightPx");
  const maxWidth = dimension("maxWidth", "maxwidth", "maxWidthPx"),
    maxHeight = dimension("maxHeight", "maxheight", "maxHeightPx");
  if (
    options.scale !== undefined &&
    options.scaleRatio !== undefined &&
    options.scale !== options.scaleRatio
  )
    fail("MODEL_INVALID", "Conflicting scale/scaleRatio aliases");
  const scale = options.scale ?? options.scaleRatio ?? 1;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1000)
    fail("MODEL_INVALID", "scale must be in (0,1000]");
  let preserve: boolean | undefined;
  for (const value of [
    options.preserveAspectRatio,
    options.keepAspectRatio,
    options.lockAspectRatio,
  ]) {
    if (value === undefined) continue;
    if (typeof value !== "boolean") fail("MODEL_INVALID", "Aspect-ratio aliases must be boolean");
    if (preserve !== undefined && preserve !== value)
      fail("MODEL_INVALID", "Conflicting aspect-ratio aliases");
    preserve = value;
  }
  preserve ??= legacy
    ? maxWidth !== undefined ||
      maxHeight !== undefined ||
      options.scale !== undefined ||
      options.scaleRatio !== undefined ||
      (width !== undefined) !== (height !== undefined)
    : true;
  // The legacy engine rounds each fit/scale stage to integer pixels. Native geometry
  // stays continuous in mm; Layout IR still performs mm -> um canonicalization only once.
  const rounded = (value: number): number =>
    legacy ? Math.max(1, Math.floor(value + 0.5)) : value;
  let w = pixelWidth * (legacy ? 1 : pixelMm),
    h = pixelHeight * (legacy ? 1 : pixelMm);
  if (preserve) {
    const fit =
      width !== undefined && height !== undefined
        ? Math.min(width / w, height / h)
        : width !== undefined
          ? width / w
          : height !== undefined
            ? height / h
            : 1;
    w = rounded(w * fit);
    h = rounded(h * fit);
  } else {
    w = width ?? w;
    h = height ?? h;
  }
  w = rounded(w * scale);
  h = rounded(h * scale);
  if (preserve) {
    const fit = Math.min(1, (maxWidth ?? w) / w, (maxHeight ?? h) / h);
    w = rounded(w * fit);
    h = rounded(h * fit);
  } else {
    w = Math.min(w, maxWidth ?? w);
    h = Math.min(h, maxHeight ?? h);
  }
  return {
    width: physical(w * (legacy ? pixelMm : 1)),
    height: physical(h * (legacy ? pixelMm : 1)),
  };
}
