// Real Worker IR, independently decoded by Node and .NET. No generator pattern data is exported.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { render } from "@ofd-compose/render-worker";

const root = new URL("../../../tests/barcodes/", import.meta.url);
const cases = JSON.parse(await readFile(new URL("cases.json", root), "utf8"));
const wasm = new Uint8Array(
  await readFile(new URL("harfbuzz-subset.wasm", import.meta.resolve("harfbuzzjs"))),
);
const profile = {
  version: "ofd-compose/render@0",
  layout: {
    page: { width: 210, height: 297, contentBox: { x: 20, y: 20, width: 170, height: 257 } },
    defaultStyle: { fontFamily: "Noto", fontSize: 12 },
    formattingPolicy: {
      version: "binding-1",
      locale: "zh-CN",
      timeZone: "UTC",
      tzdataVersion: "2026a",
      rounding: "half-up",
    },
  },
};
const fixtures = [];
for (const sample of [
  ...cases,
  ...cases
    .filter((c) => c.name.endsWith("-basic"))
    .map((c) => ({ ...c, name: `${c.name}-scaled`, scaled: true })),
]) {
  const block = {
    kind: "barcode-binding",
    nodeId: "barcode",
    bindingId: "binding",
    expression: { kind: "legacy", text: "value" },
    placement: { alignment: "center" },
    options: {
      symbology: sample.symbology,
      width: 80,
      height: 20,
      ...(sample.normalizationPolicy ? { normalizationPolicy: sample.normalizationPolicy } : {}),
    },
  };
  const source = {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "barcode-admission",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body: sample.scaled
      ? [
          {
            kind: "region",
            nodeId: "region",
            layout: {
              mode: "fixed",
              box: { x: 40, y: 50, width: 100, height: 12 },
              overflow: { kind: "scale", minScale: 0.5 },
            },
            children: [block],
          },
        ]
      : [block],
  };
  const result = await render(
    source,
    { value: sample.inputValue },
    { fonts: [], subsetWasm: { byteLength: wasm.length, bytes: wasm } },
    profile,
  );
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const paths = result.ir.pages.flatMap((p) => p.objects).filter((o) => o.kind === "path");
  assert.equal(paths.length, 1);
  const path = paths[0];
  const state = result.ir.graphicsStates.find((s) => s.id === path.stateId);
  assert.ok(state);
  const t = state.transform;
  const commands = path.commands.map((c) =>
    c.op === "close"
      ? c
      : {
          op: c.op,
          x: (t.a * c.x + t.c * c.y + t.e - path.bounds.x) / 1000,
          y: (t.b * c.x + t.d * c.y + t.f - path.bounds.y) / 1000,
        },
  );
  assert.equal(path.bounds.width, sample.scaled ? 48000 : 80000);
  assert.equal(path.bounds.height, sample.scaled ? 12000 : 20000);
  assert.equal(path.bounds.x, sample.scaled ? 46000 : 65000);
  fixtures.push({
    ...sample,
    width: path.bounds.width / 1000,
    height: path.bounds.height / 1000,
    path: { commands },
  });
}
await writeFile(new URL("fixtures.json", root), `${JSON.stringify(fixtures)}\n`);
execFileSync(fileURLToPath(new URL("../../../node_modules/.bin/biome", import.meta.url)), [
  "format",
  "--write",
  fileURLToPath(new URL("fixtures.json", root)),
]);
console.log(`Exported ${fixtures.length} real Worker barcode paths`);
