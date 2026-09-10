import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { corpusRoot, loadCorpus, schemasDir } from "../src/loader.js";

const LEGACY_COMMIT = "9c02f26d0f81b554019441e348f981b67e11a4e7";

const EXPECTED_DOCX_TEST_METHODS = [
  "Render_ReplacesBasicTags_WithJsonPathAndIndex",
  "Render_EvaluatesConditionalBlocks",
  "Render_EvaluatesLoopBlocks",
  "Render_MapsJsonListToTableRows",
  "Render_SupportsSortTakeCountAndFormattingExtensions",
  "Render_SupportsInlineFriendlyAggregateExpressions_ForNarrativeParagraphs",
  "Render_SupportsNthAndAtExpressions_ForRankedInlineNarrative",
  "Render_SupportsInlineCountConditionalAndPercentPermilleFormatting",
  "Render_RendersInlineImageTag_FromDataUri",
  "Render_RendersBlockImageTag_Centered",
  "Render_RendersImagesInsideLoopBlocks",
  "Render_RendersRealPngFromFilePathAndDataUri_WithAspectRatioScaling",
  "Render_GeneratesBarcodes_FromTemplateParameters",
  "Render_GeneratesUpcAAndItfBarcodes",
  "Render_FormatsDateExpressionInTable_WhenTagIsSplitAcrossRuns",
] as const;

const EXPECTED_EXAMPLES = [
  "01-basic-tags",
  "02-condition",
  "03-loop",
  "04-table-loop",
  "05-extensions",
  "06-images",
  "07-table-date-format-split-runs",
  "08-inline-friendly-expressions",
  "09-inline-ranking-positions",
  "10-inline-conditions-and-rates",
  "11-images-file-and-datauri-scaling",
  "12-barcodes",
] as const;

async function loadManifestSchema(): Promise<ReturnType<Ajv2020["compile"]>> {
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  return ajv.compile(
    JSON.parse(await readFile(path.join(schemasDir, "case-manifest.schema.json"), "utf8")),
  );
}

async function validManifest(): Promise<Record<string, unknown>> {
  const [first] = await loadCorpus();
  if (!first) throw new Error("corpus is empty");
  return structuredClone(first.manifest);
}

describe("corpus loader", () => {
  it("enumerates and validates every case (manifest schema, semantics schema, dataDigest)", async () => {
    const cases = await loadCorpus();
    expect(cases.length).toBeGreaterThanOrEqual(28);
  });

  it("covers all 15 DocxTemplateEngineTests methods", async () => {
    const cases = await loadCorpus();
    const covered = new Set(
      cases
        .filter((c) => (c.manifest.source as { kind: string }).kind === "docx-test")
        .map((c) => (c.manifest.source as { name: string }).name),
    );
    for (const method of EXPECTED_DOCX_TEST_METHODS) {
      expect(covered, `missing case for test method ${method}`).toContain(method);
    }
  });

  it("covers examples 01-12", async () => {
    const cases = await loadCorpus();
    const covered = new Set(
      cases
        .filter((c) => (c.manifest.source as { kind: string }).kind === "example")
        .map((c) => (c.manifest.source as { name: string }).name),
    );
    for (const example of EXPECTED_EXAMPLES) {
      expect(covered, `missing case for example ${example}`).toContain(example);
    }
  });

  it("pins every library case to the legacy commit and library tier", async () => {
    const cases = await loadCorpus();
    for (const c of cases) {
      expect(c.manifest.tier, c.relativeDir).toBe("library");
      expect(c.manifest.legacyCommit, c.relativeDir).toBe(LEGACY_COMMIT);
      expect(c.relativeDir.startsWith(`library${path.sep}`), c.relativeDir).toBe(true);
    }
  });

  it("keeps the business tier directory present but empty", async () => {
    const entries = await readdir(path.join(corpusRoot, "business"));
    expect(entries).toEqual(["README.md"]);
    const businessCases = await loadCorpus({ tier: "business" });
    expect(businessCases).toEqual([]);
  });

  it("marks legacy pixel-based barcode assertions as rebuilt with decode-value assertions", async () => {
    const cases = await loadCorpus();
    const barcodeCases = cases.filter((c) => c.semantics.barcodes !== undefined);
    expect(barcodeCases.length).toBeGreaterThanOrEqual(3);
    for (const c of barcodeCases) {
      for (const barcode of c.semantics.barcodes as { assertion: string }[]) {
        expect(barcode.assertion, c.relativeDir).toBe("decode-value");
      }
      const notes = (c.manifest.notes ?? []) as string[];
      expect(
        notes.some((n) => n.includes("本版补建")),
        `${c.relativeDir} must note 本版补建 for the rebuilt assertion`,
      ).toBe(true);
    }
  });
});

