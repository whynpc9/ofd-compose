import { Rules } from "@cto.af/linebreak";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as hb from "harfbuzzjs";
import { TypographyError } from "./errors.js";
import { type FontMetrics, readMetrics } from "./metrics.js";
import { assertP0Characters, p0CharacterRepertoire } from "./repertoire.js";

export const shapingAndLineBreakVersions = Object.freeze({
  harfbuzzjs: "1.6.0",
  harfbuzz: hb.versionString(),
  harfbuzzWasmSha256: "66f25d50cdf9942366498d0504d13096d567946cb1f6b5af6cdd87f392be99da",
  unicode: "17.0.0",
  linebreak: "@cto.af/linebreak@4.0.3",
  fontkit: "2.0.4",
  repertoire: p0CharacterRepertoire,
});

export const fontStylePolicy = Object.freeze({
  selection: "exact-digest-and-static-face",
  syntheticBold: "forbidden",
  syntheticItalic: "forbidden",
  fallback: "none",
});

export interface ShapeRequest {
  readonly fontSha256: string;
  readonly text: string;
  /** One directional/script run; bidi resolution and run itemization belong to Layout Core. */
  readonly direction: "ltr" | "rtl" | "ttb" | "btt";
  readonly language: string;
  readonly script: string;
  /** Omit to use the selected file's real style. No synthetic transformation is applied. */
  readonly style?: { readonly weight: number; readonly italic: boolean };
  /** Global OpenType feature values, e.g. { liga: 0 }. */
  readonly features?: Readonly<Record<string, number>>;
}

export interface PositionedGlyph {
  readonly glyphId: number;
  /** UTF-16 [cluster, clusterEnd) in request.text; several glyphs may share a range. */
  readonly cluster: number;
  readonly clusterEnd: number;
  /** Pen position plus offset, in unscaled font units; positive y points up. */
  readonly x: number;
  readonly y: number;
  readonly xAdvance: number;
  readonly yAdvance: number;
  readonly xOffset: number;
  readonly yOffset: number;
  readonly flags: number;
}

export function fontDigest(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

function validateText(text: string): void {
  if (text.length > 100_000) {
    throw new TypographyError("TYPOGRAPHY_LIMIT", "Text exceeds 100000 UTF-16 code units");
  }
  if (!text.isWellFormed()) {
    throw new TypographyError("TEXT_INVALID", "Text contains an unpaired surrogate");
  }
}

/** UAX #14 opportunities, in UTF-16 units. Layout Core chooses actual line breaks. */
export function lineBreakOpportunities(text: string) {
  validateText(text);
  return [...new Rules().breaks(text)].map(({ position, required }) => ({ position, required }));
}

export class TypographyCore {
  private readonly fonts = new Map<string, { font: hb.Font; metrics: FontMetrics }>();
  // harfbuzzjs 1.6 owns native lifetimes through FinalizationRegistry. Reuse the
  // buffer instead of allocating one native object per shape call.
  private readonly buffer = new hb.Buffer();
  private fontBytes = 0;

  loadFont(bytes: Uint8Array, expectedSha256: string): FontMetrics {
    if (bytes.byteLength > 32 * 1024 * 1024) {
      throw new TypographyError("TYPOGRAPHY_LIMIT", "Font exceeds 32 MiB");
    }
    // Copy before hashing/parsing so caller mutation cannot change a registered font.
    const owned = new Uint8Array(bytes);
    const digest = fontDigest(owned);
    if (digest !== expectedSha256) {
      throw new TypographyError(
        "FONT_DIGEST_MISMATCH",
        "Font bytes do not match the resource lock",
      );
    }
    const existing = this.fonts.get(digest);
    if (existing) return existing.metrics;
    if (this.fontBytes + bytes.byteLength > 128 * 1024 * 1024) {
      throw new TypographyError("TYPOGRAPHY_LIMIT", "Loaded fonts exceed 128 MiB");
    }
    const signature = Array.from(owned.subarray(0, 4)).join(",");
    if (signature !== "79,84,84,79" && signature !== "0,1,0,0") {
      throw new TypographyError("FONT_INVALID", "Expected a static OpenType CFF or TrueType font");
    }
    const metrics = readMetrics(owned, digest);
    const face = new hb.Face(new hb.Blob(owned));
    const font = new hb.Font(face);
    font.setScale(metrics.head.unitsPerEm, metrics.head.unitsPerEm);
    this.fonts.set(digest, { font, metrics });
    this.fontBytes += owned.byteLength;
    return metrics;
  }

  shape(request: ShapeRequest) {
    validateText(request.text);
    assertP0Characters(request.text);
    if (
      !["ltr", "rtl", "ttb", "btt"].includes(request.direction) ||
      !/^[A-Za-z]{4}$/.test(request.script) ||
      !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(request.language)
    ) {
      throw new TypographyError(
        "TEXT_INVALID",
        "Explicit direction, script and language are required",
      );
    }
    const loaded = this.fonts.get(request.fontSha256);
    if (!loaded) throw new TypographyError("FONT_MISSING", "Font digest has not been loaded");
    const { font, metrics } = loaded;
    if (
      request.style &&
      (request.style.weight !== metrics.os2.weight || request.style.italic !== metrics.os2.italic)
    ) {
      throw new TypographyError(
        "FONT_STYLE_UNAVAILABLE",
        "Requested style requires another font file",
      );
    }
    const buffer = this.buffer;
    buffer.reset();
    try {
      buffer.addText(request.text);
      buffer.setDirection(
        hb.Direction[request.direction.toUpperCase() as "LTR" | "RTL" | "TTB" | "BTT"],
      );
      buffer.setLanguage(request.language);
      buffer.setScript(request.script);
      buffer.setClusterLevel(hb.ClusterLevel.MONOTONE_GRAPHEMES);
      const features = Object.entries(request.features ?? {})
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([tag, value]) => {
          if (
            !/^[\x20-\x7e]{4}$/.test(tag) ||
            !Number.isInteger(value) ||
            value < 0 ||
            value > 0xffffffff
          ) {
            throw new TypographyError("TEXT_INVALID", "Invalid OpenType feature");
          }
          return new hb.Feature(tag, value);
        });
      hb.shape(font, buffer, features);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      const missing = [
        ...new Set(infos.filter((info) => info.codepoint === 0).map((info) => info.cluster)),
      ];
      if (missing.length)
        throw new TypographyError("GLYPH_MISSING", "Font lacks glyphs for text clusters", missing);
      const starts = [...new Set(infos.map((info) => info.cluster))].sort((a, b) => a - b);
      const ends = new Map(
        starts.map((start, index) => [start, starts[index + 1] ?? request.text.length]),
      );
      let x = 0;
      let y = 0;
      const glyphs: PositionedGlyph[] = infos.map((info, index) => {
        const position = positions[index];
        if (!position) throw new Error("HarfBuzz glyph/position count mismatch");
        const glyph = {
          glyphId: info.codepoint,
          cluster: info.cluster,
          clusterEnd: ends.get(info.cluster) ?? request.text.length,
          x: x + position.xOffset,
          y: y + position.yOffset,
          ...position,
          flags: info.flags,
        };
        x += position.xAdvance;
        y += position.yAdvance;
        return glyph;
      });
      return {
        fontSha256: request.fontSha256,
        text: request.text,
        direction: request.direction,
        language: request.language,
        script: request.script,
        unitsPerEm: metrics.head.unitsPerEm,
        shapingAndLineBreakVersions,
        glyphs,
        advance: { x, y },
        breaks: lineBreakOpportunities(request.text),
      };
    } finally {
      buffer.reset();
    }
  }
}
