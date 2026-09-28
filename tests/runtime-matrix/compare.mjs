import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [a, b, output] = process.argv.slice(2);
assert.ok(a && b && output, "compare <arm64-dir> <x64-dir> <report.json>");
const read = async (dir) => {
  const bytes = await readFile(`${dir}/corpus.jsonl`);
  const complete = JSON.parse(await readFile(`${dir}/corpus-complete.json`));
  assert.equal(complete.rawSha256, createHash("sha256").update(bytes).digest("hex"));
  return {
    environment: JSON.parse(await readFile(`${dir}/corpus-environment.json`)),
    rows: bytes.toString().trim().split("\n").map(JSON.parse),
  };
};
const left = await read(a),
  right = await read(b);
assert.equal(left.environment.platform, "linux");
assert.equal(right.environment.platform, "linux");
assert.deepEqual(
  new Set([left.environment.arch, right.environment.arch]),
  new Set(["arm64", "x64"]),
);
assert.deepEqual(left.environment.source, right.environment.source);
assert.equal(left.environment.corpusSha256, right.environment.corpusSha256);
assert.equal(left.rows.length, 34);
assert.equal(right.rows.length, 34);
assert.equal(new Set(left.rows.map((r) => r.id)).size, 34);
assert.equal(left.rows.filter((r) => !r.outcome.ok).length, 6);
const cases = left.rows.map((l, i) => {
  const r = right.rows[i];
  for (const [row, environment] of [
    [l, left.environment],
    [r, right.environment],
  ]) {
    assert.equal(row.platform, "linux");
    assert.equal(row.architecture, environment.arch);
    assert.equal(row.runtime, environment.node);
    assert.equal(row.runtime, "v24.19.0");
    if (row.writer) {
      assert.equal(row.writer.architecture.toLowerCase(), environment.arch);
      assert.match(row.writer.runtime, /^\.NET 10\./);
    }
  }
  assert.equal(l.id, r.id);
  assert.deepEqual(l.identity, r.identity);
  assert.deepEqual(l.outcome, r.outcome);
  assert.ok(
    (l.writer && r.writer) || !l.outcome.ok,
    "Every positive case needs actual .NET writer execution",
  );
  return {
    id: l.id,
    ok: l.outcome.ok,
    irDigest: l.outcome.identity?.irDigest ?? null,
    diagnostics: l.outcome.diagnostics,
    writerExecuted: Boolean(l.writer && r.writer),
  };
});
await writeFile(
  output,
  `${JSON.stringify({ comparedAt: new Date().toISOString(), environments: [left.environment, right.environment], cases }, null, 2)}\n`,
);
console.log(
  "34 exact input/outcome matches, including 6 negative diagnostics; both architectures actually executed",
);
