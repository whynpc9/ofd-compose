import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, glob, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const destination = resolve(process.argv[2]);
assert.ok(process.argv[2], "context <new empty directory>");
const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim();
assert.equal(
  git(["status", "--porcelain"]),
  "",
  "Commit implementation before freezing evidence context",
);
execFileSync("pnpm", ["build", "--force"], { stdio: "inherit" });
execFileSync(
  process.execPath,
  ["--experimental-transform-types", "tests/runtime-matrix/prepare.mjs"],
  { stdio: "inherit" },
);
assert.equal(git(["status", "--porcelain"]), "");
const sha = git(["rev-parse", "HEAD"]);
await mkdir(destination); // Refuse overwriting an earlier experiment.
execFileSync("git", ["archive", "--format=tar", "-o", `${destination}/source.tar`, sha]);
execFileSync("tar", ["-xf", `${destination}/source.tar`, "-C", destination]);
for (const name of [
  "binding-core",
  "document-model",
  "template-compiler",
  "typography-core",
  "media-core",
  "layout-core",
  "layout-ir",
  "source-protocol",
  "render-worker",
])
  await cp(`packages/${name}/dist`, `${destination}/packages/${name}/dist`, { recursive: true });
await mkdir(`${destination}/.matrix`);
await cp(".scratch/issue18-output/input/corpus.json", `${destination}/.matrix/corpus.json`);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const builtFiles = {};
for await (const path of glob("packages/*/dist/**/*.mjs"))
  builtFiles[path] = hash(await readFile(path));
assert.ok(Object.keys(builtFiles).length >= 9);
await writeFile(
  `${destination}/.matrix/source.json`,
  JSON.stringify(
    {
      codeSha: sha,
      builtFiles,
      sourceArchiveSha256: hash(await readFile(`${destination}/source.tar`)),
      corpusSha256: hash(await readFile(`${destination}/.matrix/corpus.json`)),
      pnpmLockSha256: hash(await readFile("pnpm-lock.yaml")),
    },
    null,
    2,
  ),
);
await unlink(`${destination}/source.tar`);
console.log(destination);
