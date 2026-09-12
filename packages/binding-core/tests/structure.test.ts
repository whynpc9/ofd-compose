import { compile } from "@ofd-compose/template-compiler";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import {
  bind,
  cellText,
  instanceIdentity,
  type JsonValue,
  ResolvedDocumentSchema,
  type ResolvedTable,
  temporalPolyfillVersion,
} from "../src/index.js";
import { build, codesOf, renderLines, renderTemplate } from "./helpers.js";

/** 取模板正文中第 index 个块的 nodeId / bindingId（结构节点）。 */
function idsOf(template: { body: readonly unknown[] }, ...indexes: number[]) {
  let node: unknown = { children: template.body };
  for (const i of indexes) {
    const children =
      (node as { children?: unknown[]; rows?: unknown[] }).children ??
      (node as { rows?: unknown[] }).rows;
    node = children?.[i];
  }
  const n = node as { nodeId: string; bindingId: string };
  return { nodeId: n.nodeId, bindingId: n.bindingId };
}

const orders: JsonValue = {
  title: "Report",
  orders: [
    { id: "ORD-1", amount: 120.5, lines: [{ sku: "A" }, { sku: "B" }] },
    { id: "ORD-2", amount: 80, lines: [{ sku: "C" }] },
  ],
};

describe("RepeatBlock", () => {
  it("expands one copy of its children per item, flattened into the parent with instancePath", () => {
    const template = build((b) => [
      b.p("Items"),
      b.repeat("orders", [b.p("- {id}: {amount}")], { kind: "path", path: "id" }),
      b.p("End"),
    ]);
    const { document, diagnostics, texts } = renderTemplate(template, orders);
    expect(diagnostics).toEqual([]);
    expect(texts).toEqual(["Items", "- ORD-1: 120.5", "- ORD-2: 80", "End"]);

    const rep = idsOf(template, 1);
    const [, first, second, end] = document.body;
    expect(first?.instancePath).toEqual([
      {
        ...rep,
        key: "ORD-1",
        keyKind: "path",
        ordinal: 0,
        dataPath: "orders[0]",
      },
    ]);
    expect(second?.instancePath?.[0]).toMatchObject({
      key: "ORD-2",
      ordinal: 1,
      dataPath: "orders[1]",
    });
    expect(instanceIdentity(second?.instancePath)).toBe(`${rep.nodeId}=ORD-2`);
    expect(end?.instancePath).toBeUndefined();
    // 同一模板节点的两个实例：nodeId 相同，身份由 instancePath 区分。
    expect(first?.nodeId).toBe(second?.nodeId);

    expect(document.structure.repeats).toEqual([
      {
        ...rep,
        kind: "repeat-block",
        expression: "orders",
        valueState: "value",
        dataPath: "orders",
        instanceCount: 2,
      },
    ]);
    expect(Value.Check(ResolvedDocumentSchema, document)).toBe(true);
  });

  it("can be driven by a sort/take expression; instance dataPaths keep the original indices", () => {
    const template = build((b) => [b.repeat("orders|sort:amount:asc|take:1", [b.p("{id}")])]);
    const { document, texts } = renderTemplate(template, orders);
    expect(texts).toEqual(["ORD-2"]);
    expect(document.body[0]?.instancePath?.[0]).toMatchObject({
      key: "0",
      keyKind: "ordinal",
      ordinal: 0,
      dataPath: "orders[1]",
    });
    expect(document.structure.repeats[0]).toMatchObject({
      expression: "orders|sort:amount:asc|take:1",
      instanceCount: 1,
    });
  });

  it("nested scopes: `.` is the current item, `^` the parent item, `$` the root (strict-1, no fallback)", () => {
    const template = build((b) => [
      b.repeat("orders", [b.repeat("lines", [b.p("{$.title}/{^.id}/{sku}/{.sku}/{^^.title}")])]),
    ]);
    const { diagnostics, texts, document } = renderTemplate(template, orders);
    expect(diagnostics).toEqual([]);
    expect(texts).toEqual([
      "Report/ORD-1/A/A/Report",
      "Report/ORD-1/B/B/Report",
      "Report/ORD-2/C/C/Report",
    ]);
    const outer = idsOf(template, 0);
    const inner = idsOf(template, 0, 0);
    expect(
      document.body[1]?.instancePath?.map((i) => `${i.nodeId}:${i.key}@${i.dataPath}`),
    ).toEqual([`${outer.nodeId}:0@orders[0]`, `${inner.nodeId}:1@orders[0].lines[1]`]);
    const fragment = document.body[2];
    if (fragment?.kind !== "paragraph") throw new Error("paragraph");
    // 嵌套作用域内的 dataPath 是绝对路径（诊断可直接定位到数据）。
    expect(
      fragment.fragments.map((f) =>
        f.kind === "text" && f.origin.kind === "dynamic-text" ? f.origin.dataPath : "",
      ),
    ).toEqual([
      "$.title",
      "",
      "orders[1].id",
      "",
      "orders[1].lines[0].sku",
      "",
      "orders[1].lines[0].sku",
      "",
      "$.title",
    ]);
  });

  it("strict-1: an implicit path is resolved against the current item only; legacy-compat-1 backtracks and flags it", () => {
    const template = build((b) => [b.repeat("orders", [b.p("{title}")])]);
    const strict = renderTemplate(template, orders, { policy: "strict-1" });
    expect(strict.texts).toEqual(["", ""]);
    expect(codesOf(strict.diagnostics)).toEqual([
      ["BINDING_MISSING", "error", "orders[0].title", undefined],
      ["BINDING_MISSING", "error", "orders[1].title", undefined],
    ]);

    const legacy = renderTemplate(template, orders, { policy: "legacy-compat-1" });
    expect(legacy.texts).toEqual(["Report", "Report"]);
    expect(codesOf(legacy.diagnostics)).toEqual([
      ["LEGACY_SEMANTIC_CHANGE", "info", "title", "scope-fallback"],
      ["LEGACY_SEMANTIC_CHANGE", "info", "title", "scope-fallback"],
    ]);
  });

  it("`^` beyond the outermost scope is Missing (BINDING_MISSING with the expression as path)", () => {
    const r = renderLines(["{^.title}"], orders, "strict-1");
    expect(r.texts).toEqual([""]);
    expect(codesOf(r.diagnostics)).toEqual([["BINDING_MISSING", "error", "^.title", undefined]]);
  });

  it("empty array and explicit null both produce zero instances without diagnostics; Missing is reported", () => {
    const template = build((b) => [b.p("A"), b.repeat("items", [b.p("x")]), b.p("B")]);
    for (const data of [{ items: [] }, { items: null }]) {
      const r = renderTemplate(template, data, { policy: "strict-1" });
      expect(r.texts, JSON.stringify(data)).toEqual(["A", "B"]);
      expect(r.diagnostics, JSON.stringify(data)).toEqual([]);
      expect(r.document.structure.repeats[0]?.instanceCount).toBe(0);
    }
    const missing = renderTemplate(template, {}, { policy: "strict-1" });
    expect(missing.texts).toEqual(["A", "B"]);
    expect(codesOf(missing.diagnostics)).toEqual([
      ["BINDING_MISSING", "error", "items", undefined],
    ]);
    expect(missing.document.structure.repeats[0]).toMatchObject({
      valueState: "missing",
      instanceCount: 0,
    });

    // legacy-compat-1：旧引擎把缺失当 null → 零次；标记而不是警告。
    const legacyMissing = renderTemplate(template, {}, { policy: "legacy-compat-1" });
    expect(legacyMissing.texts).toEqual(["A", "B"]);
    expect(codesOf(legacyMissing.diagnostics)).toEqual([
      ["LEGACY_SEMANTIC_CHANGE", "info", "items", "missing-as-null"],
    ]);
  });

  it("strict-1 requires an array; legacy-compat-1 loops once over a truthy non-array and skips a falsy one", () => {
    const template = build((b) => [b.repeat("patient", [b.p("{name}")])]);
    const strict = renderTemplate(template, { patient: { name: "Alice" } }, { policy: "strict-1" });
    expect(strict.texts).toEqual([]);
    expect(codesOf(strict.diagnostics)).toEqual([
      ["EXPRESSION_UNSUPPORTED", "error", "patient", "repeat-non-array"],
    ]);

    const once = renderTemplate(
      template,
      { patient: { name: "Alice" } },
      { policy: "legacy-compat-1" },
    );
    expect(once.texts).toEqual(["Alice"]);
    expect(codesOf(once.diagnostics)).toEqual([
      ["LEGACY_SEMANTIC_CHANGE", "info", "patient", "repeat-non-array-once"],
    ]);
    expect(once.document.body[0]?.instancePath?.[0]).toMatchObject({
      dataPath: "patient",
      key: "0",
    });

    for (const falsy of [false, 0, "", "  "]) {
      const skipped = renderTemplate(template, { patient: falsy }, { policy: "legacy-compat-1" });
      expect(skipped.texts, String(falsy)).toEqual([]);
      expect(codesOf(skipped.diagnostics), String(falsy)).toEqual([
        ["LEGACY_SEMANTIC_CHANGE", "info", "patient", "repeat-non-array-skipped"],
      ]);
    }
    // 旧 truthiness："false" 字符串为真 → 循环一次（同时标记字符串 truthiness 差异由 if/条件块覆盖）。
    const stringFalse = renderTemplate(
      template,
      { patient: "false" },
      { policy: "legacy-compat-1" },
    );
    expect(stringFalse.texts).toEqual([""]);
  });

  it("inserted strings are data: `{…}` produced by a repeat item is never scanned as a tag", () => {
    const template = build((b) => [b.repeat("items", [b.p("[{label}]")])]);
    const r = renderTemplate(template, { items: [{ label: "{#items}{label}{/items}" }] });
    expect(r.texts).toEqual(["[{#items}{label}{/items}]"]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("repeat keys (instance identity = template nodeId + key)", () => {
  it("duplicate path keys are REPEAT_KEY_INVALID (rule duplicate), located to the second instance", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{v}")], { kind: "path", path: "k" })]);
    const r = renderTemplate(template, {
      xs: [
        { k: "a", v: 1 },
        { k: "b", v: 2 },
        { k: "a", v: 3 },
      ],
    });
    expect(r.texts).toEqual(["1", "2", "3"]);
    expect(r.ok).toBe(false);
    const rep = idsOf(template, 0);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "REPEAT_KEY_INVALID",
        severity: "error",
        phase: "bind",
        ...rep,
        dataPath: "xs[2].k",
        details: { rule: "duplicate", repeatKey: "k", key: "a", firstOrdinal: 0, ordinal: 2 },
      }),
    ]);
    expect(r.document.body.map((blk) => instanceIdentity(blk.instancePath))).toEqual(
      ["a", "b", "a"].map((k) => `${rep.nodeId}=${k}`),
    );
  });

  it("missing keys are BINDING_MISSING; null / non-scalar keys are REPEAT_KEY_INVALID; the ordinal is the fallback", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{v}")], { kind: "path", path: "meta.k" })]);
    const r = renderTemplate(template, {
      xs: [
        { v: 1, meta: {} },
        { v: 2, meta: { k: null } },
        { v: 3, meta: { k: [1] } },
        { v: 4, meta: { k: 7 } },
      ],
    });
    expect(codesOf(r.diagnostics)).toEqual([
      ["BINDING_MISSING", "error", "xs[0].meta.k", undefined],
      ["REPEAT_KEY_INVALID", "error", "xs[1].meta.k", "null"],
      ["REPEAT_KEY_INVALID", "error", "xs[2].meta.k", "non-scalar"],
    ]);
    expect(r.document.body.map((blk) => blk.instancePath?.[0]?.key)).toEqual([
      "#0",
      "#1",
      "#2",
      "7",
    ]);
  });

  it("a legitimate key that collides with a fallback identity is still reported as duplicate", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{v}")], { kind: "path", path: "k" })]);
    const r = renderTemplate(template, { xs: [{ v: 1, k: "#1" }, { v: 2 }] });
    expect(codesOf(r.diagnostics)).toEqual([
      ["BINDING_MISSING", "error", "xs[1].k", undefined],
      ["REPEAT_KEY_INVALID", "error", "xs[1].k", "duplicate"],
    ]);
  });

  it("ordinal keys are the position and are marked keyKind ordinal (order-dependent identity)", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{.}")])]);
    const r = renderTemplate(template, { xs: ["b", "a"] });
    const rep = idsOf(template, 0);
    expect(r.texts).toEqual(["b", "a"]);
    expect(r.document.body.map((blk) => blk.instancePath?.[0])).toEqual([
      { ...rep, key: "0", keyKind: "ordinal", ordinal: 0, dataPath: "xs[0]" },
      { ...rep, key: "1", keyKind: "ordinal", ordinal: 1, dataPath: "xs[1]" },
    ]);
  });

  it("the template must acknowledge order dependence for ordinal keys and give a parseable key path", () => {
    const noAck = build((b) => [b.repeat("xs", [b.p("x")])]);
    const rep = noAck.body[0];
    if (rep?.kind !== "repeat-block") throw new Error("fixture");
    (rep as { repeatKey: unknown }).repeatKey = { kind: "ordinal" };
    expect(compile(noAck).diagnostics[0]?.code).toBe("MODEL_INVALID");

    const badPath = build((b) => [b.repeat("xs", [b.p("x")], { kind: "path", path: "a + b" })]);
    const c = compile(badPath);
    expect(c.ok).toBe(false);
    expect(c.diagnostics).toEqual([
      expect.objectContaining({
        code: "EXPRESSION_UNSUPPORTED",
        phase: "compile",
        ...idsOf(badPath, 0),
      }),
    ]);
  });
});

