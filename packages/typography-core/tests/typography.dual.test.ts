import * as hb from "harfbuzzjs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFontFile } from "#font-loader";
import manifest from "../fonts/manifest.json";
import {
  fontDigest,
  fontStylePolicy,
  isP0Character,
  lineBreakOpportunities,
  p0CharacterRepertoire,
  type ShapeRequest,
  TypographyCore,
  TypographyError,
} from "../src/index.js";
import cases from "./cases.json";
import expected from "./expected.json";

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`Missing fixture at ${index}`);
  return value;
}

const core = new TypographyCore();
const bytes: Uint8Array[] = [];
const regular = at(manifest, 0);
const request = (text: string): ShapeRequest => ({
  fontSha256: regular.sha256,
  text,
  script: "Latn",
  language: "en",
  direction: "ltr",
});

beforeAll(async () => {
  for (const entry of manifest) {
    const data = await loadFontFile(entry.file);
    bytes.push(data);
    core.loadFont(data, entry.sha256);
  }
}, 60_000);

function expectCode(action: () => unknown, code: string) {
  expect(action).toThrow(TypographyError);
  try {
    action();
  } catch (error) {
    expect((error as TypographyError).code).toBe(code);
  }
}

describe("identical Node/browser UTF-8 JSON fixtures", () => {
  for (const [index, entry] of cases.entries()) {
    it(entry.name, () => {
      const { name: _name, font, ...input } = entry;
      const shaped = core.shape({
        ...input,
        fontSha256: at(manifest, font).sha256,
      } as ShapeRequest);
      // The committed JSON is shared by both runners; compare every serialized
      // byte, not just a tolerance or a summary of advances.
      expect(new TextEncoder().encode(JSON.stringify(shaped))).toEqual(
        new TextEncoder().encode(JSON.stringify(expected.shapes[index])),
      );
      expect(new TextEncoder().encode(JSON.stringify(lineBreakOpportunities(input.text)))).toEqual(
        new TextEncoder().encode(JSON.stringify(expected.paragraphBreaks[index])),
      );
    });
  }

  it("compares all four font tables in both runtimes", () => {
    expect(
      JSON.stringify(manifest.map((entry, i) => core.loadFont(at(bytes, i), entry.sha256))),
    ).toBe(JSON.stringify(expected.metrics));
  });
});

it("uses real static outlines and declares synthesis forbidden", () => {
  expect(core.loadFont(at(bytes, 0), regular.sha256).outline).toBe("cff");
  expect(core.loadFont(at(bytes, 2), at(manifest, 2).sha256).outline).toBe("truetype");
  expect(fontStylePolicy.syntheticBold).toBe("forbidden");
  expectCode(
    () => core.shape({ ...request("abc"), style: { weight: 700, italic: true } }),
    "FONT_STYLE_UNAVAILABLE",
  );
});

it("keeps supplementary and combining character ranges in UTF-16 units", () => {
  const supplementary = core.shape({ ...request("𠮷A"), script: "Hani", language: "zh-Hans" });
  expect(supplementary.glyphs.map((g) => [g.cluster, g.clusterEnd])).toEqual([
    [0, 2],
    [2, 3],
  ]);
  const combining = core.shape({ ...request("ẍ́"), fontSha256: at(manifest, 3).sha256 });
  expect(combining.glyphs.length).toBeGreaterThan(1);
  expect(combining.glyphs.every((g) => g.cluster === 0 && g.clusterEnd === 3)).toBe(true);
  expect(combining.glyphs.some((g) => g.xOffset !== 0 || g.yOffset !== 0)).toBe(true);
});

it("fails on missing glyphs without consulting another loaded font", () => {
  expect(isP0Character(0x2a6df)).toBe(true);
  expectCode(() => core.shape(request("\u{2a6df}")), "GLYPH_MISSING");
  expectCode(
    () => core.shape({ ...request("中"), fontSha256: at(manifest, 3).sha256 }),
    "GLYPH_MISSING",
  );
  try {
    core.shape(request("A\u{2a6df}"));
  } catch (error) {
    expect((error as TypographyError).clusters).toEqual([1]);
  }
  expect(core.shape(request("A")).glyphs[0]?.glyphId).toBeGreaterThan(0);
});

