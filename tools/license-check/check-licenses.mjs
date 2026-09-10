#!/usr/bin/env node
// License whitelist gate (issue 01 / ADR-0001 principle 3).
//
// Covers both ecosystems against tools/license-check/allowed-licenses.json:
//   pnpm --prod (ships in artifacts): strict whitelist, no exceptions, ever.
//   pnpm --dev  (toolchain only):     whitelist + named entries in dev-exceptions.json.
//   NuGet (per project.assets.json + nuspec metadata): strict whitelist.
//
// Compound SPDX expressions are parsed with real operator precedence:
// parentheses group, AND binds tighter than OR; malformed expressions fail closed.

import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "../..");

export function normalize(license) {
  const lowered = license
    .trim()
    .toLowerCase()
    .replace(/-only$|-or-later$/g, "");
  // Canonicalize only the exact BSD variants present in allowed-licenses.json;
  // anything else (e.g. BSD-4-Clause) must not collapse into the whitelisted "bsd".
  return BSD_CANONICAL.has(lowered) ? "bsd" : lowered;
}

const BSD_CANONICAL = new Set(["bsd-1-clause", "bsd-2-clause", "bsd-3-clause", "0bsd"]);

async function loadAllowed() {
  const raw = JSON.parse(await readFile(path.join(toolDir, "allowed-licenses.json"), "utf8"));
  return new Set(raw.map(normalize));
}

export function isAllowed(expression, allowed) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let pos = 0;

  const isOperator = (token, op) => token?.toLowerCase() === op;

  function parsePrimary() {
    const token = tokens[pos];
    if (token === "(") {
      pos++;
      const value = parseOr();
      if (tokens[pos] !== ")") {
        throw new Error("unbalanced parentheses");
      }
      pos++;
      return value;
    }
    if (
      token === undefined ||
      token === ")" ||
      isOperator(token, "and") ||
      isOperator(token, "or")
    ) {
      throw new Error(`unexpected token: ${token ?? "end of expression"}`);
    }
    pos++;
    let license = token;
    if (isOperator(tokens[pos], "with")) {
      const exception = tokens[pos + 1];
      if (exception === undefined || exception === "(" || exception === ")") {
        throw new Error("WITH requires an exception name");
      }
      license = `${license} WITH ${exception}`;
      pos += 2;
    }
    return allowed.has(normalize(license));
  }

  function parseAnd() {
    let value = parsePrimary();
    while (isOperator(tokens[pos], "and")) {
      pos++;
      value = parsePrimary() && value;
    }
    return value;
  }

  function parseOr() {
    let value = parseAnd();
    while (isOperator(tokens[pos], "or")) {
      pos++;
      value = parseAnd() || value;
    }
    return value;
  }

  try {
    const result = parseOr();
    return pos === tokens.length && result;
  } catch {
    return false;
  }
}

function printViolations(title, violations) {
  console.error(title);
  for (const pkg of violations.sort((a, b) => a.name.localeCompare(b.name))) {
    console.error(`  - ${pkg.name}@${pkg.version}: ${pkg.license}`);
  }
}

// --- pnpm side -------------------------------------------------------------

