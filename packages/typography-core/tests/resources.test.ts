import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import manifest from "../fonts/manifest.json";
import { shapingAndLineBreakVersions } from "../src/index.js";

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
