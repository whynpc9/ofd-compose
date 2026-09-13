// biome-ignore-all lint/style/noNonNullAssertion: Fixed-cardinality fixtures are deliberately mutated in negative cases.
import { Value } from "@sinclair/typebox/value";
import { expect, it } from "vitest";
import {
  barcodeFixture,
  fixtureFactories,
  identityFixture,
  repeatedHeaderFixture,
  textFixture,
} from "../fixtures/index.js";
import {
  CanonicalLayoutIRSchema,
  canonicalizeLayoutIR,
  canonicalSerialize,
  clustersAtOffset,
  digestCanonical,
  digestLayoutIdentity,
  digestLayoutIR,
  digestSemanticDocument,
  formatNumber,
  offsetsForCluster,
  quantizeMm,
  validateCanonicalLayoutIR,
  validateLayoutIR,
  validateUtf16Range,
} from "../src/index.js";
import { boundDocumentFixture } from "./bound-document.js";
import expected from "./expected.json";

for (const [name, factory] of Object.entries(fixtureFactories)) {
  it(`${name}: browser/Node match independently pinned SHA-256`, () => {
    const ir = factory(),
      before = JSON.stringify(ir);
    expect(digestLayoutIR(ir)).toBe(expected[name as keyof typeof expected]);
    expect(Value.Check(CanonicalLayoutIRSchema, canonicalizeLayoutIR(ir))).toBe(true);
    expect(JSON.stringify(ir)).toBe(before);
    const shuffled = JSON.parse(canonicalSerialize(ir));
    shuffled.resources.reverse();
    shuffled.pages.reverse();
    shuffled.graphicsStates.reverse();
    shuffled.semantics.reverse();
    shuffled.markers.reverse();
    for (const p of shuffled.pages) {
      p.objects.reverse();
      for (const o of p.objects) if (o.kind === "text") o.clusters.reverse();
    }
    expect(digestLayoutIR(shuffled)).toBe(digestLayoutIR(ir));
  });
}
it("ID renaming does not alter layout identity; preserves source node IDs", () => {
  const ir = repeatedHeaderFixture(),
    before = digestLayoutIR(ir);
  for (const r of ir.resources) r.id = `x-${r.id}`;
  for (const s of ir.graphicsStates) s.id = `x-${s.id}`;
  for (const p of ir.pages) {
    p.id = `x-${p.id}`;
    for (const o of p.objects) {
      o.id = `x-${o.id}`;
      o.stateId = `x-${o.stateId}`;
      if (o.kind === "text") {
        o.fontId = `x-${o.fontId}`;
        for (const c of o.clusters) c.clusterId += 100;
        for (const g of o.glyphs) g.clusterId += 100;
      }
    }
  }
  for (const s of ir.semantics) s.objectId = `x-${s.objectId}`;
  for (const m of ir.markers) {
    m.id = `x-${m.id}`;
    m.pageId = `x-${m.pageId}`;
    if (m.objectId) m.objectId = `x-${m.objectId}`;
  }
  expect(digestLayoutIR(ir)).toBe(before);
  ir.semantics[0]!.nodeId = "changed-source";
  expect(digestLayoutIR(ir)).not.toBe(before);
});
it("actual draw and reading order changes alter digest", () => {
  const ir = barcodeFixture(),
    before = digestLayoutIR(ir),
    objects = ir.pages[0]!.objects;
  [objects[0]!.drawOrder, objects[1]!.drawOrder] = [objects[1]!.drawOrder, objects[0]!.drawOrder];
  expect(digestLayoutIR(ir)).not.toBe(before);
  const headers = repeatedHeaderFixture(),
    original = digestLayoutIR(headers);
  [headers.semantics[0]!.readingOrder, headers.semantics[1]!.readingOrder] = [1, 0];
  expect(digestLayoutIR(headers)).not.toBe(original);
});
it("keeps font faces, features and variations distinct even with identical bytes", () => {
  const ir = textFixture(),
    font = ir.resources.find((r) => r.kind === "font")!;
  if (font.kind !== "font") throw new Error("font");
  const before = digestLayoutIR(ir);
  font.faceIndex = 1;
  expect(digestLayoutIR(ir)).not.toBe(before);
  font.faceIndex = 0;
  font.features.liga = 0;
  expect(digestLayoutIR(ir)).not.toBe(before);
  font.features.liga = 1;
  font.variations.wght = 700;
  expect(digestLayoutIR(ir)).not.toBe(before);
  ir.resources.push({ ...font, id: "font-variant", variations: { wght: 400 } });
  expect(canonicalizeLayoutIR(ir).resources.filter((r) => r.kind === "font")).toHaveLength(2);
});
it("deduplicates identical resources and rewrites references", () => {
  const ir = textFixture(),
    before = digestLayoutIR(ir),
    font = ir.resources[0]!;
  ir.resources.push({ ...font, id: "duplicate" });
  const text = ir.pages[0]!.objects[0]!;
  if (text.kind === "text") text.fontId = "duplicate";
  expect(digestLayoutIR(ir)).toBe(before);
});
it.each([
  [1.2345, 1235],
  [-1.2345, -1235],
  [1.0055, 1006],
  [-0.0005, -1],
  [0.0004999, 0],
  [-0, 0],
  [1_000_000, 1_000_000_000],
  [1e-7, 0],
])("rounds %s mm to %s integer um", (mm, um) => expect(quantizeMm(mm)).toBe(um));
it("quantizes lengths only, includes matrix translations, rejects double quantization", () => {
  const ir = textFixture();
  ir.graphicsStates[0]!.transform = { a: 0.1234567, b: 0, c: 0, d: 1, e: 1.0055, f: -1.0055 };
  const result = canonicalizeLayoutIR(ir),
    state = result.graphicsStates[0]!;
  expect(state.transform).toEqual({ a: 0.1234567, b: 0, c: 0, d: 1, e: 1006, f: -1006 });
  expect(result.pages[0]!.width).toBe(210000);
  expect(() => canonicalizeLayoutIR(result)).toThrow("IR_SCHEMA");
  const text = ir.pages[0]!.objects[0]!;
  if (text.kind === "text") text.fontSize = 0.0001;
  expect(() => canonicalizeLayoutIR(ir)).toThrow("IR_SCHEMA");
});
it("provides ligature and surrogate cluster/offset mappings", () => {
  const text = textFixture().pages[0]!.objects[0]!;
  if (text.kind !== "text") throw new Error("text");
  expect(clustersAtOffset(text, 1)).toEqual([20]);
  expect(clustersAtOffset(text, 4)).toEqual([30]);
  expect(offsetsForCluster(text, 30).displayRange).toEqual({ start: 3, end: 5 });
  expect(() => clustersAtOffset(text, 2)).toThrow("IR_TEXT_RANGE");
  expect(() => validateUtf16Range("😀", { start: 0, end: 1 })).toThrow("IR_TEXT_RANGE");
  expect(clustersAtOffset(text, 5)).toEqual([]);
});
it("supports RTL glyph order and many-to-one combining clusters", () => {
  const ir = textFixture(),
    text = ir.pages[0]!.objects[0]!;
  if (text.kind !== "text") throw new Error("text");
  text.direction = "rtl";
  text.glyphs.reverse();
  for (const c of text.clusters) c.glyphIndices = c.glyphIndices.map((i) => 2 - i);
  expect(() => validateLayoutIR(ir)).not.toThrow();
  text.logicalText = "a\u0301";
  text.displayText = "a\u0301";
  for (const g of text.glyphs) g.clusterId = 9;
  text.clusters = [
    {
      clusterId: 9,
      logicalRange: { start: 0, end: 2 },
      displayRange: { start: 0, end: 2 },
      glyphIndices: [0, 1, 2],
    },
  ];
  expect(clustersAtOffset(text, 1)).toEqual([9]);
});
it.each([
  "missing-font",
  "missing-state",
  "duplicate-id",
  "duplicate-order",
  "invalid-range",
  "bad-cluster",
  "wrong-marker-page",
  "bad-subset",
])("rejects %s", (kind) => {
  const ir = repeatedHeaderFixture(),
    text = ir.pages[0]!.objects[0]!;
  if (text.kind !== "text") throw new Error("text");
  if (kind === "missing-font") text.fontId = "absent";
  if (kind === "missing-state") text.stateId = "absent";
  if (kind === "duplicate-id") ir.resources[0]!.id = ir.pages[0]!.id;
  if (kind === "duplicate-order") ir.pages[1]!.pageIndex = 0;
  if (kind === "invalid-range") text.clusters[0]!.displayRange.end = 2;
  if (kind === "bad-cluster") text.glyphs[0]!.clusterId = 999;
  if (kind === "wrong-marker-page") ir.markers[0]!.pageId = ir.pages[0]!.id;
  if (kind === "bad-subset") {
    const font = ir.resources[0]!;
    if (font.kind === "font") {
      font.subsetDigest = "c".repeat(64);
      font.glyphIdMap = [{ original: 0, subset: 0 }];
    }
  }
  expect(() => canonicalizeLayoutIR(ir)).toThrow(/IR_/);
});
it("provenance is excluded; supplied semantic digest is checked", () => {
  const ir = textFixture(),
    before = digestLayoutIR(ir);
  ir.provenance = { machine: "other", elapsedMs: 123, logId: "random" };
  expect(digestLayoutIR(ir)).toBe(before);
  ir.identity.semanticDigest = canonicalizeLayoutIR(ir).identity.semanticDigest;
  expect(digestLayoutIR(ir)).toBe(before);
  ir.identity.semanticDigest = "0".repeat(64);
  expect(() => digestLayoutIR(ir)).toThrow("IR_DIGEST_MISMATCH");
});
it("LayoutIdentity is order independent and includes every declared input", () => {
  const input = structuredClone(identityFixture),
    before = digestLayoutIdentity(input);
  expect(before).toBe(expected.identity);
  input.resources.reverse();
  input.profile.features.reverse();
  expect(digestLayoutIdentity(input)).toBe(before);
  for (const change of [
    () => {
      input.resolvedDocumentDigest = "9".repeat(64);
    },
    () => {
      input.resources[0]!.digest = "c".repeat(64);
    },
    () => {
      input.layoutOptions = { pagination: "other" };
    },
    () => {
      input.profile.version = "1";
    },
    () => {
      input.formattingPolicy.tzdataVersion = "next";
    },
    () => {
      input.shapingVersion = "next";
    },
  ]) {
    Object.assign(input, structuredClone(identityFixture));
    change();
    expect(digestLayoutIdentity(input)).not.toBe(before);
  }
  expect(() => digestLayoutIdentity({ ...input, provenance: { elapsedMs: 1 } })).toThrow(
    "IR_SCHEMA",
  );
  expect(
    digestSemanticDocument({ modelVersion: 1, body: ["hi"], provenance: { machine: "a" } }),
  ).toBe(digestSemanticDocument({ provenance: { machine: "b" }, body: ["hi"], modelVersion: 1 }));
});
it("serializes sorted keys, fixed decimals and standard SHA-256 bytes", () => {
  expect(canonicalSerialize({ z: -0, a: 1e-7 })).toBe('{"a":0.0000001,"z":0}');
  expect(formatNumber(-1.23e-8)).toBe("-0.0000000123");
  expect(digestCanonical("abc")).toBe(
    "6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25",
  );
  for (const invalid of [
    NaN,
    Infinity,
    undefined,
    new Date(),
    { a: undefined },
    new Array(2),
    {
      get a() {
        throw new Error("accessor invoked");
      },
    },
  ])
    expect(() => canonicalSerialize(invalid)).toThrow(/IR_/);
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  expect(() => canonicalSerialize(cyclic)).toThrow("IR_CYCLIC_VALUE");
});
it("rejects unsupported version, nonfinite lengths and out-of-range coordinates", () => {
  expect(() => canonicalizeLayoutIR({ ...textFixture(), irVersion: "next" })).toThrow(
    "IR_VERSION_UNSUPPORTED",
  );
  for (const value of [NaN, Infinity, 1_000_001]) {
    const ir = textFixture();
    ir.pages[0]!.width = value;
    expect(() => canonicalizeLayoutIR(ir)).toThrow(/IR_/);
  }
});
it("keeps canonical JSON byte order even for integer-looking object keys", () => {
  expect(canonicalSerialize({ "10": "ten", "2": "two", "1": "one" })).toBe(
    '{"1":"one","10":"ten","2":"two"}',
  );
  const hidden: unknown[] = [];
  Object.defineProperty(hidden, "hidden", { value: 1 });
  expect(() => canonicalSerialize(hidden)).toThrow("IR_NON_JSON_VALUE");
});
it("quantization error stays within half a micrometre across the supported range", () => {
  for (const value of [-999_999.9995, -20.000499, -1e-8, 0, 0.0005, 1.0055, 999_999.9995]) {
    expect(Math.abs(quantizeMm(value) / 1000 - value)).toBeLessThanOrEqual(0.000500001);
  }
});
it("rejects unknown font feature and variation tags instead of passing them through", () => {
  for (const field of ["features", "variations"] as const) {
    const ir = textFixture();
    const font = ir.resources.find((resource) => resource.kind === "font");
    if (font?.kind !== "font") throw new Error("Missing fixture font");
    font[field].unknownTag = 1;
    expect(() => validateLayoutIR(ir)).toThrow("IR_SCHEMA");
  }
});
it.each(["ttb", "btt"] as const)(
  "preserves %s shaping direction and vertical glyph geometry",
  (direction) => {
    const ir = textFixture();
    const text = ir.pages[0]!.objects[0]!;
    if (text.kind !== "text") throw new Error("Missing fixture text");
    text.direction = direction;
    for (const [index, glyph] of text.glyphs.entries()) {
      glyph.position = { x: 20, y: 25 + index * 4 };
      glyph.advance = { x: 0, y: direction === "ttb" ? 4.2335 : -4.2335 };
      glyph.offset = { x: -0.1255, y: 0.5 };
    }
    const canonicalText = canonicalizeLayoutIR(ir).pages[0]!.objects[0]!;
    if (canonicalText.kind !== "text") throw new Error("Missing canonical text");
    expect(canonicalText.direction).toBe(direction);
    expect(canonicalText.glyphs[0]!.advance.y).toBe(direction === "ttb" ? 4234 : -4234);
    expect(canonicalText.glyphs[0]!.offset).toEqual({ x: -126, y: 500 });
    const before = digestLayoutIR(ir);
    text.direction = "ltr";
    expect(digestLayoutIR(ir)).not.toBe(before);
  },
);
it("accepts the uint32 feature boundary and rejects values the shaper cannot consume", () => {
  const ir = textFixture();
  const font = ir.resources.find((resource) => resource.kind === "font");
  if (font?.kind !== "font") throw new Error("Missing fixture font");
  font.features.liga = 0xffffffff;
  expect(() => canonicalizeLayoutIR(ir)).not.toThrow();
  for (const value of [0x100000000, Number.MAX_SAFE_INTEGER, -1, 1.5]) {
    font.features.liga = value;
    expect(() => validateLayoutIR(ir)).toThrow("IR_SCHEMA");
  }
});
it("public writer validator accepts canonical JSON without re-quantizing or mutating", () => {
  for (const factory of Object.values(fixtureFactories)) {
    const canonical = JSON.parse(canonicalSerialize(canonicalizeLayoutIR(factory())));
    const before = canonicalSerialize(canonical);
    validateCanonicalLayoutIR(canonical);
    expect(canonicalSerialize(canonical)).toBe(before);
  }
  expect(() => validateCanonicalLayoutIR(textFixture())).toThrow("IR_SCHEMA");
});
it.each([
  "missing-state",
  "missing-font",
  "duplicate-id",
  "invalid-cluster",
  "semantic-digest",
  "marker-page",
])("canonical writer validator rejects %s", (failure) => {
  const canonical = canonicalizeLayoutIR(repeatedHeaderFixture());
  const text = canonical.pages[0]!.objects[0]!;
  if (text.kind !== "text") throw new Error("Missing fixture text");
  if (failure === "missing-state") text.stateId = "missing";
  if (failure === "missing-font") text.fontId = "missing";
  if (failure === "duplicate-id") canonical.resources[0]!.id = canonical.pages[0]!.id;
  if (failure === "invalid-cluster") text.clusters[0]!.displayRange.end = 2;
  if (failure === "semantic-digest") canonical.identity.semanticDigest = "0".repeat(64);
  if (failure === "marker-page") canonical.markers[0]!.pageId = canonical.pages[0]!.id;
  expect(() => validateCanonicalLayoutIR(canonical)).toThrow(/IR_/);
});

