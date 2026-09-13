import { beforeAll, expect, it } from "vitest";
import { loadFontFile } from "#font-loader";
import manifest from "../fonts/manifest.json";
import { type ShapeRequest, staticFaceCachePolicy, TypographyCore } from "../src/index.js";

const bytes: Uint8Array[] = [];
beforeAll(async () => {
  for (const entry of manifest) bytes.push(await loadFontFile(entry.file));
}, 60000);
function load(core: TypographyCore, index: number) {
  const entry = manifest[index],
    data = bytes[index];
  if (!entry || !data) throw new Error("Missing fixture");
  return core.loadFont(data, entry.sha256);
}
function request(index: number, features = { liga: 1 }): ShapeRequest {
  const entry = manifest[index];
  if (!entry) throw new Error("Missing fixture");
  return {
    fontSha256: entry.sha256,
    text: "office",
    direction: "ltr",
    language: "en",
    script: "Latn",
    features,
  };
}
it("reuses an immutable static face while keeping registration and shaping state local", async () => {
  const [a, b] = await Promise.all([
    Promise.resolve(new TypographyCore()),
    Promise.resolve(new TypographyCore()),
  ]);
  expect(load(a, 3)).toBe(load(b, 3));
  const ligature = a.shape(request(3));
  expect(b.shape(request(3, { liga: 0 })).glyphs.length).toBeGreaterThan(ligature.glyphs.length);
  expect(a.shape(request(3))).toEqual(ligature);
  const cold = new TypographyCore();
  expect(() => cold.shape(request(3))).toThrow(expect.objectContaining({ code: "FONT_MISSING" }));
  const originalBytes = bytes[3];
  if (!originalBytes) throw new Error("Missing italic fixture");
  const damaged = new Uint8Array(originalBytes);
  damaged[32] = (damaged[32] ?? 0) ^ 1;
  expect(() => cold.loadFont(damaged, request(3).fontSha256)).toThrow(
    expect.objectContaining({ code: "FONT_DIGEST_MISMATCH" }),
  );
  expect(() => cold.shape(request(3))).toThrow(expect.objectContaining({ code: "FONT_MISSING" }));
  load(cold, 3);
  expect(() => cold.shape({ ...request(3), style: { weight: 400, italic: false } })).toThrow(
    expect.objectContaining({ code: "FONT_STYLE_UNAVAILABLE" }),
  );
});
it("evicts the least recently loaded face without invalidating live core fonts", () => {
  const first = new TypographyCore();
  const metrics = load(first, 0);
  const shaped = first.shape(request(0));
  for (const index of [1, 2, 3, 4]) load(new TypographyCore(), index);
  const reloaded = new TypographyCore();
  expect(load(reloaded, 0)).not.toBe(metrics);
  expect(reloaded.shape(request(0))).toEqual(shaped);
  expect(first.shape(request(0))).toEqual(shaped);
  expect(staticFaceCachePolicy).toMatchObject({
    maxEntries: 4,
    maxFontBytes: 128 * 1024 * 1024,
    eviction: "least-recently-used",
  });
  expect(Object.isFrozen(staticFaceCachePolicy)).toBe(true);
  for (const index of [1, 2, 1, 2, 1, 2]) {
    const a = new TypographyCore(),
      b = new TypographyCore();
    load(a, index);
    load(b, index);
    expect(a.shape(request(index))).toEqual(b.shape(request(index)));
  }
});
it("loads the same full 16 MiB font into 160 live cores without duplicate native faces", () => {
  const cores: TypographyCore[] = [];
  const first = new TypographyCore();
  const metrics = load(first, 0);
  const expected = first.shape(request(0));
  cores.push(first);
  for (let i = 1; i < 160; i++) {
    const core = new TypographyCore();
    expect(load(core, 0)).toBe(metrics);
    expect(core.shape(request(0))).toEqual(expected);
    cores.push(core);
  }
  expect(cores[0]?.shape(request(0))).toEqual(expected);
}, 60000);
