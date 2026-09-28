import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const [
  mode = "corpus",
  input = ".scratch/issue18-output/input/corpus.json",
  output = ".scratch/issue18-output/local",
  writerDll,
] = process.argv.slice(2);
assert.ok(["corpus", "benchmark"].includes(mode));
const out = resolve(output),
  corpus = JSON.parse(await readFile(input));
await mkdir(out, { recursive: true });
const samples = Number(process.env.MATRIX_SAMPLES ?? 20),
  warmup = Number(process.env.MATRIX_WARMUP ?? 3);
assert.ok(Number.isSafeInteger(samples) && samples >= 20);
assert.ok(Number.isSafeInteger(warmup) && warmup >= 3);
const rawPath = `${out}/${mode}.jsonl`;
await writeFile(rawPath, "");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const command = (program, args) => {
  try {
    return execFileSync(program, args, { encoding: "utf8" }).trim();
  } catch (e) {
    return `Unavailable: ${e.message}`;
  }
};
const metadata = {
  schema: "ofd-compose/runtime-evidence@1",
  mode,
  startedAt: new Date().toISOString(),
  source: JSON.parse(
    await readFile(
      process.env.MATRIX_SOURCE_IDENTITY ?? ".scratch/issue18-output/source.json",
      "utf8",
    ),
  ),
  executionLabel: process.env.MATRIX_EXECUTION_LABEL ?? "local (not a clean container)",
  imageIdentity: process.env.MATRIX_IMAGE_ID ?? null,
  node: process.version,
  arch: process.arch,
  platform: process.platform,
  osRelease: os.release(),
  cpus: os.cpus().map(({ model, speed }) => ({ model, speed })),
  totalMemoryBytes: os.totalmem(),
  dotnet: command("dotnet", ["--list-runtimes"]),
  corpusSha256: hash(await readFile(input)),
  samples,
  warmup,
  cold: "fresh Node and writer processes per sample; OS page cache not purged; process/module/JIT startup included in wallMs",
  hot: "persistent Node and writer processes, 3 or configured discarded warmups per case; resources cached in Node; writer resources reloaded each job",
  scope:
    "wallMs includes resource load, render, IR/resource spool, both writers and output file writes. Stage write timers exclude input/output filesystem I/O. Queue/network/HTTP/source attachment excluded; no HTTP seam exists yet.",
  memory:
    "Node maxRSS and CLR PeakWorkingSet are separate process high-water marks, not their sum or a sampled per-job peak. Hot marks are cumulative from process startup including warmup.",
};
for (const [path, digest] of Object.entries(metadata.source.builtFiles ?? {}))
  assert.equal(hash(await readFile(path)), digest, `Built module mismatch: ${path}`);
