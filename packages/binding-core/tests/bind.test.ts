import {
  type BindingPolicyVersion,
  type InlineNode,
  type TemplateSource,
  validateTemplateSource,
} from "@ofd-compose/document-model";
import { compile } from "@ofd-compose/template-compiler";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  bind,
  evaluateExpression,
  type JsonValue,
  MISSING,
  paragraphText,
  ResolvedDocumentSchema,
} from "../src/index.js";

/** 把 `静态{表达式}静态` 形式的段落转成 TemplateSource（测试辅助；nodeId/bindingId 顺序生成）。 */
function templateOf(
  paragraphs: readonly string[],
  settings: Partial<TemplateSource["settings"]> = {},
): TemplateSource {
  let counter = 0;
  const body = paragraphs.map((line, pIndex) => {
    const inlines: InlineNode[] = [];
    const re = /\{([^{}]+)\}/g;
    let last = 0;
    for (const m of line.matchAll(re)) {
      if (m.index > last) {
        inlines.push({ kind: "text", nodeId: `t${counter++}`, text: line.slice(last, m.index) });
      }
      const id = counter++;
      inlines.push({
        kind: "dynamic-text",
        nodeId: `d${id}`,
        bindingId: `b${id}`,
        expression: { kind: "legacy", text: m[1] as string },
      });
      last = m.index + m[0].length;
    }
    if (last < line.length) {
      inlines.push({ kind: "text", nodeId: `t${counter++}`, text: line.slice(last) });
    }
    return { kind: "paragraph" as const, nodeId: `p${pIndex}`, inlines };
  });
  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "doc",
    revisionId: "r1",
    settings: {
      locale: "zh-CN",
      timeZone: "UTC",
      bindingPolicyVersion: "legacy-compat-1",
      ...settings,
    },
    styles: {},
    body,
  };
}

function render(
  paragraphs: readonly string[],
  data: JsonValue,
  policy: BindingPolicyVersion = "legacy-compat-1",
  settings: Partial<TemplateSource["settings"]> = {},
) {
  const compiled = compile(templateOf(paragraphs, { bindingPolicyVersion: policy, ...settings }));
  if (!compiled.ok) {
    throw new Error(`compile failed: ${JSON.stringify(compiled.diagnostics, null, 2)}`);
  }
  const result = bind(compiled.template, data);
  return { ...result, texts: result.document.body.map(paragraphText) };
}

const institutions = {
  institutions: [
    { name: "机构C", revenue: 650000 },
    { name: "机构A", revenue: 1000000 },
    { name: "机构Z", revenue: 100000 },
  ],
};

describe("first narrative sentence", () => {
  it("renders DynamicText inline in one paragraph with source-mapped fragments", () => {
    const { document, diagnostics, texts } = render(
      [
        "营收最高的是{institutions|maxby:revenue|get:name}，收入为{institutions|maxby:revenue|get:revenue|format:number:#,##0}元。",
      ],
      institutions,
      "strict-1",
    );
    expect(diagnostics).toEqual([]);
    expect(texts).toEqual(["营收最高的是机构A，收入为1,000,000元。"]);
    expect(document.body).toHaveLength(1);

    const [p] = document.body;
    if (!p) throw new Error("paragraph");
    expect(p.fragments.map((f) => (f.kind === "text" ? f.text : "<control>"))).toEqual([
      "营收最高的是",
      "机构A",
      "，收入为",
      "1,000,000",
      "元。",
    ]);
    const nameFragment = p.fragments[1];
    const revenueFragment = p.fragments[3];
    expect(nameFragment).toMatchObject({
      kind: "text",
      origin: {
        kind: "dynamic-text",
        nodeId: "d1",
        bindingId: "b1",
        expression: "institutions|maxby:revenue|get:name",
        dataPath: "institutions[1].name",
        valueState: "value",
      },
    });
    expect(revenueFragment).toMatchObject({
      origin: { dataPath: "institutions[1].revenue", valueState: "value" },
    });

    expect(document.expressionLanguageVersion).toBe("expr-1");
    expect(document.bindingPolicyVersion).toBe("strict-1");
    expect(document.modelVersion).toBe("0");
    expect(Value.Check(ResolvedDocumentSchema, document)).toBe(true);
  });

  it("structured config binds to the identical ResolvedDocument as legacy text", () => {
    const legacy = templateOf(["最高为{institutions|maxby:revenue|get:name}"], {
      bindingPolicyVersion: "strict-1",
    });
    const structured = JSON.parse(JSON.stringify(legacy)) as TemplateSource;
    const dyn = structured.body[0]?.inlines[1];
    if (dyn?.kind !== "dynamic-text") throw new Error("fixture");
    dyn.expression = {
      kind: "structured",
      source: "institutions",
      steps: [
        { op: "maxby", key: "revenue" },
        { op: "pick", path: "name" },
      ],
    };
    const a = compile(legacy);
    const b = compile(structured);
    if (!a.ok || !b.ok) throw new Error("compile");
    expect(bind(b.template, institutions).document).toEqual(
      bind(a.template, institutions).document,
    );
  });

  it("inserted values are data, never re-scanned as template tags", () => {
    const { texts } = render(["{label}"], { label: "{institutions|count}" }, "strict-1");
    expect(texts).toEqual(["{institutions|count}"]);
  });

  it("DynamicText inherits the paragraph style unless it carries its own or opts out", () => {
    const template = templateOf(["A{x}B{y}C{z}"], { bindingPolicyVersion: "strict-1" });
    template.styles = { body: { fontSize: 10.5 }, em: { bold: true } };
    const [p] = template.body;
    if (!p) throw new Error("fixture");
    p.styleId = "body";
    const [, x, , y, , z] = p.inlines;
    if (
      !x ||
      !y ||
      !z ||
      x.kind !== "dynamic-text" ||
      y.kind !== "dynamic-text" ||
      z.kind !== "dynamic-text"
    ) {
      throw new Error("fixture");
    }
    y.styleId = "em";
    z.styleInheritance = "explicit";
    const compiled = compile(template);
    if (!compiled.ok) throw new Error("compile");
    const { document } = bind(compiled.template, { x: 1, y: 2, z: 3 });
    const styles = document.body[0]?.fragments.map((f) => (f.kind === "text" ? f.styleId : null));
    expect(styles).toEqual([undefined, "body", undefined, "em", undefined, undefined]);
  });
});

