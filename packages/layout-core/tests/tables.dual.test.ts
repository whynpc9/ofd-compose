import { bind, type ResolvedTable } from "@ofd-compose/binding-core";
import type { BlockNode, TemplateSource } from "@ofd-compose/document-model";
import { canonicalSerialize, digestCanonical } from "@ofd-compose/layout-ir";
import { prepareMedia } from "@ofd-compose/media-core";
import { compile } from "@ofd-compose/template-compiler";
import { describe, expect, it } from "vitest";
import mediaFixture from "../../media-core/tests/fixtures.json";
import { layout } from "../src/index.js";
import { document, fonts, options } from "./fixtures.js";

function table(n = 3): ResolvedTable {
  return {
    kind: "table",
    nodeId: "t",
    layout: { headerRows: 1, repeatHeader: true },
    rows: Array.from({ length: n }, (_, r) => ({
      kind: "table-row",
      nodeId: `r${r}`,
      cells: [
        {
          kind: "table-cell",
          nodeId: `c${r}`,
          blocks: [
            {
              kind: "paragraph",
              nodeId: `p${r}`,
              fragments: [
                { kind: "text", text: `Row ${r}`, origin: { kind: "static", nodeId: `text${r}` } },
              ],
            },
          ],
        },
      ],
    })),
  };
}
describe("table layout", () => {
  it("lays out 400 real-font rows exactly once with repeated-header identity", async () => {
    const doc = document([]);
    doc.body = [table(400)];
    const fs = await fonts();
    const a = await layout(doc, fs, options);
    const b = await layout(doc, fs, options);
    expect(canonicalSerialize(a.ir)).toBe(canonicalSerialize(b.ir));
    expect(a.ir.pages.length).toBeGreaterThan(5);
    const body = a.semanticMap.filter((s) => !s.repeatedHeader);
    expect(body).toHaveLength(400);
    expect(body.map((s) => s.table?.row)).toEqual(Array.from({ length: 400 }, (_, i) => i));
    expect(body.map((s) => s.sourceText?.text).join("|")).toBe(
      Array.from({ length: 400 }, (_, i) => `Row ${i}`).join("|"),
    );
    expect(a.semanticMap.filter((s) => s.repeatedHeader)).toHaveLength(a.ir.pages.length - 1);
  });
});

it("resolves shared borders once across rows", async () => {
  const doc = document([]),
    t = table(2);
  t.border = { width: 0.2, color: "#000000" };
  t.layout = {
    columns: [
      { kind: "fixed", value: 30 },
      { kind: "proportional", value: 1 },
    ],
    headerRows: 0,
  };
  for (const [r, row] of t.rows.entries())
    row.cells.push({ kind: "table-cell", nodeId: `extra${r}`, blocks: [] });
  doc.body = [t];
  const out = await layout(doc, await fonts(), options);
  const paths = out.ir.pages.flatMap((p) => p.objects).filter((o) => o.kind === "path");
  expect(paths).toHaveLength(12);
  expect(new Set(paths.map((p) => JSON.stringify(p.commands))).size).toBe(12);
  expect(out.semanticMap.map((s) => s.table?.column)).toEqual([0, 1, 0, 1]);
});
it("preserves empty control geometry in cells", async () => {
  const doc = document([]),
    t = table(2);
  fixtureValue(fixtureValue(t.rows[0]).cells[0]).blocks = [
    {
      kind: "paragraph",
      nodeId: "p",
      fragments: [
        { kind: "input-control", nodeId: "c", controlId: "control", controlType: "text" },
      ],
    },
  ];
  doc.body = [t];
  const out = await layout(doc, await fonts(), options);
  expect(out.ir.markers).toHaveLength(1);
  expect(out.ir.markers[0]?.controlId).toBe("control");
  expect(out.semanticMap[0]?.controlId).toBe("control");
  expect(out.ir.markers[0]?.bounds.y).toBeGreaterThan(20000);
});
it("rejects tall fixed rows and page-spanning merge groups explicitly", async () => {
  const doc = document([]),
    t = table(2);
  fixtureValue(t.rows[0]).layout = { heightMode: "fixed", height: 1 };
  doc.body = [t];
  await expect(layout(doc, await fonts(), options)).rejects.toMatchObject({
    code: "LAYOUT_OVERFLOW",
  });
  fixtureValue(t.rows[0]).layout = { height: 200 };
  fixtureValue(t.rows[1]).layout = { height: 200 };
  fixtureValue(fixtureValue(t.rows[0]).cells[0]).layout = { rowSpan: 2 };
  fixtureValue(t.rows[0]).cells.push({ kind: "table-cell", nodeId: "top-extra", blocks: [] });
  fixtureValue(t.rows[1]).cells = [{ kind: "table-cell", nodeId: "last", blocks: [] }];
  t.layout = {
    columns: [
      { kind: "proportional", value: 1 },
      { kind: "proportional", value: 1 },
    ],
  };
  await expect(layout(doc, await fonts(), options)).rejects.toMatchObject({
    code: "LAYOUT_OVERFLOW",
  });
});
it("keeps a title with the following table's header and first row", async () => {
  const doc = document([]);
  const t = table(5);
  const para = (text: string, nodeId: string, height: number) => ({
    kind: "paragraph" as const,
    nodeId,
    layout: { lineHeight: { kind: "fixed" as const, value: height } },
    fragments: [
      {
        kind: "text" as const,
        text,
        origin: { kind: "static" as const, nodeId: `${nodeId}-text` },
      },
    ],
  });
  doc.body = [
    para("Filler", "filler", 240),
    {
      ...para("Title", "title", 8),
      layout: { keepWithNext: true, lineHeight: { kind: "fixed", value: 8 } },
    },
    t,
  ];
  const out = await layout(doc, await fonts(), options);
  expect(out.lines.find((l) => l.nodeId === "title")?.pageIndex).toBe(1);
  expect(out.semanticMap.find((s) => s.table?.row === 0)?.pageIndex).toBe(1);
  expect(out.semanticMap.find((s) => s.table?.row === 1)?.pageIndex).toBe(1);
});
it("keeps at least two paragraph lines on each side of a page break", async () => {
  const doc = document([]);
  doc.body = [
    {
      kind: "paragraph",
      nodeId: "p",
      layout: { lineHeight: { kind: "fixed", value: 10 }, orphanLines: 2, widowLines: 2 },
      fragments: [{ kind: "text", text: "A\nB\nC\nD", origin: { kind: "static", nodeId: "text" } }],
    },
  ];
  const out = await layout(doc, await fonts(), {
    ...options,
    page: { width: 100, height: 50, contentBox: { x: 10, y: 10, width: 80, height: 30 } },
  });
  expect(out.lines.map((l) => l.pageIndex)).toEqual([0, 0, 1, 1]);
  expect(out.semanticMap).toHaveLength(7);
});