it("real bound documents produce the same semantic digest and LayoutIdentity in Node/browser", () => {
  const bound = boundDocumentFixture();
  expect(digestSemanticDocument(bound)).toBe(expected.boundDocument);
  expect(
    digestLayoutIdentity({
      ...identityFixture,
      resolvedDocumentDigest: digestSemanticDocument(bound),
    }),
  ).toBe(expected.boundIdentity);
  const node = { ...bound, runtime: { ...bound.runtime, tzdataVersion: "2026a" } };
  const browser = { ...bound, runtime: { ...bound.runtime, tzdataVersion: null } };
  expect(digestSemanticDocument(node)).toBe(digestSemanticDocument(browser));
  expect(
    digestSemanticDocument({ ...bound, settings: { ...bound.settings, locale: "en-US" } }),
  ).not.toBe(expected.boundDocument);
  expect(
    digestLayoutIdentity({
      ...identityFixture,
      resolvedDocumentDigest: expected.boundDocument,
      formattingPolicy: { ...identityFixture.formattingPolicy, tzdataVersion: "next" },
    }),
  ).not.toBe(expected.boundIdentity);
});
it.each([
  "pages",
  "objects",
  "resources",
  "graphicsStates",
  "semantics",
  "markers",
  "features",
  "clusters",
  "object-id",
  "duplicate-resource",
  "duplicate-state",
])("canonical validator rejects noncanonical %s without mutation", (change) => {
  const source = change === "objects" ? barcodeFixture() : repeatedHeaderFixture();
  source.graphicsStates.push({ ...source.graphicsStates[0]!, id: "extra-state", opacity: 0.5 });
  if (source.markers[0])
    source.markers.push({
      ...source.markers[0],
      id: "extra-marker",
      bounds: { ...source.markers[0].bounds, x: 21 },
    });
  const canonical = canonicalizeLayoutIR(source);
  if (change === "pages") canonical.pages.reverse();
  if (change === "objects") canonical.pages[0]!.objects.reverse();
  if (change === "resources") canonical.resources.reverse();
  if (change === "graphicsStates") canonical.graphicsStates.reverse();
  if (change === "semantics") {
    canonical.semantics.reverse();
    canonical.identity.semanticDigest = digestCanonical(canonical.semantics);
  }
  if (change === "markers") canonical.markers.reverse();
  if (change === "features") canonical.identity.layoutProfile.features.reverse();
  if (change === "clusters") {
    const text = canonical.pages[0]!.objects[0]!;
    if (text.kind === "text") text.clusters.reverse();
  }
  if (change === "object-id") {
    const old = canonical.pages[0]!.objects[0]!.id;
    canonical.pages[0]!.objects[0]!.id = "renamed";
    for (const semantic of canonical.semantics)
      if (semantic.objectId === old) semantic.objectId = "renamed";
    for (const marker of canonical.markers)
      if (marker.objectId === old) marker.objectId = "renamed";
    canonical.identity.semanticDigest = digestCanonical(canonical.semantics);
  }
  if (change === "duplicate-resource")
    canonical.resources.push({ ...canonical.resources[0]!, id: "duplicate-resource" });
  if (change === "duplicate-state")
    canonical.graphicsStates.push({ ...canonical.graphicsStates[0]!, id: "duplicate-state" });
  const before = canonicalSerialize(canonical);
  expect(() => validateCanonicalLayoutIR(canonical)).toThrow("IR_NON_CANONICAL");
  expect(canonicalSerialize(canonical)).toBe(before);
});
it.each(["\ud800", "\udc00"])(
  "rejects lone surrogate %j across construction and canonical text fields",
  (malformed) => {
    for (const field of ["logicalText", "displayText", "sourceText"] as const) {
      const ir = textFixture();
      const canonical = canonicalizeLayoutIR(ir);
      for (const candidate of [ir, canonical]) {
        const text = candidate.pages[0]!.objects[0]!;
        if (text.kind !== "text") throw new Error("Missing fixture text");
        if (field === "sourceText")
          candidate.semantics[0]!.sourceText = { text: malformed, range: { start: 0, end: 1 } };
        else text[field] = malformed;
      }
      expect(() => validateLayoutIR(ir)).toThrow("IR_TEXT_INVALID");
      expect(() => canonicalizeLayoutIR(ir)).toThrow("IR_TEXT_INVALID");
      expect(() => validateCanonicalLayoutIR(canonical)).toThrow("IR_TEXT_INVALID");
    }
  },
);
it("validates complete logical text even when no display clusters exist", () => {
  const ir = textFixture();
  const text = ir.pages[0]!.objects[0]!;
  if (text.kind !== "text") throw new Error("Missing fixture text");
  text.logicalText = "\ud800";
  text.displayText = "";
  text.clusters = [];
  text.glyphs = [];
  expect(() => validateLayoutIR(ir)).toThrow("IR_TEXT_INVALID");
});
it.each(["\ud800", "\udc00", "\ud800X", "X\udc00", "\udc00\ud800", "\ud800\ud800"])(
  "range validation rejects malformed complete string %j even outside the selected range",
  (text) => {
    expect(() => validateUtf16Range(text, { start: 0, end: 0 })).toThrow("IR_TEXT_INVALID");
  },
);
it.each(["en_US", "en US", "a--b", "-en", "en-", ""])(
  "rejects run language %j unsupported by TypographyCore",
  (language) => {
    const input = textFixture();
    const canonical = canonicalizeLayoutIR(input);
    for (const candidate of [input, canonical]) {
      const text = candidate.pages[0]!.objects[0]!;
      if (text.kind !== "text") throw new Error("Missing fixture text");
      text.language = language;
    }
    expect(() => validateLayoutIR(input)).toThrow("IR_SCHEMA");
    expect(() => validateCanonicalLayoutIR(canonical)).toThrow("IR_SCHEMA");
  },
);
it("accepts the same language syntax as the repository shaper", () => {
  for (const language of ["en", "zh-CN", "und", "zh-Hans-CN"]) {
    const input = textFixture();
    const text = input.pages[0]!.objects[0]!;
    if (text.kind !== "text") throw new Error("Missing fixture text");
    text.language = language;
    expect(() => canonicalizeLayoutIR(input)).not.toThrow();
  }
});
it("accepts solid and mixed-zero dashes but rejects zero-length cycles before and after quantization", () => {
  for (const dash of [[], [0, 1], [1, 0], [0.0005, 0]]) {
    const input = textFixture();
    input.graphicsStates[0]!.dash = dash;
    expect(() => canonicalizeLayoutIR(input)).not.toThrow();
  }
  const input = textFixture();
  input.graphicsStates[0]!.dash = [0, 0];
  expect(() => validateLayoutIR(input)).toThrow("IR_SCHEMA");
  const canonical = canonicalizeLayoutIR(textFixture());
  canonical.graphicsStates[0]!.dash = [0, 0];
  expect(() => validateCanonicalLayoutIR(canonical)).toThrow("IR_SCHEMA");
  input.graphicsStates[0]!.dash = [0.0001, 0.0001];
  expect(() => validateLayoutIR(input)).not.toThrow();
  expect(() => canonicalizeLayoutIR(input)).toThrow("IR_SCHEMA");
});
it("compares decimal page boundaries without binary-addition false positives or epsilon allowances", () => {
  const input = textFixture();
  const page = input.pages[0]!;
  page.width = 0.3;
  page.height = 0.3;
  page.contentBox = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
  expect(() => validateLayoutIR(input)).not.toThrow();
  const canonical = canonicalizeLayoutIR(input);
  expect(canonical.pages[0]!.contentBox).toEqual({ x: 100, y: 100, width: 200, height: 200 });
  page.contentBox.width = 0.20000000000000004;
  expect(() => validateLayoutIR(input)).toThrow("IR_PAGE_BOUNDS");
  page.contentBox.width = 0.2;
  page.contentBox.height = 0.20000000000000004;
  expect(() => validateLayoutIR(input)).toThrow("IR_PAGE_BOUNDS");
});
