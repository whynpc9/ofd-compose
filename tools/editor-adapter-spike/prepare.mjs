import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(".scratch/first-release/reference/issue35");
const sha = "83985f729cde373eccdcf25314227827b971bb63";
const inputs = [
  {
    name: "source",
    url: `https://codeload.github.com/Hufe921/canvas-editor/tar.gz/${sha}`,
    algorithm: "sha256",
    digest: "6e9a875b15885e88ed1e710468f75d8a4d5ad44de74faeacef5298e5cf77f2bd",
    target: "original",
  },
  {
    name: "package",
    url: "https://registry.npmjs.org/@hufe921/canvas-editor/-/canvas-editor-1.0.2.tgz",
    algorithm: "sha512",
    digest:
      "uAdI70JPqakd9+8TmSO1Fv77xDG86vCXaAVfqwMChJnAiz9Ub77l2ep0t8/lnydoIjdFqywcs+dea7x2f9vNEg==",
    target: "package",
  },
];
await mkdir(root, { recursive: true });
const baseline = JSON.parse(await readFile("tools/editor-adapter-spike/baseline.json", "utf8"));
const cacheIndex = process.argv.indexOf("--cache");
const cache = cacheIndex < 0 ? null : resolve(process.argv[cacheIndex + 1]);
if (cache) {
  // Every source file is pinned to the fixed commit, not just the five patch targets.
  for (const [folder, entries] of [
    ["original", baseline.sourceFiles],
    ["package", baseline.publishedFiles],
  ]) {
    for (const item of entries) {
      const bytes = await readFile(`${cache}/${folder}/${item.path}`);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.path);
    }
    if (cache !== root) {
      await rm(`${root}/${folder}`, { recursive: true, force: true });
      await cp(`${cache}/${folder}`, `${root}/${folder}`, { recursive: true });
    }
  }
} else
  for (const input of inputs) {
    const archive = `${root}/${input.name}.tgz`;
    let bytes;
    try {
      bytes = await readFile(archive);
    } catch {
      const response = await fetch(input.url);
      assert(response.ok, `${input.url}: ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await writeFile(archive, bytes);
    }
    assert.equal(
      createHash(input.algorithm)
        .update(bytes)
        .digest(input.algorithm === "sha512" ? "base64" : "hex"),
      input.digest,
    );
    await rm(`${root}/${input.target}`, { recursive: true, force: true });
    await mkdir(`${root}/${input.target}`);
    execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", `${root}/${input.target}`]);
  }
await rm(`${root}/patched`, { recursive: true, force: true });
await cp(`${root}/original`, `${root}/patched`, { recursive: true });
const patch = await readFile("tools/editor-adapter-spike/upstream.patch");
execFileSync("patch", ["-p1", "--batch", "--fuzz=0"], {
  cwd: `${root}/patched`,
  input: patch,
  stdio: ["pipe", "pipe", "inherit"],
});
const provenance = {
  upstreamCommit: sha,
  version: "1.0.2",
  inputs,
  mode: cache ? "verified-extracted-cache" : "downloaded-archives",
  sriRecomputedThisRun: !cache,
  sourceFilesVerified: cache ? baseline.sourceFiles.length : null,
  publishedFilesVerified: cache ? baseline.publishedFiles.length : null,
  patchSha256: createHash("sha256").update(patch).digest("hex"),
  scope: "Experimental local patch, not a published or approved production fork",
};
await writeFile(`${root}/provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
console.log(JSON.stringify(provenance, null, 2));
