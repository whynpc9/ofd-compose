import { bind } from "@ofd-compose/binding-core";
import type { PageSettings, TemplateSource } from "@ofd-compose/document-model";
import {
  canonicalSerialize,
  digestCanonical,
  validateCanonicalLayoutIR,
} from "@ofd-compose/layout-ir";
import { compile } from "@ofd-compose/template-compiler";
import { beforeAll, expect, it } from "vitest";
import { type LayoutFont, layout } from "../src/index.js";
import { document, fiftyPageDocument, fiftyPageOptions, fonts, options, p } from "./fixtures.js";
import expected from "./pagination-expected.json";

let resources: LayoutFont[];
beforeAll(async () => {
  resources = await fonts();
});
const page: PageSettings = {
  paper: "A4",
  orientation: "portrait",
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};
function configured(paragraphs: ReturnType<typeof p>[], settings: PageSettings = page) {
  const source: TemplateSource = {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "pagination",
    revisionId: "1",
    settings: {
      locale: "zh-CN",
      timeZone: "UTC",
      bindingPolicyVersion: "strict-1",
      page: settings,
    },
    styles: {},
    body: paragraphs,
  };
  const compiled = compile(source);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const result = bind(compiled.template, {});
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}
function sourceText(ir: Awaited<ReturnType<typeof layout>>["ir"]) {
  const objects = new Map(
    ir.pages.flatMap((page) => page.objects).map((object) => [object.id, object]),
  );
  return ir.semantics
    .map((s) => {
      const object = objects.get(s.objectId);
      return object?.kind === "text" ? object.logicalText : "";
    })
    .join("");
}
it("binds physical page and section settings and records each page's geometry and source", async () => {
  const resolved = configured([
    p("甲", "a"),
    p("乙", "b", {
      section: { id: "appendix", page: { ...page, paper: "A5", orientation: "landscape" } },
    }),
    p("丙", "c", {
      section: {
        id: "custom",
        page: {
          ...page,
          paper: { width: 100, height: 80 },
          margins: { top: 5, right: 6, bottom: 7, left: 8 },
        },
      },
    }),
  ]);
  expect(resolved.settings.page).toEqual(page);
  const { page: _legacyPage, ...modelOptions } = options;
  const { ir, lines } = await layout(resolved, resources, modelOptions);
  expect(ir.pages.map((p) => [p.width, p.height, p.orientation, p.sectionId])).toEqual([
    [210000, 297000, "portrait", "pagination"],
    [210000, 148000, "landscape", "appendix"],
    [80000, 100000, "portrait", "custom"],
  ]);
  expect(ir.pages[2]?.contentBox).toEqual({ x: 8000, y: 5000, width: 66000, height: 88000 });
  expect(lines.map((l) => [l.pageIndex, l.sectionId])).toEqual([
    [0, "pagination"],
    [1, "appendix"],
    [2, "custom"],
  ]);
  expect(ir.semantics.map((s) => [s.pageIndex, s.sectionId, s.readingOrder])).toEqual([
    [0, "pagination", 0],
    [1, "appendix", 1],
    [2, "custom", 2],
  ]);
  validateCanonicalLayoutIR(ir);
});
it("automatically splits a paragraph by actual line boxes without losing source ranges", async () => {
  const input = document([
    p("甲\n乙\n丙\n丁", "p", {
      lineHeight: { kind: "fixed", value: 10 },
      spaceBefore: 100,
      spaceAfter: 999,
    }),
  ]);
  const { ir, lines } = await layout(input, resources, {
    ...options,
    page: { ...options.page, contentBox: { x: 20, y: 20, width: 170, height: 20 } },
  });
  expect(ir.pages).toHaveLength(2);
  expect(lines.map((l) => [l.pageIndex, l.y, l.height])).toEqual([
    [0, 20, 10],
    [0, 30, 10],
    [1, 20, 10],
    [1, 30, 10],
  ]);
  expect(sourceText(ir)).toBe("甲\n乙\n丙\n丁");
  expect(ir.semantics.every((s) => s.sourceRanges?.[0]?.nodeId === "p-text")).toBe(true);
});
it("trims trailing spacing, drops before-spacing after automatic breaks, and preserves explicit blank pages", async () => {
  const input = document([
    p("甲", "a", { spaceAfter: 500 }),
    p("乙", "b", { spaceBefore: 500 }),
    p("丙", "c", { pageBreakBefore: true, spaceBefore: 500 }),
  ]);
  const result = await layout(input, resources, options);
  expect(result.ir.pages).toHaveLength(3);
  expect(result.lines.map((l) => l.y)).toEqual([20, 20, 20]);
  const blank = await layout(
    document([p("甲", "a", { pageBreakBefore: true })]),
    resources,
    options,
  );
  expect(blank.ir.pages).toHaveLength(2);
  expect(blank.ir.pages[0]?.objects).toEqual([]);
});
it("reserves hidden bands, renders numbering and total fields, and draws a physical page border", async () => {
  const input = configured(
    [
      p("甲", "a"),
      p("乙", "b", { pageBreakBefore: true }),
      p("丙", "c", { pageBreakBefore: true }),
    ],
    {
      ...page,
      startPageNumber: 7,
      header: {
        height: 12,
        parts: [{ kind: "text", text: "页眉" }],
        hideFirstPage: true,
        hiddenPages: [3],
      },
      footer: {
        height: 12,
        alignment: "center",
        parts: [{ kind: "page-number" }, { kind: "text", text: " / " }, { kind: "total-pages" }],
      },
      border: { inset: 5, width: 0.4, color: "#123456" },
    },
  );
  const result = await layout(input, resources, options);
  expect(result.paginationPasses).toBe(2);
  expect(result.ir.pages.map((p) => p.contentBox)).toEqual(
    Array(3).fill({ x: 20000, y: 32000, width: 170000, height: 233000 }),
  );
  expect(
    result.ir.pages.map((p) =>
      p.objects
        .filter((o) => o.kind === "text")
        .map((o) => o.logicalText)
        .join(""),
    ),
  ).toEqual(["甲7 / 3", "乙页眉8 / 3", "丙9 / 3"]);
  expect(result.ir.pages.every((p) => p.objects.some((o) => o.kind === "path" && o.stroke))).toBe(
    true,
  );
  expect(sourceText(result.ir)).toBe("甲乙丙");
  await expect(
    layout(input, resources, { ...options, pagination: { maxIterations: 1 } }),
  ).rejects.toMatchObject({ code: "PAGINATION_NOT_CONVERGED" });
});
it("restarts page numbering and hiding relative to a section and wraps bands inside reserved height", async () => {
  const settings: PageSettings = {
    ...page,
    paper: { width: 80, height: 100 },
    margins: { top: 5, right: 10, bottom: 5, left: 10 },
    header: {
      height: 30,
      parts: [{ kind: "text", text: "这是一个需要换行的真实中文页眉文本。" }],
      style: { fontSize: 18 },
    },
    footer: { height: 10, parts: [{ kind: "page-number" }] },
    startPageNumber: 20,
  };
  const result = await layout(
    configured([p("甲", "a"), p("乙", "b", { section: { id: "next", page: settings } })]),
    resources,
    options,
  );
  expect(result.ir.pages[1]?.contentBox).toEqual({
    x: 10000,
    y: 35000,
    width: 60000,
    height: 50000,
  });
  const generated = result.ir.pages[1]?.objects
    .filter((o) => o.kind === "text")
    .map((o) => o.logicalText)
    .join("");
  expect(generated).toBe("乙这是一个需要换行的真实中文页眉文本。20");
});
it("emits transformed transparent text/image watermarks at their requested paint layers", async () => {
  const transform = { a: 0, b: 1, c: -1, d: 0, e: 150, f: 0 };
  const input = configured([p("正文")], {
    ...page,
    watermarks: [
      {
        kind: "text",
        text: "机密",
        x: 20,
        y: 20,
        opacity: 0.2,
        transform,
        layer: "behind",
        style: { fontSize: 24, color: "#888888" },
      },
      {
        kind: "image",
        resourceId: "logo",
        x: 40,
        y: 50,
        width: 30,
        height: 20,
        opacity: 0.4,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
        layer: "above",
      },
    ],
  });
  const result = await layout(input, resources, {
    ...options,
    images: [
      {
        kind: "image",
        id: "logo",
        digest: "a".repeat(64),
        mimeType: "image/png",
        pixelWidth: 300,
        pixelHeight: 200,
      },
    ],
  });
  const objects = result.ir.pages[0]?.objects ?? [];
  expect(objects.map((o) => (o.kind === "text" ? o.logicalText : o.kind))).toEqual([
    "机密",
    "正文",
    "image",
  ]);
  const state = result.ir.graphicsStates.find((s) => s.id === objects[0]?.stateId);
  expect(state?.opacity).toBe(0.2);
  expect(state?.transform).toEqual({ ...transform, e: 150000 });
  expect(objects[2]).toMatchObject({
    kind: "image",
    bounds: { x: 40000, y: 50000, width: 30000, height: 20000 },
    transform: { a: 0.1, b: 0, c: 0, d: 0.1, e: 40000, f: 50000 },
  });
  expect(sourceText(result.ir)).toBe("正文");
  expect(result.ir.graphicsStates.find((s) => s.id === objects[2]?.stateId)?.opacity).toBe(0.4);
});
it("rejects impossible lines/bands, invalid limits, absent images and page-budget overflow", async () => {
  await expect(
    layout(
      configured([p("甲")], {
        ...page,
        header: { height: 1, parts: [{ kind: "text", text: "甲" }] },
      }),
      resources,
      options,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  await expect(
    layout(
      configured([p("甲")], { ...page, margins: { ...page.margins, top: 500 } }),
      resources,
      options,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  await expect(
    layout(document([p("甲", "a"), p("乙", "b", { pageBreakBefore: true })]), resources, {
      ...options,
      pagination: { maxPages: 1 },
    }),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
  await expect(
    layout(document([p("甲")]), [], { ...options, pagination: { maxIterations: 0 } }),
  ).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
  await expect(
    layout(
      configured([p("甲")], {
        ...page,
        watermarks: [
          {
            kind: "image",
            resourceId: "missing",
            x: 0,
            y: 0,
            width: 20,
            height: 20,
            opacity: 1,
            layer: "behind",
            transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          },
        ],
      }),
      resources,
      options,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
  await expect(
    layout(document([p("甲")]), [], {
      ...options,
      images: Array.from({ length: 65 }, (_, i) => ({
        kind: "image" as const,
        id: `i${i}`,
        digest: "a".repeat(64),
        mimeType: "image/png" as const,
        pixelWidth: 1,
        pixelHeight: 1,
      })),
    }),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
});
it("lays out a 50-page Chinese report identically in repeat runs and the shared Node/browser fixture", async () => {
  const input = fiftyPageDocument();
  const first = await layout(input, resources, fiftyPageOptions);
  const second = await layout(input, resources, fiftyPageOptions);
  expect(first.ir.pages).toHaveLength(50);
  expect(first.lines).toHaveLength(1250);
  expect(
    first.ir.pages.every((page) =>
      page.objects.some((o) => o.kind === "text" && o.glyphs.length > 0),
    ),
  ).toBe(true);
  expect(first.lines.every((line) => line.y >= 20 && line.y + line.height <= 270)).toBe(true);
  expect(sourceText(first.ir)).toBe(
    input.body
      .map((b) =>
        b.kind === "paragraph"
          ? b.fragments.map((f) => (f.kind === "text" ? f.text : "")).join("")
          : "",
      )
      .join(""),
  );
  expect(canonicalSerialize(first.ir)).toBe(canonicalSerialize(second.ir));
  expect(digestCanonical(first.ir)).toBe(expected.fiftyPages);
}, 30000);

it("rejects the explicit minimum page count before fonts and bands before concatenation", async () => {
  await expect(
    layout(
      document(Array.from({ length: 1001 }, (_, i) => p("", `p${i}`, { pageBreakBefore: true }))),
      [],
      options,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
  const input = configured([], {
    ...page,
    header: {
      height: 20,
      parts: Array.from({ length: 11 }, () => ({
        kind: "text" as const,
        text: "甲".repeat(10000),
      })),
    },
  });
  await expect(layout(input, resources, options)).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
});
it("keeps transformed watermark bounds in page space, including text decoration paths", async () => {
  const transform = { a: 0, b: 1, c: -1, d: 0, e: 150, f: 10 };
  const plain = await layout(
    configured([], {
      ...page,
      watermarks: [
        {
          kind: "text",
          text: "水印",
          x: 20,
          y: 30,
          opacity: 0.5,
          layer: "behind",
          transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
          style: { underline: true, highlight: "#cccccc" },
        },
      ],
    }),
    resources,
    options,
  );
  const turned = await layout(
    configured([], {
      ...page,
      watermarks: [
        {
          kind: "text",
          text: "水印",
          x: 20,
          y: 30,
          opacity: 0.5,
          layer: "behind",
          transform,
          style: { underline: true, highlight: "#cccccc" },
        },
      ],
    }),
    resources,
    options,
  );
  for (let i = 0; i < (plain.ir.pages[0]?.objects.length ?? 0); i++) {
    const original = plain.ir.pages[0]?.objects[i],
      rotated = turned.ir.pages[0]?.objects[i];
    if (!original || !rotated) throw new Error("Missing watermark");
    expect(rotated.bounds.x).toBeCloseTo(150000 - original.bounds.y - original.bounds.height, -1);
    expect(rotated.bounds.y).toBeCloseTo(10000 + original.bounds.x, -1);
    expect(rotated.bounds.width).toBeCloseTo(original.bounds.height, -1);
    expect(rotated.bounds.height).toBeCloseTo(original.bounds.width, -1);
    if (rotated.kind === "path") expect(rotated.coordinateSpace).toBe("local");
  }
});
it("charges output work across pages instead of granting every page a fresh source budget", async () => {
  const text = Array.from({ length: 100 }, () => "甲").join("\n");
  const input = document(
    Array.from({ length: 250 }, (_, i) =>
      p(text, `p${i}`, { lineHeight: { kind: "fixed", value: 10 } }),
    ),
  );
  await expect(
    layout(input, resources, {
      ...options,
      page: {
        ...options.page,
        contentBox: { x: 20, y: 20, width: 170, height: 1000 },
        height: 1040,
      },
    }),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
}, 20000);
it("processes a full 1000-page image-watermark document with linear state decoration", async () => {
  const input = configured(
    Array.from({ length: 1000 }, (_, i) => p("", `p${i}`, i ? { pageBreakBefore: true } : {})),
    {
      ...page,
      watermarks: Array.from({ length: 16 }, () => ({
        kind: "image" as const,
        resourceId: "logo",
        x: 20,
        y: 20,
        width: 10,
        height: 10,
        opacity: 0.1,
        layer: "behind" as const,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      })),
    },
  );
  const result = await layout(input, resources, {
    ...options,
    images: [
      {
        kind: "image",
        id: "logo",
        digest: "a".repeat(64),
        mimeType: "image/png",
        pixelWidth: 100,
        pixelHeight: 100,
      },
    ],
  });
  expect(result.ir.pages).toHaveLength(1000);
  expect(result.work.emittedObjects).toBe(17000);
  expect(result.ir.pages.every((p) => p.objects.length === 17)).toBe(true);
}, 30000);

it("reflects image pixels with negative scaling and keeps page bounds and alpha consistent", async () => {
  const result = await layout(
    configured([], {
      ...page,
      watermarks: [
        {
          kind: "image",
          resourceId: "logo",
          x: 20,
          y: 30,
          width: 40,
          height: 10,
          opacity: 0.25,
          layer: "above",
          transform: { a: -2, b: 0, c: 0, d: -3, e: 180, f: 200 },
        },
      ],
    }),
    resources,
    {
      ...options,
      images: [
        {
          kind: "image",
          id: "logo",
          digest: "a".repeat(64),
          mimeType: "image/png",
          pixelWidth: 400,
          pixelHeight: 200,
        },
      ],
    },
  );
  const object = result.ir.pages[0]?.objects[0];
  expect(object).toMatchObject({
    kind: "image",
    bounds: { x: 60000, y: 80000, width: 80000, height: 30000 },
    transform: { a: 0.1, b: 0, c: 0, d: 0.05, e: 20000, f: 30000 },
  });
  const state = result.ir.graphicsStates.find((s) => s.id === object?.stateId);
  expect(state).toMatchObject({
    opacity: 0.25,
    transform: { a: -2, b: 0, c: 0, d: -3, e: 180000, f: 200000 },
  });
});
