import { bind } from "@ofd-compose/binding-core";
import type {
  BlockNode,
  ImageBinding,
  RegionLayout,
  TemplateSource,
} from "@ofd-compose/document-model";
import { canonicalSerialize, digestCanonical } from "@ofd-compose/layout-ir";
import { prepareMedia } from "@ofd-compose/media-core";
import { compile } from "@ofd-compose/template-compiler";
import { beforeAll, describe, expect, it } from "vitest";
import fixture from "../../media-core/tests/fixtures.json";
import { type LayoutFont, layout } from "../src/index.js";
import { fonts, options, p } from "./fixtures.js";

let pack: LayoutFont[];
beforeAll(async () => {
  pack = await fonts();
});
function bound(body: BlockNode[], data: Parameters<typeof bind>[1] = { image: fixture.png }) {
  const template: TemplateSource = {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "media-layout",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body,
  };
  const compiled = compile(template);
  if (!compiled.ok || !compiled.template) throw Error(JSON.stringify(compiled.diagnostics));
  const result = bind(compiled.template, data);
  if (!result.ok) throw Error(JSON.stringify(result.diagnostics));
  return result.document;
}
const img = (id = "image", extra: Partial<ImageBinding> = {}): ImageBinding => ({
  kind: "image-binding",
  nodeId: id,
  bindingId: `${id}-binding`,
  expression: { kind: "legacy", text: "image" },
  options: { width: 40, height: 20, preserveAspectRatio: false },
  ...extra,
});
const barcode = (id = "code"): BlockNode => ({
  kind: "barcode-binding",
  nodeId: id,
  bindingId: `${id}-binding`,
  expression: { kind: "legacy", text: "code" },
  options: { symbology: "code128", width: 60, height: 15 },
});
const region = (
  children: BlockNode[],
  overflow?: RegionLayout["overflow"],
  height = 12,
  mode: RegionLayout["mode"] = "fixed",
): BlockNode => ({
  kind: "region",
  nodeId: "region",
  layout: {
    mode,
    box: { x: mode === "fixed" ? 30 : 0, y: mode === "fixed" ? 40 : 0, width: 80, height },
    ...(overflow ? { overflow } : {}),
  },
  children,
});
async function render(body: BlockNode[], data?: Parameters<typeof bind>[1], opts = options) {
  const doc = bound(body, data);
  const media = prepareMedia(doc);
  if (!media.ok) throw Error(JSON.stringify(media.diagnostics));
  return layout(doc, pack, opts, media);
}
const images = (result: Awaited<ReturnType<typeof render>>) =>
  result.ir.pages.flatMap((page) => page.objects).filter((object) => object.kind === "image");
