/**
 * 叙述类 corpus 用例在 ResolvedDocument 级的验收（issue 04）。
 * 同一文件在 Node（vitest.config.ts）与浏览器（vitest.browser.config.ts）两种模式下运行；
 * 用 import.meta.glob 读取语料，不依赖 node:fs。
 */
import { bind, paragraphText } from "@ofd-compose/binding-core";
import type { BindingPolicyVersion } from "@ofd-compose/document-model";
import { compile } from "@ofd-compose/template-compiler";
import { describe, expect, it } from "vitest";
import { isNarrativeTemplate, narrativeTemplateFromText } from "../src/narrative-template.js";

interface Manifest {
  caseId: string;
  templateId: string;
  legacyCommit: string;
  templateDescription?: string;
  nativeProfile: { bindingPolicyVersion: BindingPolicyVersion };
  result: { status: string };
}

interface Semantics {
  paragraphs?: string[];
}

const manifests = import.meta.glob<Manifest>("../library/**/case.json", {
  eager: true,
  import: "default",
});
const templates = import.meta.glob<string>("../library/**/template.txt", {
  eager: true,
  import: "default",
  query: "?raw",
});
const dataFiles = import.meta.glob<unknown>("../library/**/data.json", {
  eager: true,
  import: "default",
});
const semanticsFiles = import.meta.glob<Semantics>("../library/**/expected/semantics.json", {
  eager: true,
  import: "default",
});

interface NarrativeCase {
  dir: string;
  manifest: Manifest;
  template: string;
  data: unknown;
  semantics: Semantics;
}

function collectCases(): { narrative: NarrativeCase[]; others: Manifest[] } {
  const narrative: NarrativeCase[] = [];
  const others: Manifest[] = [];
  for (const [manifestPath, manifest] of Object.entries(manifests).sort()) {
    const dir = manifestPath.slice(0, -"/case.json".length);
    const template = manifest.templateDescription
      ? templates[`${dir}/${manifest.templateDescription}`]
      : undefined;
    if (template === undefined || !isNarrativeTemplate(template)) {
      others.push(manifest);
      continue;
    }
    const data = dataFiles[`${dir}/data.json`];
    const semantics = semanticsFiles[`${dir}/expected/semantics.json`];
    if (data === undefined || semantics === undefined) {
      throw new Error(`incomplete case at ${dir}`);
    }
    narrative.push({ dir, manifest, template, data, semantics });
  }
  return { narrative, others };
}

const { narrative, others } = collectCases();

/** 叙述类用例的固定清单：集合缩小或扩大都必须显式更新（防止用例被静默跳过）。 */
const EXPECTED_NARRATIVE_CASES = [
  "lib-test-01-basic-tags-path-index",
  "lib-test-06-narrative-aggregates",
  "lib-test-07-nth-at-ranking",
  "lib-test-08-inline-if-percent-permille",
];

describe("narrative corpus cases (ResolvedDocument level)", () => {
  it("selects exactly the narrative cases", () => {
    expect(narrative.map((c) => c.manifest.caseId)).toEqual(EXPECTED_NARRATIVE_CASES);
    expect(others.length).toBeGreaterThan(0);
  });

  it.each(narrative.map((c) => [c.manifest.caseId, c] as const))(
    "%s: bound paragraph texts equal expected semantics",
    (_caseId, c) => {
      const template = narrativeTemplateFromText(c.template, {
        documentId: c.manifest.caseId,
        bindingPolicyVersion: c.manifest.nativeProfile.bindingPolicyVersion,
        templateId: c.manifest.templateId,
        legacyCommit: c.manifest.legacyCommit,
      });
      const compiled = compile(template);
      expect(compiled.diagnostics, "compile diagnostics").toEqual([]);
      if (!compiled.ok) throw new Error("compile failed");

      // biome-ignore lint/suspicious/noExplicitAny: corpus data.json is arbitrary JSON
      const result = bind(compiled.template, c.data as any);
      expect(
        result.diagnostics.filter((d) => d.severity !== "info"),
        "bind diagnostics",
      ).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.document.body.map(paragraphText)).toEqual(c.semantics.paragraphs);
      expect(result.document.body).toHaveLength(c.semantics.paragraphs?.length ?? -1);
    },
  );

  it("manifests record pass for narrative cases and not-executable for the rest", () => {
    for (const c of narrative) {
      expect(c.manifest.result.status, c.manifest.caseId).toBe("pass");
    }
    for (const m of others) {
      expect(m.result.status, m.caseId).toBe("not-executable");
    }
  });
});