describe("ConditionalBlock", () => {
  const template = build((b) => [
    b.p("Header"),
    b.cond("flags.showVip", [b.p("VIP Section"), b.p("{flags.tier}")]),
    b.p("Footer"),
  ]);

  it("shows its children in place when truthy and leaves no empty paragraph when falsy", () => {
    const shown = renderTemplate(template, { flags: { showVip: true, tier: "gold" } });
    expect(shown.texts).toEqual(["Header", "VIP Section", "gold", "Footer"]);
    expect(shown.diagnostics).toEqual([]);
    expect(shown.document.structure.conditionals).toEqual([
      {
        ...idsOf(template, 1),
        expression: "flags.showVip",
        visible: true,
        valueState: "value",
        dataPath: "flags.showVip",
      },
    ]);

    const hidden = renderTemplate(template, { flags: { showVip: false } });
    expect(hidden.texts).toEqual(["Header", "Footer"]);
    expect(hidden.diagnostics).toEqual([]); // 隐藏分支内的 {flags.tier} 不求值
    expect(hidden.document.structure.conditionals[0]).toMatchObject({ visible: false });
  });

  it.each([
    [null, false],
    [0, false],
    ["", false],
    [[], false],
    [{}, false],
    ["false", false],
    ["0", false],
    [1, true],
    ["yes", true],
    [[0], true],
  ])(
    "strict-1 truthiness of %j → visible %s (declared table, not JS truthiness)",
    (value, visible) => {
      const r = renderTemplate(template, { flags: { showVip: value as JsonValue, tier: "t" } });
      expect(r.texts).toEqual(
        visible ? ["Header", "VIP Section", "t", "Footer"] : ["Header", "Footer"],
      );
      expect(r.diagnostics).toEqual([]);
    },
  );

  it("Missing: strict-1 hides the block and reports BINDING_MISSING; legacy-compat-1 hides it as null and flags the change", () => {
    const strict = renderTemplate(template, {}, { policy: "strict-1" });
    expect(strict.texts).toEqual(["Header", "Footer"]);
    expect(codesOf(strict.diagnostics)).toEqual([["BINDING_MISSING", "error", "flags", undefined]]);
    expect(strict.document.structure.conditionals[0]).toMatchObject({
      visible: false,
      valueState: "missing",
    });

    const legacy = renderTemplate(template, {}, { policy: "legacy-compat-1" });
    expect(legacy.texts).toEqual(["Header", "Footer"]);
    expect(codesOf(legacy.diagnostics)).toEqual([
      ["LEGACY_SEMANTIC_CHANGE", "info", "flags", "missing-as-null"],
    ]);
    expect(legacy.document.structure.conditionals[0]).toMatchObject({
      visible: false,
      valueState: "null",
    });
  });

  it('legacy-compat-1 treats "false" / "0" strings as truthy and flags string-truthiness', () => {
    const r = renderTemplate(
      template,
      { flags: { showVip: "false", tier: "t" } },
      { policy: "legacy-compat-1" },
    );
    expect(r.texts).toEqual(["Header", "VIP Section", "t", "Footer"]);
    expect(codesOf(r.diagnostics)).toEqual([
      ["LEGACY_SEMANTIC_CHANGE", "info", "flags.showVip", "string-truthiness"],
    ]);
  });

  it("conditions may use pipeline operations (count, sort/first…) and nest inside repeats", () => {
    const t = build((b) => [
      b.repeat("orders", [
        b.cond("lines|count", [b.p("{id} has lines")]),
        b.cond("^.title", [b.p("titled")]),
      ]),
    ]);
    const r = renderTemplate(t, {
      ...orders,
      orders: [...(orders as { orders: JsonValue[] }).orders, { id: "ORD-3", lines: [] }],
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.texts).toEqual(["ORD-1 has lines", "titled", "ORD-2 has lines", "titled", "titled"]);
    expect(
      r.document.structure.conditionals.map((c) => [c.visible, c.instancePath?.[0]?.ordinal]),
    ).toEqual([
      [true, 0],
      [true, 0],
      [true, 1],
      [true, 1],
      [false, 2],
      [true, 2],
    ]);
  });
});

describe("Table + RepeatRowGroup", () => {
  const invoice = {
    invoice: {
      lines: [
        { name: "Apple", qty: 2 },
        { name: "Banana", qty: 3 },
      ],
    },
  };

  it("expands the row group per item; header rows carry no instancePath, expanded rows do", () => {
    const template = build((b) => [
      b.table([
        b.row(["Item", "Qty"]),
        b.rowGroup("invoice.lines", [b.row(["{name}", "{qty}"])], { kind: "path", path: "name" }),
        b.row(["Total", "{invoice.lines|count}"]),
      ]),
    ]);
    const { document, diagnostics } = renderTemplate(template, invoice);
    expect(diagnostics).toEqual([]);
    const table = document.body[0] as ResolvedTable;
    expect(table.kind).toBe("table");
    expect(table.rows.map((row) => row.cells.map(cellText))).toEqual([
      ["Item", "Qty"],
      ["Apple", "2"],
      ["Banana", "3"],
      ["Total", "2"],
    ]);
    const group = idsOf(template, 0, 1).nodeId;
    expect(table.rows.map((row) => instanceIdentity(row.instancePath))).toEqual([
      "",
      `${group}=Apple`,
      `${group}=Banana`,
      "",
    ]);
    expect(table.rows[1]?.instancePath?.[0]).toMatchObject({
      dataPath: "invoice.lines[0]",
      keyKind: "path",
    });
    expect(document.structure.repeats).toEqual([
      expect.objectContaining({
        kind: "repeat-row-group",
        expression: "invoice.lines",
        instanceCount: 2,
      }),
    ]);
    expect(Value.Check(ResolvedDocumentSchema, document)).toBe(true);
  });

  it("a row group with several template rows repeats the whole group per item, in order", () => {
    const template = build((b) => [
      b.table([b.rowGroup("invoice.lines", [b.row(["{name}"]), b.row(["qty={qty}"])])]),
    ]);
    const { document } = renderTemplate(template, invoice);
    const table = document.body[0] as ResolvedTable;
    expect(table.rows.map((row) => row.cells.map(cellText).join("|"))).toEqual([
      "Apple",
      "qty=2",
      "Banana",
      "qty=3",
    ]);
    expect(table.rows.map((row) => row.instancePath?.[0]?.ordinal)).toEqual([0, 0, 1, 1]);
  });

  it("tables inside a repeat inherit the instance path; cells may hold conditional blocks", () => {
    const template = build((b) => [
      b.repeat("orders", [
        b.table([
          {
            kind: "table-row",
            nodeId: "row-x",
            cells: [
              {
                kind: "table-cell",
                nodeId: "cell-x",
                blocks: [b.cond("amount", [b.p("{id}")]), b.p("({amount})")],
              },
            ],
          },
        ]),
      ]),
    ]);
    const { document, diagnostics, texts } = renderTemplate(template, orders);
    expect(diagnostics).toEqual([]);
    expect(texts).toEqual(["ORD-1\n(120.5)", "ORD-2\n(80)"]);
    const second = document.body[1] as ResolvedTable;
    const identity = `${idsOf(template, 0).nodeId}=1`;
    expect(instanceIdentity(second.instancePath)).toBe(identity);
    expect(instanceIdentity(second.rows[0]?.instancePath)).toBe(identity);
    expect(
      second.rows[0]?.cells[0]?.blocks.map((blk) => instanceIdentity(blk.instancePath)),
    ).toEqual([identity, identity]);
  });
});

describe("budgets", () => {
  it("REPEAT_LIMIT: instances beyond maxRepeatInstances are not expanded and the repeat is marked truncated", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{.}")]), b.p("after")]);
    const r = renderTemplate(
      template,
      { xs: [1, 2, 3, 4, 5] },
      { bindingPolicy: { budgets: { maxRepeatInstances: 2 } } },
    );
    expect(r.ok).toBe(false);
    expect(r.texts).toEqual(["1", "2", "after"]);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({
        code: "REPEAT_LIMIT",
        severity: "error",
        phase: "bind",
        ...idsOf(template, 0),
        dataPath: "xs",
        details: { limit: "maxRepeatInstances", max: 2, actual: 5 },
      }),
    ]);
    expect(r.document.structure.repeats[0]).toMatchObject({ instanceCount: 2, truncated: true });
  });

  it("REPEAT_LIMIT: the whole-document expanded-node budget stops expansion once, keeping what was produced", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{.}")]), b.p("after")]);
    // 重复块本身 1 + 每个实例：实例 1 + 段落 1 + 片段 1 = 3 个节点。
    const r = renderTemplate(
      template,
      { xs: [1, 2, 3] },
      { bindingPolicy: { budgets: { maxExpandedNodes: 7 } } },
    );
    expect(r.texts).toEqual(["1", "2"]);
    expect(codesOf(r.diagnostics)).toEqual([["REPEAT_LIMIT", "error", undefined, undefined]]);
    expect(r.diagnostics[0]?.details).toEqual({ limit: "maxExpandedNodes", max: 7 });
  });

  it("REPEAT_LIMIT: repeat instances and conditional evaluations themselves count as expanded nodes (structure-only nesting cannot bypass the budget)", () => {
    const template = build((b) => [b.repeat("$.xs", [b.repeat("$.xs", [b.cond("$.flag", [])])])]);
    const xs = Array.from({ length: 300 }, (_, i) => i);
    const r = renderTemplate(
      template,
      { xs, flag: false },
      { bindingPolicy: { budgets: { maxExpandedNodes: 50 } } },
    );
    expect(r.ok).toBe(false);
    expect(codesOf(r.diagnostics)).toEqual([["REPEAT_LIMIT", "error", undefined, undefined]]);
    expect(r.document.structure.conditionals.length).toBeLessThan(50);
    expect(r.document.structure.repeats.length).toBeLessThan(50);
  });

  it("budget exhaustion never emits a table row without cells (ResolvedDocument stays schema-valid)", () => {
    const template = build((b) => [b.table([b.row(["a", "b"])])]);
    for (const max of [1, 2, 3, 4, 5]) {
      const r = renderTemplate(
        template,
        {},
        { bindingPolicy: { budgets: { maxExpandedNodes: max } } },
      );
      expect(Value.Check(ResolvedDocumentSchema, r.document), `maxExpandedNodes=${max}`).toBe(true);
      for (const block of r.document.body) {
        if (block.kind === "table") {
          for (const row of block.rows) expect(row.cells.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("explicit undefined budget/limit fields fall back to the defaults instead of disabling or inverting the budget", () => {
    const template = build((b) => [b.repeat("xs", [b.p("{.}")])]);
    const r = renderTemplate(
      template,
      { xs: [1, 2, 3] },
      {
        bindingPolicy: {
          budgets: {
            maxRepeatInstances: undefined,
            maxExpandedNodes: undefined,
            maxSortOperations: undefined,
          },
        },
        compileOptions: {
          limits: {
            maxExpressionLength: undefined,
            maxPipelineSteps: undefined,
            maxStructureDepth: undefined,
          },
        },
      },
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.texts).toEqual(["1", "2", "3"]);
  });

  it("RESOURCE_LIMIT: sort/maxby/minby operations beyond maxSortOperations fail that expression only", () => {
    const r = renderLines(
      ["{xs|sort:k:asc|first|get:k}", "{xs|maxby:k|get:k}", "{xs|minby:k|get:k}", "{xs|count}"],
      { xs: [{ k: 2 }, { k: 1 }] },
      "strict-1",
    );
    expect(r.diagnostics).toEqual([]);
    const limited = renderTemplate(
      build((b) =>
        [
          "{xs|sort:k:asc|first|get:k}",
          "{xs|maxby:k|get:k}",
          "{xs|minby:k|get:k}",
          "{xs|count}",
        ].map((l) => b.p(l)),
      ),
      { xs: [{ k: 2 }, { k: 1 }] },
      { bindingPolicy: { budgets: { maxSortOperations: 2 } } },
    );
    expect(limited.texts).toEqual(["1", "2", "", "2"]);
    expect(limited.diagnostics).toEqual([
      expect.objectContaining({
        code: "RESOURCE_LIMIT",
        severity: "error",
        nodeId: "d4",
        bindingId: "b4",
        dataPath: "xs",
        details: { limit: "maxSortOperations", max: 2, actual: 3, op: "minby" },
      }),
    ]);
  });

  it("compile-time RESOURCE_LIMIT: expression length, pipeline steps and structure depth", () => {
    const long = build((b) => [b.p(`{${"a".repeat(40)}}`)]);
    expect(compile(long, { limits: { maxExpressionLength: 32 } }).diagnostics).toEqual([
      expect.objectContaining({
        code: "RESOURCE_LIMIT",
        phase: "compile",
        nodeId: "d0",
        bindingId: "b0",
        details: { limit: "maxExpressionLength", actual: 40, max: 32 },
      }),
    ]);

    const steps = build((b) => [b.p("{xs|first|first|first|first}")]);
    expect(compile(steps, { limits: { maxPipelineSteps: 3 } }).diagnostics[0]).toMatchObject({
      code: "RESOURCE_LIMIT",
      details: { limit: "maxPipelineSteps", actual: 4, max: 3 },
    });

    const deep = build((b) => [b.repeat("a", [b.repeat("b", [b.repeat("c", [b.p("x")])])])]);
    const c = compile(deep, { limits: { maxStructureDepth: 2 } });
    expect(c.ok).toBe(false);
    expect(c.diagnostics).toEqual([
      expect.objectContaining({
        code: "RESOURCE_LIMIT",
        phase: "compile",
        ...idsOf(deep, 0, 0, 0),
        details: { limit: "maxStructureDepth", actual: 3, max: 2 },
      }),
    ]);
    expect(compile(deep).ok).toBe(true);
  });
});

describe("unsupported operations", () => {
  it.each([
    "xs|sum:amount",
    "xs|average:amount",
    "xs|groupBy:region",
    "xs|avg",
    "amount * 2",
    "amount + tax",
    "xs|where:amount>1",
    "xs|eval:1",
  ])("%s → EXPRESSION_UNSUPPORTED at compile time", (expression) => {
    const c = compile(build((b) => [b.p(`{${expression}}`)]));
    expect(c.ok).toBe(false);
    expect(c.diagnostics.map((d) => [d.code, d.phase])).toEqual([
      ["EXPRESSION_UNSUPPORTED", "compile"],
    ]);
  });
});

describe("formats added for structure-level cases", () => {
  it("format:date with colon time patterns is one AST node (legacy and structured forms agree)", () => {
    const data = { at: "2026-02-10T16:45:30Z" };
    const legacy = renderLines(
      ["{at|format:date:yyyy-MM-dd HH:mm:ss}", "{at|format:datetime:HH:mm}"],
      data,
      "strict-1",
      {
        timeZone: "Asia/Shanghai",
      },
    );
    expect(legacy.texts).toEqual(["2026-02-11 00:45:30", "00:45"]);

    const structured = build((b) => [b.p("{at}")]);
    const p = structured.body[0];
    const dyn = p?.kind === "paragraph" ? p.inlines[0] : undefined;
    if (dyn?.kind !== "dynamic-text") throw new Error("fixture");
    dyn.expression = {
      kind: "structured",
      source: "at",
      steps: [{ op: "format", kind: "date", pattern: "yyyy-MM-dd HH:mm:ss" }],
    };
    const compiled = compile(structured);
    if (!compiled.ok) throw new Error("compile");
    expect(compiled.template.bindings.b0?.ast.steps).toEqual([
      { op: "format", format: { kind: "date", pattern: "yyyy-MM-dd HH:mm:ss" } },
    ]);
    expect(
      bind(
        {
          ...compiled.template,
          settings: { ...compiled.template.settings, timeZone: "Asia/Shanghai" },
        },
        data,
      ).document.body.map((blk) => (blk.kind === "paragraph" ? blk.fragments : []))[0],
    ).toEqual([expect.objectContaining({ text: "2026-02-11 00:45:30" })]);
  });

  it("percent / permille format the ratio as given (no second multiplication)", () => {
    const r = renderLines(
      [
        "{r|format:percent}",
        "{r|format:percent:0.0%}",
        "{r|format:permille}",
        "{r|format:permille:0}",
      ],
      { r: 0.256 },
    );
    expect(r.texts).toEqual(["25.6%", "25.6%", "256‰", "256‰"]);
  });
});

describe("binding runtime provenance (tzdata)", () => {
  it("records the temporal-polyfill version and the runtime tzdata version (non-semantic provenance)", () => {
    const r = renderLines(["{a}"], { a: 1 });
    expect(r.document.runtime).toEqual({
      temporalPolyfillVersion,
      tzdataSource: "runtime-icu",
      tzdataVersion: expect.stringMatching(/^\d{4}[a-z]$/),
    });
    expect(pkg.dependencies["temporal-polyfill"]).toBe(temporalPolyfillVersion);

    const overridden = renderTemplate(
      build((b) => [b.p("x")]),
      {},
      {
        bindingPolicy: {
          runtime: { temporalPolyfillVersion, tzdataSource: "runtime-icu", tzdataVersion: "2025b" },
        },
      },
    );
    expect(overridden.document.runtime.tzdataVersion).toBe("2025b");
  });
});
