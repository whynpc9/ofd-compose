import { fontDigest } from "@ofd-compose/typography-core";
import { expect, it } from "vitest";
import type { SourceContent } from "../src/index.js";
import { finalizeSource, render } from "../src/index.js";
import { combined, profile, resources, textSource } from "./fixtures.js";

it("reopens filled source with inert expressions and genuinely new subset glyphs", async () => {
  const pack = await resources();
  const first = await render(textSource("中文"), {}, pack, profile, { sourceAttachment: true });
  if (!first.ok || !first.editingSource) throw new Error(JSON.stringify(first.diagnostics));
  const content = JSON.parse(first.editingSource.json) as SourceContent;
  const paragraph = content.resolvedDocument.body[0];
  if (paragraph?.kind !== "paragraph" || paragraph.fragments[0]?.kind !== "text")
    throw new Error("fixture");
  paragraph.fragments[0].text = "中文新";
  paragraph.fragments[0].origin = {
    kind: "dynamic-text",
    nodeId: "t",
    bindingId: "inert",
    expression: "DO_NOT_RUN(secret)",
    valueState: "value",
  };
  content.resolvedDocument.revisionId = "next";
  const second = await finalizeSource(content, pack, { sourceAttachment: true });
  if (!second.ok) throw new Error(JSON.stringify(second.diagnostics));
  const glyphs = (result: typeof first) =>
    result.ir.pages
      .flatMap((p) => p.objects)
      .flatMap((o) => (o.kind === "text" ? o.glyphs.map((g) => g.glyphId) : []));
  expect(glyphs(second).some((g) => !glyphs(first).includes(g))).toBe(true);
  expect(second.fonts[0]?.subsetDigest).not.toBe(first.fonts[0]?.subsetDigest);
  expect(second.identity.resourcePackDigest).toBe(first.identity.resourcePackDigest);
  expect(second.identity.irDigest).not.toBe(first.identity.irDigest);
  expect(second.identity).not.toHaveProperty("dataDigest");
  expect(second.editingSource?.json).not.toContain("DO_NOT_RUN");
  expect(
    second.ir.pages
      .flatMap((p) => p.objects)
      .filter((o) => o.kind === "text")
      .map((o) => o.logicalText)
      .join(""),
  ).toBe("中文新");
});

it("requires the explicitly authorized full font and never treats a subset as that font", async () => {
  const pack = await resources();
  const first = await render(textSource(), {}, pack, profile, { sourceAttachment: true });
  if (!first.ok || !first.editingSource || !first.fonts[0] || !pack.fonts[0])
    throw new Error("fixture");
  const content = JSON.parse(first.editingSource.json) as SourceContent;
  const unavailable = await finalizeSource(content, { ...pack, fonts: [] });
  expect(unavailable).toMatchObject({ ok: false, diagnostics: [{ code: "FONT_MISSING" }] });
  const subset = first.fonts[0].bytes;
  const forged = await finalizeSource(content, {
    ...pack,
    fonts: [
      { ...pack.fonts[0], bytes: subset, sha256: fontDigest(subset), byteLength: subset.length },
    ],
  });
  expect(forged).toMatchObject({ ok: false, diagnostics: [{ code: "FONT_DIGEST_MISMATCH" }] });
  const tampered = new Uint8Array(await pack.fonts[0].bytes);
  tampered[0] = (tampered[0] ?? 0) ^ 1;
  const mismatch = await finalizeSource(content, {
    ...pack,
    fonts: [{ ...pack.fonts[0], bytes: tampered }],
  });
  expect(mismatch).toMatchObject({ ok: false, diagnostics: [{ code: "FONT_DIGEST_MISMATCH" }] });
  const denied = await finalizeSource(content, {
    ...pack,
    fonts: [{ ...pack.fonts[0], bytes: Promise.reject(new Error("authorization denied")) }],
  });
  expect(denied).toMatchObject({ ok: false, diagnostics: [{ code: "FONT_MISSING" }] });
  for (const result of [unavailable, forged, mismatch, denied])
    expect(result).not.toHaveProperty("ir");
});

