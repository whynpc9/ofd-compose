import { digestCanonical, validateCanonicalLayoutIR } from "@ofd-compose/layout-ir";
import { fontDigest, TypographyCore } from "@ofd-compose/typography-core";
import * as hb from "harfbuzzjs";
import { beforeAll, expect, it } from "vitest";
import { type ResourcePack, render } from "../src/index.js";
import { combined, profile, resources, textSource } from "./fixtures.js";

let pack: ResourcePack;
beforeAll(async () => {
  pack = await resources();
});
it("renders real CFF glyph subsets with stable advances and writer identities", async () => {
  const result = await render(textSource(), {}, pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  validateCanonicalLayoutIR(result.ir);
  expect(result.identity.irDigest).toBe(digestCanonical(result.ir));
  expect(result.fonts).toHaveLength(1);
  const subset = result.fonts[0]!;
  expect(subset.outline).toBe("cff");
  expect(subset.subsetDigest).toBe(fontDigest(subset.bytes));
  expect(subset.originalDigest).not.toBe(subset.subsetDigest);
  const originalCore = new TypographyCore(),
    subsetCore = new TypographyCore();
  originalCore.loadFont(await pack.fonts[0]!.bytes, subset.originalDigest);
  subsetCore.loadFont(subset.bytes, subset.subsetDigest);
  for (const text of ["中文", "office", "é"]) {
    const request = {
      text,
      direction: "ltr" as const,
      script: text === "中文" ? "Hani" : "Latn",
      language: "zh-Hans",
    };
    const original = originalCore.shape({ ...request, fontSha256: subset.originalDigest });
    const before = new hb.Font(new hb.Face(new hb.Blob(await pack.fonts[0]!.bytes)));
    const after = new hb.Font(new hb.Face(new hb.Blob(subset.bytes)));
    for (const glyph of original.glyphs) {
      expect(after.glyphHAdvance(glyph.glyphId)).toBe(before.glyphHAdvance(glyph.glyphId));
      expect(after.glyphToPath(glyph.glyphId)).toBe(before.glyphToPath(glyph.glyphId));
    }
  }
  expect(subset.bytes.length).toBeLessThan(pack.fonts[0]!.byteLength);
  expect(result.ir.resources.find((r) => r.id === subset.resourceId)).toMatchObject({
    originalDigest: subset.originalDigest,
    subsetDigest: subset.subsetDigest,
    glyphIdMap: subset.glyphIdMap,
  });
});
it("renders the complete narrative/table/image/two-barcode sample", async () => {
  const sample = await combined();
  const result = await render(sample.source, sample.data, sample.pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const objects = new Map(result.ir.pages.flatMap((p) => p.objects).map((o) => [o.id, o]));
  const text = result.semanticMap
    .map((s) => objects.get(s.objectId))
    .map((o) => (o?.kind === "text" ? o.logicalText : ""))
    .join("");
  expect(text).toBe(
    "营收最高的是机构0，占比25.00%" +
      sample.data.institutions.map((i) => i.name + i.revenue).join(""),
  );
  expect(result.ir.pages.length).toBeGreaterThan(1);
  expect(result.images).toHaveLength(1);
  expect([...objects.values()].filter((o) => o.kind === "path").length).toBeGreaterThan(1);
});
it("fails atomically for missing fonts and images", async () => {
  const noFont = await render(textSource(), {}, { ...pack, fonts: [] }, profile);
  expect(noFont).toMatchObject({ ok: false, diagnostics: [{ code: "FONT_MISSING" }] });
  expect(noFont).not.toHaveProperty("ir");
  const sample = await combined();
  const noImage = await render(sample.source, sample.data, { ...sample.pack, images: [] }, profile);
  expect(noImage).toMatchObject({ ok: false, diagnostics: [{ code: "RESOURCE_FORBIDDEN" }] });
  expect(noImage).not.toHaveProperty("fonts");
});
it("snapshots direct inputs before asynchronous resources", async () => {
  const source = textSource("original");
  let finish!: (bytes: Uint8Array) => void;
  const pending = new Promise<Uint8Array>((resolve) => {
    finish = resolve;
  });
  const task = render(
    source,
    {},
    { ...pack, subsetWasm: { ...pack.subsetWasm, bytes: pending } },
    profile,
  );
  (source.body[0] as { inlines: { text: string }[] }).inlines[0]!.text = "mutated";
  finish(await pack.subsetWasm.bytes);
  const result = await task;
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(
      result.ir.pages
        .flatMap((p) => p.objects)
        .filter((o) => o.kind === "text")
        .map((o) => o.logicalText)
        .join(""),
    ).toBe("original");
});
it("cancels a pending resource job without waiting for the resource", async () => {
  const abort = new AbortController();
  const task = render(
    textSource(),
    {},
    { ...pack, fonts: [{ ...pack.fonts[0]!, bytes: new Promise(() => {}) }] },
    profile,
    { signal: abort.signal },
  );
  abort.abort();
  expect(await task).toMatchObject({ ok: false, diagnostics: [{ code: "RENDER_CANCELLED" }] });
});
it("rejects oversized sparse input before allocating it", async () => {
  const result = await render(textSource(), new Array(10_000_000), pack, profile);
  expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "RESOURCE_LIMIT" }] });
});
it("retains real TrueType composite outlines and advances through repeated alternating jobs", async () => {
  const ttf = await resources(3);
  ttf.fonts[0]!.italic = true;
  const italic = {
    ...profile,
    layout: { ...profile.layout, defaultStyle: { ...profile.layout.defaultStyle, italic: true } },
  };
  for (let round = 0; round < 3; round++) {
    const result = await render(textSource("é Å office"), {}, ttf, italic);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    expect(result.fonts[0]!.outline).toBe("truetype");
    const originalBytes = await ttf.fonts[0]!.bytes;
    const before = new hb.Font(new hb.Face(new hb.Blob(originalBytes)));
    const after = new hb.Font(new hb.Face(new hb.Blob(result.fonts[0]!.bytes)));
    const glyphs = result.ir.pages
      .flatMap((p) => p.objects)
      .flatMap((o) => (o.kind === "text" ? o.glyphs : []));
    expect(glyphs.length).toBeGreaterThan(0);
    for (const { glyphId } of glyphs) {
      expect(after.glyphHAdvance(glyphId)).toBe(before.glyphHAdvance(glyphId));
      expect(after.glyphToPath(glyphId)).toBe(before.glyphToPath(glyphId));
    }
    // Prove the selected glyph set actually contains a composite TrueType glyph.
    const view = new DataView(originalBytes.buffer, originalBytes.byteOffset, originalBytes.length);
    const table = (tag: number) => {
      for (let i = 0; i < view.getUint16(4); i++)
        if (view.getUint32(12 + 16 * i) === tag) return view.getUint32(20 + 16 * i);
      throw new Error("Missing TrueType table");
    };
    const head = table(0x68656164),
      loca = table(0x6c6f6361),
      glyf = table(0x676c7966);
    const long = view.getInt16(head + 50) === 1;
    expect(
      glyphs.some(({ glyphId }) => {
        const at = long
          ? view.getUint32(loca + glyphId * 4)
          : view.getUint16(loca + glyphId * 2) * 2;
        return view.getInt16(glyf + at) < 0;
      }),
    ).toBe(true);
    const cff = await render(textSource(), {}, pack, profile);
    expect(cff.ok).toBe(true);
  }
});
it("is independent of async arrival order and concurrent renders", async () => {
  const fixture = await combined();
  const first = await render(fixture.source, fixture.data, fixture.pack, profile);
  if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
  const pending: { resolve: (bytes: Uint8Array) => void; bytes: Uint8Array }[] = [];
  const delayed = async (resource: {
    byteLength: number;
    bytes: Uint8Array | Promise<Uint8Array>;
  }) => {
    const bytes = await resource.bytes;
    let resolve!: (b: Uint8Array) => void;
    const promise = new Promise<Uint8Array>((r) => {
      resolve = r;
    });
    pending.push({ resolve, bytes });
    return { ...resource, bytes: promise };
  };
  const secondPack = {
    ...fixture.pack,
    fonts: [{ ...fixture.pack.fonts[0]!, ...(await delayed(fixture.pack.fonts[0]!)) }],
    images: [{ ...fixture.pack.images![0]!, ...(await delayed(fixture.pack.images![0]!)) }],
    subsetWasm: await delayed(fixture.pack.subsetWasm),
  };
  const task = render(fixture.source, fixture.data, secondPack, profile);
  for (const item of pending.reverse()) item.resolve(item.bytes);
  const [second, third] = await Promise.all([
    task,
    render(fixture.source, fixture.data, fixture.pack, profile),
  ]);
  expect(second.ok && second.identity).toEqual(first.identity);
  expect(third.ok && third.identity).toEqual(first.identity);
});
it("keeps budget and font validation failures atomic and recovers for the next job", async () => {
  expect(
    await render(textSource(), {}, pack, profile, { limits: { workUnits: 100 } }),
  ).toMatchObject({ ok: false, diagnostics: [{ code: "RESOURCE_LIMIT" }] });
  expect(await render(textSource("😀"), {}, pack, profile)).toMatchObject({
    ok: false,
    diagnostics: [{ code: "CHARACTER_OUT_OF_PROFILE" }],
  });
  const bytes = new Uint8Array(await pack.fonts[0]!.bytes);
  bytes[0] = 0;
  expect(
    await render(
      textSource(),
      {},
      { ...pack, fonts: [{ ...pack.fonts[0]!, bytes, sha256: fontDigest(bytes) }] },
      profile,
    ),
  ).toMatchObject({ ok: false, diagnostics: [{ code: "FONT_INVALID" }] });
  expect((await render(textSource(), {}, pack, profile)).ok).toBe(true);
});
it("matches the committed independent Node digest in both engines", async () => {
  const sample = await combined();
  const result = await render(sample.source, sample.data, sample.pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const expected = (await import("./expected.json")).default;
  expect({
    identity: result.identity,
    pages: result.ir.pages.length,
    subsets: result.fonts.map(({ subsetDigest }) => subsetDigest),
  }).toEqual(expected);
});
