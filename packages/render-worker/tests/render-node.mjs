// A real Node process consumes the built public package entry, with no Vite or TypeScript loader.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalSerialize } from "@ofd-compose/layout-ir";
import { render } from "@ofd-compose/render-worker";

for (const name of ["window", "document", "HTMLCanvasElement", "OffscreenCanvas"])
  assert.equal(Object.hasOwn(globalThis, name), false);
let input = "";
for await (const chunk of process.stdin) input += chunk;
const { source, data, profile } = JSON.parse(input);
const manifest = JSON.parse(
  await readFile(new URL("../../typography-core/fonts/manifest.json", import.meta.url), "utf8"),
);
const bytes = new Uint8Array(
  await readFile(new URL(`../../typography-core/fonts/${manifest[0].file}`, import.meta.url)),
);
const wasm = new Uint8Array(
  await readFile(new URL("harfbuzz-subset.wasm", import.meta.resolve("harfbuzzjs"))),
);
const png = new Uint8Array(
  JSON.parse(await readFile(new URL("./node-image.json", import.meta.url), "utf8")),
);
const pack = {
  fonts: [
    {
      family: "Noto",
      weight: 400,
      italic: false,
      sha256: manifest[0].sha256,
      byteLength: bytes.length,
      bytes,
    },
  ],
  subsetWasm: { byteLength: wasm.length, bytes: wasm },
  images: [
    {
      id: "picture",
      byteLength: png.length,
      bytes: png,
      sha256: createHash("sha256").update(png).digest("hex"),
    },
  ],
};
const result = await render(source, data, pack, profile);
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
assert.equal(
  createHash("sha256").update(canonicalSerialize(result.ir)).digest("hex"),
  result.identity.irDigest,
);
for (const font of result.fonts)
  assert.equal(createHash("sha256").update(font.bytes).digest("hex"), font.subsetDigest);
process.stdout.write(
  JSON.stringify({
    identity: result.identity,
    pages: result.ir.pages.length,
    subsets: result.fonts.map(({ subsetDigest }) => subsetDigest),
  }),
);
