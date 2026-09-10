import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const biomeBin = path.join(repoRoot, "node_modules", ".bin", "biome");

const corePackages = ["binding-core", "layout-core", "typography-core"] as const;

const intlViolation = `export function formatAmount(value: number): string {
  return Intl.NumberFormat("zh-CN").format(value);
}
`;

const domViolation = `export function measureText(text: string): number {
  return document.createElement("canvas").getContext("2d")?.measureText(text).width ?? 0;
}
`;

const cleanSource = `export function add(left: number, right: number): number {
  return left + right;
}
`;

async function createLintFixture(
  files: Readonly<Record<string, string>>,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "ofd-lint-gate-"));
  const config = JSON.parse(await readFile(path.join(repoRoot, "biome.json"), "utf8")) as Record<
    string,
    unknown
  >;
  delete config.$schema;
  delete config.vcs;
  await writeFile(path.join(dir, "biome.json"), `${JSON.stringify(config, null, 2)}\n`);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(dir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

async function runBiome(dir: string): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(biomeBin, ["lint", "."], { cwd: dir });
    return { code: 0, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failed.code ?? -1,
      output: `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`,
    };
  }
}

it("flags Intl usage in every core package", async () => {
  const files: Record<string, string> = {};
  for (const pkg of corePackages) {
    files[`packages/${pkg}/src/format.ts`] = intlViolation;
  }
  const { dir, cleanup } = await createLintFixture(files);
  try {
    const result = await runBiome(dir);
    expect(result.code).not.toBe(0);
    for (const pkg of corePackages) {
      expect(result.output).toContain(`packages/${pkg}/src/format.ts`);
    }
    expect(result.output).toContain("noRestrictedGlobals");
  } finally {
    await cleanup();
  }
});

it("flags DOM globals in core packages", async () => {
  const { dir, cleanup } = await createLintFixture({
    "packages/layout-core/src/measure.ts": domViolation,
  });
  try {
    const result = await runBiome(dir);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("noRestrictedGlobals");
    expect(result.output).toContain("document");
  } finally {
    await cleanup();
  }
});

it("accepts clean core package code", async () => {
  const { dir, cleanup } = await createLintFixture({
    "packages/typography-core/src/math.ts": cleanSource,
  });
  try {
    const result = await runBiome(dir);
    expect(result.code).toBe(0);
  } finally {
    await cleanup();
  }
});

it("does not flag the same code outside core packages", async () => {
  const { dir, cleanup } = await createLintFixture({
    "tests/smoke/src/format.helper.ts": intlViolation,
  });
  try {
    const result = await runBiome(dir);
    expect(result.code).toBe(0);
  } finally {
    await cleanup();
  }
});
