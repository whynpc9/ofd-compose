import { readFile } from "node:fs/promises";

export { loadFontFile } from "../../typography-core/tests/load.node.js";
export async function loadSubsetWasm() {
  return new Uint8Array(
    await readFile(new URL("harfbuzz-subset.wasm", import.meta.resolve("harfbuzzjs"))),
  );
}