describe("prepared media, paths and regions", () => {
  it("requires real media readiness and rejects forged or mismatched preparation", async () => {
    const doc = bound([img()]);
    await expect(layout(doc, [], options)).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
    await expect(layout(doc, [], options, { ok: true, blocks: [] })).rejects.toMatchObject({
      code: "MODEL_INVALID",
    });
    const prepared = prepareMedia(doc);
    const changed = bound([img("image", { options: { width: 20 } })]);
    await expect(layout(changed, [], options, prepared)).rejects.toMatchObject({
      code: "LAYOUT_INPUT",
    });
  });
  it("owns dimensions and resource identity even if public preparation output is mutated", async () => {
    const doc = bound([img()]);
    const prepared = prepareMedia(doc);
    if (!prepared.ok) throw Error("media");
    const image = prepared.blocks[0]?.images?.[0];
    if (!image) throw Error("image");
    Object.assign(image, { width: 999 });
    expect(() => Object.assign(image.resource, { id: "font0", pixelWidth: 0 })).toThrow();
    const result = await layout(doc, [], options, prepared);
    expect(images(result)[0]?.bounds.width).toBe(40000);
  });
  it.each([
    [{}, undefined],
    [{ width: 30 }, 30000],
    [{ width: 40, height: 20, preserveAspectRatio: false }, 40000],
    [{ width: 40, scale: 0.5 }, 20000],
    [{ width: 80, maxWidth: 20 }, 20000],
    [{ width: 40, height: 20 }, undefined],
  ] as const)("uses frozen dimension policy %j", async (size, width) => {
    const doc = bound([img("image", { options: size })]);
    const media = prepareMedia(doc);
    if (!media.ok) throw Error("media");
    const entry = media.blocks[0]?.images?.[0];
    if (!entry) throw Error("image");
    const roomy = {
      ...options,
      page: { width: 1000, height: 1000, contentBox: { x: 0, y: 0, width: 1000, height: 1000 } },
    };
    const result = await layout(doc, [], roomy, media);
    expect(images(result)[0]?.bounds.width).toBe(Math.round(entry.width * 1000));
    if (width !== undefined) expect(images(result)[0]?.bounds.width).toBe(width);
  });
  it("centers each list image and retains binding and keyed repeat identity", async () => {
    const body: BlockNode[] = [
      {
        kind: "repeat-block",
        nodeId: "repeat",
        bindingId: "repeat-binding",
        expression: { kind: "legacy", text: "items" },
        repeatKey: { kind: "path", path: "id" },
        children: [img("image", { placement: { alignment: "center", gap: 2 } })],
      },
    ];
    const result = await render(body, {
      items: [
        { id: "a", image: [fixture.png, fixture.png] },
        { id: "b", image: [fixture.png] },
      ],
    });
    expect(images(result).map((i) => i.bounds.x)).toEqual([85000, 85000, 85000]);
    expect(images(result).map((i) => i.bounds.y)).toEqual([20000, 42000, 62000]);
    expect(result.semanticMap.map((s) => [s.bindingId, s.repeatInstance?.[0]?.key])).toEqual([
      ["image-binding", "a"],
      ["image-binding", "a"],
      ["image-binding", "b"],
    ]);
    expect(new Set(result.semanticMap.map((s) => s.objectId)).size).toBe(3);
  });
  it("moves an atomic image to the next page and rejects one taller than a whole page", async () => {
    const opts = {
      ...options,
      page: { width: 100, height: 100, contentBox: { x: 10, y: 10, width: 80, height: 30 } },
    };
    const result = await render(
      [p("A", "p", { lineHeight: { kind: "fixed", value: 20 } }), img()],
      undefined,
      opts,
    );
    expect(result.ir.pages).toHaveLength(2);
    expect(result.ir.pages[1]?.objects[0]?.bounds.y).toBe(10000);
    await expect(
      render(
        [img("image", { options: { width: 20, height: 31, preserveAspectRatio: false } })],
        undefined,
        opts,
      ),
    ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  });
  it("fits exactly at the page boundary without making a trailing page", async () => {
    const opts = {
      ...options,
      page: { width: 100, height: 100, contentBox: { x: 10, y: 10, width: 80, height: 40 } },
    };
    expect((await render([img("a"), img("b")], undefined, opts)).ir.pages).toHaveLength(1);
  });
  it("clips an image in pixel-local coordinates without resizing its frozen source", async () => {
    const result = await render([
      img("image", { placement: { crop: { x: 5, y: 3, width: 20, height: 10 } } }),
    ]);
    const image = images(result)[0];
    expect(image?.bounds).toEqual({ x: 20000, y: 20000, width: 20000, height: 10000 });
    expect(image?.transform.e).toBe(15000);
    expect(image?.transform.f).toBe(17000);
    expect(image?.clip?.commands).toHaveLength(5);
    await expect(
      render([img("image", { placement: { crop: { x: 30, y: 0, width: 20, height: 10 } } })]),
    ).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
  });
  it("places barcode geometry unchanged, with full quiet-zone bounds and semantics", async () => {
    const result = await render([barcode()], { code: "CODE-128" });
    const path = result.ir.pages[0]?.objects[0];
    expect(path?.kind).toBe("path");
    expect(path?.bounds).toEqual({ x: 20000, y: 20000, width: 60000, height: 15000 });
    const state = result.ir.graphicsStates.find((s) => s.id === path?.stateId);
    expect(state?.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 20000, f: 20000 });
    expect(result.semanticMap[0]?.bindingId).toBe("code-binding");
  });
  it("never crops barcode quiet zones or shrinks below legal physical dimensions", async () => {
    await expect(
      render([region([barcode()], { kind: "truncate" }, 8)], { code: "CODE-128" }),
    ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
    await expect(
      render([region([barcode()], { kind: "scale", minScale: 0.001 }, 0.5)], { code: "CODE-128" }),
    ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  });
  it("keeps fixed and flowing content independent and fails default fixed overflow", async () => {
    const result = await render([
      p("before", "before"),
      region([p("fixed", "fixed")], undefined, 20),
      p("after", "after"),
    ]);
    expect(result.lines.find((l) => l.nodeId === "fixed")?.y).toBe(40);
    expect(result.lines.find((l) => l.nodeId === "after")?.y).toBeLessThan(40);
    await expect(render([region([p("one\ntwo\nthree", "inside")])])).rejects.toMatchObject({
      code: "LAYOUT_OVERFLOW",
      nodeId: "region",
    });
  });
  it("explicit truncation clips geometry and preserves semantic source with a diagnostic", async () => {
    const result = await render([region([p("one\ntwo\nthree", "inside")], { kind: "truncate" })]);
    expect(result.diagnostics[0]?.message).toContain("truncated=true");
    expect(result.ir.graphicsStates.some((s) => !!s.clip)).toBe(true);
    expect(result.ir.pages[0]?.objects.every((o) => o.bounds.y + o.bounds.height <= 52000)).toBe(
      true,
    );
    expect(result.lines.map((l) => l.end).at(-1)).toBe(13);
  });
  it("explicit scaling transforms text bounds and baseline inspection uniformly", async () => {
    const original = await render([region([p("one\ntwo\nthree", "inside")], undefined, 80)]);
    const scaled = await render([
      region([p("one\ntwo\nthree", "inside")], { kind: "scale", minScale: 0.1 }),
    ]);
    const a = original.ir.pages[0]?.objects[0],
      b = scaled.ir.pages[0]?.objects[0];
    if (!a || !b) throw Error("objects");
    const state = scaled.ir.graphicsStates.find((s) => s.id === b.stateId);
    expect(state?.transform.a).toBeLessThan(1);
    expect(state?.transform.a).toBe(state?.transform.d);
    expect(b.bounds.width).toBeLessThan(a.bounds.width);
    expect(scaled.lines[1]?.baseline).toBeLessThan(original.lines[1]?.baseline ?? 0);
    await expect(
      render([region([p("one\ntwo\nthree", "inside")], { kind: "scale", minScale: 0.99 })]),
    ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  });
  it("minimum-font-size performs bounded real reflow and reports failures at the floor", async () => {
    const result = await render([
      region([p("one\ntwo\nthree", "inside")], { kind: "min-font-size", minFontSize: 6 }, 12),
    ]);
    const texts = result.ir.pages[0]?.objects.filter((o) => o.kind === "text") ?? [];
    expect(texts.some((o) => o.fontSize < ((12 * 25.4) / 72) * 1000)).toBe(true);
    expect(texts.every((o) => o.fontSize >= Math.round(((6 * 25.4) / 72) * 1000))).toBe(true);
    expect(result.work.regionAttempts).toBeGreaterThan(1);
    expect(result.work.regionAttempts).toBeLessThanOrEqual(9);
    expect(result.lines.at(-1)?.y ?? 1000).toBeLessThan(52);
    await expect(
      render([
        region([p("one\ntwo\nthree", "inside")], { kind: "min-font-size", minFontSize: 12 }, 2),
      ]),
    ).rejects.toMatchObject({ code: "LAYOUT_OVERFLOW" });
  });
  it("flow regions reserve their assigned height and keep following content after it", async () => {
    const result = await render([region([img()], undefined, 25, "flow"), p("after", "after")]);
    expect(images(result)[0]?.bounds.y).toBe(20000);
    expect(result.lines[0]?.y).toBe(45);
  });
  it("emits fill rules, dash/cap/join, reflected/rotated paths and paragraph borders", async () => {
    const path: BlockNode = {
      kind: "path",
      nodeId: "shape",
      width: 20,
      height: 10,
      commands: [
        { op: "move", x: 0, y: 0 },
        { op: "line", x: 20, y: 0 },
        { op: "line", x: 20, y: 10 },
        { op: "close" },
      ],
      fill: "#ff0000",
      fillRule: "evenodd",
      stroke: { width: 0.2, dash: [1, 2], cap: "round", join: "bevel" },
      transform: { a: 0, b: -1, c: -1, d: 0, e: 0, f: 0 },
    };
    const result = await render([
      path,
      p("border", "border", { border: { width: 0.3, color: "#0000ff" } }),
    ]);
    const object = result.ir.pages[0]?.objects[0];
    if (object?.kind !== "path") throw Error("path");
    expect(object.fillRule).toBe("evenodd");
    expect(object.bounds.width).toBe(10200);
    expect(object.bounds.height).toBe(20200);
    const state = result.ir.graphicsStates.find((s) => s.id === object.stateId);
    expect(state?.dash).toEqual([1000, 2000]);
    expect(state?.lineCap).toBe("round");
    expect(state?.lineJoin).toBe("bevel");
    const border = result.ir.pages[0]?.objects.at(-1);
    expect(border?.kind).toBe("path");
  });
  it("rejects singular transforms, invalid path sequences and degenerate dash patterns", async () => {
    const path: Extract<BlockNode, { kind: "path" }> = {
      kind: "path",
      nodeId: "path",
      width: 20,
      height: 10,
      commands: [
        { op: "move", x: 0, y: 0 },
        { op: "line", x: 20, y: 10 },
      ],
      stroke: { width: 0.2 },
    };
    await expect(
      render([{ ...path, transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } }]),
    ).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
    await expect(
      render([{ ...path, commands: [{ op: "line", x: 1, y: 1 }] }]),
    ).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
    await expect(render([{ ...path, stroke: { width: 0.2, dash: [0, 0] } }])).rejects.toMatchObject(
      { code: "LAYOUT_INPUT" },
    );
  });
  it("reuses shared budgets across region retries and rejects nested long input before fonts", async () => {
    const doc = bound([
      region([p("A".repeat(100001), "large")], { kind: "min-font-size", minFontSize: 1 }),
    ]);
    await expect(layout(doc, [], options)).rejects.toMatchObject({ code: "LAYOUT_INPUT" });
    const body = Array.from({ length: 257 }, (_, i) => ({
      ...region([], { kind: "truncate" }),
      nodeId: `region${i}`,
    }));
    await expect(render(body)).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
  });
  it("is byte-deterministic with stable media identity", async () => {
    const body = [
      region(
        [
          img("image", { placement: { crop: { x: 2, y: 1, width: 30, height: 18 } } }),
          p("A B C", "caption", { border: { width: 0.2 } }),
        ],
        { kind: "scale", minScale: 0.1 },
        20,
      ),
    ];
    const a = await render(body),
      b = await render(body);
    expect(canonicalSerialize(a.ir)).toBe(canonicalSerialize(b.ir));
    expect(digestCanonical(a.ir)).toBe(
      "88c1f0810b90cbcf167c2bcd335d150f290290624ef083038f5d36458d89f214",
    );
  });
});

it("checks combined media/watermark budgets before font acquisition", async () => {
  const doc = bound([img()]);
  const prepared = prepareMedia(doc);
  const watermark = {
    id: "w",
    kind: "image" as const,
    digest: "a".repeat(64),
    mimeType: "image/png" as const,
    pixelWidth: 1,
    pixelHeight: 1,
  };
  await expect(
    layout(
      doc,
      [],
      { ...options, images: Array.from({ length: 64 }, (_, i) => ({ ...watermark, id: `w${i}` })) },
      prepared,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
  await expect(
    layout(
      doc,
      [],
      { ...options, images: [{ ...watermark, pixelWidth: 10000, pixelHeight: 9900 }] },
      prepared,
    ),
  ).rejects.toMatchObject({ code: "LAYOUT_LIMIT" });
});
it("rejects changed prepared bytes and reserves source fingerprint work", async () => {
  const doc = bound([img()]);
  const prepared = prepareMedia(doc);
  if (!prepared.ok) throw Error("media");
  const image = prepared.blocks[0]?.images?.[0];
  if (!image) throw Error("image");
  image.bytes[0] = 0;
  await expect(layout(doc, [], options, prepared)).rejects.toMatchObject({ code: "MODEL_INVALID" });
  const limited = prepareMedia(doc, { limits: { workUnits: fixture.png.length * 8 } });
  expect(limited.ok).toBe(false);
  expect(limited.diagnostics[0]?.code).toBe("RESOURCE_LIMIT");
});
it("scales actual page-space paragraph decoration paths in regions", async () => {
  const paragraph = p("A\nB\nC", "decorated", { border: { width: 0.2 } });
  const result = await render([region([paragraph], { kind: "scale", minScale: 0.1 }, 10)]);
  const paths = result.ir.pages[0]?.objects.filter((o) => o.kind === "path") ?? [];
  expect(paths.length).toBeGreaterThan(0);
  for (const path of paths) {
    expect(path.coordinateSpace).toBe("local");
    const state = result.ir.graphicsStates.find((s) => s.id === path.stateId);
    if (!state) throw Error("state");
    expect(state.transform.a).toBeLessThan(1);
    for (const command of path.commands)
      if (command.op !== "close") {
        const y = state.transform.b * command.x + state.transform.d * command.y + state.transform.f;
        expect(y).toBeGreaterThanOrEqual(40000);
        expect(y).toBeLessThanOrEqual(50001);
      }
  }
});
it.each(["right", "center"] as const)(
  "handles %s aligned unbreakable text on both region edges",
  async (alignment) => {
    const child = p("ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ", "wide", { alignment });
    const clipped = await render([region([child], { kind: "truncate" }, 20)]);
    expect(clipped.diagnostics[0]?.message).toContain("truncated=true");
    expect(clipped.ir.graphicsStates.some((s) => s.clip)).toBe(true);
    const scaled = await render([region([child], { kind: "scale", minScale: 0.1 }, 20)]);
    expect(scaled.ir.graphicsStates.some((s) => s.transform.a < 1)).toBe(true);
    for (const object of scaled.ir.pages[0]?.objects ?? []) {
      expect(object.bounds.x).toBeGreaterThanOrEqual(30000);
      expect(object.bounds.x + object.bounds.width).toBeLessThanOrEqual(110001);
    }
  },
);
it("reserves square diagonal cap corners under reflected path geometry", async () => {
  const result = await render([
    {
      kind: "path",
      nodeId: "cap",
      width: 10,
      height: 10,
      commands: [
        { op: "move", x: 0, y: 0 },
        { op: "line", x: 10, y: 10 },
      ],
      stroke: { width: 2, cap: "square", join: "bevel" },
      transform: { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    },
  ]);
  const path = result.ir.pages[0]?.objects[0];
  expect(path?.bounds.width).toBe(Math.round((10 + 2 * Math.SQRT2) * 1000));
  expect(path?.bounds.height).toBe(Math.round((10 + 2 * Math.SQRT2) * 1000));
});
it("rejects replacement image elements and containers after preparation", async () => {
  const doc = bound([img()]);
  const prepared = prepareMedia(doc);
  if (!prepared.ok) throw Error("media");
  const block = prepared.blocks[0];
  if (!block?.images?.[0]) throw Error("image");
  const array = block.images as (typeof block.images)[number][];
  const original = array[0];
  if (!original) throw Error("image");
  array[0] = { ...original, bytes: new Uint8Array(1) };
  await expect(layout(doc, [], options, prepared)).rejects.toMatchObject({ code: "MODEL_INVALID" });
});

it.each([
  ["center", 10000],
  ["right", -10000],
] as const)(
  "preserves %s alignment when clipping an overwide image",
  async (alignment, expectedX) => {
    const result = await render([
      region(
        [
          img("wide-image", {
            options: { width: 120, height: 10, preserveAspectRatio: false },
            placement: { alignment },
          }),
        ],
        { kind: "truncate" },
        20,
      ),
    ]);
    const image = images(result)[0];
    if (!image) throw Error("image");
    expect(image.transform.e).toBe(expectedX);
    expect(image.bounds).toEqual({ x: 30000, y: 40000, width: 80000, height: 10000 });
    const state = result.ir.graphicsStates.find((s) => s.id === image.stateId);
    if (!state?.clip) throw Error("clip");
    expect(state.clip.commands[0]).toEqual({ op: "move", x: 30000, y: 40000 });
    const sourceStart = (image.bounds.x - image.transform.e) / 1000;
    expect(sourceStart).toBe(alignment === "center" ? 20 : 40);
    expect(result.diagnostics[0]?.message).toContain("truncated=true");
  },
);
