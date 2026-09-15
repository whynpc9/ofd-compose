// biome-ignore-all lint/style/noNonNullAssertion: Fixed-cardinality corpus fixtures are checked by their explicit inventory tests.
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
it("charges every large array index allocation before count/first evaluation", async () => {
  const source = textSource();
  source.body = [
    {
      kind: "paragraph",
      nodeId: "large",
      inlines: Array.from({ length: 100 }, (_, i) => ({
        kind: "dynamic-text",
        nodeId: `n${i}`,
        bindingId: `b${i}`,
        expression: { kind: "legacy", text: `items|${i % 2 ? "count" : "first"}` },
      })),
    },
  ];
  // Source/resource snapshots consume <40M units; 100 independent 10000-index allocations
  // must exhaust the remaining job allowance during binding, before tiny outputs hide the work.
  const result = await render(
    source,
    { items: Array.from({ length: 10000 }, () => 1) },
    pack,
    profile,
    { limits: { workUnits: 40_000_000 } },
  );
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_LIMIT", phase: "bind" }],
  });
});
it("checks all declared sizes before awaiting or copying an earlier resource", async () => {
  const bytes = new Uint8Array(await pack.fonts[0]!.bytes);
  bytes[0] = 0; // Would be a digest error if copied/hashed before all size reservations.
  const result = await render(
    textSource(),
    {},
    {
      ...pack,
      fonts: [{ ...pack.fonts[0]!, bytes }],
      images: [
        {
          id: "too-large",
          sha256: "0".repeat(64),
          byteLength: 8_000_001,
          bytes: new Promise(() => {}),
        },
      ],
    },
    profile,
  );
  expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "RESOURCE_LIMIT" }] });
});
it("never starts shaping while another authorized resource remains pending", async () => {
  const signal = new AbortController();
  const task = render(
    textSource("😀"),
    {},
    { ...pack, subsetWasm: { ...pack.subsetWasm, bytes: new Promise(() => {}) } },
    profile,
    { signal: signal.signal },
  );
  await Promise.resolve();
  signal.abort();
  expect(await task).toMatchObject({ ok: false, diagnostics: [{ code: "RENDER_CANCELLED" }] });
});
it("rejects accessors without invoking them and preserves original font bytes after a caller edit", async () => {
  let reads = 0;
  const data = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      reads++;
      return "secret";
    },
  });
  expect(await render(textSource(), data, pack, profile)).toMatchObject({
    ok: false,
    diagnostics: [{ code: "MODEL_INVALID" }],
  });
  expect(reads).toBe(0);
  const bytes = new Uint8Array(await pack.fonts[0]!.bytes);
  const task = render(
    textSource(),
    {},
    { ...pack, fonts: [{ ...pack.fonts[0]!, bytes }] },
    profile,
  );
  bytes.fill(0);
  expect((await task).ok).toBe(true);
});
it("meters repeated legacy object counts and repeated large extrema keys", async () => {
  const source = textSource();
  source.settings.bindingPolicyVersion = "legacy-compat-1";
  source.body = [
    {
      kind: "paragraph",
      nodeId: "counts",
      inlines: Array.from({ length: 100 }, (_, i) => ({
        kind: "dynamic-text",
        nodeId: `n${i}`,
        bindingId: `b${i}`,
        expression: { kind: "legacy", text: "object|count" },
      })),
    },
  ];
  const object = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`key${i}`, i]));
  const counted = await render(source, { object }, pack, profile, {
    limits: { workUnits: 40_000_000 },
  });
  expect(counted.ok).toBe(false);
  expect(counted.diagnostics.at(-1)).toMatchObject({ code: "RESOURCE_LIMIT", phase: "bind" });
  const maximum = textSource();
  maximum.body = [
    {
      kind: "paragraph",
      nodeId: "extrema",
      inlines: [
        {
          kind: "dynamic-text",
          nodeId: "max",
          bindingId: "max-binding",
          expression: { kind: "legacy", text: "items|maxby:key|get:name" },
        },
      ],
    },
  ];
  const items = [
    { key: "Z".repeat(1_000_000), name: "large" },
    ...Array.from({ length: 1000 }, () => ({ key: "a", name: "small" })),
  ];
  const selected = await render(maximum, { items }, pack, profile, {
    limits: { workUnits: 60_000_000 },
  });
  expect(selected).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_LIMIT", phase: "bind" }],
  });
});
it("rejects exponent expansion before fixed-point formatting allocation", async () => {
  const source = textSource();
  source.body = [
    {
      kind: "paragraph",
      nodeId: "number",
      inlines: [
        {
          kind: "dynamic-text",
          nodeId: "number-text",
          bindingId: "number-binding",
          expression: { kind: "legacy", text: "value|format:number:#,##0.00" },
        },
      ],
    },
  ];
  const result = await render(source, { value: "1e1000000000" }, pack, profile);
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_LIMIT", phase: "bind" }],
  });
  expect(result).not.toHaveProperty("resolvedDocument");
});
it("subsets only used fonts from a complete five-font pack", async () => {
  const { loadFontFile } = await import("#font-loader");
  const { default: manifest } = await import("../../typography-core/fonts/manifest.json");
  const fonts = await Promise.all(
    manifest.map(async (entry, i) => {
      const bytes = await loadFontFile(entry.file);
      return {
        family: i === 0 ? "Noto" : `unused${i}`,
        weight: i === 1 || i === 4 ? 700 : 400,
        italic: i >= 3,
        sha256: entry.sha256,
        bytes,
        byteLength: bytes.length,
      };
    }),
  );
  expect(fonts).toHaveLength(5);
  const result = await render(textSource(), {}, { ...pack, fonts }, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.fonts).toHaveLength(1);
  expect(result.ir.resources.filter((r) => r.kind === "font")).toHaveLength(1);
  expect(result.budget.subsetBytes).toBe(32 * 1024 * 1024);
  const empty = await render({ ...textSource(), body: [] }, {}, { ...pack, fonts }, profile);
  if (!empty.ok) throw new Error(JSON.stringify(empty.diagnostics));
  expect(empty.fonts).toEqual([]);
  expect(empty.ir.resources.filter((r) => r.kind === "font")).toEqual([]);
  expect(empty.budget.subsetBytes).toBe(0);
});
it("rejects resource-array getters, sparse entries and custom iterators without executing them", async () => {
  let invoked = 0;
  const getter = new Array(1);
  Object.defineProperty(getter, "0", {
    get() {
      invoked++;
      return pack.fonts[0];
    },
  });
  const iterator = [...pack.fonts];
  Object.defineProperty(iterator, Symbol.iterator, {
    value() {
      invoked++;
      return [][Symbol.iterator]();
    },
  });
  for (const fonts of [getter, iterator, new Array(1)]) {
    expect(await render(textSource(), {}, { ...pack, fonts }, profile)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "MODEL_INVALID" }],
    });
  }
  expect(invoked).toBe(0);
  const images = new Array(1);
  Object.defineProperty(images, "0", {
    get() {
      invoked++;
      return {};
    },
  });
  expect(await render(textSource(), {}, { ...pack, images }, profile)).toMatchObject({
    ok: false,
    diagnostics: [{ code: "MODEL_INVALID" }],
  });
  expect(invoked).toBe(0);
});
it("routes authorized watermark images through root and section pages to writer resources", async () => {
  const sample = await combined();
  const source = textSource("正文");
  const watermark = {
    kind: "image" as const,
    resourceId: "picture",
    x: 30,
    y: 40,
    width: 10,
    height: 12,
    opacity: 0.4,
    layer: "behind" as const,
    transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
  };
  const page = {
    paper: "A4" as const,
    orientation: "portrait" as const,
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    watermarks: [watermark],
  };
  source.settings.page = page;
  source.body.push({
    kind: "paragraph",
    nodeId: "section",
    layout: {
      section: { id: "appendix", page: { ...page, watermarks: [{ ...watermark, x: 60 }] } },
    },
    inlines: [{ kind: "text", nodeId: "section-text", text: "附录" }],
  });
  const result = await render(source, {}, sample.pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.ir.pages).toHaveLength(2);
  expect(result.images).toHaveLength(1);
  const images = result.ir.pages.flatMap((p) => p.objects.filter((o) => o.kind === "image"));
  expect(images.map((o) => o.bounds)).toEqual([
    { x: 30000, y: 40000, width: 10000, height: 12000 },
    { x: 60000, y: 40000, width: 10000, height: 12000 },
  ]);
  expect(images.every((o) => o.resourceId === result.images[0]!.resourceId)).toBe(true);
  expect(fontDigest(result.images[0]!.bytes)).toBe(result.images[0]!.digest);
  const missing = await render(source, {}, { ...sample.pack, images: [] }, profile);
  expect(missing).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_FORBIDDEN", phase: "media" }],
  });
  const corrupt = new Uint8Array(await sample.pack.images![0]!.bytes);
  corrupt[corrupt.length - 1] = (corrupt.at(-1) ?? 0) ^ 1;
  const invalid = await render(
    source,
    {},
    {
      ...sample.pack,
      images: [{ ...sample.pack.images![0]!, bytes: corrupt, sha256: fontDigest(corrupt) }],
    },
    profile,
  );
  expect(invalid).toMatchObject({
    ok: false,
    diagnostics: [{ code: "MODEL_INVALID", phase: "media" }],
  });
});
it("preserves the offending node identity on layout failures", async () => {
  const result = await render(textSource(), {}, pack, {
    ...profile,
    layout: {
      ...profile.layout,
      page: { width: 210, height: 10, contentBox: { x: 0, y: 0, width: 170, height: 1 } },
    },
  });
  expect(result).toMatchObject({
    ok: false,
    diagnostics: [{ code: "LAYOUT_OVERFLOW", phase: "layout", nodeId: "p" }],
  });
  expect(result).not.toHaveProperty("ir");
});
it("retains a notdef-only subset for fonts referenced by glyphless text objects", async () => {
  const sources = [textSource(""), textSource(""), textSource("")];
  sources[1]!.body = [
    {
      kind: "paragraph",
      nodeId: "p",
      inlines: [
        {
          kind: "dynamic-text",
          nodeId: "empty-value",
          bindingId: "empty-binding",
          expression: { kind: "legacy", text: "value" },
        },
      ],
    },
  ];
  sources[2]!.body = [
    {
      kind: "paragraph",
      nodeId: "p",
      inlines: [
        {
          kind: "input-control",
          nodeId: "empty-control",
          controlId: "empty",
          controlType: "text",
          defaultValue: "",
        },
      ],
    },
  ];
  for (const source of sources) {
    const result = await render(source, { value: "" }, pack, profile);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const text = result.ir.pages.flatMap((p) => p.objects.filter((o) => o.kind === "text"));
    expect(text.length).toBeGreaterThan(0);
    expect(text.every((o) => o.glyphs.length === 0)).toBe(true);
    expect(result.fonts).toHaveLength(1);
    expect(result.fonts[0]!.glyphIdMap).toEqual([{ original: 0, subset: 0 }]);
    expect(result.fonts[0]!.subsetDigest).toBe(fontDigest(result.fonts[0]!.bytes));
    expect(text.every((o) => o.fontId === result.fonts[0]!.resourceId)).toBe(true);
  }
});
it("commits every authorized image to the identity, independent of resource arrival/order", async () => {
  const sample = await combined();
  const first = await render(textSource(), {}, pack, profile);
  const unused = { ...sample.pack.images![0]!, id: "unused" };
  const second = await render(textSource(), {}, { ...pack, images: [unused] }, profile);
  if (!first.ok || !second.ok) throw new Error("Expected successful renders");
  expect(second.images).toEqual([]);
  expect(second.identity.resourcePackDigest).not.toBe(first.identity.resourcePackDigest);
  expect(second.identity.layoutInputDigest).not.toBe(first.identity.layoutInputDigest);
  expect(second.identity.irDigest).not.toBe(first.identity.irDigest);
  const fixtures = (await import("../../media-core/tests/fixtures.json")).default;
  const bytes = Uint8Array.from(atob(fixtures.png), (c) => c.charCodeAt(0));
  const replacement = { ...unused, bytes, byteLength: bytes.length, sha256: fontDigest(bytes) };
  const third = await render(textSource(), {}, { ...pack, images: [replacement] }, profile);
  if (!third.ok) throw new Error(JSON.stringify(third.diagnostics));
  expect(third.identity.resourcePackDigest).not.toBe(second.identity.resourcePackDigest);
  expect(third.identity.irDigest).not.toBe(second.identity.irDigest);
  const alias = { ...unused, id: "alias" };
  const ordered = await render(textSource(), {}, { ...pack, images: [unused, alias] }, profile);
  const reversed = await render(textSource(), {}, { ...pack, images: [alias, unused] }, profile);
  expect(ordered.ok && ordered.identity).toEqual(reversed.ok && reversed.identity);
});
it("uses intrinsic byte lengths before copying typed arrays with shadowed size fields", async () => {
  let invoked = 0;
  const bytes = new Uint8Array(await pack.fonts[0]!.bytes);
  for (const key of ["length", "byteLength"])
    Object.defineProperty(bytes, key, {
      get() {
        invoked++;
        return 1;
      },
    });
  const invalid = await render(
    textSource(),
    {},
    { ...pack, fonts: [{ ...pack.fonts[0]!, byteLength: 1, bytes }] },
    profile,
  );
  expect(invalid).toMatchObject({ ok: false, diagnostics: [{ code: "RESOURCE_FORBIDDEN" }] });
  expect(invoked).toBe(0);
  const valid = await render(
    textSource(),
    {},
    { ...pack, fonts: [{ ...pack.fonts[0]!, bytes }] },
    profile,
  );
  expect(valid.ok).toBe(true);
  expect(invoked).toBe(0);
});
it("returns the independently versioned barcode generator and the consumed profile snapshot", async () => {
  const sample = await combined();
  const result = await render(sample.source, sample.data, sample.pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.identity.barcodeGeneratorVersion).toBe("bwip-js@4.11.4/drawing-context@1");
  expect(result.identity.layoutConfiguration).toEqual(profile);
  expect(digestCanonical(result.identity.layoutConfiguration)).toBe(
    result.identity.layoutConfigurationDigest,
  );
});
it("distinguishes declared font style mismatch from an absent exact font face", async () => {
  for (const metadata of [{ weight: 700 }, { italic: true }]) {
    const result = await render(
      textSource(),
      {},
      { ...pack, fonts: [{ ...pack.fonts[0]!, ...metadata }] },
      profile,
    );
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "FONT_STYLE_UNAVAILABLE", phase: "layout" }],
    });
  }
  const missing = await render(textSource(), {}, pack, {
    ...profile,
    layout: {
      ...profile.layout,
      defaultStyle: { ...profile.layout.defaultStyle, bold: true },
    },
  });
  expect(missing).toMatchObject({
    ok: false,
    diagnostics: [{ code: "FONT_MISSING", phase: "layout" }],
  });
});
it("keeps section-watermark diagnostics attached to their owning paragraph", async () => {
  const sample = await combined();
  const source = textSource();
  const page = {
    paper: "A4" as const,
    orientation: "portrait" as const,
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    watermarks: [
      {
        kind: "image" as const,
        resourceId: "picture",
        x: 20,
        y: 20,
        width: 10,
        height: 10,
        opacity: 0.3,
        layer: "behind" as const,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ],
  };
  source.body = [
    {
      kind: "paragraph",
      nodeId: "watermark-owner",
      layout: { section: { id: "section", page } },
      inlines: [{ kind: "text", nodeId: "text", text: "正文" }],
    },
  ];
  const missing = await render(source, {}, pack, profile);
  expect(missing).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_FORBIDDEN", phase: "media", nodeId: "watermark-owner" }],
  });
  expect(missing.diagnostics[0]).not.toHaveProperty("bindingId");
  const bytes = new Uint8Array(await sample.pack.images![0]!.bytes);
  bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;
  const invalid = await render(
    source,
    {},
    { ...sample.pack, images: [{ ...sample.pack.images![0]!, bytes, sha256: fontDigest(bytes) }] },
    profile,
  );
  expect(invalid).toMatchObject({
    ok: false,
    diagnostics: [{ code: "MODEL_INVALID", phase: "media", nodeId: "watermark-owner" }],
  });
});
it("exposes the actual independent layout, shaping and protocol versions", async () => {
  const result = await render(textSource(), {}, pack, profile);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const versions = await import("@ofd-compose/layout-core");
  const typography = await import("@ofd-compose/typography-core");
  expect(result.identity.layoutEngineVersion).toBe(versions.layoutEngineVersion);
  expect(result.identity.lineBreakVersion).toBe(versions.lineBreakVersion);
  expect(result.identity.lineBreakVersion).toBe("@cto.af/linebreak@4.0.3/chinese-v1");
  expect(result.identity.shapingAndLineBreakVersions).toEqual(
    typography.shapingAndLineBreakVersions,
  );
  expect(result.identity.irVersion).toBe(result.ir.irVersion);
  expect(result.identity.modelVersion).toBe(result.resolvedDocument.modelVersion);
  expect(result.identity.canonicalizationVersion).toBe("ofd-compose/canonical@0");
  expect(result.identity.renderProfileVersion).toBe(profile.version);
  expect(result.identity.layoutProfile).toEqual(result.ir.identity.layoutProfile);
});
it("checks per-kind font/image pack ceilings before awaiting resource bytes", async () => {
  const fonts = Array.from({ length: 5 }, (_, i) => ({
    family: `font${i}`,
    weight: 400,
    italic: false,
    sha256: "0".repeat(64),
    byteLength: 32 * 1024 * 1024,
    bytes: new Promise<Uint8Array>(() => {}),
  }));
  const tooManyFontBytes = await render(textSource(), {}, { ...pack, fonts }, profile);
  expect(tooManyFontBytes).toMatchObject({
    ok: false,
    diagnostics: [
      {
        code: "RESOURCE_LIMIT",
        phase: "render",
        message: "Resource pack exceeds font byte ceiling",
      },
    ],
  });
  const images = Array.from({ length: 5 }, (_, i) => ({
    id: `image${i}`,
    sha256: "0".repeat(64),
    byteLength: 8_000_000,
    bytes: new Promise<Uint8Array>(() => {}),
  }));
  const tooManyImageBytes = await render(textSource(), {}, { ...pack, images }, profile);
  expect(tooManyImageBytes).toMatchObject({
    ok: false,
    diagnostics: [
      {
        code: "RESOURCE_LIMIT",
        phase: "render",
        message: "Resource pack exceeds image byte ceiling",
      },
    ],
  });
});
