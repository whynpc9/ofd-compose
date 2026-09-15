// Ordinary public-Worker input retained for the pending strict-reader whitespace decision.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalSerialize } from "@ofd-compose/layout-ir";
import { render } from "@ofd-compose/render-worker";

const root = new URL(
  "../../../tests/pdf-writer/fixtures/whitespace-reader/worker-double/",
  import.meta.url,
);
const input = JSON.parse(
  await readFile(
    new URL("../../../tests/ofd-writer/fixtures/combined-input.json", import.meta.url),
    "utf8",
  ),
);
const manifest = JSON.parse(
  await readFile(new URL("../../typography-core/fonts/manifest.json", import.meta.url), "utf8"),
);
const entry = manifest[2];
const font = new Uint8Array(
  await readFile(new URL(`../../typography-core/fonts/${entry.file}`, import.meta.url)),
);
const wasm = new Uint8Array(
  await readFile(new URL("harfbuzz-subset.wasm", import.meta.resolve("harfbuzzjs"))),
);
const source = structuredClone(input.source);
source.body = [
  { kind: "paragraph", nodeId: "p", inlines: [{ kind: "text", nodeId: "t", text: "o  f" }] },
];
const result = await render(
  source,
  input.data,
  {
    fonts: [
      {
        family: "Noto",
        weight: 400,
        italic: false,
        sha256: entry.sha256,
        byteLength: font.length,
        bytes: font,
      },
    ],
    subsetWasm: { byteLength: wasm.length, bytes: wasm },
    images: [],
  },
  input.profile,
);
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
assert.equal(
  result.ir.pages
    .flatMap((p) => p.objects)
    .filter((o) => o.kind === "text")
    .map((o) => o.logicalText)
    .join(""),
  "o  f",
);
await mkdir(root, { recursive: true });
await writeFile(new URL("ir.json", root), canonicalSerialize(result.ir));
const resources = [];
for (const resource of result.fonts) {
  const file = `${resource.resourceId}.bin`;
  await writeFile(new URL(file, root), resource.bytes);
  resources.push({ resourceId: resource.resourceId, file });
}
await writeFile(new URL("manifest.json", root), JSON.stringify({ resources }));
console.log("Real Worker preserves o + two ASCII spaces + f (pending stock-reader acceptance)");