async function listPnpmPackages(pnpmArgs) {
  const { stdout } = await execFileAsync("pnpm", ["licenses", "list", "--json", ...pnpmArgs], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicense = stdout.trim().startsWith("{") ? JSON.parse(stdout) : {};
  const packages = [];
  for (const [declared, entries] of Object.entries(byLicense)) {
    for (const entry of entries) {
      const versions = entry.versions ?? [entry.version].filter(Boolean);
      for (const version of versions) {
        packages.push({ name: entry.name, version, license: entry.license ?? declared });
      }
    }
  }
  return packages;
}

async function checkPnpm(allowed, exceptions) {
  let failed = false;

  // --prod includes optionalDependencies (they can ship in artifacts); unlike the
  // dev pass there is no --no-optional here, so optional deps face the strict whitelist.
  const prod = await listPnpmPackages(["--prod"]);
  const prodViolations = prod.filter((pkg) => !isAllowed(pkg.license, allowed));
  if (prodViolations.length > 0) {
    failed = true;
    printViolations(
      `License gate failed: ${prodViolations.length} production package(s) outside the whitelist ` +
        "(no exceptions allowed for shipped code):",
      prodViolations,
    );
  }

  const dev = await listPnpmPackages(["--dev", "--no-optional"]);
  const devViolations = [];
  const usedExceptions = new Set();
  for (const pkg of dev) {
    if (isAllowed(pkg.license, allowed)) continue;
    const exception = exceptions.find(
      (e) => e.name === pkg.name && normalize(e.license) === normalize(pkg.license),
    );
    if (exception) {
      usedExceptions.add(exception);
    } else {
      devViolations.push(pkg);
    }
  }
  if (devViolations.length > 0) {
    failed = true;
    printViolations(
      `License gate failed: ${devViolations.length} dev-only package(s) outside the whitelist ` +
        "with no entry in tools/license-check/dev-exceptions.json:",
      devViolations,
    );
  }
  for (const exception of exceptions) {
    if (!usedExceptions.has(exception)) {
      console.warn(
        `warning: stale exception (not present in dev tree): ${exception.name} (${exception.license})`,
      );
    }
  }

  return { failed, prodCount: prod.length, devCount: dev.length, usedExceptions };
}

// --- NuGet side ------------------------------------------------------------

const LICENSE_URL_MAP = new Map([
  ["apache.org/licenses/license-2.0", "Apache-2.0"],
  ["opensource.org/licenses/mit", "MIT"],
  ["licenses.nuget.org/mit", "MIT"],
  ["mit-license.org", "MIT"],
  ["opensource.org/licenses/bsd-2-clause", "BSD-2-Clause"],
  ["opensource.org/licenses/bsd-3-clause", "BSD-3-Clause"],
  ["unlicense.org", "Unlicense"],
  ["openfontlicense.org", "OFL-1.1"],
]);

function licenseFromNuspec(xml) {
  const expression = xml.match(/<license\s+type="expression"[^>]*>([^<]+)<\/license>/i);
  if (expression) return expression[1].trim();
  const url = xml.match(/<licenseUrl>([^<]+)<\/licenseUrl>/i);
  if (url) {
    const normalizedUrl = url[1].trim().toLowerCase();
    for (const [fragment, license] of LICENSE_URL_MAP) {
      if (normalizedUrl.includes(fragment)) return license;
    }
    return `UNKNOWN-URL(${url[1].trim()})`;
  }
  if (/<license\s+type="file"/i.test(xml)) return "LICENSE-FILE(manual review required)";
  return "UNKNOWN(no license metadata)";
}

async function listNugetPackages() {
  const dotnetDir = path.join(repoRoot, "dotnet");
  const assetsFiles = [];
  const csprojFiles = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "bin" || entry.name === ".git") continue;
        await walk(full);
      } else if (entry.name === "project.assets.json" && dir.endsWith("obj")) {
        assetsFiles.push(full);
      } else if (entry.name.endsWith(".csproj")) {
        csprojFiles.push(full);
      }
    }
  }
  await walk(dotnetDir);

  if (assetsFiles.length === 0 && csprojFiles.length > 0) {
    throw new Error("no obj/project.assets.json found under dotnet/ — run `dotnet restore` first");
  }

  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this script runs outside turbo
  const cache = process.env.NUGET_PACKAGES ?? path.join(homedir(), ".nuget", "packages");
  const seen = new Map();
  for (const assetsFile of assetsFiles) {
    const assets = JSON.parse(await readFile(assetsFile, "utf8"));
    for (const [key, meta] of Object.entries(assets.libraries ?? {})) {
      if (meta.type !== "package") continue;
      const slash = key.lastIndexOf("/");
      const name = key.slice(0, slash);
      const version = key.slice(slash + 1);
      if (seen.has(key)) continue;
      const nuspecPath = path.join(
        cache,
        name.toLowerCase(),
        version,
        `${name.toLowerCase()}.nuspec`,
      );
      let license;
      try {
        license = licenseFromNuspec(await readFile(nuspecPath, "utf8"));
      } catch {
        license = `UNKNOWN(missing nuspec: ${nuspecPath})`;
      }
      seen.set(key, { name, version, license });
    }
  }
  return [...seen.values()];
}

async function checkNuget(allowed) {
  const packages = await listNugetPackages();
  const violations = packages.filter((pkg) => !isAllowed(pkg.license, allowed));
  if (violations.length > 0) {
    printViolations(
      `License gate failed: ${violations.length} NuGet package(s) outside the whitelist ` +
        "(dotnet/ projects; see obj/project.assets.json):",
      violations,
    );
    return { failed: true, count: packages.length };
  }
  return { failed: false, count: packages.length };
}

// --- main ------------------------------------------------------------------

async function main() {
  const allowed = await loadAllowed();
  const exceptions = JSON.parse(
    await readFile(path.join(toolDir, "dev-exceptions.json"), "utf8"),
  ).exceptions;

  const pnpm = await checkPnpm(allowed, exceptions);
  const nuget = await checkNuget(allowed);

  if (pnpm.failed || nuget.failed) process.exit(1);
  console.log(
    `License gate passed: ${pnpm.prodCount} pnpm production package(s) strict, ` +
      `${pnpm.devCount} pnpm dev package(s) with ${pnpm.usedExceptions.size} documented exception(s), ` +
      `${nuget.count} NuGet package(s) strict.`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`License gate could not run: ${error.message}`);
    process.exit(2);
  });
}
