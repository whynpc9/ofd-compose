import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release } from "node:os";
import { canonicalSerialize } from "@ofd-compose/layout-ir";
import { expect, it } from "vitest";
import { render } from "../src/index.js";
import expected from "./expected.json";
import { combined, profile } from "./fixtures.js";

it("renders in genuine Node with no DOM or canvas and independently verifies the shared SHA-256 baseline", async () => {
  for (const name of ["window", "document", "HTMLCanvasElement", "OffscreenCanvas"])
    expect(Object.hasOwn(globalThis, name)).toBe(false);
  const start = performance.now(),
    sample = await combined(),
    acquired = performance.now();
  const first = await render(sample.source, sample.data, sample.pack, profile),
    end = performance.now();
  if (!first.ok) throw new Error(JSON.stringify(first.diagnostics));
  const hotStart = performance.now(),
    second = await render(sample.source, sample.data, sample.pack, profile),
    hotEnd = performance.now();
  if (!second.ok) throw new Error(JSON.stringify(second.diagnostics));
  const nodeDigest = createHash("sha256").update(canonicalSerialize(first.ir)).digest("hex");
  expect(first.identity.irDigest).toBe(nodeDigest);
  expect(second.identity).toEqual(first.identity);
  for (const font of first.fonts)
    expect(createHash("sha256").update(font.bytes).digest("hex")).toBe(font.subsetDigest);
  const baseline = {
    identity: first.identity,
    pages: first.ir.pages.length,
    subsets: first.fonts.map(({ subsetDigest }) => subsetDigest),
  };
  if (process.env.UPDATE_RENDER_FIXTURES === "1") {
    await writeFile(
      new URL("./expected.json", import.meta.url),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    await writeFile(
      new URL("./timing.json", import.meta.url),
      `${JSON.stringify({ measuredAt: new Date().toISOString(), node: process.version, os: `${platform()} ${release()}`, arch: arch(), cpu: cpus()[0]?.model, resourceAcquisitionMs: acquired - start, firstRenderMs: end - acquired, hotRenderMs: hotEnd - hotStart, notes: "Single-process preliminary WP0.9 observation. Modules already imported; first render has cold face cache in this test process. Resource disk loading reported separately. Both renders include owned resource copies, compile/bind/media/layout, subset WASM instantiation and canonical hashing. No writers/readers/production acceptance. Not p50/p95.", pages: first.ir.pages.length }, null, 2)}\n`,
    );
  } else expect(baseline).toEqual(expected);
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  expect(
    Object.keys(packageJson.dependencies).every((name) => name.startsWith("@ofd-compose/")),
  ).toBe(true);
});
it("runs the built public render entry in an independent Node process without a test loader", async () => {
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const sample = await combined();
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./render-node.mjs", import.meta.url))],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(stdout) : reject(new Error(stderr))));
    child.stdin.end(JSON.stringify({ source: sample.source, data: sample.data, profile }));
  });
  expect(JSON.parse(result)).toEqual(
    process.env.UPDATE_RENDER_FIXTURES === "1"
      ? JSON.parse(await readFile(new URL("./expected.json", import.meta.url), "utf8"))
      : expected,
  );
});
