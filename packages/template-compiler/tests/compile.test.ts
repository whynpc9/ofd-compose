import type { ExpressionSource, TemplateSource } from "@ofd-compose/document-model";
import { describe, expect, it } from "vitest";
import {
  compile,
  compileExpression,
  type ExpressionAst,
  ExpressionCompileError,
  parseDatePattern,
  parseNumberPattern,
} from "../src/index.js";

function template(expressions: readonly ExpressionSource[]): TemplateSource {
  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "doc",
    revisionId: "r1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body: [
      {
        kind: "paragraph",
        nodeId: "p1",
        inlines: expressions.map((expression, i) => ({
          kind: "dynamic-text" as const,
          nodeId: `d${i}`,
          bindingId: `b${i}`,
          expression,
        })),
      },
    ],
  };
}

const narrativeAst: ExpressionAst = {
  version: "expr-1",
  source: { scope: "implicit", segments: [{ kind: "property", name: "institutions" }] },
  steps: [
    { op: "maxby", key: [{ kind: "property", name: "revenue" }] },
    { op: "get", path: [{ kind: "property", name: "revenue" }] },
    { op: "format", format: { kind: "number", pattern: "#,##0" } },
  ],
};

describe("legacy pipeline syntax and structured config compile to the same AST", () => {
  it("maxby/get/format:number", () => {
    const legacy = compileExpression({
      kind: "legacy",
      text: "institutions | maxby:revenue | get:revenue | format:number:#,##0",
    });
    const structured = compileExpression({
      kind: "structured",
      source: "institutions",
      steps: [
        { op: "maxby", key: "revenue" },
        { op: "get", path: "revenue" },
        { op: "format", kind: "number", pattern: "#,##0" },
      ],
    });
    expect(legacy.ast).toEqual(narrativeAst);
    expect(structured.ast).toEqual(narrativeAst);
  });

  it("aliases (pick, numeric, percentage, per_mille, datetime) normalize to one AST and are recorded", () => {
    const legacy = compileExpression({
      kind: "legacy",
      text: "rows|sort:month:DESC|pick:name|format:numeric:0.00|format:percentage:0.0|format:per_mille|format:datetime:yyyy-MM-dd HH:mm:ss",
    });
    const structured = compileExpression({
      kind: "structured",
      source: "rows",
      steps: [
        { op: "sort", key: "month", direction: "desc" },
        { op: "pick", path: "name" },
        { op: "format", kind: "numeric", pattern: "0.00" },
        { op: "format", kind: "percentage", pattern: "0.0" },
        { op: "format", kind: "per_mille" },
        { op: "format", kind: "datetime", pattern: "yyyy-MM-dd HH:mm:ss" },
      ],
    });
    expect(structured.ast).toEqual(legacy.ast);
    expect(legacy.ast.steps).toEqual([
      { op: "sort", key: [{ kind: "property", name: "month" }], direction: "desc" },
      { op: "get", path: [{ kind: "property", name: "name" }] },
      { op: "format", format: { kind: "number", pattern: "0.00" } },
      { op: "format", format: { kind: "percent", pattern: "0.0%" } },
      { op: "format", format: { kind: "permille", pattern: "0.##‰" } },
      { op: "format", format: { kind: "date", pattern: "yyyy-MM-dd HH:mm:ss" } },
    ]);
    expect(legacy.sourceMap.normalizations).toEqual([
      { astPath: "steps[0]", from: "DESC", to: "desc" },
      { astPath: "steps[1]", from: "pick", to: "get" },
      { astPath: "steps[2]", from: "numeric", to: "number" },
      { astPath: "steps[3]", from: "percentage", to: "percent" },
      { astPath: "steps[4]", from: "per_mille", to: "permille" },
      { astPath: "steps[5]", from: "datetime", to: "date" },
    ]);
  });

  it("paths: `.`, `$`, `$.a.b[0]`, indexes, and `if` with ':' inside the false branch", () => {
    const { ast } = compileExpression({
      kind: "legacy",
      text: "$.report.items[1].value|if:yes:a:b",
    });
    expect(ast.source).toEqual({
      scope: "root",
      segments: [
        { kind: "property", name: "report" },
        { kind: "property", name: "items" },
        { kind: "index", index: 1 },
        { kind: "property", name: "value" },
      ],
    });
    expect(ast.steps).toEqual([{ op: "if", whenTrue: "yes", whenFalse: "a:b" }]);
    expect(compileExpression({ kind: "legacy", text: "." }).ast.source).toEqual({
      scope: "current",
      segments: [],
    });
    expect(compileExpression({ kind: "legacy", text: "$" }).ast.source).toEqual({
      scope: "root",
      segments: [],
    });
    expect(compileExpression({ kind: "legacy", text: "x|get:." }).ast.steps).toEqual([
      { op: "get", path: [] },
    ]);
  });

  it("property names follow the legacy loose rule: inner spaces, symbols and CJK are plain names", () => {
    for (const name of ["first name", "机构名称", "a&b", "x%", "y?", "first-name", "a>b"]) {
      expect(compileExpression({ kind: "legacy", text: name }).ast.source.segments, name).toEqual([
        { kind: "property", name },
      ]);
    }
    for (const text of ["a + b", "a >b", "x && y", "f(x)", "'quoted'", "a - b"]) {
      expect(() => compileExpression({ kind: "legacy", text }), text).toThrowError(
        /EXPRESSION_UNSUPPORTED|arithmetic\/comparison\/script/,
      );
    }
  });
});

