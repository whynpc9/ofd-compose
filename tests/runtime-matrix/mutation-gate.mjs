// Counterexamples use copies of actual completed runs; originals are never modified.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [arm, x64] = process.argv.slice(2).map((path) => resolve(path));
assert.ok(arm && x64, "mutation-gate <arm64-dir> <x64-dir>");
const temporary = await mkdtemp(join(tmpdir(), "ofd-runtime-mutations-"));
const compare = (right) =>
  spawnSync(
    process.execPath,
    ["tests/runtime-matrix/compare.mjs", arm, right, join(temporary, "result.json")],
    { encoding: "utf8" },
  );
try {
  const baseline = compare(x64);
  assert.equal(baseline.status, 0, baseline.stderr);
  const original = (await readFile(join(x64, "corpus.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map(JSON.parse);
  const environment = JSON.parse(await readFile(join(x64, "corpus-environment.json")));
  const complete = JSON.parse(await readFile(join(x64, "corpus-complete.json")));
  const mutations = {
    "changed canonical IR": (rows) => {
      rows.find((r) => r.outcome.ok).outcome.identity.irDigest = "0".repeat(64);
    },
    "lost negative case": (rows) => {
      rows.splice(
        rows.findIndex((r) => !r.outcome.ok),
        1,
      );
    },
    "different font input": (rows) => {
      rows[0].identity.fontSha256 = "0".repeat(64);
    },
    "missing image identity": (_rows, env) => {
      env.imageIdentity = null;
    },
    "same runtime architecture": (rows, env) => {
      env.arch = "arm64";
      for (const row of rows) row.architecture = "arm64";
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const rows = structuredClone(original),
      env = structuredClone(environment);
    mutate(rows, env);
    const raw = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
    await writeFile(join(temporary, "corpus.jsonl"), raw);
    await writeFile(join(temporary, "corpus-environment.json"), JSON.stringify(env));
    // Recompute the untrusted file checksum: the semantic gate must still reject it.
    await writeFile(
      join(temporary, "corpus-complete.json"),
      JSON.stringify({ ...complete, rawSha256: createHash("sha256").update(raw).digest("hex") }),
    );
    const result = compare(temporary);
    assert.equal(result.status, 1, `${name} unexpectedly passed or tool failed: ${result.stderr}`);
    assert.match(result.stderr, /AssertionError/);
    process.stdout.write(`rejected: ${name}\n`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
