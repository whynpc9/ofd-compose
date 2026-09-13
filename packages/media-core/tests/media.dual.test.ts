import { bind, type JsonValue } from "@ofd-compose/binding-core";
import type {
  BarcodeOptions,
  BlockNode,
  ImageOptions,
  TemplateSource,
} from "@ofd-compose/document-model";
import { canonicalizeLayoutIR, quantizeMm } from "@ofd-compose/layout-ir";
import { barcodeFixture } from "@ofd-compose/layout-ir/fixtures";
import { compile } from "@ofd-compose/template-compiler";
import { beforeAll, describe, expect, it } from "vitest";
import { readBarcodes } from "zxing-wasm/reader";
import { prepareDecoder } from "#decoder";
import goldenImages from "../../../tests/golden-corpus/library/examples/11-images-file-and-datauri-scaling/expected/semantics.json";
import {
  barcode,
  imageDimensions,
  MediaError,
  type MediaOptions,
  prepareMedia,
} from "../src/index.js";
import fixtures from "./fixtures.json";
import { raster } from "./raster.js";

function template(body: BlockNode[]): TemplateSource {
  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "media",
    revisionId: "1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: {},
    body,
  };
}
const image = (options: ImageOptions = {}): BlockNode => ({
  kind: "image-binding",
  nodeId: "img",
  bindingId: "ib",
  expression: { kind: "legacy", text: "images" },
  options,
});
function run(data: JsonValue, body: BlockNode[] = [image()], options: MediaOptions = {}) {
  const compiled = compile(template(body));
  if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
  const bound = bind(compiled.template, data);
  if (!bound.ok) return { ok: false as const, diagnostics: bound.diagnostics, blocks: [] };
  return prepareMedia(bound.document, options);
}
function error(fn: () => unknown, code: string) {
  try {
    fn();
    throw Error("Expected error");
  } catch (e) {
    expect(e).toBeInstanceOf(MediaError);
    expect((e as MediaError).code).toBe(code);
  }
}
const bytes = Uint8Array.from(atob(fixtures.png), (c) => c.charCodeAt(0));