describe("Missing vs Null", () => {
  const data = { patient: { name: null, age: 3 } };

  it("strict-1: Missing is an error diagnostic, Null is a legitimate empty value", () => {
    const { diagnostics, texts, document } = render(
      ["Name: {patient.name}", "Nick: {patient.nick}", "Age: {patient.age}"],
      data,
      "strict-1",
    );
    expect(texts).toEqual(["Name: ", "Nick: ", "Age: 3"]);
    expect(diagnostics).toEqual([
      {
        code: "BINDING_MISSING",
        severity: "error",
        phase: "bind",
        nodeId: "d3",
        bindingId: "b3",
        dataPath: "patient.nick",
        message: expect.stringContaining("patient.nick"),
        details: { expression: "patient.nick" },
      },
    ]);
    const states = document.body.map((p) => {
      const f = p.fragments[1];
      return f?.kind === "text" && f.origin.kind === "dynamic-text" ? f.origin.valueState : null;
    });
    expect(states).toEqual(["null", "missing", "value"]);
  });

  it("legacy-compat-1: Missing renders empty like the legacy engine but is still reported (warning)", () => {
    const result = render(["Nick: {patient.nick}"], data, "legacy-compat-1");
    expect(result.ok).toBe(true);
    expect(result.texts).toEqual(["Nick: "]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "BINDING_MISSING",
        severity: "warning",
        dataPath: "patient.nick",
      }),
    ]);
  });

  it("reports the first missing segment, not the tail of the path", () => {
    const { diagnostics } = render(
      ["{report.items[5].code}"],
      { report: { items: [] } },
      "strict-1",
    );
    expect(diagnostics[0]).toMatchObject({ dataPath: "report.items[5]" });
    const empty = render(
      ["{institutions|maxby:revenue|get:name}"],
      { institutions: [] },
      "strict-1",
    );
    expect(empty.diagnostics[0]).toMatchObject({
      code: "BINDING_MISSING",
      dataPath: "institutions[0]",
    });
  });
});

