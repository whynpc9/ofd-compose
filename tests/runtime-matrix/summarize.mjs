import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [directory, output] = process.argv.slice(2);
const raw = await readFile(`${directory}/benchmark.jsonl`);
const complete = JSON.parse(await readFile(`${directory}/benchmark-complete.json`));
assert.equal(complete.rawSha256, createHash("sha256").update(raw).digest("hex"));
const environment = JSON.parse(await readFile(`${directory}/benchmark-environment.json`));
const rows = raw.toString().trim().split("\n").map(JSON.parse);
const percentile = (values, p) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const summary = [];
for (const id of [...new Set(rows.map((r) => r.id))])
  for (const temperature of ["cold", "hot"]) {
    const samples = rows.filter((r) => r.id === id && r.temperature === temperature);
    assert.equal(samples.length, environment.samples);
    assert.equal(new Set(samples.map((r) => r.index)).size, environment.samples);
    assert.ok(samples.every((r) => r.outcome.ok === samples[0].outcome.ok));
    if (temperature === "hot")
      assert.equal(
        rows.filter((r) => r.id === id && r.temperature === "warmup").length,
        environment.warmup,
      );
    const collect = (getter) => {
      const values = samples.map(getter);
      if (values.every((v) => v === undefined || v === null)) return null;
      assert.ok(values.every((v) => Number.isFinite(v) && v >= 0));
      return {
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        max: Math.max(...values),
      };
    };
    const stages = {};
    for (const stage of [
      "resources",
      "compile",
      "bind",
      "media",
      "shape",
      "layout",
      "layoutExclusive",
      "subset",
      "identity",
    ])
      stages[stage] = collect((r) => r.timing.stages[stage]);
    summary.push({
      id,
      temperature,
      count: samples.length,
      status: samples[0].outcome.ok
        ? "rendered and both formats written"
        : "expected capacity rejection; successful long-table performance Not verified",
      diagnostics: samples[0].outcome.diagnostics,
      milliseconds: {
        wall: collect((r) => r.wallMs),
        resourceLoad: collect((r) => r.timing.resourceLoadMs),
        render: collect((r) => r.timing.renderMs),
        stages,
        writerInputLoad: collect((r) => r.writer?.loadMs),
        ofd: collect((r) => r.writer?.ofdMs),
        pdf: collect((r) => r.writer?.pdfMs),
      },
      bytes: {
        nodeProcessHighWater: collect((r) => r.nodePeakRssBytes),
        writerProcessHighWater: collect((r) => r.writer?.peakWorkingSetBytes),
      },
    });
  }
assert.equal(summary.length, 8);
await writeFile(
  output,
  `${JSON.stringify({ method: "nearest-rank percentiles; warmup discarded; no latency SLO claimed", environment, summary }, null, 2)}\n`,
);
console.log(`${summary.length} case/temperature summaries from ${rows.length} raw samples`);
