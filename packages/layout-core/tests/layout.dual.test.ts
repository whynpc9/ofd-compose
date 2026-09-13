import { paragraphText } from "@ofd-compose/binding-core";
import type { CanonicalLayoutIR, TextObject } from "@ofd-compose/layout-ir";
import {
  canonicalSerialize,
  digestCanonical,
  validateCanonicalLayoutIR,
} from "@ofd-compose/layout-ir";
import { beforeAll, expect, it } from "vitest";
import { type LayoutFont, layout, permitsChineseBreak } from "../src/index.js";
import expected from "./expected.json";
import { document, fonts, narrative, options, p } from "./fixtures.js";

let resources: LayoutFont[];
beforeAll(async () => {
  resources = await fonts();
});
const texts = (ir: CanonicalLayoutIR) =>
  ir.pages.flatMap((p) => p.objects).filter((o) => o.kind === "text") as TextObject[];
function extract(ir: CanonicalLayoutIR) {
  const objects = new Map(texts(ir).map((o) => [o.id, o]));
  return ir.semantics.map((s) => objects.get(s.objectId)?.logicalText ?? "").join("");
}
it("shares the pinned complete narrative IR digest in Node and Chromium", async () => {
  const doc = narrative();
  const result = await layout(doc, resources, {
    ...options,
    page: { ...options.page, contentBox: { ...options.page.contentBox, width: 70 } },
  });
  validateCanonicalLayoutIR(result.ir);
  expect(extract(result.ir)).toBe(
    paragraphText(doc.body[0] as Parameters<typeof paragraphText>[0]),
  );
  expect(result.lines.length).toBeGreaterThan(1);
  expect(digestCanonical(result.ir)).toBe(expected.narrative);
  const repeated = await layout(doc, resources, {
    ...options,
    page: { ...options.page, contentBox: { ...options.page.contentBox, width: 70 } },
  });
  expect(canonicalSerialize(repeated.ir)).toBe(canonicalSerialize(result.ir));
  expect(
    result.ir.semantics
      .flatMap((s) => s.sourceRanges ?? [])
      .find((s) => s.bindingId === "name-binding")?.sourceText.text,
  ).toBe("甲公司");
});
it("shapes a ligature across static/dynamic source boundaries with both source ranges", async () => {
  const doc = document(
    [
      {
        kind: "paragraph",
        nodeId: "p",
        styleId: "italic",
        inlines: [
          { kind: "text", nodeId: "first", text: "of" },
          {
            kind: "dynamic-text",
            nodeId: "dynamic",
            bindingId: "binding",
            expression: { kind: "legacy", text: "value" },
          },
        ],
      },
    ],
    { italic: { italic: true } },
    { value: "fice" },
  );
  const { ir } = await layout(doc, resources, options);
  const run = texts(ir)[0];
  expect(run?.logicalText).toBe("office");
  expect(run?.glyphs.length).toBeLessThan(6);
  expect(run?.clusters.some((c) => c.logicalRange.start < 2 && c.logicalRange.end > 2)).toBe(true);
  expect(ir.semantics[0]?.sourceRanges).toHaveLength(2);
  expect(ir.semantics[0]?.sourceRanges?.[1]?.logicalRange).toEqual({ start: 2, end: 6 });
});
it("uses Chinese opening and closing classes and word boundaries over the full paragraph", async () => {
  expect(permitsChineseBreak("甲（ 乙", 3)).toBe(false);
  expect(permitsChineseBreak("甲 ，乙", 1)).toBe(false);
  expect(permitsChineseBreak("甲乙", 1)).toBe(true);
  const content = "甲乙（丙丁）戊己，庚辛。alpha beta gamma delta";
  const result = await layout(document([p(content)]), resources, {
    ...options,
    page: { ...options.page, contentBox: { ...options.page.contentBox, width: 27 } },
  });
  for (const line of result.lines.slice(0, -1)) {
    expect(permitsChineseBreak(content, line.end)).toBe(true);
    expect(/[a-z][a-z]/u.test(content.slice(line.end - 1, line.end + 1))).toBe(false);
  }
  expect(extract(result.ir)).toBe(content);
});
it("lays out tabs, CRLF, blank paragraphs and terminal breaks without losing logical controls", async () => {
  const content = "A\tB\r\nC\n";
  const { ir, lines } = await layout(
    document([p(content, "p", { tabStops: [20] })]),
    resources,
    options,
  );
  expect(extract(ir)).toBe(content);
  const b = texts(ir).find((t) => t.logicalText === "B");
  expect(b?.baseline.x).toBe(40000);
  expect(lines).toHaveLength(3);
  const blank = await layout(document([p("", "blank")]), resources, options);
  expect(blank.lines[0]?.height).toBeGreaterThan(0);
});
it("applies left/center/right/justify, hanging indents, paragraph spacing and fixed line heights", async () => {
  const base = await layout(document([p("甲乙")]), resources, options);
  for (const alignment of ["center", "right"] as const) {
    const result = await layout(document([p("甲乙", "p", { alignment })]), resources, options);
    const b = base.lines[0],
      r = result.lines[0];
    expect(b && r).toBeTruthy();
    expect(r?.x).toBeCloseTo(20 + (170 - (b?.width ?? 0)) / (alignment === "center" ? 2 : 1));
  }
  const content = "甲乙丙丁戊己庚辛壬癸甲乙丙丁";
  const result = await layout(
    document([
      p(content, "p", {
        leftIndent: 8,
        firstLineIndent: -4,
        alignment: "justify",
        lineHeight: { kind: "fixed", value: 12 },
        spaceBefore: 3,
        spaceAfter: 4,
      }),
      p("尾", "end"),
    ]),
    resources,
    {
      ...options,
      page: { ...options.page, contentBox: { ...options.page.contentBox, width: 35 } },
    },
  );
  expect(result.lines[0]?.x).toBe(24);
  expect(result.lines[1]?.x).toBe(28);
  expect(result.lines[0]?.height).toBe(12);
  expect(result.lines[0]?.y).toBe(23);
  expect(result.lines[0]?.width).toBe(31);
  const last = result.lines.at(-1),
    before = result.lines.at(-2);
  expect(last?.y).toBeCloseTo((before?.y ?? 0) + 12 + 4);
});
it("emits real font instances, superscript/subscript, color, highlight and link decorations", async () => {
  const doc = document(
    [
      {
        ...p("", "p"),
        inlines: [
          { kind: "text", nodeId: "a", text: "Bold", styleId: "bold" },
          { kind: "text", nodeId: "b", text: "Italic", styleId: "italic" },
          { kind: "text", nodeId: "c", text: "2", styleId: "sup" },
          { kind: "text", nodeId: "d", text: "3", styleId: "sub" },
        ],
      },
    ],
    {
      bold: {
        bold: true,
        color: "#ff0000",
        highlight: "#ffff00",
        underline: true,
        strikethrough: true,
        link: "https://example.com",
      },
      italic: { italic: true },
      sup: { verticalAlign: "superscript" },
      sub: { verticalAlign: "subscript" },
    },
  );
  const { ir } = await layout(doc, resources, options);
  const runs = texts(ir);
  expect(ir.resources.find((r) => r.id === runs[0]?.fontId)).toMatchObject({
    weight: 700,
    style: "normal",
  });
  expect(ir.resources.find((r) => r.id === runs[1]?.fontId)).toMatchObject({
    weight: 400,
    style: "italic",
  });
  expect(runs[2]?.fontSize).toBeLessThan(runs[0]?.fontSize ?? 0);
  expect(runs[2]?.baseline.y).toBeLessThan(runs[0]?.baseline.y ?? 0);
  expect(runs[3]?.baseline.y).toBeGreaterThan(runs[0]?.baseline.y ?? 0);
  expect(ir.pages[0]?.objects.filter((o) => o.kind === "path")).toHaveLength(3);
  expect(ir.semantics[0]?.link).toBe("https://example.com");
  expect(ir.graphicsStates.some((s) => s.fillColor.r === 1 && s.fillColor.g === 0)).toBe(true);
});
it("preserves heading and numbering through binding, with stable list continuation and restart", async () => {
  const doc = document([
    p("标题", "heading", { role: "heading", headingLevel: 2 }),
    p("甲", "one", { role: "list-item", numbering: { listId: "list", format: "decimal" } }),
    p("乙", "two", { role: "list-item", numbering: { listId: "list", format: "decimal" } }),
    p("丙", "restart", { numbering: { listId: "list", format: "upper-alpha", start: 27 } }),
  ]);
  expect(doc.body[0]).toMatchObject({ layout: { role: "heading", headingLevel: 2 } });
  const { ir } = await layout(doc, resources, options);
  expect(texts(ir).map((t) => t.logicalText)).toEqual([
    "标题",
    "1. ",
    "甲",
    "2. ",
    "乙",
    "AA. ",
    "丙",
  ]);
  expect(extract(ir)).toBe("标题甲乙丙");
  expect(texts(ir)[0]?.fontSize).toBe(7056);
});
it("waits for every font before shaping; reverse resource order/arrival yields the same digest", async () => {
  const regular = resources[0];
  if (!regular) throw new Error("Missing fixture");
  let release: (value: Uint8Array) => void = () => {};
  let done = false;
  const delayed = resources.map((font, index) =>
    index === 0
      ? {
          ...font,
          bytes: new Promise<Uint8Array>((resolve) => {
            release = resolve;
          }),
        }
      : font,
  );
  const pending = layout(narrative(), delayed, options).then((result) => {
    done = true;
    return result;
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(done).toBe(false);
  release(await regular.bytes);
  const first = await pending,
    second = await layout(narrative(), [...resources].reverse(), options);
  expect(digestCanonical(first.ir)).toBe(digestCanonical(second.ir));
});
it("respects explicit dynamic style inheritance and preserves repeat identities", async () => {
  const doc = document(
    [
      {
        ...p("", "p"),
        styleId: "bold",
        inlines: [
          {
            kind: "dynamic-text",
            nodeId: "d",
            bindingId: "b",
            expression: { kind: "legacy", text: "value" },
            styleInheritance: "explicit",
          },
        ],
      },
    ],
    { bold: { bold: true } },
    { value: "plain" },
  );
  const paragraph = doc.body[0];
  if (paragraph?.kind !== "paragraph") throw new Error("Expected paragraph");
  paragraph.instancePath = [
    { nodeId: "repeat", bindingId: "rb", key: "甲", keyKind: "path", ordinal: 0 },
  ];
  const { ir } = await layout(doc, resources, options);
  expect(ir.resources.find((r) => r.id === texts(ir)[0]?.fontId)).toMatchObject({ weight: 400 });
  expect(ir.semantics[0]?.repeatInstance).toEqual([{ nodeId: "repeat", key: "甲" }]);
});
it("rejects missing faces, unsupported controls, invalid text, unbreakable words and page overflow", async () => {
  await expect(layout(document([p("中文")]), [], options)).rejects.toMatchObject({
    code: "FONT_UNAVAILABLE",
  });
  await expect(
    layout(document([p("averylongunbreakableword")]), resources, {
      ...options,
      page: { ...options.page, contentBox: { ...options.page.contentBox, width: 2 } },
    }),
  ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  await expect(
    layout(document([p("甲")]), resources, {
      ...options,
      page: { ...options.page, contentBox: { ...options.page.contentBox, height: 1 } },
    }),
  ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  await expect(layout(document([p("\ud800")]), resources, options)).rejects.toMatchObject({
    code: "LAYOUT_INPUT",
  });
  await expect(
    layout(
      document([p("甲", "p", { lineHeight: { kind: "fixed", value: 1 } })]),
      resources,
      options,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  await expect(
    layout(document([p("甲", "p", { tabStops: [20, 10] })]), resources, options),
  ).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
});
it("keeps astral/combining clusters intact and supports bullet labels", async () => {
  const doc = document([
    p("𠮷甲 a\u0301", "p"),
    p("item", "bullet", { role: "list-item", numbering: { listId: "bullets", format: "bullet" } }),
  ]);
  const { ir } = await layout(doc, resources, options);
  validateCanonicalLayoutIR(ir);
  expect(extract(ir)).toBe("𠮷甲 a\u0301item");
  const han = texts(ir)[0];
  expect(han?.clusters[0]?.logicalRange).toEqual({ start: 0, end: 2 });
  expect(texts(ir).some((t) => t.logicalText === "· ")).toBe(true);
});
it("retains terminal line offsets and rejects unsupported blocks/controls explicitly", async () => {
  const { lines } = await layout(document([p("甲\n")]), resources, options);
  expect(lines.map((l) => [l.start, l.end])).toEqual([
    [0, 2],
    [2, 2],
  ]);
  const control = document([
    {
      kind: "paragraph",
      nodeId: "p",
      inlines: [{ kind: "input-control", nodeId: "c", controlId: "control", controlType: "text" }],
    },
  ]);
  await expect(layout(control, resources, options)).rejects.toMatchObject({
    code: "LAYOUT_UNSUPPORTED",
    nodeId: "p",
  });
  const table = document([]);
  table.body = [{ kind: "table", nodeId: "t", rows: [] }];
  await expect(layout(table, resources, options)).rejects.toMatchObject({
    code: "LAYOUT_UNSUPPORTED",
    nodeId: "t",
  });
});