describe("truthiness policies", () => {
  it.each([
    ["false", "否", "是"],
    ["0", "否", "是"],
    [" FALSE ", "否", "是"],
  ])(
    "string %j: strict says %s, legacy says %s and flags LEGACY_SEMANTIC_CHANGE",
    (value, strict, legacy) => {
      const s = render(["{flag|if:是:否}"], { flag: value }, "strict-1");
      expect(s.texts).toEqual([strict]);
      expect(s.diagnostics).toEqual([]);

      const l = render(["{flag|if:是:否}"], { flag: value }, "legacy-compat-1");
      expect(l.texts).toEqual([legacy]);
      expect(l.diagnostics).toEqual([
        expect.objectContaining({
          code: "LEGACY_SEMANTIC_CHANGE",
          severity: "info",
          phase: "bind",
          nodeId: "d0",
          bindingId: "b0",
          dataPath: "flag",
          details: { rule: "string-truthiness", bindingPolicyVersion: "legacy-compat-1" },
        }),
      ]);
    },
  );

  it.each([
    [true, "是"],
    [false, "否"],
    [1, "是"],
    [0, "否"],
    ["", "否"],
    ["  ", "否"],
    ["yes", "是"],
    [[], "否"],
    [[1], "是"],
    [{}, "否"],
    [{ a: 1 }, "是"],
    [null, "否"],
  ])("both policies agree on %j → %s (no LEGACY_SEMANTIC_CHANGE)", (value, expected) => {
    for (const policy of ["strict-1", "legacy-compat-1"] as const) {
      const r = render(["{flag|if:是:否}"], { flag: value as JsonValue }, policy);
      expect(r.texts, policy).toEqual([expected]);
      expect(
        r.diagnostics.filter((d) => d.code === "LEGACY_SEMANTIC_CHANGE"),
        policy,
      ).toEqual([]);
    }
  });

  it("single-branch if renders an empty false branch; missing subject is Missing, not false", () => {
    expect(render(["[{flag|if:VIP}]"], { flag: false }, "strict-1").texts).toEqual(["[]"]);
    const r = render(["[{flag|if:VIP}]"], {}, "strict-1");
    expect(r.texts).toEqual(["[]"]);
    expect(r.diagnostics[0]?.code).toBe("BINDING_MISSING");
  });
});

describe("scope rules", () => {
  const ast = compile(templateOf(["{title}"])).template?.bindings.b0?.ast;
  if (!ast) throw new Error("fixture");
  const scope = {
    root: { title: "root-title", items: [{ n: 1 }] },
    parent: { current: { title: "root-title", items: [{ n: 1 }] }, root: { title: "root-title" } },
    current: { n: 1 },
  };
  const ctx = (policy: BindingPolicyVersion) => ({
    policy,
    timeZone: "UTC",
    scope,
    nodeId: "d0",
    bindingId: "b0",
    patternCache: new Map(),
  });

  it("strict-1 resolves against the current item only (explicit scope)", () => {
    const r = evaluateExpression(ast, ctx("strict-1"));
    expect(r.value).toBe(MISSING);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["BINDING_MISSING"]);
  });

  it("legacy-compat-1 backtracks to ancestors and flags LEGACY_SEMANTIC_CHANGE", () => {
    const r = evaluateExpression(ast, ctx("legacy-compat-1"));
    expect(r.text).toBe("root-title");
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "LEGACY_SEMANTIC_CHANGE",
        details: expect.objectContaining({ rule: "scope-fallback" }),
      }),
    ]);
  });

  it("`$` / `$.path` address the root explicitly under both policies", () => {
    const rootAst = compile(templateOf(["{$.title}"])).template?.bindings.b0?.ast;
    if (!rootAst) throw new Error("fixture");
    for (const policy of ["strict-1", "legacy-compat-1"] as const) {
      const r = evaluateExpression(rootAst, ctx(policy));
      expect(r.text).toBe("root-title");
      expect(r.dataPath).toBe("$.title");
      expect(r.diagnostics).toEqual([]);
    }
  });
});

