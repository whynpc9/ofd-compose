import { digestLayoutIdentity } from "../src/canonicalize.js";
import {
  irVersion,
  type LayoutIdentityInput,
  type LayoutIR,
  type TextObject,
} from "../src/schema.js";

export const identityFixture: LayoutIdentityInput = {
  resolvedDocumentDigest: "1".repeat(64),
  resources: [
    { kind: "font", digest: "a".repeat(64) },
    { kind: "image", digest: "b".repeat(64) },
  ],
  layoutEngineVersion: "layout-poc@0",
  shapingVersion: "harfbuzzjs@1.6.0",
  lineBreakVersion: "uax14@17",
  formattingPolicy: {
    version: "format@0",
    locale: "zh-CN",
    timeZone: "Asia/Shanghai",
    tzdataVersion: "2026a",
    rounding: "half-away-from-zero",
  },
  profile: { name: "writer-fixture", version: "0", features: ["text", "path", "image"] },
  layoutOptions: { pagination: "fixed" },
};
const transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const bounds = { x: 20, y: 20, width: 40, height: 10 };
function base(): LayoutIR {
  return {
    irVersion,
    units: "mm",
    origin: "top-left",
    identity: {
      inputDigest: digestLayoutIdentity(identityFixture),
      layoutProfile: JSON.parse(JSON.stringify(identityFixture.profile)),
    },
    resources: [
      {
        id: "font",
        kind: "font",
        originalDigest: "a".repeat(64),
        faceIndex: 0,
        weight: 400,
        style: "normal",
        features: { liga: 1 },
        variations: {},
      },
      {
        id: "image",
        kind: "image",
        digest: "b".repeat(64),
        mimeType: "image/png",
        pixelWidth: 32,
        pixelHeight: 16,
      },
    ],
    graphicsStates: [
      {
        id: "black",
        transform: { ...transform },
        fillColor: { space: "srgb", r: 0, g: 0, b: 0 },
        strokeColor: { space: "srgb", r: 0, g: 0, b: 0 },
        opacity: 1,
        blendMode: "normal",
        lineWidth: 0.25,
        dash: [],
        dashOffset: 0,
        lineCap: "butt",
        lineJoin: "miter",
        miterLimit: 10,
      },
    ],
    pages: [
      {
        id: "page",
        pageIndex: 0,
        width: 210,
        height: 297,
        contentBox: { x: 20, y: 20, width: 170, height: 257 },
        orientation: "portrait",
        sectionId: "section-1",
        objects: [],
      },
    ],
    semantics: [],
    markers: [],
    provenance: { machine: "fixture", elapsedMs: 0 },
  };
}
export function textFixture(): LayoutIR {
  const ir = base();
  const text: TextObject = {
    id: "greeting",
    drawOrder: 0,
    stateId: "black",
    bounds: { ...bounds },
    kind: "text",
    logicalText: "A😀fi",
    displayText: "A😀fi",
    fontId: "font",
    fontSize: 4.233333,
    language: "en",
    direction: "ltr",
    baseline: { x: 20, y: 25 },
    glyphs: [
      {
        glyphId: 36,
        position: { x: 20, y: 25 },
        advance: { x: 3, y: 0 },
        offset: { x: 0, y: 0 },
        clusterId: 10,
      },
      {
        glyphId: 500,
        position: { x: 23, y: 25 },
        advance: { x: 4, y: 0 },
        offset: { x: 0, y: 0 },
        clusterId: 20,
      },
      {
        glyphId: 42,
        position: { x: 27, y: 25 },
        advance: { x: 3, y: 0 },
        offset: { x: 0, y: 0 },
        clusterId: 30,
      },
    ],
    clusters: [
      {
        clusterId: 10,
        logicalRange: { start: 0, end: 1 },
        displayRange: { start: 0, end: 1 },
        glyphIndices: [0],
      },
      {
        clusterId: 20,
        logicalRange: { start: 1, end: 3 },
        displayRange: { start: 1, end: 3 },
        glyphIndices: [1],
      },
      {
        clusterId: 30,
        logicalRange: { start: 3, end: 5 },
        displayRange: { start: 3, end: 5 },
        glyphIndices: [2],
      },
    ],
  };
  ir.pages[0]?.objects.push(text);
  ir.semantics.push({
    objectId: "greeting",
    nodeId: "paragraph-1",
    readingOrder: 0,
    sourceText: { text: "A😀fi", range: { start: 0, end: 5 } },
  });
  return ir;
}
export function tableFixture(): LayoutIR {
  const ir = base();
  ir.pages[0]?.objects.push({
    id: "border",
    drawOrder: 0,
    stateId: "black",
    bounds: { ...bounds },
    kind: "path",
    coordinateSpace: "page",
    commands: [
      { op: "move", x: 20, y: 20 },
      { op: "line", x: 60, y: 20 },
      { op: "line", x: 60, y: 30 },
      { op: "line", x: 20, y: 30 },
      { op: "close" },
    ],
    fillRule: "nonzero",
    fill: false,
    stroke: true,
  });
  ir.semantics.push({
    objectId: "border",
    nodeId: "cell-1",
    readingOrder: 0,
    table: { tableId: "table-1", row: 0, column: 0, rowSpan: 1, columnSpan: 1 },
  });
  return ir;
}
export function imageFixture(): LayoutIR {
  const ir = base();
  ir.pages[0]?.objects.push({
    id: "chart",
    drawOrder: 0,
    stateId: "black",
    bounds: { ...bounds },
    kind: "image",
    resourceId: "image",
    transform: { ...transform, e: 20, f: 20 },
    clip: {
      coordinateSpace: "local",
      fillRule: "nonzero",
      commands: [
        { op: "move", x: 0, y: 0 },
        { op: "line", x: 40, y: 0 },
        { op: "line", x: 40, y: 10 },
        { op: "line", x: 0, y: 10 },
        { op: "close" },
      ],
    },
  });
  return ir;
}
export function barcodeFixture(): LayoutIR {
  const ir = base();
  for (let index = 0; index < 4; index++) {
    ir.pages[0]?.objects.push({
      id: `bar-${index}`,
      drawOrder: index,
      stateId: "black",
      bounds: { x: 20 + index * 2, y: 20, width: 1, height: 10 },
      kind: "path",
      coordinateSpace: "page",
      commands: [
        { op: "move", x: 20 + index * 2, y: 20 },
        { op: "line", x: 21 + index * 2, y: 20 },
        { op: "line", x: 21 + index * 2, y: 30 },
        { op: "line", x: 20 + index * 2, y: 30 },
        { op: "close" },
      ],
      fillRule: "nonzero",
      fill: true,
      stroke: false,
    });
  }
  return ir;
}
export function repeatedHeaderFixture(): LayoutIR {
  const ir = textFixture(),
    second = JSON.parse(JSON.stringify(ir.pages[0])) as LayoutIR["pages"][number];
  if (!second) throw new Error("Missing fixture page");
  second.id = "page-2";
  second.pageIndex = 1;
  const header = second.objects[0];
  if (!header) throw new Error("Missing fixture text");
  header.id = "greeting-repeat";
  ir.pages.push(second);
  ir.semantics.push({
    objectId: header.id,
    nodeId: "paragraph-1",
    readingOrder: 1,
    repeatedHeader: { originalNodeId: "paragraph-1", instanceIndex: 1 },
  });
  ir.markers.push({
    id: "hit",
    pageId: second.id,
    kind: "selection-hit",
    bounds: { ...bounds },
    nodeId: "paragraph-1",
    objectId: header.id,
    signatureCoverage: "none",
  });
  return ir;
}
export const fixtureFactories = {
  text: textFixture,
  table: tableFixture,
  image: imageFixture,
  barcode: barcodeFixture,
  repeatedHeader: repeatedHeaderFixture,
};
