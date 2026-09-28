import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { chromium, firefox } from "playwright";

const root = process.cwd();
const evidenceDir = resolve(
  root,
  process.env.EDITOR_SPIKE_EVIDENCE || "tests/editor-adapter-spike/evidence",
);
const baseUrl = "http://127.0.0.1:4535";
const requested = process.argv.slice(2);
const browserNames = requested.length ? requested : ["chromium", "firefox"];
const browserTypes = { chromium, firefox };

for (const name of browserNames) {
  if (!browserTypes[name]) throw new Error(`Unsupported browser: ${name}`);
}

await mkdir(evidenceDir, { recursive: true });

const provenance = JSON.parse(
  await readFile(`${root}/.scratch/first-release/reference/issue35/provenance.json`, "utf8"),
);
const sourceFiles = [
  "tools/editor-adapter-spike/harness.mjs",
  "tools/editor-adapter-spike/adapter.mjs",
  "tools/editor-adapter-spike/upstream.patch",
  "tools/editor-adapter-spike/run-browser.mjs",
  "tools/editor-adapter-spike/baseline.json",
  "tools/editor-adapter-spike/vite.config.mjs",
];
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    sourceFiles.map(async (path) => [
      path,
      createHash("sha256")
        .update(await readFile(`${root}/${path}`))
        .digest("hex"),
    ]),
  ),
);

let serverLog = "";
const vite = spawn(
  `${root}/node_modules/.bin/vite`,
  ["--config", `${root}/tools/editor-adapter-spike/vite.config.mjs`],
  { cwd: root, env: process.env, stdio: ["ignore", "pipe", "pipe"] },
);
for (const stream of [vite.stdout, vite.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    serverLog += chunk;
  });
}

async function waitForVite() {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error(`Vite exited ${vite.exitCode}:\n${serverLog}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not become ready: ${lastError}\n${serverLog}`);
}

let failed = false;
try {
  await waitForVite();
  for (const name of browserNames) {
    const type = browserTypes[name];
    const consoleMessages = [];
    const pageErrors = [];
    const startedAt = new Date().toISOString();
    let browser;
    let result;
    let fatalError;
    try {
      browser = await type.launch();
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on("console", (message) =>
        consoleMessages.push({ type: message.type(), text: message.text() }),
      );
      page.on("pageerror", (error) => pageErrors.push(error.stack ?? String(error)));
      await page.goto(baseUrl, { waitUntil: "networkidle" });
      await page.waitForFunction(() => typeof window.probe?.run === "function");
      result = await page.evaluate(() => window.probe.run());
      await page.screenshot({ path: `${evidenceDir}/${name}.png`, fullPage: true });
    } catch (error) {
      fatalError = error.stack ?? String(error);
    } finally {
      await browser?.close();
    }

    const raw = {
      browser: name,
      browserVersion: browser?.version() ?? null,
      executablePath: type.executablePath(),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      provenance,
      sourceSha256,
      startedAt,
      finishedAt: new Date().toISOString(),
      layer: "synthetic-browser-events-with-real-Editor",
      osImeVerified: false,
      consoleMessages,
      pageErrors,
      fatalError,
      result,
    };
    await writeFile(`${evidenceDir}/${name}.json`, `${JSON.stringify(raw, null, 2)}\n`);
    const browserFailed = Boolean(fatalError || pageErrors.length || !result || result.failed > 0);
    failed ||= browserFailed;
    process.stdout.write(
      `${JSON.stringify({ browser: name, version: raw.browserVersion, passed: result?.passed ?? 0, failed: result?.failed ?? 0, fatalError, pageErrors: pageErrors.length })}\n`,
    );
  }
} finally {
  vite.kill("SIGTERM");
  await new Promise((resolve) => {
    if (vite.exitCode !== null) return resolve();
    vite.once("exit", resolve);
    setTimeout(resolve, 5_000).unref();
  });
  await writeFile(`${evidenceDir}/vite.log`, serverLog);
}

if (failed) process.exitCode = 1;