describe("number formatting (.NET custom pattern subset, decimal.js)", () => {
  it.each([
    [1000000, "#,##0", "1,000,000"],
    [100, "0.00", "100.00"],
    [66.2, "0.00", "66.20"],
    [12.5, "0.00", "12.50"],
    [0.0123, "0.00%", "1.23%"],
    [0.0045, "0.00‰", "4.50‰"],
    [-1234.5, "#,##0.0", "-1,234.5"],
    [0, "#.##", ""],
    [0, "#,##0", "0"],
    [2.345, "0.00", "2.35"],
    [2.5, "0", "3"],
    [-2.5, "0", "-3"],
    [-0.001, "0.00", "0.00"],
    [1234.5678, "#,##0.##", "1,234.57"],
    [7, "000", "007"],
    [12.5, "¥#,##0.00元", "¥12.50元"],
    [1e21, "0", "1000000000000000000000"],
    [0.1 + 0.2, "0.0000000000000000", "0.3000000000000000"],
  ])("%s with %s → %s", (value, pattern, expected) => {
    const r = render([`{v|format:number:${pattern}}`], { v: value }, "strict-1");
    expect(r.diagnostics).toEqual([]);
    expect(r.texts).toEqual([expected]);
  });

  it("numeric strings format; non-numeric values fall back to their text (legacy behaviour)", () => {
    expect(render(["{v|format:number:0.00}"], { v: "12.5" }, "strict-1").texts).toEqual(["12.50"]);
    expect(render(["{v|format:number:0.00}"], { v: "1,234.5" }, "strict-1").texts).toEqual([
      "1234.50",
    ]);
    expect(render(["{v|format:number:0.00}"], { v: "n/a" }, "strict-1").texts).toEqual(["n/a"]);
    expect(render(["{v|format:number:0.00}"], { v: null }, "strict-1").texts).toEqual([""]);
  });

  it("format:percent / format:permille default patterns and suffix completion", () => {
    const r = render(
      ["{a|format:percent} {a|format:percent:0.00} {b|format:permille} {b|format:permille:0.0}"],
      { a: 0.0123, b: 0.0045 },
      "strict-1",
    );
    expect(r.texts).toEqual(["1.23% 1.23% 4.5‰ 4.5‰"]);
  });

  it("plain values render without exponent notation and with legacy boolean casing only in compat mode", () => {
    const data = { a: 120.5, b: 80, c: 1e21, d: true, e: [1, "x"], f: { k: null } };
    const strict = render(["{a} {b} {c} {d} {e} {f}"], data, "strict-1");
    expect(strict.texts).toEqual(['120.5 80 1000000000000000000000 true [1,"x"] {"k":null}']);
    const legacy = render(["{d}"], data, "legacy-compat-1");
    expect(legacy.texts).toEqual(["True"]);
    expect(legacy.diagnostics).toEqual([
      expect.objectContaining({
        code: "LEGACY_SEMANTIC_CHANGE",
        details: expect.objectContaining({ rule: "boolean-text" }),
      }),
    ]);
  });
});

describe("date formatting (ISO input, template-locked time zone)", () => {
  it("zoned instants are converted to the template time zone; plain dates keep their fields", () => {
    const data = { at: "2026-02-10T16:45:30Z", day: "2025-03-01" };
    expect(render(["{at|format:date:yyyy-MM-dd}"], data, "strict-1").texts).toEqual(["2026-02-10"]);
    expect(
      render(["{at|format:date:yyyy-MM-dd HH:mm:ss}"], data, "strict-1", {
        timeZone: "Asia/Shanghai",
      }).texts,
    ).toEqual(["2026-02-11 00:45:30"]);
    expect(
      render(["{day|format:date:yyyy年M月}"], data, "strict-1", { timeZone: "Asia/Shanghai" })
        .texts,
    ).toEqual(["2025年3月"]);
    expect(render(["{day|format:date:M月}"], data, "strict-1").texts).toEqual(["3月"]);
    expect(
      render(["{at|format:date:yy/M/d H:m:s}"], { at: "2026-02-10T06:05:04+08:00" }, "strict-1", {
        timeZone: "Asia/Shanghai",
      }).texts,
    ).toEqual(["26/2/10 6:5:4"]);
  });

  it("non-ISO text is not a date and falls back to its text", () => {
    expect(render(["{d|format:date:yyyy-MM-dd}"], { d: "next tuesday" }, "strict-1").texts).toEqual(
      ["next tuesday"],
    );
  });
});

