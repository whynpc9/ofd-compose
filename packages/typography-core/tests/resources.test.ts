import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import manifest from "../fonts/manifest.json";
import { isP0Character, p0CharacterRepertoire, shapingAndLineBreakVersions } from "../src/index.js";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

it("pins every font and OFL license to its committed bytes and upstream revision", async () => {
  for (const entry of manifest) {
    const font = await readFile(new URL(`../fonts/${entry.file}`, import.meta.url));
    const license = await readFile(new URL(`../fonts/${entry.licenseFile}`, import.meta.url));
    expect(font.length).toBe(entry.bytes);
    expect(digest(font)).toBe(entry.sha256);
    expect(digest(license)).toBe(entry.licenseSha256);
    expect(license.toString()).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(entry.source).toMatch(/githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\//);
  }
});

it("pins the installed HarfBuzz WASM used by both runtimes", async () => {
  const wasm = await readFile(
    new URL("../node_modules/harfbuzzjs/dist/harfbuzz.wasm", import.meta.url),
  );
  expect(digest(wasm)).toBe(shapingAndLineBreakVersions.harfbuzzWasmSha256);
  expect(shapingAndLineBreakVersions.harfbuzz).toBe("14.3.0");
});

it("matches the published repertoire count and digest to the actual admission gate", () => {
  const hash = createHash("sha256");
  const scalar = Buffer.alloc(4);
  let count = 0;
  for (let point = 0; point <= 0x10ffff; point++) {
    if (!isP0Character(point)) continue;
    scalar.writeUInt32BE(point);
    hash.update(scalar);
    count++;
  }
  expect(count).toBe(p0CharacterRepertoire.codePointCount);
  expect(hash.digest("hex")).toBe(p0CharacterRepertoire.sha256);
});