it("keeps visible values and source relationships while excluding unused business input", async () => {
  const fixture = await combined();
  fixture.source.settings.page = {
    paper: "A4",
    orientation: "portrait",
    margins: { top: 20, bottom: 20, left: 20, right: 20 },
    watermarks: [
      {
        kind: "image",
        resourceId: "picture",
        x: 2,
        y: 2,
        width: 10,
        height: 10,
        layer: "behind",
        opacity: 1,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ],
  };
  const font = fixture.pack.fonts[0];
  if (!font) throw new Error("fixture");
  const pack = {
    ...fixture.pack,
    fonts: [...fixture.pack.fonts, { ...font, family: "UNUSED_ALIAS_SECRET" }],
  };
  const result = await render(
    fixture.source,
    { ...fixture.data, neverUsed: "SECRET_TOKEN" },
    pack,
    profile,
    { sourceAttachment: true },
  );
  if (!result.ok || !result.editingSource) throw new Error(JSON.stringify(result.diagnostics));
  const source = JSON.parse(result.editingSource.json) as SourceContent;
  expect(source.semanticMap.pageDecorations.length).toBe(result.ir.pages.length);
  expect(
    source.semanticMap.pageDecorations.every((w) => w.pointer === "/settings/page/watermarks/0"),
  ).toBe(true);
  const withoutCapture = await render(
    fixture.source,
    { ...fixture.data, neverUsed: "SECRET_TOKEN" },
    pack,
    profile,
  );
  if (!withoutCapture.ok) throw new Error(JSON.stringify(withoutCapture.diagnostics));
  expect(withoutCapture.ir).toEqual(result.ir);
  expect(result.editingSource.json).not.toContain("SECRET_TOKEN");
  expect(result.editingSource.json).not.toContain("dataPath");
  expect(result.editingSource.json).not.toContain("UNUSED_ALIAS_SECRET");
  expect(result.editingSource.json).toContain("winner-binding");
  expect(source.semanticMap.entries).toEqual(result.semanticMap);
  const edited = await finalizeSource(source, fixture.pack);
  if (!edited.ok) throw new Error(JSON.stringify(edited.diagnostics));
  const text = (r: typeof result) =>
    r.ir.pages
      .flatMap((p) => p.objects)
      .filter((o) => o.kind === "text")
      .map((o) => o.logicalText);
  expect(text(edited)).toEqual(text(result));
  expect(edited.images.map((i) => i.digest)).toEqual(result.images.map((i) => i.digest));
  const invalid = await render(
    fixture.source,
    fixture.data,
    fixture.pack,
    { ...profile, debug: "DEBUG_SECRET" } as typeof profile,
    { sourceAttachment: true },
  );
  expect(invalid).toMatchObject({ ok: false, diagnostics: [{ code: "MODEL_INVALID" }] });
  expect(invalid).not.toHaveProperty("editingSource");
});

it("bounds source snapshots, repeated identities, full resource bytes and cancellation before output", async () => {
  const pack = await resources();
  const first = await render(textSource(), {}, pack, profile, { sourceAttachment: true });
  if (!first.ok || !first.editingSource) throw new Error("fixture");
  const content = JSON.parse(first.editingSource.json) as SourceContent;
  const cancelled = new AbortController();
  cancelled.abort();
  expect(await finalizeSource(content, pack, { signal: cancelled.signal })).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RENDER_CANCELLED" }],
  });
  expect(await finalizeSource(content, pack, { limits: { resourceBytes: 1024 } })).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_LIMIT" }],
  });
  content.resources.fonts = new Array(200001).fill(content.resources.fonts[0]);
  expect(await finalizeSource(content, pack)).toMatchObject({
    ok: false,
    diagnostics: [{ code: "RESOURCE_LIMIT" }],
  });
  const cycle = JSON.parse(first.editingSource.json);
  cycle.resolvedDocument.body.push(cycle);
  expect(await finalizeSource(cycle, pack)).toMatchObject({
    ok: false,
    diagnostics: [{ code: "MODEL_INVALID" }],
  });
});
