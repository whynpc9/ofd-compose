import type { Buffer } from "node:buffer";
import { create, type Font } from "fontkit";
import { TypographyError } from "./errors.js";

export interface FontMetrics {
  readonly sha256: string;
  readonly outline: "cff" | "truetype";
  readonly head: {
    readonly unitsPerEm: number;
    readonly xMin: number;
    readonly yMin: number;
    readonly xMax: number;
    readonly yMax: number;
  };
  readonly hhea: {
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap: number;
  };
  readonly os2: {
    readonly weight: number;
    readonly italic: boolean;
    readonly typoAscender: number;
    readonly typoDescender: number;
    readonly typoLineGap: number;
    readonly winAscent: number;
    readonly winDescent: number;
    readonly useTypoMetrics: boolean;
  };
  readonly name: {
    readonly family: string;
    readonly subfamily: string;
    readonly postscript: string;
  };
}

export function readMetrics(bytes: Uint8Array, sha256: string): FontMetrics {
  try {
    // fontkit's runtime accepts Uint8Array in both environments; its published
    // DefinitelyTyped signature still asks for Node Buffer. No Buffer is created.
    const parsed = create(bytes as Buffer);
    if (!("unitsPerEm" in parsed) || Object.keys(parsed.variationAxes).length !== 0) {
      throw new Error("Only single-face static SFNT fonts are supported");
    }
    const font = parsed as Font & { head: FontMetrics["head"] };
    const os2 = font["OS/2"];
    const head = font.head;
    const hhea = font.hhea;
    if (!head || !os2 || !hhea || head.unitsPerEm < 16 || head.unitsPerEm > 16384) {
      throw new Error("Required metrics are absent or invalid");
    }
    return Object.freeze({
      sha256,
      outline: bytes[0] === 0x4f ? "cff" : "truetype",
      head: Object.freeze({
        unitsPerEm: head.unitsPerEm,
        xMin: head.xMin,
        yMin: head.yMin,
        xMax: head.xMax,
        yMax: head.yMax,
      }),
      hhea: Object.freeze({ ascent: hhea.ascent, descent: hhea.descent, lineGap: hhea.lineGap }),
      os2: Object.freeze({
        weight: os2.usWeightClass,
        italic: os2.fsSelection.italic || os2.fsSelection.oblique,
        typoAscender: os2.typoAscender,
        typoDescender: os2.typoDescender,
        typoLineGap: os2.typoLineGap,
        winAscent: os2.winAscent,
        winDescent: os2.winDescent,
        useTypoMetrics: os2.fsSelection.useTypoMetrics,
      }),
      name: Object.freeze({
        family: font.familyName,
        subfamily: font.subfamilyName,
        postscript: font.postscriptName,
      }),
    });
  } catch {
    throw new TypographyError("FONT_INVALID", "Cannot read static font metrics");
  }
}
