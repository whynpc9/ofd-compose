import type { BlockNode, TemplateSource } from "@ofd-compose/document-model";
import { describe, expect, it } from "vitest";
import type { JsonValue } from "../src/index.js";
import { build, renderTemplate, type TemplateBuilder } from "./helpers.js";

/**
 * strict-1 与 legacy-compat-1 的差异表（spec §6）。每一行：同一模板 + 同一数据，两种策略的文本、
 * strict 的诊断码与 legacy 产生的 LEGACY_SEMANTIC_CHANGE 规则。legacy 侧每处差异都必须被标记——
 * 这张表就是 MigrationReport 需要人工确认的清单。
 */
interface DiffRow {
  readonly rule: string;
  readonly make: (b: TemplateBuilder) => BlockNode[];
  readonly data: JsonValue;
  readonly strict: { readonly texts: string[]; readonly codes: string[] };
  readonly legacy: {
    readonly texts: string[];
    readonly rules: string[];
    readonly codes?: string[];
  };
}

const rows: readonly DiffRow[] = [
  {
    rule: "scope-fallback：裸路径在当前项取不到时回溯父级/根",
    make: (b) => [b.repeat("items", [b.p("{title}:{n}")])],
    data: { title: "T", items: [{ n: 1 }] },
    strict: { texts: [":1"], codes: ["BINDING_MISSING"] },
    legacy: { texts: ["T:1"], rules: ["scope-fallback"] },
  },
  {
    rule: 'string-truthiness："false" / "0" 字符串为真',
    make: (b) => [b.p("{a|if:是:否}{b|if:是:否}"), b.cond("a", [b.p("shown")])],
    data: { a: "false", b: "0" },
    strict: { texts: ["否否"], codes: [] },
    legacy: {
      texts: ["是是", "shown"],
      rules: ["string-truthiness", "string-truthiness", "string-truthiness"],
    },
  },
  {
    rule: "missing-as-null：缺失进入 if / count / 条件块 / 重复时视为 null",
    make: (b) => [
      b.p("[{flag|if:是:否}][{items|count}]"),
      b.cond("flag", [b.p("cond")]),
      b.repeat("items", [b.p("item")]),
    ],
    data: {},
    strict: {
      texts: ["[][]"],
      codes: ["BINDING_MISSING", "BINDING_MISSING", "BINDING_MISSING", "BINDING_MISSING"],
    },
    legacy: {
      texts: ["[否][0]"],
      rules: ["missing-as-null", "missing-as-null", "missing-as-null", "missing-as-null"],
    },
  },
  {
    rule: "count-non-array：对象属性数 / 字符串 UTF-16 长度 / 标量为 1",
    make: (b) => [b.p("{o|count}/{s|count}/{n|count}")],
    data: { o: { a: 1, b: 2 }, s: "héllo", n: 5 },
    strict: {
      texts: ["//"],
      codes: ["EXPRESSION_UNSUPPORTED", "EXPRESSION_UNSUPPORTED", "EXPRESSION_UNSUPPORTED"],
    },
    legacy: { texts: ["2/5/1"], rules: ["count-non-array", "count-non-array", "count-non-array"] },
  },
  {
    rule: "repeat-non-array-once / -skipped：truthy 非数组循环一次，falsy 非数组零次",
    make: (b) => [b.repeat("patient", [b.p("{name}")]), b.repeat("empty", [b.p("x")])],
    data: { patient: { name: "Alice" }, empty: "" },
    strict: { texts: [], codes: ["EXPRESSION_UNSUPPORTED", "EXPRESSION_UNSUPPORTED"] },
    legacy: { texts: ["Alice"], rules: ["repeat-non-array-once", "repeat-non-array-skipped"] },
  },
  {
    rule: "negative-path-index：路径 `[-1]` 越界（strict 缺失 / 旧 null），`at:-1` 才是倒数取项",
    make: (b) => [b.p("[{xs[-1]}][{xs|at:-1}]")],
    data: { xs: ["a", "b"] },
    strict: { texts: ["[][b]"], codes: ["BINDING_MISSING"] },
    legacy: { texts: ["[][b]"], rules: ["negative-path-index"] },
  },
  {
    rule: "boolean-text：布尔渲染为 True/False",
    make: (b) => [b.p("{t}/{f}")],
    data: { t: true, f: false },
    strict: { texts: ["true/false"], codes: [] },
    legacy: { texts: ["True/False"], rules: ["boolean-text", "boolean-text"] },
  },
  {
    rule: "missing-as-null（sort/maxby 键缺失按 null 比较）",
    make: (b) => [b.p("{xs|minby:k|get:id}")],
    data: { xs: [{ id: "a", k: 2 }, { id: "b" }] },
    strict: { texts: [""], codes: ["BINDING_MISSING"] },
    legacy: { texts: ["b"], rules: ["missing-as-null"] },
  },
];

describe("strict-1 vs legacy-compat-1 difference table", () => {
  it.each(rows.map((row) => [row.rule, row] as const))("%s", (_rule, row) => {
    const template: TemplateSource = build(row.make);
    const strict = renderTemplate(template, row.data, { policy: "strict-1" });
    expect(strict.texts, "strict texts").toEqual(row.strict.texts);
    expect(
      strict.diagnostics.map((d) => d.code),
      "strict codes",
    ).toEqual(row.strict.codes);
    expect(
      strict.diagnostics.filter((d) => d.code === "LEGACY_SEMANTIC_CHANGE"),
      "strict never reports LEGACY_SEMANTIC_CHANGE",
    ).toEqual([]);

    const legacy = renderTemplate(template, row.data, { policy: "legacy-compat-1" });
    expect(legacy.texts, "legacy texts").toEqual(row.legacy.texts);
    const changes = legacy.diagnostics.filter((d) => d.code === "LEGACY_SEMANTIC_CHANGE");
    expect(
      changes.map((d) => d.details?.rule),
      "legacy rules",
    ).toEqual(row.legacy.rules);
    for (const change of changes) {
      expect(change.severity).toBe("info");
      expect(change.details?.bindingPolicyVersion).toBe("legacy-compat-1");
      expect(change.nodeId).toBeDefined();
      expect(change.bindingId).toBeDefined();
    }
    expect(
      legacy.diagnostics.filter((d) => d.code !== "LEGACY_SEMANTIC_CHANGE").map((d) => d.code),
      "other legacy codes",
    ).toEqual(row.legacy.codes ?? []);
    expect(legacy.document.bindingPolicyVersion).toBe("legacy-compat-1");
  });

  it("the table covers every legacy rule the binder can emit", () => {
    const covered = new Set(rows.flatMap((r) => r.legacy.rules));
    expect([...covered].sort()).toEqual(
      [
        "boolean-text",
        "count-non-array",
        "missing-as-null",
        "negative-path-index",
        "repeat-non-array-once",
        "repeat-non-array-skipped",
        "scope-fallback",
        "string-truthiness",
      ].sort(),
    );
  });
});
