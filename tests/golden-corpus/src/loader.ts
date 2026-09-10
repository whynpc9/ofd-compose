import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020.js";

export const corpusRoot = path.resolve(import.meta.dirname, "..");
export const schemasDir = path.resolve(corpusRoot, "../../schemas/golden-corpus");

export interface CorpusCase {
  /** 用例目录（绝对路径）。 */
  dir: string;
  /** 相对 corpusRoot 的目录，如 library/examples/04-table-loop。 */
  relativeDir: string;
  manifest: Record<string, unknown>;
  semantics: Record<string, unknown>;
  /** data.json 的原始字节。 */
  data: Buffer;
}

export class CorpusValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`golden corpus validation failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "CorpusValidationError";
  }
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8"));
}

function formatErrors(errors: readonly ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`);
}

async function collectCaseDirs(base: string): Promise<string[]> {
  const dirs: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      const hasManifest = await readFile(path.join(full, "case.json"), "utf8")
        .then(() => true)
        .catch(() => false);
      if (hasManifest) {
        dirs.push(full);
      } else {
        await walk(full);
      }
    }
  }
  try {
    await walk(base);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return dirs;
    throw error;
  }
  return dirs;
}

export interface LoadCorpusOptions {
  /** 只加载指定 tier（默认全部）。 */
  tier?: "library" | "business";
  /** corpus 根目录（默认本包目录；测试可注入临时语料）。 */
  root?: string;
}

/**
 * 枚举 corpus 全部用例并校验：manifest schema、语义文件 schema、
 * dataDigest 与 data.json 字节一致、引用的模板文件存在。
 * 任何一处不合法即抛 CorpusValidationError（聚合全部问题）。
 */
export async function loadCorpus(options: LoadCorpusOptions = {}): Promise<CorpusCase[]> {
  const root = options.root ?? corpusRoot;
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  const manifestSchema = await readJson(path.join(schemasDir, "case-manifest.schema.json"));
  const semanticsSchema = await readJson(path.join(schemasDir, "case-semantics.schema.json"));
  const validateManifest = ajv.compile(manifestSchema) as ValidateFunction;
  const validateSemantics = ajv.compile(semanticsSchema) as ValidateFunction;

  const problems: string[] = [];
  const cases: CorpusCase[] = [];
  const caseIds = new Set<string>();

  const tiers: readonly ("library" | "business")[] = options.tier
    ? [options.tier]
    : ["library", "business"];
  const caseDirs = (await Promise.all(tiers.map((tier) => collectCaseDirs(path.join(root, tier)))))
    .flat()
    .sort();

  for (const dir of caseDirs) {
    const relativeDir = path.relative(root, dir);
    const where = relativeDir;

    const manifest = (await readJson(path.join(dir, "case.json"))) as Record<string, unknown>;
    if (!validateManifest(manifest)) {
      problems.push(
        ...formatErrors(validateManifest.errors).map((e) => `${where}/case.json: ${e}`),
      );
      continue;
    }

    const caseId = manifest.caseId as string;
    if (caseIds.has(caseId)) problems.push(`${where}/case.json: duplicate caseId '${caseId}'`);
    caseIds.add(caseId);

    const dataPath = path.join(dir, "data.json");
    const data = await readFile(dataPath).catch(() => null);
    if (data === null) {
      problems.push(`${where}: missing data.json`);
    } else {
      const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
      if (digest !== manifest.dataDigest) {
        problems.push(`${where}/case.json: dataDigest ${manifest.dataDigest} != actual ${digest}`);
      }
    }

    const semanticsRel = (manifest.expectedSemantic as { file: string }).file;
    const semanticsPath = path.join(dir, semanticsRel);
    const semanticsRaw = await readFile(semanticsPath).catch(() => null);
    if (semanticsRaw === null) {
      problems.push(`${where}: expectedSemantic.file '${semanticsRel}' not found`);
    } else {
      const semantics = JSON.parse(semanticsRaw.toString("utf8")) as Record<string, unknown>;
      if (!validateSemantics(semantics)) {
        problems.push(
          ...formatErrors(validateSemantics.errors).map((e) => `${where}/${semanticsRel}: ${e}`),
        );
      } else {
        cases.push({ dir, relativeDir, manifest, semantics, data: data ?? Buffer.alloc(0) });
      }
    }

    for (const ref of ["templateAsset", "templateDescription"] as const) {
      const value = manifest[ref];
      if (typeof value === "string") {
        const exists = await readFile(path.join(dir, value)).then(
          () => true,
          () => false,
        );
        if (!exists) problems.push(`${where}/case.json: ${ref} '${value}' not found`);
      }
    }
  }

  if (problems.length > 0) throw new CorpusValidationError(problems);
  return cases;
}