describe("source map: template position ↔ legacy expression ↔ AST node", () => {
  it("records original spans for legacy text (whitespace preserved in offsets)", () => {
    const text = " institutions | maxby:revenue |get:name";
    const { sourceMap } = compileExpression({ kind: "legacy", text });
    expect(sourceMap.origin).toBe("legacy");
    expect(sourceMap.legacyText).toBe(text);
    const slice = (i: number) => {
      const span = sourceMap.spans[i];
      if (!span) throw new Error("span");
      return text.slice(span.start, span.end);
    };
    expect(sourceMap.spans.map((s) => s.astPath)).toEqual(["source", "steps[0]", "steps[1]"]);
    expect([slice(0), slice(1), slice(2)]).toEqual(["institutions", "maxby:revenue", "get:name"]);
  });

  it("generates canonical legacy text with spans for structured input", () => {
    const { sourceMap } = compileExpression({
      kind: "structured",
      source: "$.institutions",
      steps: [
        { op: "sort", key: "revenue" },
        { op: "take", count: 10 },
        { op: "at", index: -1 },
        { op: "pick", path: "name" },
        { op: "if", whenTrue: "T" },
      ],
    });
    expect(sourceMap.origin).toBe("structured");
    expect(sourceMap.legacyText).toBe(
      "$.institutions|sort:revenue:asc|take:10|at:-1|get:name|if:T",
    );
    for (const span of sourceMap.spans) {
      const piece = sourceMap.legacyText.slice(span.start, span.end);
      expect(piece).not.toContain("|");
      expect(piece.length).toBeGreaterThan(0);
    }
    expect(sourceMap.spans.at(-1)).toEqual({ astPath: "steps[4]", start: 55, end: 59 });
  });

  it("compile() attaches nodeId/bindingId to each binding and stamps versions", () => {
    const result = compile(template([{ kind: "legacy", text: "institutions|count" }]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.template.expressionLanguageVersion).toBe("expr-1");
    expect(result.template.modelVersion).toBe("0");
    expect(result.template.bindings.b0).toMatchObject({
      nodeId: "d0",
      bindingId: "b0",
      styleInheritance: "inherit-paragraph",
    });
  });
});

describe("compile-time diagnostics", () => {
  it("EXPRESSION_UNSUPPORTED for sum/average/groupBy and arithmetic, located to the node and step", () => {
    const result = compile(
      template([
        { kind: "legacy", text: "orders|sum:amount" },
        { kind: "legacy", text: "orders|groupBy:region" },
        { kind: "legacy", text: "a + b" },
        { kind: "structured", source: "orders", steps: [{ op: "sort", key: "a[b]" }] },
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((d) => [d.code, d.nodeId, d.bindingId, d.phase])).toEqual([
      ["EXPRESSION_UNSUPPORTED", "d0", "b0", "compile"],
      ["EXPRESSION_UNSUPPORTED", "d1", "b1", "compile"],
      ["EXPRESSION_UNSUPPORTED", "d2", "b2", "compile"],
      ["EXPRESSION_UNSUPPORTED", "d3", "b3", "compile"],
    ]);
    expect(result.diagnostics[0]?.details).toMatchObject({
      operation: "sum",
      step: "sum:amount",
      astPath: "steps[0]",
      span: { start: 7, end: 17 },
      expression: "orders|sum:amount",
    });
  });

  it("FORMAT_PATTERN_UNSUPPORTED for patterns outside the declared subset", () => {
    const bad = [
      "format:number:0.00;(0.00)",
      "format:number:0.00E+00",
      "format:number:#,",
      "format:number",
      "format:date:d",
      "format:date:yyyy-MM-dd tt",
      "format:date:MMM d",
      "format:percent:0.00‰",
    ];
    const result = compile(template(bad.map((step) => ({ kind: "legacy", text: `x|${step}` }))));
    expect(result.ok).toBe(false);
    expect(new Set(result.diagnostics.map((d) => d.code))).toEqual(
      new Set(["FORMAT_PATTERN_UNSUPPORTED"]),
    );
    expect(result.diagnostics).toHaveLength(bad.length);
  });

  it("accepts the declared subset (number, percent/permille suffix, CJK date literals, colon time)", () => {
    const good = [
      "format:number:#,##0",
      "format:number:0.00",
      "format:number:0.00%",
      "format:number:0.00‰",
      "format:number:¥#,##0.00元",
      "format:percent",
      "format:percent:0.00",
      "format:permille:0.00",
      "format:date:yyyy-MM-dd",
      "format:date:yyyy年M月",
      "format:date:M月",
      "format:date:yyyy-MM-dd HH:mm:ss",
    ];
    const result = compile(template(good.map((step) => ({ kind: "legacy", text: `x|${step}` }))));
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("unknown format kind is EXPRESSION_UNSUPPORTED (not a pattern problem)", () => {
    expect(() => compileExpression({ kind: "legacy", text: "x|format:currency:0.00" })).toThrow(
      ExpressionCompileError,
    );
    try {
      compileExpression({ kind: "legacy", text: "x|format:currency:0.00" });
    } catch (error) {
      expect((error as ExpressionCompileError).code).toBe("EXPRESSION_UNSUPPORTED");
    }
  });

  it("model errors surface first and stop compilation", () => {
    const result = compile({ not: "a template" });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.every((d) => d.code === "MODEL_INVALID" && d.phase === "model")).toBe(
      true,
    );
  });
});

describe("format pattern parsers", () => {
  it("parses number patterns into a structured description", () => {
    expect(parseNumberPattern("¥#,##0.00元")).toEqual({
      kind: "number",
      prefix: "¥",
      suffix: "元",
      integerMinDigits: 1,
      grouping: true,
      fractionMinDigits: 2,
      fractionMaxDigits: 2,
      scaleExponent: 0,
    });
    expect(parseNumberPattern("0.##%")).toMatchObject({
      fractionMinDigits: 0,
      fractionMaxDigits: 2,
      scaleExponent: 2,
      suffix: "%",
    });
  });

  it("parses date patterns into fields and literals", () => {
    expect(parseDatePattern("yyyy年M月")).toEqual({
      kind: "date",
      tokens: [
        { kind: "field", field: "yyyy" },
        { kind: "literal", text: "年" },
        { kind: "field", field: "M" },
        { kind: "literal", text: "月" },
      ],
    });
  });
});

describe("parent scope paths and structure bindings (issue 05)", () => {
  it("`^`, `^^.a[0]` compile to parent PathRefs and round-trip through the canonical text", () => {
    expect(compileExpression({ kind: "legacy", text: "^" }).ast.source).toEqual({
      scope: "parent",
      hops: 1,
      segments: [],
    });
    const deep = compileExpression({ kind: "legacy", text: "^^.items[0]|get:name" });
    expect(deep.ast.source).toEqual({
      scope: "parent",
      hops: 2,
      segments: [
        { kind: "property", name: "items" },
        { kind: "index", index: 0 },
      ],
    });
    const structured = compileExpression({
      kind: "structured",
      source: "^^.items[0]",
      steps: [{ op: "get", path: "name" }],
    });
    expect(structured.ast).toEqual(deep.ast);
    expect(structured.sourceMap.legacyText).toBe("^^.items[0]|get:name");
    expect(compileExpression({ kind: "legacy", text: "^[1]" }).sourceMap.legacyText).toBe("^[1]");
    expect(() => compileExpression({ kind: "legacy", text: "^name" })).toThrow(
      ExpressionCompileError,
    );
  });

  it("compiles ConditionalBlock / RepeatBlock / RepeatRowGroup expressions into role-tagged bindings", () => {
    const source: TemplateSource = {
      ...template([]),
      body: [
        {
          kind: "conditional-block",
          nodeId: "c1",
          bindingId: "cond",
          expression: { kind: "legacy", text: "flags.show" },
          children: [
            {
              kind: "repeat-block",
              nodeId: "r1",
              bindingId: "rows",
              expression: { kind: "legacy", text: "items|sort:score:desc|take:3" },
              repeatKey: { kind: "path", path: "meta.id" },
              children: [
                {
                  kind: "table",
                  nodeId: "tbl",
                  rows: [
                    {
                      kind: "repeat-row-group",
                      nodeId: "rg",
                      bindingId: "cells",
                      expression: { kind: "structured", source: "values", steps: [] },
                      repeatKey: { kind: "ordinal", orderDependentIdentity: true },
                      rows: [
                        {
                          kind: "table-row",
                          nodeId: "row",
                          cells: [
                            {
                              kind: "table-cell",
                              nodeId: "cell",
                              blocks: [
                                {
                                  kind: "paragraph",
                                  nodeId: "p",
                                  inlines: [
                                    {
                                      kind: "dynamic-text",
                                      nodeId: "d",
                                      bindingId: "v",
                                      expression: { kind: "legacy", text: "." },
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    if (!result.ok) throw new Error("compile");
    const { bindings } = result.template;
    expect(Object.keys(bindings).sort()).toEqual(["cells", "cond", "rows", "v"]);
    expect(bindings.cond).toMatchObject({ role: "conditional-block", nodeId: "c1" });
    expect(bindings.rows).toMatchObject({
      role: "repeat-block",
      nodeId: "r1",
      repeatKey: {
        kind: "path",
        text: "meta.id",
        segments: [
          { kind: "property", name: "meta" },
          { kind: "property", name: "id" },
        ],
      },
    });
    expect(bindings.rows?.ast.steps.map((s) => s.op)).toEqual(["sort", "take"]);
    expect(bindings.cells).toMatchObject({
      role: "repeat-row-group",
      repeatKey: { kind: "ordinal" },
    });
    expect(bindings.v).toMatchObject({
      role: "dynamic-text",
      styleInheritance: "inherit-paragraph",
    });
  });

  it("locates expression errors inside structure nodes to the structure node's ids", () => {
    const source: TemplateSource = {
      ...template([]),
      body: [
        {
          kind: "repeat-block",
          nodeId: "r1",
          bindingId: "rows",
          expression: { kind: "legacy", text: "items|groupBy:region" },
          repeatKey: { kind: "ordinal", orderDependentIdentity: true },
          children: [],
        },
      ],
    };
    const result = compile(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "EXPRESSION_UNSUPPORTED",
        phase: "compile",
        nodeId: "r1",
        bindingId: "rows",
        details: expect.objectContaining({ operation: "groupBy" }),
      }),
    ]);
  });
});
