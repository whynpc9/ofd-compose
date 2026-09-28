import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { canonicalSerialize } from "../../packages/layout-ir/dist/index.mjs";
import { render } from "../../packages/render-worker/dist/index.mjs";

const require = createRequire(
  new URL("../../packages/typography-core/package.json", import.meta.url),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fontManifest = JSON.parse(
  await readFile("packages/typography-core/fonts/manifest.json", "utf8"),
);
const wasmPath = new URL("harfbuzz-subset.wasm", `file://${require.resolve("harfbuzzjs")}`);
const inputBytes = await readFile(process.argv[2]);
const corpus = JSON.parse(inputBytes);
const corpusSha256 = hash(inputBytes);
for (const name of ["window", "document", "HTMLCanvasElement", "OffscreenCanvas"])
  assert.equal(Object.hasOwn(globalThis, name), false);
// Cached only within this process. Fresh cold processes load again (OS page cache is not purged).
const packs = new Map();
for await (const line of createInterface({ input: process.stdin })) {
  const { id, directory, observe = true } = JSON.parse(line);
  const item = corpus.cases.find((c) => c.id === id);
  assert.ok(item, `Unknown case ${id}`);
  const t0 = performance.now();
  let base = packs.get(item.fontIndex);
  if (!base) {
    const font = fontManifest[item.fontIndex];
    const bytes = new Uint8Array(await readFile(`packages/typography-core/fonts/${font.file}`));
    assert.equal(hash(bytes), font.sha256);
    const wasm = new Uint8Array(await readFile(wasmPath));
    base = {
      fonts: [
        {
          family: "Noto",
          weight: 400,
          italic: false,
          sha256: font.sha256,
          byteLength: bytes.length,
          bytes,
        },
      ],
      subsetWasm: { byteLength: wasm.length, bytes: wasm },
    };
    packs.set(item.fontIndex, base);
  }
  const images = item.images.map(({ id, sha256, base64 }) => {
    const bytes = new Uint8Array(Buffer.from(base64, "base64"));
    assert.equal(hash(bytes), sha256);
    return { id, sha256, byteLength: bytes.length, bytes };
  });
  const resourceLoadMs = performance.now() - t0;
  const stages = {},
    starts = {};
  const observer = (stage, edge) => {
    const now = performance.now();
    if (edge === "start") {
      assert.equal(starts[stage], undefined);
      starts[stage] = now;
    } else {
      assert.notEqual(starts[stage], undefined);
      stages[stage] = (stages[stage] ?? 0) + now - starts[stage];
      delete starts[stage];
    }
  };
  const start = performance.now();
  const result = await render(
    item.source,
    item.data,
    { ...base, images },
    item.profile,
    observe ? { observe: observer } : {},
  );
  const renderMs = performance.now() - start;
  const identity = {
    corpusSha256,
    inputSha256: hash(canonicalSerialize(item)),
    fontSha256: base.fonts[0].sha256,
    subsetWasmSha256: hash(base.subsetWasm.bytes),
    profileSha256: hash(canonicalSerialize(item.profile)),
  };
  let outcome;
  if (item.expected.code) {
    assert.equal(result.ok, false);
    assert.equal(result.ir, undefined);
    assert.equal(result.diagnostics[0]?.code, item.expected.code);
    assert.ok(
      result.diagnostics[0]?.message.includes(item.expected.message),
      JSON.stringify(result.diagnostics),
    );
    outcome = { ok: false, diagnostics: result.diagnostics };
  } else {
    assert.equal(result.ok, true, `${id}: ${JSON.stringify(result.diagnostics)}`);
    assert.deepEqual(Object.keys(starts), []);
    const objects = result.ir.pages.flatMap((p) => p.objects);
    if (item.expected.readerRegions) {
      assert.ok(
        objects.some((o) => o.kind === "path"),
        "Reader sample needs actual border paths",
      );
      assert.equal(objects.filter((o) => o.kind === "image").length, 1);
      assert.equal(
        objects
          .filter((o) => o.kind === "text")
          .map((o) => o.logicalText)
          .join(""),
        "中文 office é 2026边框 Border",
      );
    }
    if (item.expected.pages) assert.equal(result.ir.pages.length, item.expected.pages);
    if (item.expected.tableCells)
      assert.equal(result.semanticMap.filter((s) => s.table).length, item.expected.tableCells);
    if (item.expected.text !== undefined) {
      const byId = new Map(objects.map((o) => [o.id, o]));
      const text = result.semanticMap
        .map((s) => byId.get(s.objectId))
        .map((o) => (o?.kind === "text" ? o.logicalText : ""))
        .join("");
      assert.equal(text, item.expected.text);
      const renderedImages = objects.filter((o) => o.kind === "image");
      assert.equal(renderedImages.length, item.expected.images.length);
      for (const [i, image] of renderedImages.entries()) {
        assert.ok(
          Math.abs(image.bounds.width / 1000 - (item.expected.images[i].widthPx * 25.4) / 96) <
            0.01,
        );
        assert.ok(
          Math.abs(image.bounds.height / 1000 - (item.expected.images[i].heightPx * 25.4) / 96) <
            0.01,
        );
      }
      assert.equal(objects.filter((o) => o.kind === "path").length, item.expected.barcodes);
    }
    const canonical = canonicalSerialize(result.ir);
    assert.equal(hash(canonical), result.identity.irDigest);
    const resources = [...result.fonts, ...result.images].map((resource) => ({
      resourceId: resource.resourceId,
      file: `${resource.resourceId}.bin`,
      sha256: hash(resource.bytes),
    }));
    outcome = {
      ok: true,
      identity: result.identity,
      pages: result.ir.pages.length,
      resources,
      diagnostics: result.diagnostics,
    };
    if (directory) {
      const dir = resolve(directory);
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/ir.json`, canonical);
      await writeFile(
        `${dir}/manifest.json`,
        JSON.stringify({ identity: result.identity, resources }),
      );
      for (const resource of [...result.fonts, ...result.images])
        await writeFile(`${dir}/${resource.resourceId}.bin`, resource.bytes);
    }
  }
  if (stages.layout !== undefined) stages.layoutExclusive = stages.layout - (stages.shape ?? 0);
  process.stdout.write(
    `${JSON.stringify({ id, identity, outcome, observed: observe, timing: { resourceLoadMs, renderMs, stages }, nodePeakRssBytes: process.resourceUsage().maxRSS * 1024, runtime: process.version, architecture: process.arch, platform: process.platform })}\n`,
  );
}