it("rejects out-of-profile text even when the locked font contains its glyph", () => {
  const font = new hb.Font(new hb.Face(new hb.Blob(at(bytes, 3))));
  const buffer = new hb.Buffer();
  buffer.addText("₦");
  buffer.setDirection(hb.Direction.LTR);
  buffer.setLanguage("en");
  buffer.setScript("Latn");
  hb.shape(font, buffer);
  expect(buffer.getGlyphInfos()[0]?.codepoint).toBeGreaterThan(0);
  expectCode(
    () => core.shape({ ...request("₦"), fontSha256: at(manifest, 3).sha256 }),
    "CHARACTER_OUT_OF_PROFILE",
  );
  try {
    core.shape(request("𠮷₦😀"));
  } catch (error) {
    expect((error as TypographyError).code).toBe("CHARACTER_OUT_OF_PROFILE");
    expect((error as TypographyError).clusters).toEqual([2, 3]);
  }
  expectCode(() => core.shape(request("\u{10ffff}")), "CHARACTER_OUT_OF_PROFILE");
});

it("publishes a font-independent frozen repertoire and admits required GB extensions", () => {
  expect(p0CharacterRepertoire.version).toBe("wp0.4-p0-repertoire-v1");
  for (const text of ["中丂㐀𠮷", "Aéắá0123", "αЯあ￥€−×÷℃"]) {
    expect([...text].every((character) => isP0Character(character.codePointAt(0) ?? -1))).toBe(
      true,
    );
  }
  for (const point of [-1, NaN, 1.5, 0xd800, 0x20a6, 0x1f600, 0x10ffff]) {
    expect(isP0Character(point)).toBe(false);
  }
});

it("requires the exact font bytes and refuses an unloaded digest", () => {
  expectCode(() => core.loadFont(at(bytes, 1), regular.sha256), "FONT_DIGEST_MISMATCH");
  expectCode(() => core.shape({ ...request("abc"), fontSha256: "0".repeat(64) }), "FONT_MISSING");
  const invalid = new Uint8Array([0, 1, 0, 0]);
  expectCode(() => core.loadFont(invalid, fontDigest(invalid)), "FONT_INVALID");
});

it("distinguishes same-name different bytes and owns its registered bytes", () => {
  const source = new Uint8Array(at(bytes, 3));
  // Change head.fontRevision, leaving the name table and glyph data identical.
  const view = new DataView(source.buffer);
  for (let offset = 12; offset < 12 + view.getUint16(4) * 16; offset += 16) {
    if (view.getUint32(offset) === 0x68656164) {
      const headOffset = view.getUint32(offset + 8);
      view.setUint32(headOffset + 4, view.getUint32(headOffset + 4) + 1);
      break;
    }
  }
  const digest = fontDigest(source);
  const other = core.loadFont(source, digest);
  expect(other.name).toEqual(core.loadFont(at(bytes, 3), at(manifest, 3).sha256).name);
  expect(digest).not.toBe(at(manifest, 3).sha256);
  const before = core.shape({ ...request("abc"), fontSha256: digest });
  source.fill(0);
  expect(core.shape({ ...request("abc"), fontSha256: digest })).toEqual(before);
});

it("exposes UAX #14 candidate breaks, mandatory CRLF, and no combining/surrogate split", () => {
  expect(lineBreakOpportunities("中文")).toEqual([
    { position: 1, required: false },
    { position: 2, required: true },
  ]);
  expect(lineBreakOpportunities("A\r\nB")).toEqual([
    { position: 3, required: true },
    { position: 4, required: true },
  ]);
  expect(lineBreakOpportunities("𠮷á")).toEqual([
    { position: 2, required: false },
    { position: 4, required: true },
  ]);
  expect(lineBreakOpportunities("A\u00a0B")).toEqual([{ position: 3, required: true }]);
});

it("computes paragraph breaks across style runs without forcing a break at run ends", () => {
  // A style change inside a word must not introduce a mandatory or optional break.
  const runs = [
    core.shape(request("hel")),
    core.shape({ ...request("lo world"), fontSha256: at(manifest, 1).sha256 }),
  ];
  const paragraph = runs.map((run) => run.text).join("");
  expect(lineBreakOpportunities(paragraph)).toEqual([
    { position: 6, required: false },
    { position: 11, required: true },
  ]);
  for (const run of runs) expect(run).not.toHaveProperty("breaks");
  // CJK punctuation rules also require context across a script/style boundary.
  expect(lineBreakOpportunities("中）文")).toEqual([
    { position: 2, required: false },
    { position: 3, required: true },
  ]);
});

it("rejects malformed and oversized input before shaping", () => {
  expectCode(() => core.shape(request("\ud800")), "TEXT_INVALID");
  expectCode(() => lineBreakOpportunities("a".repeat(100001)), "TYPOGRAPHY_LIMIT");
  expectCode(() => core.shape({ ...request("abc"), features: { bad: 1 } }), "TEXT_INVALID");
});