assert.equal(metadata.corpusSha256, metadata.source.corpusSha256 ?? metadata.corpusSha256);
if (process.platform === "linux") {
  metadata.osReleaseFile = await readFile("/etc/os-release", "utf8");
  metadata.cgroupLimits = {};
  for (const name of ["cpu.max", "memory.max"]) {
    try {
      metadata.cgroupLimits[name] = (await readFile(`/sys/fs/cgroup/${name}`, "utf8")).trim();
    } catch {
      metadata.cgroupLimits[name] = "Unavailable";
    }
  }
  // biome-ignore lint/suspicious/noTemplateCurlyInString: dpkg expands its own placeholders.
  metadata.packages = command("dpkg-query", ["-W", "-f=${Package} ${Version}\n"]);
  assert.ok(!metadata.packages.startsWith("Unavailable:"), "Package inventory is required");
  const forbidden =
    /^(?:libreoffice\S*|chromium\S*|google-chrome\S*|firefox\S*|openjdk\S*|default-jre\S*|default-jdk\S*|microsoft-word\S*) /m;
  assert.ok(!forbidden.test(metadata.packages), "Forbidden production package installed");
  metadata.executableCheck = command("sh", [
    "-c",
    'for p in java javac chromium chromium-browser google-chrome firefox libreoffice soffice winword; do command -v "$p" && exit 1; done; exit 0',
  ]);
  assert.equal(metadata.executableCheck, "", "Forbidden production executable present");
  metadata.dotnetSdks = command("dotnet", ["--list-sdks"]);
  assert.equal(metadata.dotnetSdks, "", "Runtime image must not contain SDK");
}
await writeFile(`${out}/${mode}-environment.json`, `${JSON.stringify(metadata, null, 2)}\n`);
function client(program, args) {
  const child = spawn(program, args, { stdio: ["pipe", "pipe", "inherit"] });
  let pending, failure;
  let finish;
  const exited = new Promise((resolve) => {
    finish = resolve;
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const p = pending;
    pending = undefined;
    if (p) {
      try {
        p.resolve(JSON.parse(line));
      } catch (e) {
        p.reject(e);
      }
    }
  });
  child.on("error", (error) => {
    failure = error;
    finish();
    pending?.reject(error);
    pending = undefined;
  });
  child.on("exit", (code) => {
    failure = new Error(`${program} exited ${code}`);
    finish();
    pending?.reject(failure);
    pending = undefined;
  });
  return {
    ask(value) {
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        assert.equal(pending, undefined);
        pending = { resolve, reject };
        child.stdin.write(`${JSON.stringify(value)}\n`);
      });
    },
    close() {
      child.stdin.end();
      return exited;
    },
    kill() {
      child.kill("SIGKILL");
    },
  };
}
function start() {
  return {
    node: client(process.execPath, [
      "--max-old-space-size=2048",
      "tests/runtime-matrix/sample.mjs",
      resolve(input),
    ]),
    writer: writerDll ? client("dotnet", [resolve(writerDll)]) : undefined,
  };
}
const reference = new Map();
async function sample(pair, item, temperature, index, begun) {
  const directory = `${out}/artifacts/${item.id.replaceAll("/", "__")}`;
  const timeout = setTimeout(() => {
    pair.node.kill();
    pair.writer?.kill();
  }, 180_000);
  try {
    const rendered = await pair.node.ask({ id: item.id, directory, observe: mode === "benchmark" });
    const key = JSON.stringify({ identity: rendered.identity, outcome: rendered.outcome });
    if (reference.has(item.id))
      assert.equal(key, reference.get(item.id), "Identity changed between samples");
    else reference.set(item.id, key);
    const writer = rendered.outcome.ok && pair.writer ? await pair.writer.ask(directory) : null;
    const row = { temperature, index, ...rendered, writer, wallMs: performance.now() - begun };
    await appendFile(rawPath, `${JSON.stringify(row)}\n`);
    process.stderr.write(`${temperature} ${item.id} ${index}: ${row.wallMs.toFixed(1)}ms\n`);
  } finally {
    clearTimeout(timeout);
  }
}
if (mode === "corpus") {
  const pair = start();
  try {
    for (const item of corpus.cases) await sample(pair, item, "correctness", 0, performance.now());
  } finally {
    await Promise.all([pair.node.close(), pair.writer?.close()]);
  }
} else {
  assert.ok(writerDll, "Benchmark requires both actual .NET writers");
  for (const item of corpus.cases.filter((c) => c.kind === "benchmark")) {
    for (let i = 0; i < samples; i++) {
      const begun = performance.now(),
        pair = start();
      try {
        await sample(pair, item, "cold", i, begun);
      } finally {
        await Promise.all([pair.node.close(), pair.writer.close()]);
      }
    }
    const pair = start();
    try {
      for (let i = -warmup; i < samples; i++)
        await sample(pair, item, i < 0 ? "warmup" : "hot", i, performance.now());
    } finally {
      await Promise.all([pair.node.close(), pair.writer.close()]);
    }
  }
}
await writeFile(
  `${out}/${mode}-complete.json`,
  JSON.stringify(
    {
      completedAt: new Date().toISOString(),
      cases: reference.size,
      rawSha256: hash(await readFile(rawPath)),
    },
    null,
    2,
  ),
);