beforeAll(prepareDecoder);
describe("real compile/bind/media inputs in Node and Chromium", () => {
  it("resolves data URI, base64 and authorized bytes in source order with content identity", () => {
    const result = run(
      {
        images: [
          fixtures.png,
          `data:image/png;base64,${fixtures.png}`,
          { resourceId: "p0" },
          { path: "charts/chart.png" },
        ],
      },
      [image({ width: "2in", scale: 2, maxWidth: 60 })],
      {
        resources: [{ id: "p0", bytes }],
        root: { id: "approved-charts", entries: [{ path: "charts/chart.png", resourceId: "p0" }] },
      },
    );
    expect(result.ok).toBe(true);
    const images = result.blocks[0]?.images;
    expect(images).toHaveLength(4);
    expect(new Set(images?.map((i) => i.resource.digest)).size).toBe(1);
    expect(images?.[0]?.width).toBe(60);
    expect(images?.[0]?.resource.id).not.toBe("p0");
    expect(images?.[0]?.resource.pixelWidth).toBeGreaterThan(1);
    expect(images?.[0]?.bytes).toEqual(bytes);
    expect(images?.[2]?.bytes).not.toBe(bytes);
  });
  it("accepts real JPEG bytes and base64 with matching dimensions", () => {
    const png = run({ images: fixtures.png });
    const jpg = run({ images: [fixtures.jpeg, `data:image/jpeg;base64,${fixtures.jpeg}`] });
    expect(jpg.ok).toBe(true);
    expect(jpg.blocks[0]?.images?.[0]?.resource.pixelWidth).toBe(
      png.blocks[0]?.images?.[0]?.resource.pixelWidth,
    );
    expect(jpg.blocks[0]?.images?.[0]?.resource.mimeType).toBe("image/jpeg");
  });
  it("accepts legal JPEG marker fill bytes before APP and SOF markers", () => {
    const jpeg = Uint8Array.from(atob(fixtures.jpeg), (c) => c.charCodeAt(0));
    const sof = jpeg.findIndex(
      (value, i) => value === 255 && [192, 193, 194].includes(jpeg[i + 1] ?? -1),
    );
    expect(sof).toBeGreaterThan(0);
    for (const offset of [2, sof]) {
      const filled = new Uint8Array(jpeg.length + 3);
      filled.set(jpeg.subarray(0, offset));
      filled.set([255, 255, 255], offset);
      filled.set(jpeg.subarray(offset), offset + 3);
      const result = run({ images: { resourceId: "jpeg" } }, [image()], {
        resources: [{ id: "jpeg", bytes: filled }],
      });
      expect(result.ok).toBe(true);
      expect(result.blocks[0]?.images?.[0]?.resource.pixelWidth).toBe(
        run({ images: fixtures.jpeg }).blocks[0]?.images?.[0]?.resource.pixelWidth,
      );
    }
  });
  it("accepts standalone TEM markers without treating the next marker as a length", () => {
    const jpeg = Uint8Array.from(atob(fixtures.jpeg), (c) => c.charCodeAt(0));
    const sof = jpeg.findIndex(
      (value, i) => value === 255 && [192, 193, 194].includes(jpeg[i + 1] ?? -1),
    );
    for (const offset of [2, sof]) {
      const input = new Uint8Array(jpeg.length + 3);
      input.set(jpeg.subarray(0, offset));
      input.set([255, 255, 1], offset);
      input.set(jpeg.subarray(offset), offset + 3);
      expect(
        run({ images: { resourceId: "jpeg" } }, [image()], {
          resources: [{ id: "jpeg", bytes: input }],
        }).ok,
      ).toBe(true);
    }
  });
  it.each([195, 197, 198, 199, 201, 202, 203, 205, 206, 207])(
    "diagnoses unsupported JPEG SOF process %i explicitly",
    (marker) => {
      // Admission is based on the declared frame process, before entropy decoding.
      const jpeg = Uint8Array.from(atob(fixtures.jpeg), (c) => c.charCodeAt(0));
      const sof = jpeg.findIndex(
        (value, i) => value === 255 && [192, 193, 194].includes(jpeg[i + 1] ?? -1),
      );
      jpeg[sof + 1] = marker;
      expect(
        run({ images: { resourceId: "jpeg" } }, [image()], {
          resources: [{ id: "jpeg", bytes: jpeg }],
        }).diagnostics[0]?.code,
      ).toBe("UNSUPPORTED_FEATURE");
    },
  );
  it("uses the declared EXIF IFD offset in either byte order", () => {
    const jpeg = Uint8Array.from(atob(fixtures.jpeg), (c) => c.charCodeAt(0));
    for (const little of [true, false])
      for (const ifdOffset of [8, 16])
        for (const orientation of [1, 6]) {
          const exif = new Uint8Array(6 + ifdOffset + 18);
          exif.set([69, 120, 105, 102, 0, 0]);
          const tiff = new DataView(exif.buffer, 6);
          tiff.setUint16(0, little ? 0x4949 : 0x4d4d);
          tiff.setUint16(2, 42, little);
          tiff.setUint32(4, ifdOffset, little);
          tiff.setUint16(ifdOffset, 1, little);
          tiff.setUint16(ifdOffset + 2, 274, little);
          tiff.setUint16(ifdOffset + 4, 3, little);
          tiff.setUint32(ifdOffset + 6, 1, little);
          tiff.setUint16(ifdOffset + 10, orientation, little);
          const input = new Uint8Array(jpeg.length + exif.length + 4);
          input.set(jpeg.subarray(0, 2));
          input.set([255, 225, (exif.length + 2) >>> 8, (exif.length + 2) & 255], 2);
          input.set(exif, 6);
          input.set(jpeg.subarray(2), 6 + exif.length);
          const result = run({ images: { resourceId: "exif" } }, [image()], {
            resources: [{ id: "exif", bytes: input }],
          });
          expect(result.ok).toBe(orientation === 1);
          if (orientation !== 1) expect(result.diagnostics[0]?.code).toBe("UNSUPPORTED_FEATURE");
        }
  });
  it("rejects a truncated image and CRC mismatch", () => {
    const truncated = bytes.slice(0, 33);
    const corrupted = bytes.slice();
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] as number) ^ 1;
    for (const input of [truncated, corrupted])
      expect(
        run({ images: { resourceId: "bad" } }, [image()], {
          resources: [{ id: "bad", bytes: input }],
        }).diagnostics[0]?.code,
      ).toBe("MODEL_INVALID");
  });
  it.each([false, true])(
    "matches the explicitly migrated golden image sizes (aliases=%s)",
    (aliases) => {
      // Issue30/host explicitly splits the old {src,width,...} records into safe references
      // and template ImageOptions. This is not an implicit legacy-record import path.
      const options: ImageOptions[] = aliases
        ? [
            { maxWidthPx: 376, keepAspectRatio: true },
            { scaleRatio: 0.25, lockAspectRatio: true },
            { widthPx: 420, heightPx: 260, keepAspectRatio: true },
          ]
        : [
            { maxWidth: 376, preserveAspectRatio: true },
            { scale: 0.25, preserveAspectRatio: true },
            { width: 420, height: 260, preserveAspectRatio: true },
          ];
      const sourceTemplate = template(
        options.map((opts, i) => ({
          kind: "image-binding",
          nodeId: `img${i}`,
          bindingId: `ib${i}`,
          expression: { kind: "legacy", text: `images[${i}]` },
          options: { ...opts, legacyPixelDpi: 96 },
        })),
      );
      sourceTemplate.settings.bindingPolicyVersion = "legacy-compat-1";
      const compiled = compile(sourceTemplate);
      if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
      const bound = bind(compiled.template, {
        images: [
          { path: "assets/chart.png" },
          `data:image/png;base64,${fixtures.png}`,
          { resourceId: "chart" },
        ],
      });
      expect(bound.ok).toBe(true);
      const result = prepareMedia(bound.document, {
        resources: [{ id: "chart", bytes }],
        root: {
          id: "golden-example11",
          entries: [{ path: "assets/chart.png", resourceId: "chart" }],
        },
      });
      expect(result.ok).toBe(true);
      const actual = result.blocks.flatMap((b) => b.images ?? []);
      expect(actual).toHaveLength(3);
      for (const [i, expected] of goldenImages.media.entries()) {
        expect(actual[i]?.width).toBeCloseTo((expected.widthPx * 25.4) / 96, 10);
        expect(actual[i]?.height).toBeCloseTo((expected.heightPx * 25.4) / 96, 10);
        expect(actual[i]?.bytes).toEqual(bytes);
      }
      expect(new Set(actual.map((i) => i.resource.digest)).size).toBe(1);
    },
  );
  it.each(["strict-1", "legacy-compat-1"] as const)(
    "keeps image sizing independent of %s expression policy",
    (policy) => {
      for (const options of [{ width: 25.4 }, { width: 96, legacyPixelDpi: 96 as const }]) {
        const input = template([image(options)]);
        input.settings.bindingPolicyVersion = policy;
        const compiled = compile(input);
        if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
        const bound = bind(compiled.template, { images: fixtures.png });
        expect(bound.ok).toBe(true);
        const resolved = bound.document.body[0];
        if (resolved?.kind !== "image-binding") throw Error("Expected image");
        expect(resolved.options).toEqual(options);
        const result = prepareMedia(bound.document);
        expect(result.ok).toBe(true);
        expect(result.blocks[0]?.images?.[0]?.width).toBeCloseTo(25.4, 10);
      }
    },
  );
  it("preserves legacy integer text dimensions and pixel aliases through compile/bind", () => {
    for (const options of [
      {
        width: " +096 ",
        height: "48",
        scale: 2,
        maxWidth: "96",
        maxHeight: "48",
        legacyPixelDpi: 96 as const,
      },
      {
        widthPx: "96",
        heightPx: "+48",
        scaleRatio: 2,
        maxWidthPx: "96",
        maxHeightPx: "48",
        legacyPixelDpi: 96 as const,
      },
      { widthPx: "96", maxWidthPx: 96 },
    ]) {
      const result = run({ images: fixtures.png }, [
        image({ ...options, preserveAspectRatio: false }),
      ]);
      expect(result.ok).toBe(true);
      expect(result.blocks[0]?.images?.[0]?.width).toBeCloseTo(25.4, 10);
      if ("height" in options || "heightPx" in options)
        expect(result.blocks[0]?.images?.[0]?.height).toBeCloseTo(12.7, 10);
    }
    expect(run({ images: fixtures.png }, [image({ width: "96" })]).diagnostics[0]?.code).toBe(
      "MODEL_INVALID",
    );
  });
  it("keeps repeated media source scope and instance identity", () => {
    const body: BlockNode[] = [
      {
        kind: "repeat-block",
        nodeId: "repeat",
        bindingId: "rb",
        expression: { kind: "legacy", text: "rows" },
        repeatKey: { kind: "path", path: "id" },
        children: [image()],
      },
    ];
    const result = run(
      {
        rows: [
          { id: "a", images: fixtures.png },
          { id: "b", images: fixtures.png },
        ],
      },
      body,
    );
    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks.map((b) => b.source.instancePath?.[0]?.key)).toEqual(["a", "b"]);
    expect(result.blocks[1]?.source.dataPath).toBe("rows[1].images");
  });
  it.each(["https://example.org/a.png", "file:///tmp/a.png", "/etc/passwd", "C:\\a.png"])(
    "forbids arbitrary resource %s",
    (source) => {
      const result = run({ images: source });
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("RESOURCE_FORBIDDEN");
    },
  );
  it.each([
    "../a.png",
    "a/../../b.png",
    "%2e%2e/a.png",
    "a\\b.png",
    "/a.png",
    "a//b.png",
    "./a.png",
  ])("forbids unsafe relative path %s", (path) => {
    const result = run({ images: { path } });
    expect(result.diagnostics[0]?.code).toBe("RESOURCE_FORBIDDEN");
  });
  it("returns diagnostics for malformed host configuration and sparse entries", () => {
    const invalidResources = [
      null,
      {},
      [null],
      [undefined],
      new Array(1),
      [1],
      [[]],
      [{ id: 3, bytes }],
      [{ id: "x" }],
      [{ id: "x", bytes: null }],
    ];
    for (const resources of invalidResources) {
      const result = run({ images: fixtures.png }, [image()], {
        resources,
      } as unknown as MediaOptions);
      expect(result.ok).toBe(false);
      expect(result.diagnostics[0]?.code).toBe("MODEL_INVALID");
      expect(result.blocks).toHaveLength(0);
    }
    for (const root of [
      null,
      1,
      {},
      { id: 1, entries: [] },
      { id: "root", entries: null },
      { id: "root", entries: [null] },
      { id: "root", entries: new Array(1) },
      { id: "root", entries: [{ path: 1, resourceId: "x" }] },
    ]) {
      expect(
        run({ images: fixtures.png }, [image()], { root } as unknown as MediaOptions).diagnostics[0]
          ?.code,
      ).toBe("RESOURCE_FORBIDDEN");
    }
    for (const options of [null, [], { limits: null }, { limits: [] }])
      expect(
        run({ images: fixtures.png }, [image()], options as unknown as MediaOptions).diagnostics[0]
          ?.code,
      ).toBe("MODEL_INVALID");
  });
  it("rejects configuration accessors without invoking them", () => {
    const trap = () => {
      throw Error("Configuration accessors must not run");
    };
    const entry = Object.defineProperty({ bytes }, "id", { get: trap });
    const array = Object.defineProperty(new Array(1), "0", { get: trap });
    for (const resources of [[entry], array])
      expect(
        run({ images: fixtures.png }, [image()], { resources } as MediaOptions).diagnostics[0]
          ?.code,
      ).toBe("MODEL_INVALID");
    const options = Object.defineProperty({}, "resources", { get: trap });
    expect(run({ images: fixtures.png }, [image()], options).diagnostics[0]?.code).toBe(
      "MODEL_INVALID",
    );
    expect(
      run({ images: fixtures.png }, [image()], {
        limits: { imageBytes: null },
      } as unknown as MediaOptions).diagnostics[0]?.code,
    ).toBe("RESOURCE_LIMIT");
  });
  it("requires an explicit root and rejects duplicate external IDs", () => {
    expect(run({ images: { path: "chart.png" } }).diagnostics[0]?.code).toBe("RESOURCE_FORBIDDEN");
    expect(
      run({ images: { resourceId: "x" } }, [image()], {
        resources: [
          { id: "x", bytes },
          { id: "x", bytes },
        ],
      }).diagnostics[0]?.code,
    ).toBe("MODEL_INVALID");
  });
  it.each([
    "abc",
    "AA=A",
    "AB==",
    "AAA\n",
    "data:image/png,AAAA",
    "data:image/png;base64,",
    `data:image/jpeg;base64,${fixtures.png}`,
  ])("rejects malformed base64/MIME (%#)", (source) => {
    const result = run({ images: source });
    expect(result.diagnostics[0]?.code).toBe("MODEL_INVALID");
    expect(result.blocks).toHaveLength(0);
  });
  it.each(["R0lGODlhAQABAA==", "Qk0AAAAA", "SUkqAAAAAAA="])(
    "rejects GIF/BMP/TIFF explicitly (%#)",
    (source) => expect(run({ images: source }).diagnostics[0]?.code).toBe("UNSUPPORTED_FEATURE"),
  );
  it("rejects a nested oversized media list before indexing its elements", () => {
    const nested: JsonValue[] = Array(65).fill(null);
    Object.defineProperty(nested, "0", {
      get() {
        throw Error("Must reject before copying/indexing oversized input");
      },
    });
    for (const expression of ["images | first", "images | first | take:1", "images | at:0"]) {
      const block = image();
      if (block.kind !== "image-binding") throw Error("Expected image");
      block.expression = { kind: "legacy", text: expression };
      expect(run({ images: [nested] }, [block]).diagnostics[0]?.code).toBe("RESOURCE_LIMIT");
    }
  });
  it("rejects object/oversized media sort keys before serialization", () => {
    const objectKey = {
      get payload(): string {
        throw Error("Must not serialize unbounded key");
      },
    };
    for (const key of [objectKey, "a".repeat(1025), [1, 2]])
      for (const op of ["sort", "maxby", "minby"]) {
        const block = image();
        if (block.kind !== "image-binding") throw Error("Expected image");
        block.expression = { kind: "legacy", text: `images | ${op}:key` };
        expect(run({ images: [{ key }, { key }] }, [block]).diagnostics[0]?.code).toBe(
          "RESOURCE_LIMIT",
        );
      }
  });
  it("keeps bounded media sorting and prevents format pipelines", () => {
    const block = image();
    if (block.kind !== "image-binding") throw Error("Expected image");
    block.expression = { kind: "legacy", text: "images | sort:key | first | get:src" };
    expect(
      run(
        {
          images: [
            { key: 2, src: fixtures.png },
            { key: 1, src: fixtures.png },
          ],
        },
        [block],
      ).ok,
    ).toBe(true);
    block.expression = { kind: "legacy", text: "images | format:numeric:0.00" };
    expect(compile(template([block])).diagnostics[0]?.code).toBe("EXPRESSION_UNSUPPORTED");
    expect(compile(template([block])).diagnostics[0]?.message).toContain(
      "Media expressions select",
    );
  });
  it("projects wide raw records without any own-key enumeration", () => {
    const target: Record<string, JsonValue> = {};
    for (let i = 0; i < 10000; i++) target[`extra${i}`] = i;
    const source = new Proxy(target, {
      ownKeys() {
        throw Error("Must not enumerate raw image-reference keys");
      },
    });
    // Missing or ambiguous references fail with no key enumeration.
    expect(run({ images: source }).diagnostics[0]?.code).toBe("MODEL_INVALID");
    target.resourceId = "x";
    target.path = "chart.png";
    expect(run({ images: source }).diagnostics[0]?.code).toBe("MODEL_INVALID");
    delete target.path;
    const result = run({ images: source }, [image()], { resources: [{ id: "x", bytes }] });
    expect(result.ok).toBe(true);
    expect(result.blocks[0]?.source.kind).toBe("image-binding");
    const resolved = result.blocks[0]?.source;
    if (resolved?.kind !== "image-binding") throw Error("Expected image block");
    expect(resolved.sources).toEqual([{ resourceId: "x" }]);
    // Also exercise the public prepareMedia boundary directly, before Binder's projection.
    resolved.sources = [source as { resourceId: string }];
    const compiled = compile(template([image()]));
    if (!compiled.ok) throw Error("Compile failed");
    const bound = bind(compiled.template, { images: fixtures.png });
    bound.document.body = [resolved];
    expect(prepareMedia(bound.document, { resources: [{ id: "x", bytes }] }).ok).toBe(true);
  });

  it.each([
    ["strict-1", "if"],
    ["legacy-compat-1", "if"],
    ["legacy-compat-1", "count"],
  ] as const)("rejects object %s/%s media operations before enumeration", (policy, operation) => {
    const source = new Proxy(
      { field: "value" },
      {
        ownKeys() {
          throw Error("Object-consuming media operation must not enumerate keys");
        },
      },
    );
    const block = image();
    if (block.kind !== "image-binding") throw Error("Expected image");
    block.expression = {
      kind: "structured",
      source: "images",
      steps: [operation === "if" ? { op: "if", whenTrue: "unused" } : { op: "count" }],
    };
    const input = template([block]);
    input.settings.bindingPolicyVersion = policy;
    const compiled = compile(input);
    if (!compiled.ok) throw Error(JSON.stringify(compiled.diagnostics));
    expect(bind(compiled.template, { images: source }).diagnostics.map((d) => d.code)).toEqual([
      "RESOURCE_LIMIT",
    ]);
  });
  it("returns only the original budget diagnostic after failed media evaluation", () => {
    const barcodeBlock: BlockNode = {
      kind: "barcode-binding",
      nodeId: "b",
      bindingId: "bb",
      expression: { kind: "legacy", text: "images" },
      options: { symbology: "code128", width: 80, height: 20 },
    };
    for (const body of [[image()], [barcodeBlock]]) {
      const result = run({ images: Array(65).fill(null) }, body);
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((d) => d.code)).toEqual(["RESOURCE_LIMIT"]);
    }
  });
  it("bounds source identity metadata before image copies and digest serialization", () => {
    expect(
      run({ images: fixtures.png }, [image()], { limits: { metadataCharacters: 1 } }).diagnostics[0]
        ?.code,
    ).toBe("RESOURCE_LIMIT");
    const body: BlockNode[] = [
      {
        kind: "repeat-block",
        nodeId: "r",
        bindingId: "rb",
        expression: { kind: "legacy", text: "rows" },
        repeatKey: { kind: "path", path: "id" },
        children: [image()],
      },
    ];
    const result = run({ rows: [{ id: "k".repeat(1000001), images: fixtures.png }] }, body);
    expect(result.diagnostics.map((d) => d.code)).toEqual(["RESOURCE_LIMIT"]);
    expect(result.blocks).toHaveLength(0);
  });
  it("enforces list, decoded-byte, pixel, and work budgets before output", () => {
    expect(run({ images: Array(65).fill(fixtures.png) }).diagnostics[0]?.code).toBe(
      "RESOURCE_LIMIT",
    );
    for (const limits of [
      { imageBytes: 1 },
      { totalBytes: 1 },
      { pixels: 1 },
      { workUnits: 1 },
      { encodedCharacters: 1 },
    ]) {
      const result = run({ images: fixtures.png }, [image()], { limits });
      expect(result.diagnostics[0]?.code).toBe("RESOURCE_LIMIT");
      expect(result.blocks).toHaveLength(0);
    }
  });
  it("does not let NaN/zero/negative/oversized budget values disable limits", () => {
    for (const workUnits of [NaN, 0, -1, Infinity, 1000000000])
      expect(
        run({ images: fixtures.png }, [image()], { limits: { workUnits } }).diagnostics[0]?.code,
      ).toBe("RESOURCE_LIMIT");
  });
  it.each([
    ["code128", "A20260303001", "Code128"],
    ["code128", "01234567890123456789", "Code128"],
    ["code128", "Hello-123 ^FNC1", "Code128"],
    ["ean13", "6901234567892", "EAN13"],
    ["ean13", "4006381333931", "EAN13"],
  ] as const)("decodes %s %s from actual IR rectangles", async (symbology, value, format) => {
    const result = run({ value }, [
      {
        kind: "barcode-binding",
        nodeId: "bar",
        bindingId: "bb",
        expression: { kind: "legacy", text: "value" },
        options: { symbology, width: "80mm", height: "2cm", pure: true },
      },
    ]);
    expect(result.ok).toBe(true);
    const code = result.blocks[0]?.barcode;
    expect(code).toBeDefined();
    if (!code) return;
    expect(code.width).toBe(80);
    expect(code.height).toBe(20);
    expect(code.path.bounds).toEqual({ x: 0, y: 0, width: 80, height: 20 });
    const decoded = await readBarcodes(raster(code), {
      formats: ["Code128", "EAN13"],
      tryHarder: true,
    });
    expect(decoded.map((d) => ({ value: d.text, format: d.format }))).toEqual([{ value, format }]);
    expect(Object.isFrozen(code.path.commands)).toBe(true);
    expect(code.geometryDigest).toMatchSnapshot();
    const ir = barcodeFixture();
    ir.resources = [];
    ir.semantics = [];
    ir.markers = [];
    const page = ir.pages[0];
    if (!page) throw Error("Missing fixture page");
    page.objects = [{ ...code.path, stateId: "black" }];
    const canonical = canonicalizeLayoutIR(ir);
    const path = canonical.pages[0]?.objects[0];
    expect(path?.bounds.width).toBe(80000);
    expect(path?.bounds.height).toBe(20000);
    if (path?.kind !== "path") throw Error("Expected canonical barcode path");
    const mmCode = {
      ...code,
      path: {
        ...code.path,
        commands: path.commands.map((c) =>
          c.op === "move" || c.op === "line" ? { ...c, x: c.x / 1000, y: c.y / 1000 } : c,
        ),
      },
    };
    expect(
      (await readBarcodes(raster(mmCode), { formats: ["Code128", "EAN13"] })).map((d) => d.text),
    ).toEqual([value]);
    expect(quantizeMm(code.quietZone)).toBeGreaterThan(0);
    expect(barcode(value, { symbology, width: 80, height: 20 }).geometryDigest).toBe(
      code.geometryDigest,
    );
  });
});
describe("physical image dimensions", () => {
  it("rejects invalid intrinsic pixels even when explicit targets hide them", () => {
    for (const [w, h] of [
      [-96, -48],
      [0, 48],
      [NaN, 48],
      [96, Infinity],
      [0.5, 48],
      [32769, 1],
      [32768, 32768],
    ])
      error(
        () =>
          imageDimensions(w as number, h as number, {
            width: 10,
            height: 5,
            preserveAspectRatio: false,
          }),
        "RESOURCE_LIMIT",
      );
  });

  it.each([
    [{}, 25.4, 12.7],
    [{ width: 100 }, 100, 50],
    [{ height: 40 }, 80, 40],
    [{ width: 80, height: 30 }, 60, 30],
    [{ width: 80, height: 30, preserveAspectRatio: false }, 80, 30],
    [{ width: 80, height: 30, scale: 2, maxWidth: 100 }, 100, 50],
    [
      { width: 80, height: 30, scale: 2, maxWidth: 100, maxHeight: 40, preserveAspectRatio: false },
      100,
      40,
    ],
    [{ w: "1in", h: "72pt" }, 25.4, 12.7],
    [{ width: 96, legacyPixelDpi: 96 }, 25.4, 12.7],
  ] as [ImageOptions, number, number][])(
    "applies target/fit then scale then bounds (%#)",
    (options, w, h) => {
      const size = imageDimensions(96, 48, options);
      expect(size.width).toBeCloseTo(w, 8);
      expect(size.height).toBeCloseTo(h, 8);
    },
  );
  it.each([undefined, 96] as const)(
    "normalizes explicit pixel aliases exactly once (legacy=%s)",
    (legacyPixelDpi) => {
      for (const options of [
        { width: "1in", widthPx: 96 },
        { w: "2.54cm", widthPx: 96 },
        { heightPx: 48 },
        { maxWidthPx: 96, scaleRatio: 2 },
        { maxHeightPx: 48, scale: 2, scaleRatio: 2 },
      ]) {
        const size = imageDimensions(96, 48, { ...options, legacyPixelDpi });
        expect(size.width).toBeCloseTo(25.4, 10);
        expect(size.height).toBeCloseTo(12.7, 10);
      }
    },
  );
  it("preserves native continuous sizing and legacy stage rounding/defaults", () => {
    const mm = 25.4 / 96;
    expect(imageDimensions(3, 2, { width: 2, scale: 2, legacyPixelDpi: 96 })).toEqual({
      width: 4 * mm,
      height: 2 * mm,
    });
    expect(imageDimensions(96, 48, { width: 4, height: 3, legacyPixelDpi: 96 })).toEqual({
      width: 4 * mm,
      height: 3 * mm,
    });
    const native = imageDimensions(96, 48, { width: 4, height: 3 });
    expect(native.width).toBeCloseTo(4, 10);
    expect(native.height).toBeCloseTo(2, 10);
    expect(
      imageDimensions(96, 48, {
        widthPx: 4,
        heightPx: 3,
        keepAspectRatio: false,
        lockAspectRatio: false,
      }),
    ).toEqual({ width: 4 * mm, height: 3 * mm });
    expect(imageDimensions(3, 2, { widthPx: 2, scaleRatio: 2 }).height).toBeCloseTo(
      (8 * mm) / 3,
      10,
    );
    error(() => imageDimensions(96, 48, { maxWidth: "1mm", legacyPixelDpi: 96 }), "MODEL_INVALID");
    error(() => imageDimensions(96, 48, { width: 0.5, legacyPixelDpi: 96 }), "MODEL_INVALID");
    error(() => imageDimensions(100, 1, { maxWidthPx: 0.5, legacyPixelDpi: 96 }), "MODEL_INVALID");
    expect(imageDimensions(100, 1, { maxWidthPx: 1, maxHeightPx: 1, legacyPixelDpi: 96 })).toEqual({
      width: mm,
      height: mm,
    });
  });
  it("accepts equivalent integer text and rejects invalid/ambiguous legacy text", () => {
    expect(
      imageDimensions(96, 48, { width: "96", w: 96, widthPx: "+096", legacyPixelDpi: 96 }).width,
    ).toBeCloseTo(25.4, 10);
    for (const value of ["0", "-1", "96.5", "1e2", "1000001", "bad"])
      error(() => imageDimensions(96, 48, { width: value, legacyPixelDpi: 96 }), "MODEL_INVALID");
    error(
      () => imageDimensions(96, 48, { width: "96", widthPx: "97", legacyPixelDpi: 96 }),
      "MODEL_INVALID",
    );
  });
  it("rejects conflicting or invalid legacy aliases", () => {
    for (const options of [
      { width: "1in", widthPx: 97 },
      { maxHeight: 10, maxHeightPx: 10 },
      { scale: 2, scaleRatio: 3 },
      { preserveAspectRatio: true, keepAspectRatio: false },
      { keepAspectRatio: false, lockAspectRatio: true },
      { widthPx: NaN },
      { heightPx: 0 },
      { scaleRatio: 0 },
      { scaleRatio: Infinity },
    ])
      error(() => imageDimensions(96, 48, options), "MODEL_INVALID");
  });
  it("normalizes equal aliases and rejects conflicts and invalid dimensions", () => {
    expect(imageDimensions(96, 48, { width: "1in", w: "25.4mm" }).width).toBeCloseTo(25.4);
    for (const options of [
      { width: 2, w: 3 },
      { width: NaN },
      { width: 0 },
      { height: -1 },
      { scale: 0 },
      { scale: Infinity },
      { maxHeight: 0 },
      { width: "20%" },
      { width: "1000001mm" },
    ])
      error(() => imageDimensions(96, 48, options), "MODEL_INVALID");
  });
});
describe("barcode rejection and budgets", () => {
  const options: BarcodeOptions = { symbology: "code128", width: 80, height: 20 };
  it.each(["", "中文", "A\nB"])("rejects code128 value %s", (value) =>
    error(() => barcode(value, options), "BARCODE_VALUE_INVALID"),
  );
  it.each(["6901234567893", "690123456789", "69012345678x2"])(
    "rejects EAN13 length/charset/check digit %s",
    (value) =>
      error(() => barcode(value, { ...options, symbology: "ean13" }), "BARCODE_VALUE_INVALID"),
  );
  it("rejects tiny modules, quiet zones and labels", () => {
    error(() => barcode("hello", { ...options, width: 1 }), "MODEL_INVALID");
    error(() => barcode("hello", { ...options, quietZone: 0.1 }), "MODEL_INVALID");
    error(() => barcode("hello", { ...options, pure: false }), "UNSUPPORTED_FEATURE");
    error(() => barcode("a".repeat(257), options), "RESOURCE_LIMIT");
  });
  it("reserves path budget before drawing", () => {
    const result = run(
      { value: "A20260303001" },
      [
        {
          kind: "barcode-binding",
          nodeId: "b",
          bindingId: "bb",
          expression: { kind: "legacy", text: "value" },
          options,
        },
      ],
      { limits: { pathCommands: 1 } },
    );
    expect(result.diagnostics[0]?.code).toBe("RESOURCE_LIMIT");
  });
});
