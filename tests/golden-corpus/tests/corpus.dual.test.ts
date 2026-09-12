/**
 * 文本/结构类 corpus 用例在 ResolvedDocument 级的验收（issue 04 叙述类，issue 05 扩展到条件块、重复块、表格行组）。
 * 同一文件在 Node（vitest.config.ts）与浏览器（vitest.browser.config.ts）两种模式下运行；
 * 用 import.meta.glob 读取语料，不依赖 node:fs。
 */
import { bind, cellText, paragraphText, type ResolvedBlock } from "@ofd-compose/binding-core";
import type { BindingPolicyVersion } from "@ofd-compose/document-model";
import { compile } from "@ofd-compose/template-compiler";
import { describe, expect, it } from "vitest";
import { isExecutableTemplate, templateFromText } from "../src/corpus-template.js";

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
  tables?: { rows: string[][] }[];
  conditionalBlocks?: { expression: string; visible: boolean }[];
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

interface ExecutableCase {
  dir: string;
  manifest: Manifest;
  template: string;
  data: unknown;
  semantics: Semantics;
}

function collectCases(): { executable: ExecutableCase[]; others: Manifest[] } {
  const executable: ExecutableCase[] = [];
  const others: Manifest[] = [];
  for (const [manifestPath, manifest] of Object.entries(manifests).sort()) {
    const dir = manifestPath.slice(0, -"/case.json".length);
    const template = manifest.templateDescription
      ? templates[`${dir}/${manifest.templateDescription}`]
      : undefined;
    if (template === undefined || !isExecutableTemplate(template)) {
      others.push(manifest);
      continue;
    }
    const data = dataFiles[`${dir}/data.json`];
    const semantics = semanticsFiles[`${dir}/expected/semantics.json`];
    if (data === undefined || semantics === undefined) {
      throw new Error(`incomplete case at ${dir}`);
    }
    executable.push({ dir, manifest, template, data, semantics });
  }
  return { executable, others };
}

const { executable, others } = collectCases();

/**
 * 文本/结构类用例的固定清单：集合缩小或扩大都必须显式更新（防止用例被静默跳过）。
 * 示例库（examples/）只有 .docx 没有 template.txt，媒体用例 09–14 含 `{%`，均留待后续票。
 */
const EXPECTED_EXECUTABLE_CASES = [
  "lib-test-01-basic-tags-path-index",
  "lib-test-02-condition-hidden",
  "lib-test-02-condition-shown",
  "lib-test-03-loop-orders",
  "lib-test-04-table-row-loop",
  "lib-test-05-sort-take-count-format",
  "lib-test-06-narrative-aggregates",
  "lib-test-07-nth-at-ranking",
  "lib-test-08-inline-if-percent-permille",
  "lib-test-15-table-split-runs-date-format",
];

/** 把 ResolvedDocument 投影成 `ofd-compose/case-semantics@1` 的可比较子集。 */
function projectSemantics(
  body: readonly ResolvedBlock[],
  conditionals: readonly { expression: string; visible: boolean }[],
): Required<Semantics> {
  return {
    paragraphs: body.filter((b) => b.kind === "paragraph").map(paragraphText),
    tables: body
      .filter((b) => b.kind === "table")
      .map((table) => ({ rows: table.rows.map((row) => row.cells.map(cellText)) })),
    conditionalBlocks: conditionals.map((c) => ({ expression: c.expression, visible: c.visible })),
  };
}

describe("text/structure corpus cases (ResolvedDocument level)", () => {
  it("selects exactly the executable cases", () => {
    expect(executable.map((c) => c.manifest.caseId)).toEqual(EXPECTED_EXECUTABLE_CASES);
    expect(others.length).toBeGreaterThan(0);
  });

  it.each(executable.map((c) => [c.manifest.caseId, c] as const))(
    "%s: bound paragraphs / tables / conditional blocks equal expected semantics",
    (_caseId, c) => {
      const template = templateFromText(c.template, {
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

      const actual = projectSemantics(result.document.body, result.document.structure.conditionals);
      expect(actual).toEqual({
        paragraphs: c.semantics.paragraphs ?? [],
        tables: c.semantics.tables ?? [],
        conditionalBlocks: c.semantics.conditionalBlocks ?? [],
      });
      expect(result.document.runtime.temporalPolyfillVersion).toMatch(/^\d+\.\d+\.\d+$/);
    },
  );

  it("repeat instances carry order-dependent ordinal identities for legacy loop templates", () => {
    const c = executable.find((x) => x.manifest.caseId === "lib-test-03-loop-orders");
    if (!c) throw new Error("case 03 missing");
    const compiled = compile(
      templateFromText(c.template, {
        documentId: c.manifest.caseId,
        bindingPolicyVersion: "strict-1",
      }),
    );
    if (!compiled.ok) throw new Error("compile failed");
    // biome-ignore lint/suspicious/noExplicitAny: corpus data.json is arbitrary JSON
    const result = bind(compiled.template, c.data as any);
    const instancePaths = result.document.body
      .filter((b) => b.kind === "paragraph")
      .map((p) => p.instancePath?.map((i) => `${i.keyKind}:${i.key}`) ?? []);
    expect(instancePaths).toEqual([[], ["ordinal:0"], ["ordinal:1"]]);
    expect(result.document.structure.repeats).toEqual([
      expect.objectContaining({ kind: "repeat-block", expression: "orders", instanceCount: 2 }),
    ]);
  });

  it("manifests record pass for executable cases and not-executable for the rest", () => {
    for (const c of executable) {
      expect(c.manifest.result.status, c.manifest.caseId).toBe("pass");
    }
    for (const m of others) {
      expect(m.result.status, m.caseId).toBe("not-executable");
    }
  });
});