function bound(body: BlockNode[], data: Parameters<typeof bind>[1] = {}) {
  const source: TemplateSource = {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "tables",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body,
  };
  const compiled = compile(source);
  if (!compiled.ok || !compiled.template) throw Error(JSON.stringify(compiled.diagnostics));
  const result = bind(compiled.template, data);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.document;
}
it("binds 400 RepeatRowGroup instances and preserves table, row and cell contracts", async () => {
  const data = {
    items: Array.from({ length: 400 }, (_, i) => ({
      id: `key${i}`,
      name: `机构 ${i} 收入 ${i}.00 元。`,
    })),
  };
  const doc = bound(
    [
      {
        kind: "table",
        nodeId: "t",
        border: { width: 0.2, color: "#222222" },
        layout: {
          columns: [{ kind: "proportional", value: 1 }],
          headerRows: 1,
          repeatHeader: true,
        },
        rows: [
          {
            kind: "table-row",
            nodeId: "header",
            layout: { height: 12, heightMode: "fixed" },
            cells: [
              {
                kind: "table-cell",
                nodeId: "header-cell",
                layout: { background: "#eeeeee", verticalAlign: "middle" },
                blocks: [
                  {
                    kind: "paragraph",
                    nodeId: "header-p",
                    inlines: [{ kind: "text", nodeId: "header-text", text: "机构收入" }],
                  },
                ],
              },
            ],
          },
          {
            kind: "repeat-row-group",
            nodeId: "group",
            bindingId: "group-binding",
            expression: { kind: "legacy", text: "items" },
            repeatKey: { kind: "path", path: "id" },
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
                            nodeId: "value",
                            bindingId: "value-binding",
                            expression: { kind: "legacy", text: "name" },
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
    data,
  );
  const result = await layout(doc, await fonts(), options);
  const business = result.semanticMap.filter((s) => s.repeatInstance && !s.repeatedHeader);
  expect(business).toHaveLength(400);
  expect(business.map((s) => s.repeatInstance?.[0]?.key)).toEqual(data.items.map((i) => i.id));
  expect(business.map((s) => s.sourceText?.text)).toEqual(data.items.map((i) => i.name));
  expect(business.map((s) => s.table?.row)).toEqual(data.items.map((_, i) => i + 1));
  expect(result.semanticMap.filter((s) => s.repeatedHeader).every((s) => !s.repeatInstance)).toBe(
    true,
  );
  expect(digestCanonical(result.ir)).toMatchInlineSnapshot(
    `"8ad91d471f44ee2c5160b7b87a39b881aefb107b63084a5da79fc2eb5c8abfe8"`,
  );
});
it("places frozen media inside cells and retains barcode clipping safeguards in regions", async () => {
  const body: BlockNode[] = [
    {
      kind: "table",
      nodeId: "t",
      rows: [
        {
          kind: "table-row",
          nodeId: "r",
          cells: [
            {
              kind: "table-cell",
              nodeId: "c",
              blocks: [
                {
                  kind: "image-binding",
                  nodeId: "image",
                  bindingId: "ib",
                  expression: { kind: "legacy", text: "image" },
                  options: { width: 20, height: 10, preserveAspectRatio: false },
                },
                {
                  kind: "barcode-binding",
                  nodeId: "code",
                  bindingId: "cb",
                  expression: { kind: "legacy", text: "code" },
                  options: { symbology: "code128", width: 60, height: 15 },
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  const doc = bound(body, { image: mediaFixture.png, code: "ABC123" }),
    prepared = prepareMedia(doc);
  const result = await layout(doc, await fonts(), options, prepared);
  expect(result.semanticMap.map((s) => s.bindingId)).toEqual(["ib", "cb"]);
  const image = fixtureValue(
    result.ir.pages.flatMap((p) => p.objects).find((o) => o.kind === "image"),
  );
  expect(image.bounds).toMatchObject({ width: 20000, height: 10000, x: 21000, y: 21000 });
  const clipped = bound(
    [
      {
        kind: "region",
        nodeId: "region",
        layout: {
          mode: "fixed",
          box: { x: 20, y: 20, width: 100, height: 18 },
          overflow: { kind: "truncate" },
        },
        children: body,
      },
    ],
    { image: mediaFixture.png, code: "ABC123" },
  );
  await expect(
    layout(clipped, await fonts(), options, prepareMedia(clipped)),
  ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
});
it("lays out merged cells with shared segmented edges and bottom alignment", async () => {
  const doc = document([]),
    t = table(2);
  t.layout = {
    columns: [
      { kind: "fixed", value: 30 },
      { kind: "proportional", value: 1 },
    ],
  };
  t.border = { width: 0.2, color: "#000000" };
  const first = t.rows[0],
    second = t.rows[1];
  if (!first || !second || !first.cells[0]) throw Error("fixture");
  first.cells[0].layout = { columnSpan: 2, verticalAlign: "bottom", background: "#dddddd" };
  first.layout = { height: 20, heightMode: "fixed" };
  second.cells.push({ kind: "table-cell", nodeId: "extra", blocks: [] });
  doc.body = [t];
  const out = await layout(doc, await fonts(), options);
  expect(out.semanticMap[0]?.table).toMatchObject({ columnSpan: 2, rowSpan: 1 });
  expect(out.lines[0]?.y).toBeGreaterThan(30);
  const paths = out.ir.pages
    .flatMap((p) => p.objects)
    .filter((o) => o.kind === "path")
    .filter((o) => o.stroke);
  expect(paths).toHaveLength(11);
  expect(new Set(paths.map((p) => JSON.stringify(p.commands))).size).toBe(paths.length);
});
it("accepts a fully covered empty row under a vertical merge", async () => {
  const doc = document([]),
    t = table(2);
  const first = t.rows[0],
    second = t.rows[1];
  if (!first?.cells[0] || !second) throw Error("fixture");
  t.layout = { columns: [{ kind: "proportional", value: 1 }] };
  first.cells[0].layout = { rowSpan: 2 };
  first.layout = { height: 12, heightMode: "fixed" };
  second.layout = { height: 12, heightMode: "fixed" };
  second.cells = [];
  doc.body = [t];
  const out = await layout(doc, await fonts(), options);
  expect(out.semanticMap[0]?.table?.rowSpan).toBe(2);
});
it("rejects excessive span occupancy before waiting for a font", async () => {
  const doc = document([]),
    t = table(1),
    cell = t.rows[0]?.cells[0];
  if (!cell) throw Error("fixture");
  cell.layout = { rowSpan: 10000, columnSpan: 1024 };
  doc.body = [t];
  await expect(
    layout(
      doc,
      [
        {
          family: "Noto",
          weight: 400,
          italic: false,
          sha256: "0".repeat(64),
          bytes: new Promise(() => {}),
        },
      ],
      options,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
});
it("budgets repeated header source text and control-only output", async () => {
  const doc = document([]),
    t = table(400),
    cell = t.rows[0]?.cells[0];
  if (!cell) throw Error("fixture");
  cell.blocks = [
    {
      kind: "paragraph",
      nodeId: "p",
      fragments: [
        { kind: "input-control", nodeId: "c", controlId: "control", controlType: "text" },
      ],
    },
  ];
  if (t.rows[0]) t.rows[0].nodeId = "x".repeat(300000);
  doc.body = [t];
  await expect(
    layout(doc, await fonts(), {
      ...options,
      page: { width: 210, height: 50, contentBox: { x: 20, y: 5, width: 170, height: 40 } },
    }),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
});

function fixtureValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing test fixture value");
  return value;
}

it.each([
  { count: 3, orphan: 2, widow: 2 },
  { count: 5, orphan: 3, widow: 1 },
])(
  "rejects impossible orphan constraints after widow adjustment: %j",
  async ({ count, orphan, widow }) => {
    const doc = document([]);
    doc.body = [
      {
        kind: "paragraph",
        nodeId: "p",
        layout: {
          lineHeight: { kind: "fixed", value: 10 },
          orphanLines: orphan,
          widowLines: widow,
        },
        fragments: [
          {
            kind: "text",
            text: Array(count).fill("A").join("\n"),
            origin: { kind: "static", nodeId: "text" },
          },
        ],
      },
    ];
    await expect(
      layout(doc, await fonts(), {
        ...options,
        page: { width: 100, height: 40, contentBox: { x: 10, y: 10, width: 80, height: 20 } },
      }),
    ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  },
);

it("versions implicit heading pagination in LayoutIdentity", async () => {
  const doc = bound([
    {
      kind: "paragraph",
      nodeId: "heading",
      layout: { role: "heading", headingLevel: 6 },
      inlines: [{ kind: "text", nodeId: "title", text: "Title" }],
    },
    {
      kind: "paragraph",
      nodeId: "body",
      inlines: [{ kind: "text", nodeId: "body-text", text: "Body" }],
    },
  ]);
  const result = await layout(doc, await fonts(), options);
  expect(result.ir.identity.layoutProfile.name).toBe("tables-ltr");
  expect(result.ir.identity.layoutProfile.features).toContain("keep-with-next");
});
it("honors explicitly disabled heading pagination without implicit orphan minima", async () => {
  const doc = bound([
    {
      kind: "paragraph",
      nodeId: "heading",
      layout: {
        role: "heading",
        headingLevel: 6,
        keepWithNext: false,
        lineHeight: { kind: "fixed", value: 10 },
      },
      inlines: [{ kind: "text", nodeId: "title", text: "A\nB\nC" }],
    },
  ]);
  const result = await layout(doc, await fonts(), {
    ...options,
    page: { width: 100, height: 40, contentBox: { x: 10, y: 10, width: 80, height: 20 } },
  });
  expect(result.lines.map((l) => l.pageIndex)).toEqual([0, 0, 1]);
  expect(result.ir.identity.layoutProfile.name).toBe("paragraphs-ltr");
});
it.each(["flow", "fixed"] as const)(
  "keeps headings before valid top-level %s regions",
  async (mode) => {
    const doc = bound([
      {
        kind: "paragraph",
        nodeId: "filler",
        layout: { lineHeight: { kind: "fixed", value: 230 } },
        inlines: [{ kind: "text", nodeId: "filler-text", text: "Filler" }],
      },
      {
        kind: "paragraph",
        nodeId: "heading",
        layout: { role: "heading", headingLevel: 6, lineHeight: { kind: "fixed", value: 8 } },
        inlines: [{ kind: "text", nodeId: "title", text: "Title" }],
      },
      {
        kind: "region",
        nodeId: "region",
        layout: {
          mode,
          box: {
            x: mode === "fixed" ? 20 : 0,
            y: mode === "fixed" ? 30 : 0,
            width: 100,
            height: 24,
          },
        },
        children: [
          {
            kind: "paragraph",
            nodeId: "inside",
            inlines: [{ kind: "text", nodeId: "inside-text", text: "Inside" }],
          },
        ],
      },
    ]);
    const result = await layout(doc, await fonts(), options);
    expect(result.lines.find((l) => l.nodeId === "heading")?.pageIndex).toBe(
      mode === "flow" ? 1 : 0,
    );
    expect(result.lines.find((l) => l.nodeId === "inside")?.pageIndex).toBe(
      mode === "flow" ? 1 : 0,
    );
  },
);
it("measures empty tables locally after an earlier nonempty table", async () => {
  const doc = document([]),
    first = table(1);
  fixtureValue(first.rows[0]).layout = { height: 200, heightMode: "fixed" };
  doc.body = [
    first,
    {
      kind: "paragraph",
      nodeId: "heading",
      layout: { role: "heading", headingLevel: 6, lineHeight: { kind: "fixed", value: 10 } },
      fragments: [{ kind: "text", text: "Title", origin: { kind: "static", nodeId: "title" } }],
    },
    { kind: "table", nodeId: "empty", rows: [] },
  ];
  const result = await layout(doc, await fonts(), options);
  expect(result.ir.pages).toHaveLength(1);
  expect(result.lines.find((l) => l.nodeId === "heading")?.pageIndex).toBe(0);
});
