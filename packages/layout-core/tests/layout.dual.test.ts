import { paragraphText } from "@ofd-compose/binding-core";
import type { CanonicalLayoutIR, TextObject } from "@ofd-compose/layout-ir";
import {
  canonicalSerialize,
  digestCanonical,
  validateCanonicalLayoutIR,
} from "@ofd-compose/layout-ir";
import { beforeAll, expect, it, vi } from "vitest";
import { renderTemplate, TemplateBuilder } from "../../binding-core/tests/helpers.js";
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
it("uses the selected font metrics for blank paragraphs and terminal lines, including fixed-height thresholds", async () => {
  const result = await layout(
    document([p("甲", "text"), p("", "empty"), p("甲\n", "terminal")]),
    resources,
    options,
  );
  const heights = result.lines.map((l) => l.height);
  expect(heights).toHaveLength(4);
  for (const height of heights) expect(height).toBeCloseTo(heights[0] ?? 0, 10);
  const natural = (heights[0] ?? 0) / 1.2;
  for (const text of ["甲", "", "甲\n"]) {
    const exact = document([p(text, "p", { lineHeight: { kind: "fixed", value: natural } })]);
    expect(
      (await layout(exact, resources, options)).lines.every(
        (l) => Math.abs(l.height - natural) < 1e-9,
      ),
    ).toBe(true);
    const short = document([
      p(text, "p", { lineHeight: { kind: "fixed", value: natural - 0.01 } }),
    ]);
    await expect(layout(short, resources, options)).rejects.toMatchObject({
      code: "LAYOUT_OVERFLOW",
    });
  }
  const heading = await layout(
    document([p("标题\n", "h", { role: "heading", headingLevel: 2 })]),
    resources,
    options,
  );
  expect(heading.lines[0]?.height).toBeCloseTo(heading.lines[1]?.height ?? 0, 10);
});
it("justifies punctuation-separated Chinese at legal boundaries and fills the actual glyph advance", async () => {
  const text = "甲，乙，丙，丁，戊，己，庚，辛，壬，癸。";
  const { ir, lines } = await layout(
    document([p(text, "p", { alignment: "justify" })]),
    resources,
    {
      ...options,
      page: { ...options.page, contentBox: { ...options.page.contentBox, width: 27 } },
    },
  );
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines.slice(0, -1)) {
    expect(line.width).toBeCloseTo(27, 10);
    const run = texts(ir).find((t) => Math.abs(t.baseline.y - line.baseline * 1000) < 1);
    expect(run).toBeDefined();
    const last = run?.glyphs.at(-1);
    expect(last).toBeDefined();
    expect(Math.abs((last?.position.x ?? 0) + (last?.advance.x ?? 0) - 47000)).toBeLessThanOrEqual(
      1,
    );
    expect(permitsChineseBreak(text, line.end)).toBe(true);
  }
  expect(extract(ir)).toBe(text);
});
it("rejects inherited object property names as missing styles in a supplied ResolvedDocument", async () => {
  const doc = document([p("text")]);
  const paragraph = doc.body[0];
  if (paragraph?.kind !== "paragraph") throw new Error("Missing paragraph");
  paragraph.styleId = "constructor";
  await expect(layout(doc, resources, options)).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
});
it("advances candidate/run cursors on control-only lines and bounds expanded source output", async () => {
  const content = "\n".repeat(1200);
  const largePage = {
    ...options,
    page: { width: 210, height: 1000000, contentBox: { x: 20, y: 20, width: 170, height: 999960 } },
  };
  const result = await layout(document([p(content)]), resources, largePage);
  expect(result.lines).toHaveLength(1201);
  expect(result.work.candidateVisits).toBe(1200);
  expect(result.work.runVisits).toBe(1200);
  expect(extract(result.ir)).toBe(content);
  await expect(
    layout(document([p("\n".repeat(100000))]), resources, largePage),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
});
it("checks adjacent Chinese punctuation across long paragraphs without prefix/suffix copying", () => {
  const text = `${"甲".repeat(50000)}（ 𠮷，${"乙".repeat(49994)}`;
  expect(permitsChineseBreak(text, 50002)).toBe(false);
  expect(permitsChineseBreak(text, 50004)).toBe(false);
  // Every candidate in a long Han paragraph must remain a legal boundary.
  const han = "甲".repeat(100000);
  for (let i = 1; i < han.length; i++) expect(permitsChineseBreak(han, i)).toBe(true);
});
it("aligns tab prefixes while keeping single/multiple stops anchored under indents and wrapping", async () => {
  for (const alignment of ["left", "center", "right", "justify"] as const) {
    for (const firstLineIndent of [4, -4]) {
      const properties = { alignment, leftIndent: 8, firstLineIndent, tabStops: [20, 40] };
      const { ir } = await layout(document([p("A\tB\tC", "p", properties)]), resources, options);
      expect(texts(ir).find((t) => t.logicalText === "B")?.baseline.x).toBe(48000);
      expect(texts(ir).find((t) => t.logicalText === "C")?.baseline.x).toBe(68000);
      const wrapped = await layout(
        document([p(`${"甲".repeat(9)}\tB`, "p", properties)]),
        resources,
        {
          ...options,
          page: { ...options.page, contentBox: { ...options.page.contentBox, width: 35 } },
        },
      );
      expect(wrapped.lines.length).toBeGreaterThan(1);
      expect(texts(wrapped.ir).find((t) => t.logicalText === "B")?.baseline.x).toBe(48000);
    }
  }
  const left = await layout(document([p("A\tB", "p", { tabStops: [20] })]), resources, options);
  const center = await layout(
    document([p("A\tB", "p", { alignment: "center", tabStops: [20] })]),
    resources,
    options,
  );
  const right = await layout(
    document([p("A\tB", "p", { alignment: "right", tabStops: [20] })]),
    resources,
    options,
  );
  const original = texts(left.ir)[0];
  const centered = texts(center.ir)[0];
  const aligned = texts(right.ir)[0];
  expect(texts(center.ir).find((t) => t.logicalText === "B")?.baseline.x).toBe(40000);
  expect(texts(right.ir).find((t) => t.logicalText === "B")?.baseline.x).toBe(40000);
  expect(
    Math.abs((aligned?.baseline.x ?? 0) + (original?.bounds.width ?? 0) - 40000),
  ).toBeLessThanOrEqual(1);
  expect(centered?.baseline.x).toBeCloseTo(
    ((original?.baseline.x ?? 0) + (aligned?.baseline.x ?? 0)) / 2,
    0,
  );
}, 20000);
it("bounds optional control and whitespace candidate measurement", async () => {
  for (const content of ["\t".repeat(100000), " \t".repeat(50000)]) {
    await expect(
      layout(document([p(content)]), resources, {
        ...options,
        page: {
          width: 1000000,
          height: 1000000,
          contentBox: { x: 0, y: 0, width: 1000000, height: 1000000 },
        },
      }),
    ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
  }
}, 20000);
it("rejects over-limit or malformed fragments before iterating text to construct runs", async () => {
  for (const invalid of ["A\n".repeat(50001), "\ud800"]) {
    const original = String.prototype[Symbol.iterator];
    let visited = 0;
    const spy = vi.spyOn(String.prototype, Symbol.iterator).mockImplementation(function (
      this: string,
    ) {
      if (String(this) === invalid) visited++;
      return original.call(this);
    });
    try {
      await expect(layout(document([p(invalid)]), resources, options)).rejects.toMatchObject({
        code: "LAYOUT_INPUT",
      });
      expect(visited).toBe(0);
    } finally {
      spy.mockRestore();
    }
  }
  const oversizedSum = document([
    {
      ...p("", "p"),
      inlines: [
        { kind: "text", nodeId: "a", text: "A".repeat(60000) },
        { kind: "text", nodeId: "b", text: "B".repeat(60000) },
      ],
    },
  ]);
  await expect(layout(oversizedSum, resources, options)).rejects.toMatchObject({
    code: "LAYOUT_INPUT",
  });
});
it("initializes explicit list starts once per repeated paragraph and restarts for a new parent group", async () => {
  for (const nested of [false, true]) {
    const builder = new TemplateBuilder();
    const item = builder.p("{name}");
    item.layout = {
      role: "list-item",
      numbering: { listId: "items", format: "decimal", start: 5 },
    };
    const repeat = builder.repeat("items", [item]);
    const source = builder.template(nested ? [builder.repeat("groups", [repeat])] : [repeat]);
    const items = [{ name: "A" }, { name: "B" }, { name: "C" }];
    const result = renderTemplate(
      source,
      nested ? { groups: [{ items }, { items: items.slice(0, 2) }] } : { items },
    );
    expect(result.ok).toBe(true);
    const { ir } = await layout(result.document, resources, options);
    expect(
      texts(ir)
        .map((t) => t.logicalText)
        .filter((t) => /^\d+\. $/u.test(t)),
    ).toEqual(nested ? ["5. ", "6. ", "7. ", "5. ", "6. "] : ["5. ", "6. ", "7. "]);
  }
});
