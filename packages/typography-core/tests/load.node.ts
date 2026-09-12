import { readFile } from "node:fs/promises";

export async function loadFontFile(file: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`../fonts/${file}`, import.meta.url)));
}