describe("case manifest schema", () => {
  it("accepts a real corpus manifest", async () => {
    const validate = await loadManifestSchema();
    const manifest = await validManifest();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
  });

  it("rejects a manifest missing a required field", async () => {
    const validate = await loadManifestSchema();
    const manifest = await validManifest();
    delete manifest.dataDigest;
    expect(validate(manifest)).toBe(false);
  });

  it("rejects an unknown tier", async () => {
    const validate = await loadManifestSchema();
    const manifest = await validManifest();
    manifest.tier = "community";
    expect(validate(manifest)).toBe(false);
  });

  it("rejects a malformed dataDigest", async () => {
    const validate = await loadManifestSchema();
    const manifest = await validManifest();
    manifest.dataDigest = "sha256:xyz";
    expect(validate(manifest)).toBe(false);
  });

  it("rejects unknown extra properties (format is frozen)", async () => {
    const validate = await loadManifestSchema();
    const manifest = await validManifest();
    manifest.surprise = true;
    expect(validate(manifest)).toBe(false);
  });

  it("rejects an unknown result status", async () => {
    const validate = await loadManifestSchema();
    const manifest = await validManifest();
    manifest.result = { status: "green" };
    expect(validate(manifest)).toBe(false);
  });
});

describe("dataDigest integrity", () => {
  async function writeTempCorpus(root: string): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const dir = path.join(root, "library", "docx-tests", "00-drift-probe");
    await mkdir(path.join(dir, "expected"), { recursive: true });
    const data = Buffer.from('{"probe":true}\n');
    const manifest = {
      caseId: "lib-test-00-drift-probe",
      tier: "library",
      legacyCommit: LEGACY_COMMIT,
      source: { kind: "docx-test", name: "Render_ReplacesBasicTags_WithJsonPathAndIndex" },
      templateId: "ndocxtemplater-test-drift-probe",
      dataDigest: `sha256:${createHash("sha256").update(data).digest("hex")}`,
      expectedSemantic: {
        file: "expected/semantics.json",
        format: "ofd-compose/case-semantics@1",
      },
      allowedDifferences: [],
      nativeProfile: { bindingPolicyVersion: "legacy-compat-1" },
      result: { status: "not-executable" },
    };
    await writeFile(path.join(dir, "case.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(path.join(dir, "data.json"), data);
    await writeFile(path.join(dir, "expected", "semantics.json"), '{"paragraphs":["x"]}\n');
  }

  it("loads a well-formed temp corpus", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(tmpdir(), "ofd-corpus-ok-"));
    try {
      await writeTempCorpus(root);
      const cases = await loadCorpus({ root });
      expect(cases).toHaveLength(1);
      expect(cases[0]?.manifest.caseId).toBe("lib-test-00-drift-probe");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects the corpus when data.json drifts from dataDigest", async () => {
    const { mkdtemp, rm, writeFile } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(tmpdir(), "ofd-corpus-drift-"));
    try {
      await writeTempCorpus(root);
      await writeFile(
        path.join(root, "library", "docx-tests", "00-drift-probe", "data.json"),
        "{}\n",
      );
      await expect(loadCorpus({ root })).rejects.toThrow(/dataDigest/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