describe("list operations used by narrative sentences", () => {
  const data = {
    institutions: [
      { name: "A", revenue: 1000000 },
      { name: "B", revenue: 920000 },
      { name: "C", revenue: 880000 },
      { name: "D", revenue: 100000 },
    ],
    months: [{ month: "2025-03-01" }, { month: "2025-01-01" }, { month: "2025-07-01" }],
  };

  it("sort/take/nth/at/first/last/count/minby with tracked data paths", () => {
    const r = render(
      [
        "{institutions|sort:revenue:desc|take:3|nth:3|get:name}",
        "{institutions|sort:revenue:desc|take:3|at:-1|get:revenue|format:number:#,##0}",
        "{institutions|sort:revenue:asc|first|get:name}",
        "{months|sort:month:asc|last|get:month|format:date:yyyy年M月}",
        "{institutions|count}",
        "{institutions|minby:revenue|get:name}",
      ],
      data,
      "strict-1",
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.texts).toEqual(["C", "880,000", "D", "2025年7月", "4", "D"]);
    const paths = r.document.body.map((p) => {
      const f = p.fragments[0];
      return f?.kind === "text" && f.origin.kind === "dynamic-text" ? f.origin.dataPath : null;
    });
    expect(paths).toEqual([
      "institutions[2].name",
      "institutions[2].revenue",
      "institutions[3].name",
      "months[2].month",
      "institutions",
      "institutions[3].name",
    ]);
  });

  it("sort is stable with input order as tie-break in both directions", () => {
    const ties = {
      xs: [
        { k: 1, id: "a" },
        { k: 0, id: "b" },
        { k: 1, id: "c" },
        { k: 0, id: "d" },
      ],
    };
    expect(
      render(["{xs|sort:k:asc|first|get:id}{xs|sort:k:asc|last|get:id}"], ties, "strict-1").texts,
    ).toEqual(["bc"]);
    expect(
      render(["{xs|sort:k:desc|first|get:id}{xs|sort:k:desc|last|get:id}"], ties, "strict-1").texts,
    ).toEqual(["ad"]);
  });

  it("legacy-compat count on non-arrays keeps legacy semantics and flags the change", () => {
    const r = render(["{s|count} {o|count} {n|count} {z|count}"], {
      s: "héllo",
      o: { a: 1, b: 2 },
      n: 5,
      z: null,
    });
    expect(r.texts).toEqual(["5 2 1 0"]);
    expect(r.diagnostics.filter((d) => d.code === "LEGACY_SEMANTIC_CHANGE")).toHaveLength(3);
  });

  it("strict count requires an array: non-arrays yield EXPRESSION_UNSUPPORTED and empty text; null counts 0", () => {
    const r = render(
      ["{s|count}|{o|count}|{z|count}|{list|count}"],
      {
        s: "héllo",
        o: { a: 1 },
        z: null,
        list: [1, 2],
      },
      "strict-1",
    );
    expect(r.texts).toEqual(["||0|2"]);
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.dataPath, d.details?.rule])).toEqual([
      ["EXPRESSION_UNSUPPORTED", "error", "s", "count-non-array"],
      ["EXPRESSION_UNSUPPORTED", "error", "o", "count-non-array"],
    ]);
  });

  it("legacy-compat feeds Missing into if/count as null (legacy) and flags missing-as-null", () => {
    const r = render(["[{flag|if:是:否}] [{items|count}] [{name}]"], {});
    expect(r.texts).toEqual(["[否] [0] []"]);
    expect(r.diagnostics.map((d) => [d.code, d.severity, d.dataPath, d.details?.rule])).toEqual([
      ["LEGACY_SEMANTIC_CHANGE", "info", "flag", "missing-as-null"],
      ["LEGACY_SEMANTIC_CHANGE", "info", "items", "missing-as-null"],
      ["BINDING_MISSING", "warning", "name", undefined],
    ]);
    // strict-1 keeps Missing distinct: no false branch, BINDING_MISSING errors instead.
    const strict = render(["[{flag|if:是:否}] [{items|count}]"], {}, "strict-1");
    expect(strict.texts).toEqual(["[] []"]);
    expect(strict.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["BINDING_MISSING", "error"],
      ["BINDING_MISSING", "error"],
    ]);
  });
});

describe("diagnostics carry the required fields for the three named codes", () => {
  it("BINDING_MISSING / EXPRESSION_UNSUPPORTED / FORMAT_PATTERN_UNSUPPORTED", () => {
    const template = templateOf(
      [
        "{institutions|sum:revenue}",
        "{institutions|maxby:revenue|get:revenue|format:number:0.00E+00}",
      ],
      { bindingPolicyVersion: "strict-1" },
    );
    const compiled = compile(template);
    expect(compiled.ok).toBe(false);
    expect(compiled.diagnostics.map((d) => [d.code, d.phase, d.nodeId, d.bindingId])).toEqual([
      ["EXPRESSION_UNSUPPORTED", "compile", "d0", "b0"],
      ["FORMAT_PATTERN_UNSUPPORTED", "compile", "d1", "b1"],
    ]);

    const missing = render(["{nowhere}"], {}, "strict-1").diagnostics[0];
    expect(missing).toMatchObject({
      code: "BINDING_MISSING",
      severity: "error",
      phase: "bind",
      nodeId: "d0",
      bindingId: "b0",
      dataPath: "nowhere",
    });
    expect(typeof missing?.message).toBe("string");
  });

  it("the template used by these tests is a valid Document Model v0 instance", () => {
    expect(validateTemplateSource(templateOf(["{a}b{c}"])).ok).toBe(true);
  });
});
