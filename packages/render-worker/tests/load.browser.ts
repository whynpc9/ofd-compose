import subsetUrl from "#subset-wasm?url";

export { loadFontFile } from "../../typography-core/tests/load.browser.js";
export async function loadSubsetWasm() {
  const response = await fetch(subsetUrl);
  if (!response.ok) throw new Error("Subset WASM fixture unavailable");
  return new Uint8Array(await response.arrayBuffer());
}
