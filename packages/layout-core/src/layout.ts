import {
  type ResolvedBlock,
  type ResolvedDocument,
  ResolvedDocumentSchema,
  type ResolvedMedia,
  type ResolvedParagraph,
  type ResolvedTextFragment,
} from "@ofd-compose/binding-core";
import {
  type PageBand,
  type PageSettings,
  type ParagraphLayout,
  type Stroke,
  type TextStyle,
  TextStyleSchema,
  type Watermark,
} from "@ofd-compose/document-model";
import {
  canonicalizeLayoutIR,
  canonicalSerialize,
  digestCanonical,
  digestLayoutIdentity,
  digestSemanticDocument,
  irVersion,
  type LayoutIR,
  LayoutIRSchema,
  type TextObject,
} from "@ofd-compose/layout-ir";
import { type LayoutMediaSnapshot, mediaForLayout } from "@ofd-compose/media-core";
import {
  type FontMetrics,
  lineBreakOpportunities,
  shapingAndLineBreakVersions,
  TypographyCore,
} from "@ofd-compose/typography-core";
import { Value } from "@sinclair/typebox/value";
import {
  borderPath,
  clipRectangle,
  compose,
  identity,
  intersect,
  inverse,
  type Matrix,
  rectangle,
  transformedBox,
  validateBorderFits,
} from "./graphics.js";
import { type PageGeometry, pageGeometry } from "./page.js";

// Layout IR construction coordinates are bounded to one million millimetres.
const maxLayoutCoordinate = 1_000_000;

export const layoutEngineVersion = "ofd-compose/paginated-layout@0";
export const paragraphProfile = Object.freeze({
  name: "paragraphs-ltr",
  version: "0",
  features: Object.freeze([
    "paragraphs",
    "headings",
    "numbering",
    "text-decoration",
    "source-ranges",
    "pagination",
    "page-bands",
    "watermarks",
  ]),
});
export const mediaRegionProfile = Object.freeze({
  name: "media-regions-ltr",
  version: "0",
  features: Object.freeze([
    ...paragraphProfile.features,
    "frozen-media",
    "vector-paths",
    "regions",
  ]),
});
export const tableProfile = Object.freeze({
  name: "tables-ltr",
  version: "0",
  features: Object.freeze([
    ...mediaRegionProfile.features,
    "tables",
    "repeat-headers",
    "input-controls",
    "keep-with-next",
    "widow-orphan",
  ]),
});
function hasParagraphPaginationPolicy(layout: ParagraphLayout | undefined): boolean {
  return Boolean(
    (layout?.keepWithNext ?? layout?.role === "heading") ||
      layout?.orphanLines ||
      layout?.widowLines,
  );
}
function usesTableProfile(blocks: readonly ResolvedBlock[]): boolean {
  return blocks.some(
    (block) =>
      block.kind === "table" ||
      (block.kind === "region" && usesTableProfile(block.children)) ||
      (block.kind === "paragraph" &&
        (block.fragments.some((f) => f.kind === "input-control") ||
          hasParagraphPaginationPolicy(block.layout))),
  );
}
export const layoutResourceLimits = Object.freeze({
  inputTextUnits: 1000000,
  inputJsonNodes: 200000,
  inputJsonStringUnits: 8000000,
  inputJsonDepth: 128,
  fontResources: 64,
  fontFileBytes: 32 * 1024 * 1024,
  fontPackBytes: 128 * 1024 * 1024,
  paragraphs: 10000,
  fragments: 100000,
  sourceMappings: 100000,
  objects: 100000,
  pages: 1000,
  paginationPasses: 4,
  layoutParagraphs: 30000,
  imageResources: 64,
  imagePixels: 100000000,
});
// Read data descriptors only: preflight must not invoke accessors before canonical validation.
function ownData(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}
function preflightJsonTree(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0,
    strings = 0;
  while (pending.length) {
    const entry = pending.pop();
    if (!entry) break;
    nodes++;
    if (
      nodes > layoutResourceLimits.inputJsonNodes ||
      entry.depth > layoutResourceLimits.inputJsonDepth
    )
      throw new LayoutError("LAYOUT_LIMIT", "Input JSON node/depth budget exceeded");
    if (typeof entry.value === "string") strings += entry.value.length;
    else if (entry.value !== null && typeof entry.value === "object") {
      const prototype = Object.getPrototypeOf(entry.value);
      if (!Array.isArray(entry.value) && prototype !== Object.prototype && prototype !== null)
        throw new LayoutError(
          "LAYOUT_INPUT",
          "Document and options must contain plain JSON objects",
        );
      const remaining = layoutResourceLimits.inputJsonNodes - nodes - pending.length;
      if (Array.isArray(entry.value) && (ownData(entry.value, "length") as number) > remaining)
        throw new LayoutError("LAYOUT_LIMIT", "Input JSON array budget exceeded");
      const keys = Object.keys(entry.value);
      if (keys.length > remaining)
        throw new LayoutError("LAYOUT_LIMIT", "Input JSON property budget exceeded");
      for (const key of keys) {
        strings += key.length;
        if (strings > layoutResourceLimits.inputJsonStringUnits)
          throw new LayoutError("LAYOUT_LIMIT", "Input JSON string budget exceeded");
        const descriptor = Object.getOwnPropertyDescriptor(entry.value, key);
        if (descriptor && "value" in descriptor)
          pending.push({ value: descriptor.value, depth: entry.depth + 1 });
      }
    }
    if (strings > layoutResourceLimits.inputJsonStringUnits)
      throw new LayoutError("LAYOUT_LIMIT", "Input JSON string budget exceeded");
  }
}
function preflightDocument(value: unknown): void {
  const body = ownData(value, "body");
  if (!Array.isArray(body)) return;
  const count = ownData(body, "length") as number;
  if (count > layoutResourceLimits.paragraphs)
    throw new LayoutError("LAYOUT_LIMIT", "Document exceeds paragraph budget");
  let fragments = 0;
  let documentUnits = 0;
  const pending: unknown[] = [body];
  let blockCount = 0;
  let tableCells = 0,
    tableSlots = 0;
  while (pending.length) {
    const children = pending.pop();
    if (!Array.isArray(children)) continue;
    if (children.length > layoutResourceLimits.paragraphs - blockCount)
      throw new LayoutError("LAYOUT_LIMIT", "Nested block budget exceeded");
    for (let i = 0; i < children.length; i++) {
      blockCount++;
      const block = ownData(children, String(i));
      if (ownData(block, "kind") === "region") pending.push(ownData(block, "children"));
      if (ownData(block, "kind") === "table") {
        const rows = ownData(block, "rows");
        if (Array.isArray(rows)) {
          if (rows.length > 10000)
            throw new LayoutError("LAYOUT_LIMIT", "Table row budget exceeded before copying");
          const columns = ownData(ownData(block, "layout"), "columns");
          if (
            Array.isArray(columns) &&
            (columns.length > 1024 || rows.length * columns.length > 100000)
          )
            throw new LayoutError(
              "LAYOUT_LIMIT",
              "Table grid budget exceeded before resource acquisition",
            );
          for (let r = 0; r < rows.length; r++) {
            const row = ownData(rows, String(r)),
              cells = ownData(row, "cells");
            if (!Array.isArray(cells)) continue;
            tableCells += cells.length;
            if (tableCells > 100000)
              throw new LayoutError("LAYOUT_LIMIT", "Table cell budget exceeded before copying");
            let rowColumns = 0;
            for (let c = 0; c < cells.length; c++) {
              const cell = ownData(cells, String(c)),
                spec = ownData(cell, "layout");
              const rs = ownData(spec, "rowSpan") ?? 1,
                cs = ownData(spec, "columnSpan") ?? 1;
              if (typeof cs === "number") rowColumns += cs;
              if (
                !Array.isArray(columns) &&
                (rowColumns > 1024 || rows.length * rowColumns > 100000)
              )
                throw new LayoutError(
                  "LAYOUT_LIMIT",
                  "Inferred table grid budget exceeded before resource acquisition",
                );
              if (typeof rs === "number" && typeof cs === "number") tableSlots += rs * cs;
              if (tableSlots > 100000)
                throw new LayoutError("LAYOUT_LIMIT", "Table span budget exceeded before copying");
              pending.push(ownData(cell, "blocks"));
            }
          }
        }
      }

      const entries = ownData(block, "fragments");
      if (!Array.isArray(entries)) continue;
      const size = ownData(entries, "length") as number;
      fragments += size;
      if (fragments > layoutResourceLimits.fragments)
        throw new LayoutError("LAYOUT_LIMIT", "Document exceeds fragment budget");
      let units = 0;
      for (let j = 0; j < size; j++) {
        const entry = ownData(entries, String(j));
        const text =
          ownData(entry, "kind") === "input-control"
            ? (ownData(entry, "defaultValue") ?? ownData(entry, "placeholder") ?? "")
            : ownData(entry, "text");
        if (typeof text !== "string") continue;
        units += text.length;
        documentUnits += text.length;
        if (documentUnits > layoutResourceLimits.inputTextUnits)
          throw new LayoutError("LAYOUT_LIMIT", "Document input text budget exceeded");
        if (units > 100000 || !text.isWellFormed())
          throw new LayoutError(
            "LAYOUT_INPUT",
            "Paragraph must be well-formed UTF-16 with at most 100000 units",
          );
      }
    }
  }
}
const pt = 25.4 / 72;
export class LayoutError extends Error {
  constructor(
    readonly code:
      | "LAYOUT_INPUT"
      | "LAYOUT_UNSUPPORTED"
      | "LAYOUT_OVERFLOW"
      | "LAYOUT_LIMIT"
      | "FONT_UNAVAILABLE"
      | "PAGINATION_NOT_CONVERGED",
    message: string,
    readonly nodeId?: string,
  ) {
    super(message);
    this.name = "LayoutError";
  }
}
export interface LayoutFont {
  family: string;
  weight: number;
  italic: boolean;
  sha256: string;
  bytes: Uint8Array | Promise<Uint8Array>;
}
export interface LayoutOptions {
  page?: {
    width: number;
    height: number;
    contentBox: { x: number; y: number; width: number; height: number };
  };
  /** Fixed, host-authorized image descriptors; bytes are supplied to writers by the host. */
  images?: Extract<LayoutIR["resources"][number], { kind: "image" }>[];
  pagination?: { maxPages?: number; maxIterations?: number };
  defaultStyle: TextStyle & { fontFamily: string; fontSize: number };
  /** Matches the formatting policy used to produce this ResolvedDocument. */
  formattingPolicy: {
    version: string;
    locale: string;
    timeZone: string;
    tzdataVersion: string;
    rounding: string;
  };
}
interface Face {
  definition: Omit<LayoutFont, "bytes">;
  metrics: FontMetrics;
  id: string;
}
interface Span {
  controlId?: string;
  start: number;
  end: number;
  fragment: ResolvedTextFragment;
}
interface Run {
  separateAfter?: boolean;
  start: number;
  end: number;
  style: TextStyle;
  face: Face;
  script: string;
  control: boolean;
}
interface Piece {
  run: Run;
  start: number;
  end: number;
  text: string;
  width: number;
  size: number;
  shift: number;
  ascent: number;
  descent: number;
  shaped?: ReturnType<TypographyCore["shape"]>;
}
export interface LayoutLine {
  nodeId: string;
  paragraphIndex: number;
  pageIndex: number;
  sectionId: string;
  sectionSourceId?: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
}

/** Chinese opening/closing punctuation classes supplement UAX #14, including trailing spaces. */
const opening = new Set(Array.from("（［｛〈《「『【〔〖〘〚‘“﹙﹛﹝"));
const closing = new Set(Array.from("）］｝〉》」』】〕〗〙〛’”、。，．！？：；％‰…﹚﹜﹞"));
export function permitsChineseBreak(text: string, position: number): boolean {
  let before = position,
    after = position;
  while (before > 0 && (text[before - 1] === " " || text[before - 1] === "\t")) before--;
  while (after < text.length && (text[after] === " " || text[after] === "\t")) after++;
  const low = text.charCodeAt(before - 1);
  const high = text.charCodeAt(before - 2);
  const leftStart =
    low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? before - 2 : before - 1;
  const left = before > 0 ? String.fromCodePoint(text.codePointAt(leftStart) ?? 0) : "";
  const right = after < text.length ? String.fromCodePoint(text.codePointAt(after) ?? 0) : "";
  return !opening.has(left) && !closing.has(right);
}
/** Preclassify once so a whitespace run shared by many candidates is never rescanned. */
function chineseBreakChecker(text: string): (position: number) => boolean {
  const before = new Uint8Array(text.length + 1),
    after = new Uint8Array(text.length + 1);
  let blocked = false;
  for (let i = 0; i < text.length; i++) {
    const character = text[i] ?? "";
    if (character !== " " && character !== "\t") blocked = opening.has(character);
    before[i + 1] = Number(blocked);
  }
  blocked = false;
  for (let i = text.length - 1; i >= 0; i--) {
    const character = text[i] ?? "";
    if (character !== " " && character !== "\t") blocked = closing.has(character);
    after[i] = Number(blocked);
  }
  return (position) => before[position] === 0 && after[position] === 0;
}
/** First ordered range intersecting an offset; avoids rescanning consumed run/source prefixes. */
function firstEndingAfter(ranges: readonly { end: number }[], offset: number): number {
  let low = 0,
    high = ranges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((ranges[middle]?.end ?? 0) <= offset) low = middle + 1;
    else high = middle;
  }
  return low;
}
function upperBound(values: readonly number[], value: number): number {
  let low = 0,
    high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((values[middle] ?? 0) <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}
function scriptOf(character: string): string | undefined {
  const cp = character.codePointAt(0) ?? 0;
  if ((cp >= 0x3400 && cp <= 0x9fff) || (cp >= 0x20000 && cp <= 0x2a6df)) return "Hani";
  if (cp >= 0x3040 && cp <= 0x309f) return "Hira";
  if (cp >= 0x30a0 && cp <= 0x30ff) return "Kana";
  if (cp >= 0x3100 && cp <= 0x312f) return "Bopo";
  if (cp >= 0x370 && cp <= 0x3ff) return "Grek";
  if (cp >= 0x400 && cp <= 0x4ff) return "Cyrl";
  if (/[A-Za-z]/u.test(character) || (cp >= 0xc0 && cp <= 0x2af) || (cp >= 0x1e00 && cp <= 0x1eff))
    return "Latn";
  return undefined;
}
const isControl = (text: string) => /^[\t\r\n\u2028\u2029]+$/u.test(text);
function color(value = "#000000") {
  return {
    space: "srgb" as const,
    r: Number.parseInt(value.slice(1, 3), 16) / 255,
    g: Number.parseInt(value.slice(3, 5), 16) / 255,
    b: Number.parseInt(value.slice(5, 7), 16) / 255,
  };
}
function alpha(value: number): string {
  let result = "";
  for (let n = value; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(97 + ((n - 1) % 26)) + result;
  return result;
}

/** Multi-page layout. Resource I/O belongs to the host; every promise settles before metrics/shaping. */
export async function layout(
  document: ResolvedDocument,
  resources: readonly LayoutFont[],
  options: LayoutOptions,
  preparedMedia?: object,
) {
  preflightJsonTree(document);
  preflightDocument(document);
  preflightJsonTree(options);
  const imageInputs = ownData(options, "images");
  if (
    Array.isArray(imageInputs) &&
    (ownData(imageInputs, "length") as number) > layoutResourceLimits.imageResources
  )
    throw new LayoutError("LAYOUT_LIMIT", "Image descriptor budget exceeded before ownership copy");
  // Own inputs before any await: arrival timing and caller mutation cannot change layout identity.
  const doc = JSON.parse(canonicalSerialize(document)) as ResolvedDocument;
  const opts = JSON.parse(canonicalSerialize(options)) as LayoutOptions;
  validatePaginationOptions(opts);
  if (!Value.Check(TextStyleSchema, opts.defaultStyle))
    throw new LayoutError("LAYOUT_INPUT", "Invalid default style");
  if (!Value.Check(ResolvedDocumentSchema, doc))
    throw new LayoutError("LAYOUT_INPUT", "Invalid ResolvedDocument");
  const media = preparedMedia === undefined ? undefined : mediaForLayout(preparedMedia);
  const sourceDigests: string[] = [];
  const collectMedia = (blocks: ResolvedBlock[]) => {
    for (const block of blocks) {
      if (block.kind === "region") collectMedia(block.children);
      else if (block.kind === "table")
        for (const row of block.rows) for (const cell of row.cells) collectMedia(cell.blocks);
      else if (block.kind === "image-binding" || block.kind === "barcode-binding")
        sourceDigests.push(digestCanonical(block));
    }
  };
  collectMedia(doc.body);
  if (
    sourceDigests.length !== (media?.blocks.length ?? 0) ||
    sourceDigests.some((digest, i) => digest !== media?.blocks[i]?.sourceDigest)
  )
    throw new LayoutError(
      "LAYOUT_INPUT",
      "Media preparation does not match current resolved input",
    );
  const preparedResources = new Map<string, { pixelWidth: number; pixelHeight: number }>();
  for (const block of media?.blocks ?? [])
    for (const image of block.images ?? [])
      preparedResources.set(image.resource.id, image.resource);
  let aggregatePixels = 0;
  if ((opts.images?.length ?? 0) + preparedResources.size > layoutResourceLimits.imageResources)
    throw new LayoutError("LAYOUT_LIMIT", "Combined media/watermark resource count exceeds budget");
  for (const image of [...(opts.images ?? []), ...preparedResources.values()]) {
    aggregatePixels += image.pixelWidth * image.pixelHeight;
    if (aggregatePixels > layoutResourceLimits.imagePixels)
      throw new LayoutError("LAYOUT_LIMIT", "Combined media/watermark pixels exceed budget");
  }
  // Reject a known minimum page count and impossible section geometry before acquiring fonts.
  let minimumPages = 1;
  const firstBlock = doc.body[0];
  const initialPage =
    firstBlock?.kind === "paragraph"
      ? (firstBlock.layout?.section?.page ?? doc.settings.page)
      : doc.settings.page;
  if (initialPage) pageGeometry(initialPage);
  const sections = new Set<string>();
  for (const [index, block] of doc.body.entries()) {
    if (block.kind !== "paragraph") continue;
    const section = block.layout?.section;
    if (section) {
      const occurrence = sectionOccurrenceId(block, doc.documentId);
      if (sections.has(occurrence))
        throw new LayoutError("LAYOUT_INPUT", "Section IDs must be unique", block.nodeId);
      sections.add(occurrence);
      pageGeometry(section.page);
      if (index > 0) minimumPages++;
    }
    if (block.layout?.pageBreakBefore) minimumPages++;
    if (minimumPages > (opts.pagination?.maxPages ?? layoutResourceLimits.pages))
      throw new LayoutError(
        "LAYOUT_LIMIT",
        "Explicit breaks exceed page budget before resource acquisition",
        block.nodeId,
      );
  }
  if (!Array.isArray(resources) || resources.length > layoutResourceLimits.fontResources)
    throw new LayoutError("LAYOUT_LIMIT", "Font resource count budget exceeded");
  const inputs = resources.map((resource) => {
    const { family, weight, italic, sha256, bytes } = resource;
    if (
      typeof family !== "string" ||
      !family.length ||
      family.length > 256 ||
      !Number.isInteger(weight) ||
      weight < 1 ||
      weight > 1000 ||
      typeof italic !== "boolean" ||
      typeof sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new LayoutError("LAYOUT_INPUT", "Invalid font resource definition");
    return { definition: { family, weight, italic, sha256 }, source: bytes };
  });
  let fontBytes = 0,
    failed = false;
  const reserve = (bytes: Uint8Array) => {
    if (!(bytes instanceof Uint8Array))
      throw new LayoutError("LAYOUT_INPUT", "Font bytes must be Uint8Array");
    if (
      bytes.byteLength > layoutResourceLimits.fontFileBytes ||
      bytes.byteLength > layoutResourceLimits.fontPackBytes - fontBytes
    )
      throw new LayoutError("LAYOUT_LIMIT", "Font byte budget exceeded before ownership copy");
    fontBytes += bytes.byteLength;
  };
  // Preflight all direct buffers before copying any; promised buffers reserve atomically on arrival.
  for (const input of inputs) if (input.source instanceof Uint8Array) reserve(input.source);
  const pending = inputs.map(({ definition, source }) => {
    if (source instanceof Uint8Array)
      return Promise.resolve({ definition, bytes: new Uint8Array(source) });
    return Promise.resolve(source)
      .then((bytes) => {
        if (failed) throw new LayoutError("LAYOUT_LIMIT", "Font acquisition was aborted");
        try {
          reserve(bytes);
          return { definition, bytes: new Uint8Array(bytes) };
        } catch (error) {
          failed = true;
          throw error;
        }
      })
      .catch((error) => {
        failed = true;
        throw error;
      });
  });
  const loaded = await Promise.all(pending);
  loaded.sort((a, b) =>
    canonicalSerialize(a.definition) < canonicalSerialize(b.definition)
      ? -1
      : canonicalSerialize(a.definition) > canonicalSerialize(b.definition)
        ? 1
        : 0,
  );
  const core = new TypographyCore();
  const faces: Face[] = [];
  for (const { definition, bytes } of loaded) {
    if (
      faces.some(
        (f) =>
          f.definition.family === definition.family &&
          f.definition.weight === definition.weight &&
          f.definition.italic === definition.italic,
      )
    )
      throw new LayoutError("LAYOUT_INPUT", "Ambiguous font family/style mapping");
    const metrics = core.loadFont(bytes, definition.sha256);
    if (metrics.os2.weight !== definition.weight || metrics.os2.italic !== definition.italic)
      throw new LayoutError("FONT_UNAVAILABLE", "Declared font style differs from static face");
    faces.push({ definition, metrics, id: `font${faces.length}` });
  }
  const work = {
    shapedUnits: 0,
    candidateVisits: 0,
    runVisits: 0,
    outputTextUnits: 0,
    sourceMappings: 0,
    emittedObjects: 0,
    paragraphs: 0,
    pages: 0,
    pathCommands: 0,
    regionAttempts: 0,
  };
  const maxIterations = opts.pagination?.maxIterations ?? layoutResourceLimits.paginationPasses;
  let totalPages = 1;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const { usesTotalPages, ...result } = new ParagraphLayouter(
      doc,
      faces,
      core,
      opts,
      work,
      totalPages,
      media,
    ).layout();
    if (!usesTotalPages || result.ir.pages.length === totalPages)
      return { ...result, paginationPasses: iteration };
    totalPages = result.ir.pages.length;
  }
  throw new LayoutError(
    "PAGINATION_NOT_CONVERGED",
    "Total-page field did not converge within the pagination pass budget",
  );
}

/** Canonical tuples retain source identity and every enclosing node/key boundary. */
function sectionOccurrenceId(paragraph: ResolvedParagraph, rootSectionId: string): string {
  const section = paragraph.layout?.section;
  if (!section) throw new Error("Missing section marker");
  if (!paragraph.instancePath?.length) return section.id;
  // Explicit source section IDs cannot start with @ under the model schema. The implicit
  // root uses an arbitrary documentId, so avoid that one value too. Doubling @ cannot
  // collide with another generated ID, which always starts with the single @section: prefix.
  const generated = `@section:${canonicalSerialize([section.id, paragraph.instancePath.map((instance) => [instance.nodeId, instance.key])])}`;
  return generated === rootSectionId ? `@${generated}` : generated;
}

/** Keep legacy root IDs unless an explicit source section uses that public document ID. */
function implicitRootSectionId(doc: ResolvedDocument): string {
  const collides = doc.body.some(
    (block) =>
      block.kind === "paragraph" &&
      !block.instancePath?.length &&
      block.layout?.section?.id === doc.documentId,
  );
  // Explicit IDs exclude @, repeated IDs start @section: (or @@section:), so this
  // structurally encoded root namespace cannot collide with either category.
  return collides ? `@root:${canonicalSerialize(doc.documentId)}` : doc.documentId;
}

interface LayoutWork {
  shapedUnits: number;
  candidateVisits: number;
  runVisits: number;
  outputTextUnits: number;
  sourceMappings: number;
  emittedObjects: number;
  paragraphs: number;
  pages: number;
  pathCommands: number;
  regionAttempts: number;
}
function validatePaginationOptions(options: LayoutOptions) {
  for (const [value, limit] of [
    [options.pagination?.maxPages, layoutResourceLimits.pages],
    [options.pagination?.maxIterations, layoutResourceLimits.paginationPasses],
  ])
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > (limit ?? 0)))
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Pagination limits must be positive integers within engine limits",
      );
  if (options.images !== undefined && !Array.isArray(options.images))
    throw new LayoutError("LAYOUT_INPUT", "Images must be a descriptor array");
  if ((options.images?.length ?? 0) > layoutResourceLimits.imageResources)
    throw new LayoutError("LAYOUT_LIMIT", "Image descriptor budget exceeded");
  let pixels = 0;
  const imageIds = new Set<string>();
  for (const image of options.images ?? []) {
    if (!Value.Check(LayoutIRSchema.properties.resources.items, image) || image.kind !== "image")
      throw new LayoutError("LAYOUT_INPUT", "Invalid image descriptor");
    if (imageIds.has(image.id)) throw new LayoutError("LAYOUT_INPUT", "Duplicate image source ID");
    imageIds.add(image.id);
    pixels += image.pixelWidth * image.pixelHeight;
    if (!Number.isSafeInteger(pixels) || pixels > layoutResourceLimits.imagePixels)
      throw new LayoutError("LAYOUT_LIMIT", "Image pixel budget exceeded");
  }
}

class ParagraphLayouter {
  private readonly ir: LayoutIR;
  private readonly diagnostics: {
    code: "LAYOUT_OVERFLOW";
    severity: "warning";
    phase: "layout";
    nodeId: string;
    pageIndex: number;
    message: string;
  }[] = [];
  private mediaIndex = 0;
  private fontScale = 1;
  private fontFloor = 0;
  private inRegion = false;
  private horizontalOverflow = false;
  private readonly barcodeObjects = new Map<string, { height: number; moduleWidth: number }>();
  private readonly mediaImages = new Map<
    string,
    Extract<LayoutIR["resources"][number], { kind: "image" }>
  >();
  private readonly lines: LayoutLine[] = [];
  private readonly counts = new Map<string, number>();
  private readonly initializedRepeatStarts = new Set<string>();
  private y: number;
  private pageIndex = 0;
  private usesTotalPages = false;
  private readonly imagesBySourceId = new Map<
    string,
    Extract<LayoutIR["resources"][number], { kind: "image" }>
  >();
  private sectionId: string;
  private sectionSourceId: string;
  private sectionStart = 0;
  private pageSettings?: PageSettings;
  private geometry: PageGeometry;
  private readonly sectionIds = new Set<string>();
  private decoration = false;
  private decorationBox?: PageGeometry["contentBox"];
  private readonly pageSettingsByIndex: (PageSettings | undefined)[] = [];
  private readonly sectionStarts: number[] = [];
  constructor(
    private readonly doc: ResolvedDocument,
    private readonly faces: Face[],
    private readonly core: TypographyCore,
    private readonly options: LayoutOptions,
    private readonly work: LayoutWork,
    private readonly totalPages: number,
    private readonly media?: LayoutMediaSnapshot,
  ) {
    const { formattingPolicy, defaultStyle } = options;
    this.pageSettings = doc.settings.page;
    const first = doc.body[0];
    if (first?.kind === "paragraph" && first.layout?.section)
      this.pageSettings = first.layout.section.page;
    const page = this.pageSettings ? pageGeometry(this.pageSettings) : options.page;
    this.sectionId =
      first?.kind === "paragraph" && first.layout?.section
        ? sectionOccurrenceId(first, doc.documentId)
        : implicitRootSectionId(doc);
    this.sectionSourceId =
      first?.kind === "paragraph" ? (first.layout?.section?.id ?? doc.documentId) : doc.documentId;
    this.sectionIds.add(this.sectionId);
    const selectedProfile = usesTableProfile(doc.body)
      ? tableProfile
      : doc.body.some((block) => block.kind !== "paragraph" || block.layout?.border)
        ? mediaRegionProfile
        : paragraphProfile;
    const profile = { ...selectedProfile, features: [...selectedProfile.features] };
    if (
      !page ||
      !defaultStyle?.fontFamily ||
      !Number.isFinite(defaultStyle.fontSize) ||
      defaultStyle.fontSize <= 0 ||
      !formattingPolicy ||
      formattingPolicy.locale !== doc.settings.locale ||
      formattingPolicy.timeZone !== doc.settings.timeZone
    )
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Page, default font and matching formatting policy are required",
      );
    this.geometry = page;
    this.y = page.contentBox.y;
    for (const [index, image] of (options.images ?? []).entries())
      this.imagesBySourceId.set(image.id, { ...image, id: `image${index}` });
    for (const block of media?.blocks ?? [])
      for (const image of block.images ?? []) {
        if (!this.mediaImages.has(image.resource.id))
          this.mediaImages.set(image.resource.id, {
            ...image.resource,
            id: `mediaImage${this.mediaImages.size}`,
          });
      }
    this.ir = {
      irVersion,
      units: "mm",
      origin: "top-left",
      identity: {
        inputDigest: digestLayoutIdentity({
          resolvedDocumentDigest: digestSemanticDocument(doc),
          resources: [
            ...faces.map((f) => ({ kind: "font", digest: f.definition.sha256 })),
            ...(options.images ?? []).map((i) => ({ kind: "image", digest: i.digest })),
            ...[...this.mediaImages.values()].map((i) => ({ kind: "image", digest: i.digest })),
          ],
          layoutEngineVersion,
          shapingVersion: canonicalSerialize(shapingAndLineBreakVersions),
          lineBreakVersion: `${shapingAndLineBreakVersions.linebreak}/chinese-v1`,
          formattingPolicy,
          profile,
          layoutOptions: {
            ...JSON.parse(canonicalSerialize(options)),
            fonts: faces.map((f) => f.definition),
            ...(media ? { mediaIdentity: media.mediaIdentity } : {}),
          },
        }),
        layoutProfile: profile,
      },
      resources: [
        ...faces.map((f): LayoutIR["resources"][number] => ({
          id: f.id,
          kind: "font",
          originalDigest: f.definition.sha256,
          faceIndex: 0,
          weight: f.definition.weight,
          style: f.definition.italic ? "italic" : "normal",
          features: {},
          variations: {},
        })),
        ...this.imagesBySourceId.values(),
        ...this.mediaImages.values(),
      ],
      graphicsStates: [],
      pages: [],
      semantics: [],
      markers: [],
    };
    this.newPage(true);
    // Validate geometry/identity even for an empty document before doing expensive work.
    canonicalizeLayoutIR(this.ir);
  }
  layout() {
    this.doc.body.forEach((block, index) => {
      this.block(block, index);
    });
    // Decorations share this job's shaping/output budgets. They cannot allocate a fresh budget per page.
    for (let index = 0; index < this.ir.pages.length; index++) {
      this.pageIndex = index;
      this.decoratePage();
    }
    const ir = canonicalizeLayoutIR(this.ir);
    return {
      ir,
      usesTotalPages: this.usesTotalPages,
      semanticMap: ir.semantics,
      lines: this.lines,
      diagnostics: this.diagnostics,
      work: { ...this.work },
    };
  }
  private block(block: ResolvedBlock, index: number) {
    if (block.kind === "image-binding" || block.kind === "barcode-binding") {
      this.placeMedia(block);
      return;
    }
    if (block.kind === "path") {
      this.placePath(block);
      return;
    }
    if (block.kind === "region") {
      this.region(block, index);
      return;
    }
    if (block.kind === "table") {
      this.table(block);
      return;
    }
    if (this.inRegion && (block.layout?.section || block.layout?.pageBreakBefore))
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Region children cannot change page or section",
        block.nodeId,
      );
    const section = block.layout?.section;
    if (section && index > 0) {
      const occurrence = sectionOccurrenceId(block, this.doc.documentId);
      if (this.sectionIds.has(occurrence))
        throw new LayoutError("LAYOUT_INPUT", "Section IDs must be unique", block.nodeId);
      this.sectionIds.add(occurrence);
      this.pageSettings = section.page;
      this.geometry = pageGeometry(section.page);
      this.sectionId = occurrence;
      this.sectionSourceId = section.id;
      this.sectionStart = this.ir.pages.length;
      this.newPage();
    }
    if (block.layout?.pageBreakBefore) this.newPage();
    if (!this.inRegion && hasParagraphPaginationPolicy(block.layout))
      this.paragraphWithPolicy(block, index);
    else this.paragraph(block, index);
  }
  private probeNext(block: ResolvedBlock, index: number): number {
    // Regions reserve an explicit box: lookahead needs its flow extent, not a nested layout pass.
    if (block.kind === "region")
      return block.layout.mode === "flow" ? block.layout.box.height + block.layout.box.y : 0;
    const page = requiredLayoutValue(this.ir.pages[this.pageIndex]);
    const lengths = [
      page.objects.length,
      this.ir.semantics.length,
      this.ir.markers.length,
      this.lines.length,
      this.ir.graphicsStates.length,
    ];
    const savedY = this.y,
      savedBox = this.decorationBox,
      savedRegion = this.inRegion,
      savedMedia = this.mediaIndex;
    this.work.runVisits += this.counts.size + this.initializedRepeatStarts.size;
    if (this.work.runVisits > 2000000)
      throw new LayoutError("LAYOUT_LIMIT", "Pagination lookahead work exceeded", block.nodeId);
    const counts = new Map(this.counts),
      starts = new Set(this.initializedRepeatStarts);
    try {
      this.y = 0;
      this.inRegion = true;
      this.decorationBox = { ...this.geometry.contentBox, y: 0 };
      if (block.kind === "table") return this.table(block, true);
      if (block.kind === "image-binding" || block.kind === "barcode-binding") {
        this.placeMedia(block, true);
        return this.y;
      }
      if (block.kind !== "paragraph") {
        this.block(block, index);
        return this.y;
      }
      const keep = block.layout?.keepWithNext ?? block.layout?.role === "heading";
      const policy = hasParagraphPaginationPolicy(block.layout);
      const leading = block.layout?.orphanLines ?? (policy ? 2 : 1);
      const trailing = block.layout?.widowLines ?? 2;
      const maxLines = keep ? undefined : policy ? leading + trailing : 1;
      this.decorationBox.height = Math.min(
        maxLayoutCoordinate,
        this.geometry.contentBox.height * (maxLines ?? 1),
      );
      this.paragraph(block, index, undefined, maxLines);
      const captured = this.lines.slice(requiredLayoutValue(lengths[3]));
      const take =
        keep || (policy && captured.length < leading + trailing) ? captured.length : leading;
      return (
        captured.slice(0, take).reduce((n, line) => n + line.height, 0) +
        (block.layout?.spaceBefore ?? 0) +
        (keep ? (block.layout?.spaceAfter ?? 0) : 0)
      );
    } finally {
      for (let i = requiredLayoutValue(lengths[0]); i < page.objects.length; i++)
        this.barcodeObjects.delete(requiredLayoutValue(page.objects[i]).id);
      page.objects.length = requiredLayoutValue(lengths[0]);
      this.ir.semantics.length = requiredLayoutValue(lengths[1]);
      this.ir.markers.length = requiredLayoutValue(lengths[2]);
      this.lines.length = requiredLayoutValue(lengths[3]);
      this.ir.graphicsStates.length = requiredLayoutValue(lengths[4]);
      this.y = savedY;
      this.decorationBox = savedBox;
      this.inRegion = savedRegion;
      this.mediaIndex = savedMedia;
      this.counts.clear();
      for (const [k, v] of counts) this.counts.set(k, v);
      this.initializedRepeatStarts.clear();
      for (const k of starts) this.initializedRepeatStarts.add(k);
    }
  }
  private paragraphWithPolicy(paragraph: ResolvedParagraph, index: number) {
    const page = requiredLayoutValue(this.ir.pages[this.pageIndex]);
    const starts = {
      objects: page.objects.length,
      semantics: this.ir.semantics.length,
      markers: this.ir.markers.length,
      lines: this.lines.length,
    };
    const box = this.geometry.contentBox,
      savedY = this.y;
    const properties = paragraph.layout ?? {};
    this.inRegion = true;
    this.decorationBox = {
      ...box,
      y: 0,
      height: Math.min(
        maxLayoutCoordinate,
        box.height * (this.options.pagination?.maxPages ?? layoutResourceLimits.pages),
      ),
    };
    this.y = 0;
    try {
      this.paragraph(
        {
          ...paragraph,
          layout: { ...properties, border: undefined, spaceBefore: 0, spaceAfter: 0 },
        },
        index,
      );
    } finally {
      this.inRegion = false;
      this.decorationBox = undefined;
      this.y = savedY;
    }
    const objects = page.objects.splice(starts.objects),
      semantics = this.ir.semantics.splice(starts.semantics),
      markers = this.ir.markers.splice(starts.markers),
      lines = this.lines.splice(starts.lines);
    const keep = properties.keepWithNext ?? properties.role === "heading";
    const next = this.doc.body[index + 1];
    const total = lines.reduce((n, l) => n + l.height, 0);
    if (
      keep &&
      next &&
      !(next.kind === "paragraph" && (next.layout?.pageBreakBefore || next.layout?.section))
    ) {
      let needed = total + (properties.spaceAfter ?? 0);
      for (let following = index + 1; following < this.doc.body.length; following++) {
        const candidate = requiredLayoutValue(this.doc.body[following]);
        if (
          candidate.kind === "paragraph" &&
          (candidate.layout?.pageBreakBefore || candidate.layout?.section)
        )
          break;
        needed += this.probeNext(candidate, following);
        if (
          candidate.kind !== "paragraph" ||
          !(candidate.layout?.keepWithNext ?? candidate.layout?.role === "heading")
        )
          break;
      }
      if (needed > box.height + 1e-9)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Keep-with-next group exceeds page height",
          paragraph.nodeId,
        );
      if (
        this.y + (this.y > box.y ? (properties.spaceBefore ?? 0) : 0) + needed >
        box.y + box.height + 1e-9
      )
        this.newPage();
    }
    if (this.y > box.y) this.y += properties.spaceBefore ?? 0;
    const orphan = properties.orphanLines ?? 2,
      widow = properties.widowLines ?? 2;
    let objectIndex = 0,
      semanticIndex = 0,
      markerIndex = 0;
    for (let first = 0; first < lines.length; ) {
      let end = first,
        height = 0;
      while (
        end < lines.length &&
        this.y + height + requiredLayoutValue(lines[end]).height <= box.y + box.height + 1e-9
      ) {
        height += requiredLayoutValue(lines[end]).height;
        end++;
      }
      if (end < lines.length && end - first < orphan && this.y > box.y + 1e-9) {
        this.newPage();
        continue;
      }
      if (end < lines.length && lines.length - end < widow) {
        end = Math.max(first, end - (widow - (lines.length - end)));
        height = lines.slice(first, end).reduce((n, l) => n + l.height, 0);
      }
      if (end < lines.length && end - first < orphan) {
        if (this.y > box.y + 1e-9) {
          this.newPage();
          continue;
        }
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Orphan minimum cannot fit page",
          paragraph.nodeId,
        );
      }
      if (end === first) {
        if (this.y > box.y + 1e-9) {
          this.newPage();
          continue;
        }
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Widow/orphan policy cannot fit page",
          paragraph.nodeId,
        );
      }
      const target = requiredLayoutValue(this.ir.pages[this.pageIndex]),
        dy = this.y - requiredLayoutValue(lines[first]).y;
      const until = end === lines.length ? Infinity : requiredLayoutValue(lines[end]).y;
      const ids = new Map<string, string>();
      // Captured objects retain paint order; line bounds partition that order monotonically.
      while (
        objectIndex < objects.length &&
        requiredLayoutValue(objects[objectIndex]).bounds.y < until - 1e-9
      ) {
        const object = requiredLayoutValue(objects[objectIndex++]),
          oldId = object.id;
        this.metadata(
          paragraph,
          object.kind === "text" ? object.logicalText.length + object.displayText.length : 0,
        );
        object.id = `page${this.pageIndex}object${target.objects.length}`;
        ids.set(oldId, object.id);
        object.drawOrder = target.objects.length;
        object.bounds = { ...object.bounds, y: object.bounds.y + dy };
        const state = requiredLayoutValue(this.ir.graphicsStates[Number(object.stateId.slice(5))]);
        if (object.kind === "path" && object.coordinateSpace === "page")
          object.coordinateSpace = "local";
        state.transform = compose({ ...identity, f: dy }, state.transform);
        target.objects.push(object);
      }
      while (
        semanticIndex < semantics.length &&
        ids.has(requiredLayoutValue(semantics[semanticIndex]).objectId)
      ) {
        const semantic = requiredLayoutValue(semantics[semanticIndex++]);
        semantic.objectId = requiredLayoutValue(ids.get(semantic.objectId));
        semantic.pageIndex = this.pageIndex;
        semantic.readingOrder = this.ir.semantics.length;
        this.ir.semantics.push(semantic);
      }
      while (
        markerIndex < markers.length &&
        ids.has(requiredLayoutValue(markers[markerIndex]).objectId ?? "")
      ) {
        const marker = requiredLayoutValue(markers[markerIndex++]);
        marker.id = `marker${this.ir.markers.length}`;
        marker.pageId = `page${this.pageIndex}`;
        marker.objectId = requiredLayoutValue(ids.get(marker.objectId ?? ""));
        marker.bounds = { ...marker.bounds, y: marker.bounds.y + dy };
        this.ir.markers.push(marker);
      }
      for (let i = first; i < end; i++) {
        const line = requiredLayoutValue(lines[i]);
        this.reserveSectionMetadata(paragraph.nodeId);
        this.lines.push({
          ...line,
          y: line.y + dy,
          baseline: line.baseline + dy,
          pageIndex: this.pageIndex,
        });
      }
      if (properties.border) {
        const bounds = { x: box.x, y: this.y, width: box.width, height };
        this.reserveObjects(1);
        this.commands(5);
        target.objects.push({
          id: `page${this.pageIndex}object${target.objects.length}`,
          kind: "path",
          drawOrder: target.objects.length,
          stateId: this.graphicState(properties.border),
          bounds,
          coordinateSpace: "page",
          commands: borderPath(bounds, properties.border),
          fill: false,
          stroke: true,
          fillRule: "nonzero",
        });
      }
      this.y += height;
      first = end;
      if (first < lines.length) this.newPage();
    }
    this.y = Math.min(box.y + box.height, this.y + (properties.spaceAfter ?? 0));
  }

  private table(table: Extract<ResolvedBlock, { kind: "table" }>, initialOnly = false): number {
    const parent = this.decorationBox ?? this.geometry.contentBox;
    const savedRegion = this.inRegion,
      savedBox = this.decorationBox;
    let rows = table.rows;
    if (!rows.length) return 0;
    let firstGroupHeight = 0;
    // Bound dense grid occupancy before allocation, including spans and empty cells.
    const columns = table.layout?.columns;
    let inferredCount = 0;
    for (const row of rows) {
      this.work.runVisits += 1 + row.cells.length;
      if (this.work.runVisits > 2000000)
        throw new LayoutError("LAYOUT_LIMIT", "Table planning budget exceeded", table.nodeId);
      if (!columns)
        inferredCount = Math.max(
          inferredCount,
          row.cells.reduce((n, c) => n + (c.layout?.columnSpan ?? 1), 0),
        );
    }
    const count = columns?.length ?? inferredCount;
    if (count > 1024 || rows.length > 10000 || rows.length * count > 100000)
      throw new LayoutError("LAYOUT_LIMIT", "Table grid budget exceeded", table.nodeId);
    if (initialOnly) {
      let end = Math.min(rows.length, Math.max(1, (table.layout?.headerRows ?? 0) + 1));
      for (let row = 0; row < end; row++) {
        const source = rows[row];
        if (!source) throw new LayoutError("LAYOUT_INPUT", "Table span exceeds rows", table.nodeId);
        this.work.runVisits += 1 + source.cells.length;
        if (this.work.runVisits > 2000000)
          throw new LayoutError("LAYOUT_LIMIT", "Table lookahead budget exceeded", table.nodeId);
        for (const cell of source.cells) end = Math.max(end, row + (cell.layout?.rowSpan ?? 1));
      }
      rows = rows.slice(0, end);
    }
    if (!count)
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Table requires a column or covered cells",
        table.nodeId,
      );
    const fixed = columns?.reduce((n, c) => n + (c.kind === "fixed" ? c.value : 0), 0) ?? 0;
    const weights =
      columns?.reduce((n, c) => n + (c.kind === "proportional" ? c.value : 0), 0) ?? count;
    if (fixed > parent.width || (weights > 0 && fixed >= parent.width))
      throw new LayoutError(
        "LAYOUT_OVERFLOW",
        "Table columns exceed available width",
        table.nodeId,
      );
    const widths =
      columns?.map((c) =>
        c.kind === "fixed" ? c.value : ((parent.width - fixed) * c.value) / weights,
      ) ?? (Array(count).fill(parent.width / count) as number[]);
    const xs = [0];
    for (const w of widths) xs.push((xs.at(-1) ?? 0) + w);
    this.work.runVisits += rows.length * count;
    if (this.work.runVisits > 2000000)
      throw new LayoutError("LAYOUT_LIMIT", "Shared table grid work exceeded", table.nodeId);
    const occupied = new Uint8Array(rows.length * count);
    const heights = rows.map((r) => r.layout?.height ?? 0);
    type Cell = {
      row: number;
      col: number;
      rs: number;
      cs: number;
      height: number;
      source: (typeof rows)[number]["cells"][number];
      objects: LayoutIR["pages"][number]["objects"];
      semantics: LayoutIR["semantics"];
      lines: LayoutLine[];
      markers: LayoutIR["markers"];
      barcodes: Map<string, { height: number; moduleWidth: number }>;
    };
    const cells: Cell[] = [];
    const page = this.ir.pages[this.pageIndex];
    if (!page) throw new Error("Missing page");
    const savedY = this.y;
    try {
      this.inRegion = true;
      for (const [row, sourceRow] of rows.entries()) {
        let col = 0;
        for (const source of sourceRow.cells) {
          while (col < count && occupied[row * count + col]) col++;
          const rs = source.layout?.rowSpan ?? 1,
            cs = source.layout?.columnSpan ?? 1;
          if (col + cs > count || row + rs > rows.length)
            throw new LayoutError("LAYOUT_INPUT", "Table span exceeds grid", source.nodeId);
          for (let r = row; r < row + rs; r++)
            for (let c = col; c < col + cs; c++) {
              if (occupied[r * count + c])
                throw new LayoutError("LAYOUT_INPUT", "Overlapping table spans", source.nodeId);
              occupied[r * count + c] = 1;
            }
          const padding = source.layout?.padding ?? 1;
          const width = (xs[col + cs] ?? 0) - (xs[col] ?? 0) - 2 * padding;
          if (width <= 0)
            throw new LayoutError(
              "LAYOUT_OVERFLOW",
              "Cell padding consumes column width",
              source.nodeId,
            );
          const startObjects = page.objects.length,
            startSemantics = this.ir.semantics.length,
            startLines = this.lines.length,
            startMarkers = this.ir.markers.length;
          this.y = 0;
          this.decorationBox = { x: 0, y: 0, width, height: parent.height };
          source.blocks.forEach((b, i) => {
            this.block(b, i);
          });
          if (page.objects.length === startObjects)
            this.paragraph({ kind: "paragraph", nodeId: source.nodeId, fragments: [] }, 0);
          const height = this.y + 2 * padding;
          const barcodes = new Map<string, { height: number; moduleWidth: number }>();
          for (let i = startObjects; i < page.objects.length; i++) {
            const id = requiredLayoutValue(page.objects[i]).id,
              barcode = this.barcodeObjects.get(id);
            if (barcode) {
              barcodes.set(id, barcode);
              this.barcodeObjects.delete(id);
            }
          }
          cells.push({
            row,
            col,
            rs,
            cs,
            height,
            source,
            objects: page.objects.splice(startObjects),
            semantics: this.ir.semantics.splice(startSemantics),
            lines: this.lines.splice(startLines),
            markers: this.ir.markers.splice(startMarkers),
            barcodes,
          });
          if (rs === 1) {
            if (
              sourceRow.layout?.heightMode === "fixed" &&
              height > (sourceRow.layout.height ?? 0) + 1e-9
            )
              throw new LayoutError(
                "LAYOUT_OVERFLOW",
                "Cell exceeds fixed row height",
                source.nodeId,
              );
            heights[row] = Math.max(heights[row] ?? 0, height);
          }
          col += cs;
        }
      }
    } finally {
      this.y = savedY;
      this.inRegion = savedRegion;
      this.decorationBox = savedBox;
    }
    if (occupied.some((value) => value === 0))
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Every table grid slot must be a cell or covered by a span",
        table.nodeId,
      );
    // Fixed rows never silently expand; spanning cells grow only automatic rows.
    for (const c of cells) {
      let total = 0;
      const auto: number[] = [];
      for (let r = c.row; r < c.row + c.rs; r++) {
        total += heights[r] ?? 0;
        if (rows[r]?.layout?.heightMode !== "fixed") auto.push(r);
      }
      if (c.height > total + 1e-9) {
        if (!auto.length)
          throw new LayoutError(
            "LAYOUT_OVERFLOW",
            "Merged cell exceeds fixed rows",
            c.source.nodeId,
          );
        for (const r of auto) heights[r] = (heights[r] ?? 0) + (c.height - total) / auto.length;
      }
    }
    for (const [r, row] of rows.entries())
      if (row.layout?.heightMode === "fixed") {
        if (!row.layout.height || (heights[r] ?? 0) > row.layout.height + 1e-9)
          throw new LayoutError("LAYOUT_OVERFLOW", "Cell exceeds fixed row height", row.nodeId);
        heights[r] = row.layout.height;
      }
    const headers = table.layout?.headerRows ?? 0;
    if (headers > rows.length || cells.some((c) => c.row < headers && c.row + c.rs > headers))
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Header boundary intersects a merged cell",
        table.nodeId,
      );
    if (initialOnly) {
      this.work.runVisits += heights.length;
      if (this.work.runVisits > 2000000)
        throw new LayoutError(
          "LAYOUT_LIMIT",
          "Table lookahead height budget exceeded",
          table.nodeId,
        );
      return heights.reduce((n, height) => n + height, 0);
    }
    const byRow = rows.map(() => [] as Cell[]);
    for (const c of cells) byRow[c.row]?.push(c);
    const ends = rows.map((_, i) => i + 1);
    for (const c of cells) ends[c.row] = Math.max(ends[c.row] ?? 0, c.row + c.rs);
    const edges = new Map<
      string,
      {
        pageIndex: number;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
        stroke: Stroke;
        explicit: boolean;
      }
    >();
    const fragmentBoxes = new Map<
      number,
      { x: number; y: number; width: number; height: number }
    >();
    let repeat = 0;
    const paint = (start: number, end: number, repeated: boolean) => {
      const previousBox = fragmentBoxes.get(this.pageIndex);
      const top = previousBox?.y ?? this.y;
      const ys = [this.y];
      for (let r = start; r < end; r++) ys.push((ys.at(-1) ?? 0) + (heights[r] ?? 0));
      fragmentBoxes.set(this.pageIndex, {
        x: parent.x,
        y: top,
        width: xs.at(-1) ?? 0,
        height: (ys.at(-1) ?? top) - top,
      });
      for (let r = start; r < end; r++)
        for (const cell of byRow[r] ?? []) {
          const x = parent.x + (xs[cell.col] ?? 0),
            y = ys[r - start] ?? 0;
          const width = (xs[cell.col + cell.cs] ?? 0) - (xs[cell.col] ?? 0),
            height = (ys[r - start + cell.rs] ?? 0) - y;
          const target = this.ir.pages[this.pageIndex];
          if (!target) throw new Error("Missing page");
          const addPath = (
            commands: ReturnType<typeof rectangle>,
            stroke?: Stroke,
            fill?: string,
          ) => {
            this.commands(commands.length);
            this.reserveObjects(1);
            target.objects.push({
              id: `page${this.pageIndex}object${target.objects.length}`,
              kind: "path",
              drawOrder: target.objects.length,
              stateId: this.graphicState(stroke, fill),
              bounds: { x, y, width, height },
              coordinateSpace: "page",
              commands,
              fill: !!fill,
              stroke: !!stroke,
              fillRule: "nonzero",
            });
          };
          if (cell.source.layout?.background)
            addPath(rectangle({ x, y, width, height }), undefined, cell.source.layout.background);
          const stroke = cell.source.border ?? table.border;
          if (stroke) {
            validateBorderFits({ x, y, width, height }, stroke, cell.source.nodeId);
            const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
              if (x1 === x2 && y1 === y2) return;
              const key = `${this.pageIndex}:${Math.round(x1 * 1000)},${Math.round(y1 * 1000)},${Math.round(x2 * 1000)},${Math.round(y2 * 1000)}`;
              const old = edges.get(key),
                explicit = !!cell.source.border;
              if (
                !old ||
                (explicit && !old.explicit) ||
                (explicit === old.explicit && stroke.width > old.stroke.width)
              )
                edges.set(key, { pageIndex: this.pageIndex, x1, y1, x2, y2, stroke, explicit });
            };
            // Split along the grid so a merged side and its individual neighbors share keys.
            for (let col = cell.col; col < cell.col + cell.cs; col++) {
              const left = parent.x + (xs[col] ?? 0),
                right = parent.x + (xs[col + 1] ?? 0);
              addEdge(left, y, right, y);
              addEdge(left, y + height, right, y + height);
            }
            for (let row = r; row < r + cell.rs; row++) {
              const top = ys[row - start] ?? 0,
                bottom = ys[row - start + 1] ?? 0;
              addEdge(x, top, x, bottom);
              addEdge(x + width, top, x + width, bottom);
            }
          }
          const pad = cell.source.layout?.padding ?? 1;
          const dy =
            y +
            pad +
            Math.max(0, height - cell.height) *
              (cell.source.layout?.verticalAlign === "bottom"
                ? 1
                : cell.source.layout?.verticalAlign === "middle"
                  ? 0.5
                  : 0);
          const move = { ...identity, e: x + pad, f: dy };
          const ids = new Map<string, string>();
          for (const original of cell.objects) {
            this.reserveObjects(1);
            this.metadata(
              table,
              original.kind === "text"
                ? original.logicalText.length + original.displayText.length
                : 0,
            );
            if (original.kind === "path") this.commands(original.commands.length);
            this.work.runVisits +=
              original.kind === "text" ? original.glyphs.length + original.clusters.length : 1;
            if (this.work.runVisits > 2000000)
              throw new LayoutError(
                "LAYOUT_LIMIT",
                "Table output traversal budget exceeded",
                table.nodeId,
              );
            const object = structuredClone(original);
            const state = this.ir.graphicsStates[Number(original.stateId.slice(5))];
            if (!state) throw new Error("Missing state");
            if (state.clip) this.commands(state.clip.commands.length);
            const cloned = structuredClone(state);
            cloned.id = `state${this.ir.graphicsStates.length}`;
            cloned.transform = compose(move, cloned.transform);
            this.ir.graphicsStates.push(cloned);
            object.id = `page${this.pageIndex}object${target.objects.length}`;
            ids.set(original.id, object.id);
            const barcode = cell.barcodes.get(original.id);
            if (barcode) this.barcodeObjects.set(object.id, barcode);
            object.stateId = cloned.id;
            object.drawOrder = target.objects.length;
            object.bounds = transformedBox(object.bounds, move);
            if (object.kind === "path" && object.coordinateSpace === "page")
              object.coordinateSpace = "local";
            target.objects.push(object);
          }
          for (const original of cell.semantics) {
            let units =
              original.nodeId.length +
              (original.bindingId?.length ?? 0) +
              (original.controlId?.length ?? 0) +
              (original.sectionId?.length ?? 0) +
              (original.sectionSourceId?.length ?? 0) +
              (original.link?.length ?? 0) +
              (original.table?.tableId.length ?? 0) +
              (original.sourceText?.text.length ?? 0);
            for (const source of original.sourceRanges ?? [])
              units +=
                source.nodeId.length +
                (source.bindingId?.length ?? 0) +
                source.sourceText.text.length;
            for (const instance of original.repeatInstance ?? [])
              units += instance.nodeId.length + instance.key.length;
            if (!original.repeatInstance)
              for (const instance of rows[r]?.instancePath ?? [])
                units += instance.nodeId.length + instance.key.length;
            if (repeated) units += original.nodeId.length;
            this.metadata(table, units);
            this.work.sourceMappings += original.sourceRanges?.length ?? 0;
            if (++this.work.sourceMappings > layoutResourceLimits.sourceMappings)
              throw new LayoutError(
                "LAYOUT_LIMIT",
                "Table source mapping budget exceeded",
                table.nodeId,
              );
            this.ir.semantics.push({
              ...structuredClone(original),
              objectId: requiredLayoutValue(ids.get(original.objectId)),
              readingOrder: this.ir.semantics.length,
              pageIndex: this.pageIndex,
              ...(!original.repeatInstance && rows[r]?.instancePath
                ? {
                    repeatInstance: requiredLayoutValue(
                      requiredLayoutValue(rows[r]).instancePath,
                    ).map((i) => ({
                      nodeId: i.nodeId,
                      key: i.key,
                    })),
                  }
                : {}),
              table: original.table ?? {
                tableId: table.nodeId,
                row: r,
                column: cell.col,
                rowSpan: cell.rs,
                columnSpan: cell.cs,
              },
              ...(repeated
                ? {
                    repeatedHeader: {
                      originalNodeId: original.nodeId,
                      instanceIndex: repeat,
                    },
                  }
                : {}),
            });
          }
          for (const marker of cell.markers) {
            this.reserveObjects(1);
            this.metadata(table, marker.nodeId.length + (marker.controlId?.length ?? 0));
            this.ir.markers.push({
              ...marker,
              id: `marker${this.ir.markers.length}`,
              pageId: `page${this.pageIndex}`,
              objectId: ids.get(marker.objectId ?? ""),
              bounds: transformedBox(marker.bounds, move),
            });
          }
          for (const line of cell.lines) {
            this.metadata(table, line.nodeId.length);
            this.lines.push({
              ...line,
              x: line.x + x + pad,
              y: line.y + dy,
              baseline: line.baseline + dy,
              pageIndex: this.pageIndex,
            });
          }
        }
      this.y = ys.at(-1) ?? this.y;
    };
    this.work.runVisits += heights.length;
    if (this.work.runVisits > 2000000)
      throw new LayoutError("LAYOUT_LIMIT", "Table height scan budget exceeded", table.nodeId);
    const heightPrefix = [0];
    for (const height of heights) heightPrefix.push((heightPrefix.at(-1) ?? 0) + height);
    const sum = (a: number, b: number) => (heightPrefix[b] ?? 0) - (heightPrefix[a] ?? 0);
    for (let start = 0; start < rows.length; ) {
      let end = ends[start] ?? start + 1;
      if (start === 0 && headers > 0) end = Math.max(end, Math.min(rows.length, headers + 1));
      for (let r = start; r < end; r++) end = Math.max(end, ends[r] ?? r + 1);
      if (start === 0) firstGroupHeight = sum(start, end);
      const h = sum(start, end),
        head = start > 0 && table.layout?.repeatHeader ? sum(0, headers) : 0;
      if (h + head > parent.height + 1e-9)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Unsplit row or merged row group exceeds page height",
          table.nodeId,
        );
      if (this.y + h > parent.y + parent.height + 1e-9) {
        if (this.inRegion)
          throw new LayoutError("LAYOUT_OVERFLOW", "Table exceeds region", table.nodeId);
        this.newPage();
        if (head > 0) {
          repeat++;
          paint(0, headers, true);
        }
      }
      paint(start, end, false);
      start = end;
    }
    for (const edge of edges.values()) {
      const box = requiredLayoutValue(fragmentBoxes.get(edge.pageIndex)),
        half = edge.stroke.width / 2;
      const clampX = (x: number) => Math.max(box.x + half, Math.min(box.x + box.width - half, x));
      const clampY = (y: number) => Math.max(box.y + half, Math.min(box.y + box.height - half, y));
      const x1 = clampX(edge.x1),
        x2 = clampX(edge.x2),
        y1 = clampY(edge.y1),
        y2 = clampY(edge.y2);
      const target = requiredLayoutValue(this.ir.pages[edge.pageIndex]);
      this.reserveObjects(1);
      this.commands(2);
      target.objects.push({
        id: `page${edge.pageIndex}object${target.objects.length}`,
        kind: "path",
        drawOrder: target.objects.length,
        stateId: this.graphicState(edge.stroke),
        bounds: {
          x: x1 - half,
          y: y1 - half,
          width: x2 - x1 + 2 * half,
          height: y2 - y1 + 2 * half,
        },
        coordinateSpace: "page",
        commands: [
          { op: "move", x: x1, y: y1 },
          { op: "line", x: x2, y: y2 },
        ],
        fill: false,
        stroke: true,
        fillRule: "nonzero",
      });
    }
    return firstGroupHeight;
  }

  private commands(count: number) {
    if (count > 1000000 - this.work.pathCommands)
      throw new LayoutError("LAYOUT_LIMIT", "Shared path/clip command budget exceeded");
    this.work.pathCommands += count;
  }
  private metadata(block: ResolvedBlock, extra = 0) {
    let units = block.nodeId.length + extra;
    if ("bindingId" in block) units += block.bindingId.length;
    if ("instancePath" in block)
      for (const instance of block.instancePath ?? [])
        units += instance.nodeId.length + instance.key.length;
    if (units > 8_000_000 - this.work.outputTextUnits)
      throw new LayoutError("LAYOUT_LIMIT", "Output source metadata exceeds budget", block.nodeId);
    this.work.outputTextUnits += units;
  }
  private semantic(block: ResolvedBlock, id: string) {
    this.metadata(block);
    this.reserveSectionMetadata(block.nodeId);
    if (++this.work.sourceMappings > layoutResourceLimits.sourceMappings)
      throw new LayoutError("LAYOUT_LIMIT", "Source mapping budget exceeded", block.nodeId);
    this.ir.semantics.push({
      objectId: id,
      nodeId: block.nodeId,
      readingOrder: this.ir.semantics.length,
      pageIndex: this.pageIndex,
      sectionId: this.sectionId,
      ...(this.sectionId !== this.sectionSourceId ? { sectionSourceId: this.sectionSourceId } : {}),
      ...("bindingId" in block ? { bindingId: block.bindingId } : {}),
      ...("instancePath" in block && block.instancePath
        ? { repeatInstance: block.instancePath.map((i) => ({ nodeId: i.nodeId, key: i.key })) }
        : {}),
    });
  }
  private atomicBox(width: number, height: number, nodeId: string, alignment = "left") {
    const box = this.decorationBox ?? this.geometry.contentBox;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 0.001 ||
      height < 0.001 ||
      height > box.height + 1e-9 ||
      (!this.horizontalOverflow && width > box.width + 1e-9)
    )
      throw new LayoutError("LAYOUT_OVERFLOW", "Atomic block cannot fit its content area", nodeId);
    if (this.y + height > box.y + box.height + 1e-9) {
      if (this.inRegion)
        throw new LayoutError("LAYOUT_OVERFLOW", "Region content exceeds layout ceiling", nodeId);
      this.newPage();
    }
    return {
      x:
        box.x +
        (this.horizontalOverflow ? box.width - width : Math.max(0, box.width - width)) *
          (alignment === "center" ? 0.5 : alignment === "right" ? 1 : 0),
      y: this.y,
      width,
      height,
    };
  }
  private graphicState(stroke?: Stroke, fill?: string, transform: Matrix = identity) {
    const id = this.state(fill, stroke?.width ?? 0);
    const state = this.ir.graphicsStates.at(-1);
    if (!state) throw new Error("Missing graphics state");
    if (stroke) {
      if (stroke.dash?.length && !stroke.dash.some((n) => n > 0))
        throw new LayoutError("LAYOUT_INPUT", "Dash array must contain a positive length");
      state.strokeColor = color(stroke.color);
      state.dash = stroke.dash ?? [];
      state.dashOffset = stroke.dashOffset ?? 0;
      state.lineCap = stroke.cap ?? "butt";
      state.lineJoin = stroke.join ?? "miter";
      state.miterLimit = stroke.miterLimit ?? 10;
    }
    state.transform = transform;
    return id;
  }
  private placeMedia(block: ResolvedMedia, initialOnly = false) {
    const prepared = this.media?.blocks[this.mediaIndex++];
    if (!prepared) throw new LayoutError("LAYOUT_INPUT", "Media is not ready", block.nodeId);
    const objects = this.ir.pages[this.pageIndex]?.objects;
    if (!objects) throw new Error("Missing page");
    // Empty lists still consume traversal/source metadata work.
    this.metadata(block);
    if (block.kind === "barcode-binding" && block.placement?.crop)
      throw new LayoutError("LAYOUT_INPUT", "Barcode quiet zones cannot be cropped", block.nodeId);
    const entries = prepared.images ?? (prepared.barcode ? [prepared.barcode] : []);
    for (const [index, entry] of entries.entries()) {
      if (initialOnly && index > 0) break;
      const crop = block.kind === "image-binding" ? block.placement?.crop : undefined;
      if (
        crop &&
        (crop.x < 0 ||
          crop.y < 0 ||
          crop.x + crop.width > entry.width + 1e-9 ||
          crop.y + crop.height > entry.height + 1e-9)
      )
        throw new LayoutError(
          "LAYOUT_INPUT",
          "Image crop must be inside frozen physical dimensions",
          block.nodeId,
        );
      if (index > 0) this.y += block.placement?.gap ?? 0;
      const bounds = this.atomicBox(
        crop?.width ?? entry.width,
        crop?.height ?? entry.height,
        block.nodeId,
        block.placement?.alignment,
      );
      this.reserveObjects(1);
      const page = this.ir.pages[this.pageIndex];
      if (!page) throw new Error("Missing page");
      const id = `page${this.pageIndex}object${page.objects.length}`;
      if ("resource" in entry) {
        const resource = this.mediaImages.get(entry.resource.id);
        if (!resource)
          throw new LayoutError("LAYOUT_INPUT", "Image resource is not ready", block.nodeId);
        const sx = entry.width / resource.pixelWidth,
          sy = entry.height / resource.pixelHeight;
        if (crop) this.commands(5);
        page.objects.push({
          kind: "image",
          id,
          drawOrder: page.objects.length,
          stateId: this.state(),
          bounds,
          resourceId: resource.id,
          transform: {
            a: sx,
            b: 0,
            c: 0,
            d: sy,
            e: bounds.x - (crop?.x ?? 0),
            f: bounds.y - (crop?.y ?? 0),
          },
          ...(crop
            ? {
                clip: {
                  coordinateSpace: "local",
                  fillRule: "nonzero",
                  commands: rectangle({
                    x: crop.x / sx,
                    y: crop.y / sy,
                    width: crop.width / sx,
                    height: crop.height / sy,
                  }),
                },
              }
            : {}),
        });
      } else {
        this.commands(entry.path.commands.length);
        page.objects.push({
          ...entry.path,
          id,
          drawOrder: page.objects.length,
          bounds,
          stateId: this.graphicState(undefined, "#000000", {
            ...identity,
            e: bounds.x,
            f: bounds.y,
          }),
        });
        let moduleWidth = Infinity;
        for (let i = 0; i < entry.path.commands.length; i += 5) {
          const a = entry.path.commands[i],
            b = entry.path.commands[i + 1];
          if (a?.op === "move" && b?.op === "line") moduleWidth = Math.min(moduleWidth, b.x - a.x);
        }
        this.barcodeObjects.set(id, { height: entry.height, moduleWidth });
      }
      this.semantic(block, id);
      this.y += bounds.height;
    }
  }
  private placePath(block: Extract<ResolvedBlock, { kind: "path" }>) {
    this.commands(block.commands.length);
    if (!block.fill && !block.stroke)
      throw new LayoutError("LAYOUT_INPUT", "Path must declare fill or stroke", block.nodeId);
    const transform = block.transform ?? identity;
    inverse(transform);
    let opened = false;
    for (const command of block.commands) {
      if (command.op === "move") opened = true;
      else if (!opened)
        throw new LayoutError("LAYOUT_INPUT", "Path requires a leading move", block.nodeId);
      if (command.op === "close") {
        opened = false;
        continue;
      }
      const coords =
        command.op === "cubic"
          ? [
              [command.x, command.y],
              [command.x1, command.y1],
              [command.x2, command.y2],
            ]
          : [[command.x, command.y]];
      for (const [x = 0, y = 0] of coords)
        if (x < 0 || y < 0 || x > block.width || y > block.height)
          throw new LayoutError(
            "LAYOUT_INPUT",
            "Path control points must lie inside its declared local box",
            block.nodeId,
          );
    }
    const pad = block.stroke
      ? (block.stroke.width / 2) *
        Math.max(
          block.stroke.cap === "square" ? Math.SQRT2 : 1,
          block.stroke.join === "miter" || !block.stroke.join ? (block.stroke.miterLimit ?? 10) : 1,
        )
      : 0;
    const extents = transformedBox(
      { x: -pad, y: -pad, width: block.width + 2 * pad, height: block.height + 2 * pad },
      transform,
    );
    const bounds = this.atomicBox(extents.width, extents.height, block.nodeId);
    const placed = compose(
      { ...identity, e: bounds.x - extents.x, f: bounds.y - extents.y },
      transform,
    );
    this.reserveObjects(1);
    const page = this.ir.pages[this.pageIndex];
    if (!page) throw new Error("Missing page");
    const id = `page${this.pageIndex}object${page.objects.length}`;
    page.objects.push({
      id,
      kind: "path",
      drawOrder: page.objects.length,
      stateId: this.graphicState(block.stroke, block.fill, placed),
      bounds,
      coordinateSpace: "local",
      commands: block.commands,
      fill: !!block.fill,
      stroke: !!block.stroke,
      fillRule: block.fillRule ?? "nonzero",
    });
    this.semantic(block, id);
    this.y += bounds.height;
  }
  private region(block: Extract<ResolvedBlock, { kind: "region" }>, index: number) {
    if (this.inRegion)
      throw new LayoutError(
        "LAYOUT_INPUT",
        "P0 regions cannot contain another region",
        block.nodeId,
      );
    const spec = block.layout,
      policy = spec.overflow ?? { kind: "error" as const };
    if (spec.mode === "flow" && (spec.box.x < 0 || spec.box.y < 0))
      throw new LayoutError("LAYOUT_INPUT", "Flow region offsets cannot be negative", block.nodeId);
    const parent = this.geometry.contentBox;
    const bounds =
      spec.mode === "fixed"
        ? spec.box
        : this.atomicBox(spec.box.width, spec.box.height + spec.box.y, block.nodeId);
    const box =
      spec.mode === "fixed"
        ? { ...bounds }
        : {
            x: parent.x + spec.box.x,
            y: bounds.y + spec.box.y,
            width: spec.box.width,
            height: spec.box.height,
          };
    const page = this.ir.pages[this.pageIndex];
    if (!page) throw new Error("Missing page");
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > page.width ||
      box.y + box.height > page.height ||
      (spec.mode === "flow" && (box.x < parent.x || box.x + box.width > parent.x + parent.width))
    )
      throw new LayoutError(
        "LAYOUT_OVERFLOW",
        "Region box is outside its assigned page area",
        block.nodeId,
      );
    const savedY = this.y,
      startObjects = page.objects.length,
      startStates = this.ir.graphicsStates.length,
      startSemantics = this.ir.semantics.length,
      startLines = this.lines.length,
      startMarkers = this.ir.markers.length,
      startMedia = this.mediaIndex;
    this.work.runVisits += this.counts.size + this.initializedRepeatStarts.size;
    if (this.work.runVisits > 2000000)
      throw new LayoutError(
        "LAYOUT_LIMIT",
        "Region state snapshot exceeds shared work budget",
        block.nodeId,
      );
    const counts = new Map(this.counts),
      starts = new Set(this.initializedRepeatStarts);
    const reset = () => {
      for (let i = startObjects; i < page.objects.length; i++) {
        const object = page.objects[i];
        if (object) this.barcodeObjects.delete(object.id);
      }
      page.objects.length = startObjects;
      this.ir.graphicsStates.length = startStates;
      this.ir.semantics.length = startSemantics;
      this.lines.length = startLines;
      this.ir.markers.length = startMarkers;
      this.mediaIndex = startMedia;
      this.counts.clear();
      for (const [k, v] of counts) this.counts.set(k, v);
      this.initializedRepeatStarts.clear();
      for (const k of starts) this.initializedRepeatStarts.add(k);
      this.y = box.y;
    };
    let contentLeft = box.x,
      contentTop = box.y;
    let naturalHeight = 0,
      naturalWidth = box.width,
      appliedScale = 1,
      success = false;
    try {
      this.inRegion = true;
      this.horizontalOverflow = policy.kind === "scale" || policy.kind === "truncate";
      this.decorationBox = { ...box, height: maxLayoutCoordinate - box.y };
      const attempts = policy.kind === "min-font-size" ? 9 : 1;
      for (let attempt = 0; attempt < attempts; attempt++) {
        if (++this.work.regionAttempts > 256)
          throw new LayoutError(
            "LAYOUT_LIMIT",
            "Shared region retry budget exceeded",
            block.nodeId,
          );
        reset();
        this.metadata(block);
        this.fontScale = policy.kind === "min-font-size" ? 1 - attempt / 8 : 1;
        this.fontFloor = policy.kind === "min-font-size" ? policy.minFontSize : 0;
        try {
          block.children.forEach((child, i) => {
            this.block(child, index + i);
          });
        } catch (error) {
          if (
            error instanceof LayoutError &&
            error.code === "LAYOUT_OVERFLOW" &&
            attempt + 1 < attempts
          )
            continue;
          throw error;
        }
        let contentRight = box.x + box.width,
          contentBottom = this.y;
        contentLeft = box.x;
        contentTop = box.y;
        for (let i = startObjects; i < page.objects.length; i++) {
          const b = page.objects[i]?.bounds;
          if (b) {
            contentLeft = Math.min(contentLeft, b.x);
            contentTop = Math.min(contentTop, b.y);
            contentRight = Math.max(contentRight, b.x + b.width);
            contentBottom = Math.max(contentBottom, b.y + b.height);
          }
        }
        naturalWidth = contentRight - contentLeft;
        naturalHeight = contentBottom - contentTop;
        const overflow = naturalHeight > box.height + 1e-9 || naturalWidth > box.width + 1e-9;
        if (!overflow) {
          success = true;
          break;
        }
        if (policy.kind === "truncate") {
          success = true;
          break;
        }
        if (policy.kind === "scale") {
          appliedScale = Math.min(1, box.height / naturalHeight, box.width / naturalWidth);
          if (appliedScale < policy.minScale)
            throw new LayoutError(
              "LAYOUT_OVERFLOW",
              "Required region scale is below minScale",
              block.nodeId,
            );
          success = true;
          break;
        }
        if (policy.kind === "error") break;
      }
      if (!success)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Region content exceeds its explicit overflow policy",
          block.nodeId,
        );
      const truncated =
        policy.kind === "truncate" &&
        (naturalHeight > box.height + 1e-9 || naturalWidth > box.width + 1e-9);
      const scaleMatrix = {
        a: appliedScale,
        b: 0,
        c: 0,
        d: appliedScale,
        e: policy.kind === "scale" ? box.x - contentLeft * appliedScale : 0,
        f: policy.kind === "scale" ? box.y - contentTop * appliedScale : 0,
      };
      for (let i = startObjects; i < page.objects.length; i++) {
        const object = page.objects[i];
        if (!object) continue;
        const barcode = this.barcodeObjects.get(object.id);
        if (barcode) {
          if (
            truncated &&
            (object.bounds.x < box.x ||
              object.bounds.y < box.y ||
              object.bounds.x + object.bounds.width > box.x + box.width + 1e-9 ||
              object.bounds.y + object.bounds.height > box.y + box.height + 1e-9)
          )
            throw new LayoutError(
              "LAYOUT_OVERFLOW",
              "Region clipping would remove barcode quiet zones or bars",
              block.nodeId,
            );
          if (barcode.height * appliedScale < 1 || barcode.moduleWidth * appliedScale < 0.1 - 1e-9)
            throw new LayoutError(
              "LAYOUT_OVERFLOW",
              "Region scale violates barcode physical minimum",
              block.nodeId,
            );
        }
        const state = this.ir.graphicsStates[Number(object.stateId.slice(5))];
        if (!state) throw new Error("Missing state");
        // Page-space paths bypass state transforms under the IR contract. Reclassify the
        // already positioned commands as local before composing the region transform.
        if (object.kind === "path" && object.coordinateSpace === "page")
          object.coordinateSpace = "local";
        state.transform = compose(scaleMatrix, state.transform);
        object.bounds = transformedBox(object.bounds, scaleMatrix);
        if (truncated) {
          this.commands(5);
          state.clip = clipRectangle(box, state.transform);
          object.bounds = intersect(object.bounds, box);
        }
      }
      for (let i = startLines; i < this.lines.length; i++) {
        const line = this.lines[i];
        if (line) {
          const b = transformedBox(line, scaleMatrix);
          Object.assign(line, b);
          line.baseline = line.baseline * appliedScale + scaleMatrix.f;
        }
      }
      for (let i = startMarkers; i < this.ir.markers.length; i++) {
        const marker = this.ir.markers[i];
        if (!marker) continue;
        marker.bounds = transformedBox(marker.bounds, scaleMatrix);
        if (truncated) marker.bounds = intersect(marker.bounds, box);
      }
      if (policy.kind !== "error") {
        this.metadata(block, 128);
        this.diagnostics.push({
          code: "LAYOUT_OVERFLOW",
          severity: "warning",
          phase: "layout",
          nodeId: block.nodeId,
          pageIndex: this.pageIndex,
          message: `Explicit ${policy.kind}: truncated=${truncated}, scale=${appliedScale}, fontScale=${this.fontScale}, minimumFontSize=${this.fontFloor}`,
        });
      }
    } finally {
      this.inRegion = false;
      this.horizontalOverflow = false;
      this.fontScale = 1;
      this.fontFloor = 0;
      this.decorationBox = undefined;
      this.y = spec.mode === "fixed" ? savedY : box.y + box.height;
    }
  }

  private newPage(initial = false) {
    if (
      this.ir.pages.length >= (this.options.pagination?.maxPages ?? layoutResourceLimits.pages) ||
      this.work.pages >= layoutResourceLimits.pages * layoutResourceLimits.paginationPasses
    )
      throw new LayoutError("LAYOUT_LIMIT", "Page budget exceeded before page allocation");
    this.reserveSectionMetadata();
    this.work.pages++;
    this.pageIndex = this.ir.pages.length;
    this.ir.pages.push({
      ...this.geometry,
      id: `page${this.pageIndex}`,
      pageIndex: this.pageIndex,
      orientation:
        this.pageSettings?.orientation ??
        (this.geometry.width <= this.geometry.height ? "portrait" : "landscape"),
      sectionId: this.sectionId,
      ...(this.sectionId !== this.sectionSourceId ? { sectionSourceId: this.sectionSourceId } : {}),
      objects: [],
    });
    this.pageSettingsByIndex.push(this.pageSettings);
    this.sectionStarts.push(this.sectionStart);
    this.y = this.geometry.contentBox.y;
    if (!initial && this.geometry.contentBox.height < 0.001)
      throw new LayoutError("LAYOUT_OVERFLOW", "No content height");
  }
  private decoratePage() {
    const page = this.ir.pages[this.pageIndex];
    if (!page) throw new Error("Missing page");
    const settings = this.pageSettingsByIndex[this.pageIndex];
    if (!settings) return;
    const bodyObjects = page.objects.length;
    const behindIds = new Set<string>();
    this.decoration = true;
    for (const watermark of settings.watermarks ?? []) {
      const before = page.objects.length;
      this.watermark(watermark);
      if (watermark.layer === "behind")
        for (const object of page.objects.slice(before)) behindIds.add(object.id);
    }
    if (settings.border) {
      this.reserveObjects(1);
      const { inset, width, color: value } = settings.border;
      const x = inset + width / 2,
        y = x,
        w = page.width - 2 * x,
        h = page.height - 2 * y;
      page.objects.push({
        id: `page${this.pageIndex}object${page.objects.length}`,
        kind: "path",
        drawOrder: page.objects.length,
        stateId: this.state(value, width),
        bounds: { x, y, width: w, height: h },
        coordinateSpace: "page",
        commands: [
          { op: "move", x, y },
          { op: "line", x: x + w, y },
          { op: "line", x: x + w, y: y + h },
          { op: "line", x, y: y + h },
          { op: "close" },
        ],
        fillRule: "nonzero",
        fill: false,
        stroke: true,
      });
    }
    for (const [kind, band] of [
      ["header", settings.header],
      ["footer", settings.footer],
    ] as const) {
      if (!band) continue;
      const sectionPage = this.pageIndex - (this.sectionStarts[this.pageIndex] ?? 0) + 1;
      if ((band.hideFirstPage && sectionPage === 1) || band.hiddenPages?.includes(sectionPage))
        continue;
      const parts: string[] = [];
      let units = 0;
      for (const part of band.parts) {
        if (part.kind === "total-pages") this.usesTotalPages = true;
        const text =
          part.kind === "text"
            ? part.text
            : part.kind === "total-pages"
              ? String(this.totalPages)
              : String((settings.startPageNumber ?? 1) + sectionPage - 1);
        if (text.length > 100000 - units)
          throw new LayoutError(
            "LAYOUT_LIMIT",
            "Page band text budget exceeded before concatenation",
          );
        units += text.length;
        parts.push(text);
      }
      const text = parts.join("");
      if (!text.length) continue;
      this.decorationBox = {
        x: settings.margins.left,
        y:
          kind === "header"
            ? settings.margins.top
            : page.height - settings.margins.bottom - band.height,
        width: page.width - settings.margins.left - settings.margins.right,
        height: band.height,
      };
      this.y = this.decorationBox.y;
      this.generatedParagraph(text, band.style, band.alignment);
    }
    // Paint background watermarks first while preserving body reading order and stable object references.
    page.objects = [
      ...page.objects.filter((o) => behindIds.has(o.id)),
      ...page.objects.slice(0, bodyObjects),
      ...page.objects.slice(bodyObjects).filter((o) => !behindIds.has(o.id)),
    ];
    page.objects.forEach((object, index) => {
      object.drawOrder = index;
    });
    this.decorationBox = undefined;
    this.decoration = false;
  }
  private generatedParagraph(text: string, style?: TextStyle, alignment?: PageBand["alignment"]) {
    this.paragraph(
      {
        kind: "paragraph",
        nodeId: `generated-page${this.pageIndex}`,
        layout: { alignment: alignment ?? "left" },
        fragments: [
          {
            kind: "text",
            text,
            origin: { kind: "static", nodeId: `generated-page${this.pageIndex}` },
          },
        ],
      },
      -1,
      style,
    );
  }
  private watermark(watermark: Watermark) {
    const page = this.ir.pages[this.pageIndex];
    if (!page) throw new Error("Missing page");
    const start = page.objects.length;
    const firstState = this.ir.graphicsStates.length;
    if (watermark.kind === "image") {
      const image = this.imagesBySourceId.get(watermark.resourceId);
      if (!image) throw new LayoutError("LAYOUT_INPUT", "Watermark image resource is missing");
      this.reserveObjects(1);
      page.objects.push({
        kind: "image",
        id: `page${this.pageIndex}object${page.objects.length}`,
        drawOrder: page.objects.length,
        stateId: this.state(),
        bounds: {
          x: watermark.x,
          y: watermark.y,
          width: watermark.width,
          height: watermark.height,
        },
        resourceId: image.id,
        transform: {
          a: watermark.width / image.pixelWidth,
          b: 0,
          c: 0,
          d: watermark.height / image.pixelHeight,
          e: watermark.x,
          f: watermark.y,
        },
      });
    } else {
      this.decorationBox = {
        x: watermark.x,
        y: watermark.y,
        width: page.width - watermark.x,
        height: page.height - watermark.y,
      };
      this.y = watermark.y;
      this.generatedParagraph(watermark.text, watermark.style);
    }
    for (const object of page.objects.slice(start)) {
      if (object.kind === "path") object.coordinateSpace = "local";
      const { x, y, width, height } = object.bounds;
      const matrix = watermark.transform;
      const points = [
        [x, y],
        [x + width, y],
        [x, y + height],
        [x + width, y + height],
      ].map(([px = 0, py = 0]) => ({
        x: matrix.a * px + matrix.c * py + matrix.e,
        y: matrix.b * px + matrix.d * py + matrix.f,
      }));
      const left = Math.min(...points.map((p) => p.x)),
        top = Math.min(...points.map((p) => p.y));
      object.bounds = {
        x: left,
        y: top,
        width: Math.max(...points.map((p) => p.x)) - left,
        height: Math.max(...points.map((p) => p.y)) - top,
      };
    }
    // Only visit this watermark's newly allocated states, never scan all preceding pages.
    for (let index = firstState; index < this.ir.graphicsStates.length; index++) {
      const state = this.ir.graphicsStates[index];
      if (!state) throw new Error("Missing watermark state");
      state.opacity = watermark.opacity;
      state.transform = { ...watermark.transform };
    }
  }
  private reserveSectionMetadata(nodeId?: string) {
    const units =
      this.sectionId.length +
      (this.sectionId !== this.sectionSourceId ? this.sectionSourceId.length : 0);
    if (units > 8_000_000 - this.work.outputTextUnits)
      throw new LayoutError(
        "LAYOUT_LIMIT",
        "Output section metadata exceeds string budget before allocation",
        nodeId,
      );
    this.work.outputTextUnits += units;
  }
  private reserveObjects(count: number) {
    if (count > layoutResourceLimits.objects - this.work.emittedObjects)
      throw new LayoutError("LAYOUT_LIMIT", "IR object budget exceeded");
    this.work.emittedObjects += count;
  }
  private style(styleId?: string): TextStyle {
    if (styleId === undefined) return {};
    const style = Object.hasOwn(this.doc.styles, styleId) ? this.doc.styles[styleId] : undefined;
    if (!style) throw new LayoutError("LAYOUT_INPUT", `Unknown style ${styleId}`);
    return style;
  }
  private face(style: TextStyle): Face {
    const face = this.faces.find(
      (f) =>
        f.definition.family === style.fontFamily &&
        f.definition.weight === (style.bold ? 700 : 400) &&
        f.definition.italic === (style.italic ?? false),
    );
    if (!face)
      throw new LayoutError("FONT_UNAVAILABLE", "Exact family/weight/italic face is required");
    return face;
  }
  private shape(text: string, run: Run) {
    this.work.shapedUnits += text.length;
    if (this.work.shapedUnits > 2_000_000)
      throw new LayoutError("LAYOUT_LIMIT", "Shaping work exceeds 2000000 UTF-16 units");
    return this.core.shape({
      text,
      fontSha256: run.face.definition.sha256,
      direction: "ltr",
      script: run.script,
      language: this.doc.settings.locale,
      style: { weight: run.face.definition.weight, italic: run.face.definition.italic },
    });
  }
  private runs(text: string, spans: Span[], base: TextStyle): Run[] {
    const runs: Run[] = [];
    const styles = new Map<string, { style: TextStyle; face: Face }>();
    const definitions = new Map<string, { style: TextStyle; face: Face }>();
    let script = Array.from(text).map(scriptOf).find(Boolean) ?? "Latn";
    for (const span of spans) {
      if (span.start === span.end) {
        const previous = runs.at(-1);
        if (span.controlId && previous) previous.separateAfter = true;
        continue;
      }
      const key = `${span.fragment.styleInheritance === "explicit" ? "e" : "p"}:${span.fragment.styleId ?? ""}`;
      let selected = styles.get(key);
      if (!selected) {
        const effective = {
          ...this.options.defaultStyle,
          ...(span.fragment.styleInheritance === "explicit" ? {} : base),
          ...this.style(span.fragment.styleId),
        };
        const definition = canonicalSerialize(effective);
        selected = definitions.get(definition);
        if (!selected) {
          selected = { style: effective, face: this.face(effective) };
          definitions.set(definition, selected);
        }
        styles.set(key, selected);
      }
      const { face } = selected;
      const style = span.controlId ? { ...selected.style } : selected.style;
      for (let i = span.start; i < span.end; ) {
        const char = String.fromCodePoint(text.codePointAt(i) ?? 0);
        const control = isControl(char);
        script = scriptOf(char) ?? script;
        const previous = runs.at(-1);
        if (
          previous &&
          previous.end === i &&
          !previous.separateAfter &&
          !control &&
          !previous.control &&
          previous.script === script &&
          previous.style === style
        )
          previous.end += char.length;
        else runs.push({ start: i, end: i + char.length, style, face, script, control });
        i += char.length;
      }
    }
    return runs;
  }
  private metrics(run: Run) {
    const nominal =
      Math.min(
        run.style.fontSize ?? this.options.defaultStyle.fontSize,
        Math.max(
          this.fontFloor,
          (run.style.fontSize ?? this.options.defaultStyle.fontSize) * this.fontScale,
        ),
      ) * pt;
    const size =
      nominal * (run.style.verticalAlign && run.style.verticalAlign !== "baseline" ? 0.65 : 1);
    const shift =
      run.style.verticalAlign === "superscript"
        ? -nominal * 0.35
        : run.style.verticalAlign === "subscript"
          ? nominal * 0.2
          : 0;
    const scale = size / run.face.metrics.head.unitsPerEm;
    const metrics = run.face.metrics;
    const ascender = metrics.os2.useTypoMetrics ? metrics.os2.typoAscender : metrics.hhea.ascent;
    const descender = metrics.os2.useTypoMetrics ? metrics.os2.typoDescender : metrics.hhea.descent;
    return {
      size,
      shift,
      ascent: Math.max(0, ascender * scale - shift),
      descent: Math.max(0, -descender * scale + shift),
    };
  }
  private measure(
    text: string,
    runs: Run[],
    start: number,
    end: number,
    properties: ParagraphLayout,
    indent: number,
  ): Piece[] {
    const result: Piece[] = [];
    let x = indent;
    for (let index = firstEndingAfter(runs, start); index < runs.length; index++) {
      const run = runs[index];
      if (!run || run.start >= end) break;
      this.work.runVisits++;
      if (this.work.runVisits > 2_000_000)
        throw new LayoutError("LAYOUT_LIMIT", "Line measurement exceeds 2000000 run visits");
      const a = Math.max(start, run.start),
        b = Math.min(end, run.end);
      if (a >= b) continue;
      const slice = text.slice(a, b);
      const { size, shift, ascent, descent } = this.metrics(run);
      const scale = size / run.face.metrics.head.unitsPerEm;
      const shaped = run.control ? undefined : this.shape(slice, run);
      let width = shaped ? shaped.advance.x * scale : 0;
      if (slice === "\t") {
        const interval = properties.defaultTabInterval ?? 12.7;
        const stops = properties.tabStops ?? [];
        const stop = stops[upperBound(stops, x)] ?? (Math.floor(x / interval) + 1) * interval;
        width = stop - x;
      }
      result.push({
        run,
        start: a,
        end: b,
        text: slice,
        size,
        shift,
        width,
        ascent,
        descent,
        ...(shaped ? { shaped } : {}),
      });
      x += width;
    }
    return result;
  }
  private paragraph(
    paragraph: ResolvedParagraph,
    paragraphIndex: number,
    generatedStyle?: TextStyle,
    maxLines?: number,
  ) {
    if (++this.work.paragraphs > layoutResourceLimits.layoutParagraphs)
      throw new LayoutError("LAYOUT_LIMIT", "Paragraph layout budget exceeded", paragraph.nodeId);
    const firstLine = this.lines.length;
    const properties = paragraph.layout ?? {};
    if (properties.tabStops?.some((value, i, values) => i > 0 && value <= (values[i - 1] ?? 0)))
      throw new LayoutError("LAYOUT_INPUT", "Tab stops must increase", paragraph.nodeId);
    const heading =
      properties.role === "heading"
        ? { fontSize: [24, 20, 18, 16, 14, 12][(properties.headingLevel ?? 1) - 1], bold: true }
        : {};
    const base = {
      ...this.options.defaultStyle,
      ...heading,
      ...this.style(paragraph.styleId),
      ...generatedStyle,
    };
    let text = "";
    const spans: Span[] = [];
    for (const input of paragraph.fragments) {
      const controlId = input.kind === "input-control" ? input.controlId : undefined;
      const fragment: ResolvedTextFragment =
        input.kind === "text"
          ? input
          : {
              kind: "text",
              text:
                typeof input.defaultValue === "boolean"
                  ? input.defaultValue
                    ? "[x]"
                    : "[ ]"
                  : (input.defaultValue ?? input.placeholder ?? ""),
              origin: { kind: "static", nodeId: input.nodeId },
              ...(input.styleId ? { styleId: input.styleId } : {}),
            };
      if (fragment.text.length > 100_000 - text.length || !fragment.text.isWellFormed())
        throw new LayoutError(
          "LAYOUT_INPUT",
          "Paragraph must be well-formed UTF-16 with at most 100000 units",
          paragraph.nodeId,
        );
      spans.push({
        start: text.length,
        end: text.length + fragment.text.length,
        fragment,
        ...(controlId ? { controlId } : {}),
      });
      text += fragment.text;
    }
    const runs = this.runs(text, spans, base);
    const number = properties.numbering;
    let label = "";
    if (number) {
      let startValue = number.start;
      if (startValue !== undefined && paragraph.instancePath?.length) {
        // The innermost repeat varies item identity; its parent chain identifies the list group.
        const startKey = canonicalSerialize({
          listId: number.listId,
          nodeId: paragraph.nodeId,
          parents: paragraph.instancePath
            .slice(0, -1)
            .map((instance) => ({ nodeId: instance.nodeId, key: instance.key })),
        });
        if (this.initializedRepeatStarts.has(startKey)) startValue = undefined;
        else this.initializedRepeatStarts.add(startKey);
      }
      const count = startValue ?? (this.counts.get(number.listId) ?? 0) + 1;
      this.counts.set(number.listId, count);
      label =
        (number.format === "decimal"
          ? String(count)
          : number.format === "bullet"
            ? "·"
            : number.format === "upper-alpha"
              ? alpha(count).toUpperCase()
              : alpha(count)) + (number.suffix ?? (number.format === "bullet" ? " " : ". "));
    }
    const baseRun = (): Run => ({
      start: 0,
      end: label.length,
      style: base,
      face: this.face(base),
      script: "Latn",
      control: false,
    });
    if (!label.isWellFormed() || /[\t\r\n\u2028\u2029]/u.test(label))
      throw new LayoutError(
        "LAYOUT_INPUT",
        "Numbering markers must be well-formed single-line text without Tabs",
        paragraph.nodeId,
      );
    const labelRuns = label
      ? this.runs(
          label,
          [
            {
              start: 0,
              end: label.length,
              fragment: {
                kind: "text",
                text: label,
                origin: { kind: "static", nodeId: paragraph.nodeId },
              },
            },
          ],
          base,
        )
      : [];
    const labelRun = labelRuns[0];
    const labelPieces = this.measure(label, labelRuns, 0, label.length, {}, 0);
    const labelWidth = labelPieces.reduce((sum, piece) => sum + piece.width, 0);
    const left = properties.leftIndent ?? (label ? labelWidth + 2 : 0),
      right = properties.rightIndent ?? 0;
    const firstIndent = properties.firstLineIndent ?? 0;
    const box = this.decorationBox ?? this.geometry.contentBox;
    if (
      left + firstIndent < 0 ||
      box.width - left - right - Math.max(0, firstIndent) <= 0 ||
      (label && left + firstIndent < labelWidth)
    )
      throw new LayoutError(
        "LAYOUT_OVERFLOW",
        "Indent/numbering leaves no line width",
        paragraph.nodeId,
      );
    // Boundaries from complete shaping prevent splitting ligatures/combining clusters.
    const safe = new Set<number>([0, text.length]);
    for (const run of runs) {
      if (run.control) {
        safe.add(run.start);
        safe.add(run.end);
        continue;
      }
      const shaped = this.shape(text.slice(run.start, run.end), run);
      for (const glyph of shaped.glyphs) {
        safe.add(run.start + glyph.cluster);
        safe.add(run.start + glyph.clusterEnd);
      }
    }
    const chineseBreak = chineseBreakChecker(text);
    const candidates = lineBreakOpportunities(text).filter(
      (b) => b.required || (safe.has(b.position) && chineseBreak(b.position)),
    );
    const breakPositions = new Set(candidates.map((candidate) => candidate.position));
    if (this.y > box.y) this.y += properties.spaceBefore ?? 0;
    let start = 0,
      lineIndex = 0;
    let candidateIndex = 0;
    let terminalEmptyPending = /[\n\r\u2028\u2029]$/u.test(text);
    do {
      const indent = lineIndex === 0 ? firstIndent : 0;
      const available = box.width - left - right - indent;
      let end = start,
        pieces: Piece[] = [],
        forced = false;
      while (
        candidateIndex < candidates.length &&
        (candidates[candidateIndex]?.position ?? 0) <= start
      )
        candidateIndex++;
      for (let index = candidateIndex; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (!candidate) break;
        this.work.candidateVisits++;
        if (this.work.candidateVisits > 2_000_000)
          throw new LayoutError("LAYOUT_LIMIT", "Line selection exceeds 2000000 candidate visits");
        const measured = this.measure(text, runs, start, candidate.position, properties, indent);
        if (measured.reduce((sum, p) => sum + p.width, 0) > available + 1e-9) break;
        end = candidate.position;
        pieces = measured;
        forced = candidate.required && end < text.length;
        if (candidate.required) break;
      }
      if (end === start && text.length > start && this.horizontalOverflow) {
        const candidate = candidates[candidateIndex];
        if (candidate) {
          end = candidate.position;
          pieces = this.measure(text, runs, start, end, properties, indent);
          forced = candidate.required && end < text.length;
        }
      }
      if (end === start && text.length > start)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Unbreakable text exceeds line width",
          paragraph.nodeId,
        );
      const blankRun = runs.at(-1) ?? labelRun ?? baseRun();
      const blankMetrics = this.metrics(blankRun);
      const metricPieces = [...pieces, ...(lineIndex === 0 ? labelPieces : [])];
      const ascent = metricPieces.length
        ? Math.max(...metricPieces.map((p) => p.ascent))
        : blankMetrics.ascent;
      const descent = metricPieces.length
        ? Math.max(...metricPieces.map((p) => p.descent))
        : blankMetrics.descent;
      const natural = ascent + descent;
      const height =
        properties.lineHeight?.kind === "fixed"
          ? properties.lineHeight.value
          : natural * (properties.lineHeight?.value ?? 1.2);
      if (height + 1e-9 < natural)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Line height is smaller than font metrics",
          paragraph.nodeId,
        );
      if (height > box.height + 1e-9 || box.width <= 0)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Line cannot fit the reserved page area",
          paragraph.nodeId,
        );
      if (this.y + height > box.y + box.height + 1e-9) {
        if (this.decoration || this.inRegion)
          throw new LayoutError(
            "LAYOUT_OVERFLOW",
            "Page decoration exceeds its reserved area",
            paragraph.nodeId,
          );
        this.newPage();
      }
      const baseline = this.y + (height - natural) / 2 + ascent;
      const alignment = properties.alignment ?? "left";
      const firstTab = pieces.findIndex((piece) => piece.text === "\t");
      let tabPrefixOffset = 0;
      if (firstTab >= 0 && (alignment === "center" || alignment === "right")) {
        const tab = pieces[firstTab];
        if (tab) {
          // Only the unanchored prefix is aligned within the first tab cell.
          // Shorten that tab by the same amount: every anchored segment keeps its position.
          tabPrefixOffset = tab.width * (alignment === "center" ? 0.5 : 1);
          pieces[firstTab] = { ...tab, width: tab.width - tabPrefixOffset };
        }
      }
      const width = pieces.reduce((sum, p) => sum + p.width, 0);
      const justify = alignment === "justify" && end < text.length && !forced;
      const gaps = justify ? this.justificationGaps(pieces, text, end, breakPositions) : [];
      const extra = gaps.length ? (available - width) / gaps.length : 0;
      const offset =
        firstTab >= 0
          ? tabPrefixOffset
          : alignment === "right"
            ? available - width
            : alignment === "center"
              ? (available - width) / 2
              : 0;
      let x = box.x + left + indent + offset;
      if (!this.decoration) {
        this.reserveSectionMetadata(paragraph.nodeId);
        this.lines.push({
          nodeId: paragraph.nodeId,
          paragraphIndex,
          pageIndex: this.pageIndex,
          sectionId: this.sectionId,
          ...(this.sectionId !== this.sectionSourceId
            ? { sectionSourceId: this.sectionSourceId }
            : {}),
          start,
          end,
          x,
          y: this.y,
          width: gaps.length ? available : width,
          height,
          baseline,
        });
      }
      if (lineIndex === 0) {
        let labelX = box.x + left + indent - labelWidth;
        for (const labelPiece of labelPieces)
          labelX += this.emit(labelPiece, labelX, baseline, paragraph, [], [], 0, true);
      }
      for (const piece of pieces) {
        x += this.emit(piece, x, baseline, paragraph, spans, gaps, extra);
      }
      if (!pieces.length) {
        const empty: Piece = {
          run: blankRun,
          start,
          end,
          text: "",
          ...blankMetrics,
          width: 0,
        };
        this.emit(empty, x, baseline, paragraph, spans, [], 0);
      }
      this.y += height;
      start = end;
      lineIndex++;
      if (maxLines !== undefined && lineIndex >= maxLines) break;
      if (start === text.length) {
        if (!terminalEmptyPending) break;
        terminalEmptyPending = false;
      }
    } while (start <= text.length);
    if (properties.border) {
      let first = firstLine;
      while (first < this.lines.length) {
        const initial = this.lines[first];
        if (!initial) break;
        let last = first;
        while (this.lines[last + 1]?.pageIndex === initial.pageIndex) last++;
        const bottom = this.lines[last];
        if (!bottom) break;
        const borderBox = {
          x: box.x,
          y: initial.y,
          width: box.width,
          height: bottom.y + bottom.height - initial.y,
        };
        this.commands(5);
        this.reserveObjects(1);
        const target = this.ir.pages[initial.pageIndex];
        if (!target) throw new Error("Missing page");
        target.objects.push({
          id: `page${initial.pageIndex}object${target.objects.length}`,
          kind: "path",
          drawOrder: target.objects.length,
          stateId: this.graphicState(properties.border),
          bounds: borderBox,
          coordinateSpace: "page",
          commands: borderPath(borderBox, properties.border),
          fill: false,
          stroke: true,
          fillRule: "nonzero",
        });
        first = last + 1;
      }
    }
    // Trailing space consumes remaining space only; it never creates a blank page itself.
    this.y = Math.min(box.y + box.height, this.y + (properties.spaceAfter ?? 0));
  }
  private justificationGaps(
    pieces: Piece[],
    text: string,
    end: number,
    breakPositions: Set<number>,
  ): number[] {
    if (pieces.some((p) => p.text === "\t")) return [];
    const gaps: number[] = [];
    const seen = new Set<number>();
    for (const piece of pieces)
      for (const glyph of piece.shaped?.glyphs ?? []) {
        const at = piece.start + glyph.clusterEnd;
        if (at >= end || seen.has(at)) continue;
        seen.add(at);
        const cluster = text.slice(piece.start + glyph.cluster, at);
        const left = Array.from(cluster).at(-1) ?? "";
        const right = String.fromCodePoint(text.codePointAt(at) ?? 0);
        const cjkEdge =
          scriptOf(left) === "Hani" ||
          scriptOf(right) === "Hani" ||
          opening.has(left) ||
          closing.has(left) ||
          opening.has(right) ||
          closing.has(right);
        if (/ $/u.test(cluster) || (breakPositions.has(at) && cjkEdge)) gaps.push(at);
      }
    return gaps.sort((a, b) => a - b);
  }
  private state(value?: string, thickness = 0.2) {
    const id = `state${this.ir.graphicsStates.length}`;
    this.ir.graphicsStates.push({
      id,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      fillColor: color(value),
      strokeColor: color(value),
      opacity: 1,
      blendMode: "normal",
      lineWidth: thickness,
      dash: [],
      dashOffset: 0,
      lineCap: "butt",
      lineJoin: "miter",
      miterLimit: 10,
    });
    return id;
  }
  private emptyControlAnchor(
    source: Span,
    paragraph: ResolvedParagraph,
    piece: Piece,
    x: number,
    baseline: number,
  ) {
    if (!source.controlId) throw new Error("Missing control identity");
    this.reserveObjects(2);
    this.metadata(
      paragraph,
      source.fragment.origin.nodeId.length * 2 + source.controlId.length * 2,
    );
    const objects = requiredLayoutValue(this.ir.pages[this.pageIndex]).objects;
    const id = `page${this.pageIndex}object${objects.length}`;
    const bounds = {
      x,
      y: baseline - piece.ascent,
      width: 0,
      height: piece.ascent + piece.descent,
    };
    objects.push({
      id,
      kind: "text",
      drawOrder: objects.length,
      stateId: this.state(piece.run.style.color),
      bounds,
      logicalText: "",
      displayText: "",
      fontId: piece.run.face.id,
      fontSize: piece.size,
      language: this.doc.settings.locale,
      direction: "ltr",
      baseline: { x, y: baseline + piece.shift },
      glyphs: [],
      clusters: [],
    });
    this.semantic({ ...paragraph, nodeId: source.fragment.origin.nodeId }, id);
    const semantic = requiredLayoutValue(this.ir.semantics.at(-1));
    semantic.controlId = source.controlId;
    semantic.sourceText = { text: "", range: { start: 0, end: 0 } };
    semantic.sourceRanges = [
      {
        nodeId: source.fragment.origin.nodeId,
        sourceText: { text: "", range: { start: 0, end: 0 } },
        logicalRange: { start: 0, end: 0 },
      },
    ];
    this.ir.markers.push({
      id: `marker${this.ir.markers.length}`,
      pageId: `page${this.pageIndex}`,
      kind: "control-geometry",
      bounds: { ...bounds },
      nodeId: source.fragment.origin.nodeId,
      objectId: id,
      controlId: source.controlId,
      signatureCoverage: "none",
    });
  }
  private emit(
    piece: Piece,
    x: number,
    baseline: number,
    paragraph: ResolvedParagraph,
    spans: Span[],
    gaps: number[],
    extra: number,
    generated = false,
  ) {
    generated ||= this.decoration;
    if (!generated) {
      this.reserveSectionMetadata(paragraph.nodeId);
      this.metadata(paragraph);
    }
    // Reserve cardinality and wire-text expansion before allocating any IR objects/maps.
    const style = piece.run.style;
    const objectCount =
      1 +
      Number(!!style.highlight) +
      Number(!!(style.underline || style.link)) +
      Number(!!style.strikethrough);
    if (objectCount > layoutResourceLimits.objects - this.work.emittedObjects)
      throw new LayoutError("LAYOUT_LIMIT", "IR object budget exceeded", paragraph.nodeId);
    const selected: Span[] = [];
    let sourceUnits = 0;
    if (!generated)
      for (let index = firstEndingAfter(spans, piece.start - 1); index < spans.length; index++) {
        const span = spans[index];
        if (!span || span.start > piece.end) break;
        const empty = span.start === span.end;
        // Empty origins belong to the preceding piece, except paragraph-start origins
        // which belong to the first (possibly empty) object. Never duplicate at run/line edges.
        const ownsEmpty =
          empty &&
          ((span.start > piece.start && span.start <= piece.end) ||
            (span.start === 0 && piece.start === 0));
        const intersects = !empty && span.start < piece.end && span.end > piece.start;
        if (!ownsEmpty && !intersects) continue;
        this.metadata(
          paragraph,
          span.fragment.origin.nodeId.length +
            (span.fragment.origin.kind === "dynamic-text"
              ? span.fragment.origin.bindingId.length
              : 0),
        );
        sourceUnits += span.fragment.text.length;
        if (sourceUnits > 8_000_000 - this.work.outputTextUnits)
          throw new LayoutError(
            "LAYOUT_LIMIT",
            "Output source text exceeds 8000000 UTF-16 units",
            paragraph.nodeId,
          );
        if (selected.length >= layoutResourceLimits.sourceMappings - this.work.sourceMappings)
          throw new LayoutError("LAYOUT_LIMIT", "Source mapping budget exceeded", paragraph.nodeId);
        selected.push(span);
      }
    const outputUnits =
      piece.text.length * (piece.shaped ? 2 : 1) + sourceUnits * (selected.length === 1 ? 2 : 1);
    if (outputUnits > 8_000_000 - this.work.outputTextUnits)
      throw new LayoutError(
        "LAYOUT_LIMIT",
        "Output logical/display/source text exceeds 8000000 UTF-16 units",
        paragraph.nodeId,
      );
    this.work.outputTextUnits += outputUnits;
    this.work.sourceMappings += selected.length;
    this.work.emittedObjects += objectCount;
    const objects = this.ir.pages[this.pageIndex]?.objects;
    if (!objects) throw new Error("Missing page");
    const ownGaps = gaps.slice(upperBound(gaps, piece.start), upperBound(gaps, piece.end));
    const gapSet = new Set(ownGaps);
    const width = piece.width + ownGaps.length * extra;
    const top = baseline - piece.ascent;
    const bounds = { x, y: top, width, height: piece.ascent + piece.descent };
    const path = (fill: boolean, value: string | undefined, y: number, height: number) => {
      this.commands(fill ? 5 : 2);
      const id = `page${this.pageIndex}object${objects.length}`;
      objects.push({
        kind: "path",
        id,
        drawOrder: objects.length,
        stateId: this.state(value, piece.size / 18),
        bounds: { x, y, width, height },
        coordinateSpace: "page",
        commands: fill
          ? [
              { op: "move", x, y },
              { op: "line", x: x + width, y },
              { op: "line", x: x + width, y: y + height },
              { op: "line", x, y: y + height },
              { op: "close" },
            ]
          : [
              { op: "move", x, y },
              { op: "line", x: x + width, y },
            ],
        fillRule: "nonzero",
        fill,
        stroke: !fill,
      });
    };
    const detachedControls = new Set(
      selected.length > 1
        ? selected.filter((source) => source.controlId && source.start === source.end)
        : [],
    );
    const textSelected = selected.filter((source) => !detachedControls.has(source));
    for (const source of detachedControls)
      if (source.start === piece.start)
        this.emptyControlAnchor(source, paragraph, piece, x, baseline);
    if (style.highlight) path(true, style.highlight, top, bounds.height);
    const id = `page${this.pageIndex}object${objects.length}`;
    const glyphs: TextObject["glyphs"] = [],
      clusters: TextObject["clusters"] = [];
    const scale = piece.size / piece.run.face.metrics.head.unitsPerEm;
    const byStart = new Map<number, TextObject["clusters"][number]>();
    const shapedGlyphs = piece.shaped?.glyphs ?? [];
    const lastGlyph = new Map<number, number>();
    shapedGlyphs.forEach((glyph, index) => {
      lastGlyph.set(glyph.cluster, index);
    });
    for (const glyph of shapedGlyphs) {
      let cluster = byStart.get(glyph.cluster);
      if (!cluster) {
        cluster = {
          clusterId: clusters.length,
          logicalRange: { start: glyph.cluster, end: glyph.clusterEnd },
          displayRange: { start: glyph.cluster, end: glyph.clusterEnd },
          glyphIndices: [],
        };
        clusters.push(cluster);
        byStart.set(glyph.cluster, cluster);
      }
      cluster.glyphIndices.push(glyphs.length);
      const before = upperBound(ownGaps, piece.start + glyph.cluster) * extra;
      const atEnd =
        gapSet.has(piece.start + glyph.clusterEnd) &&
        lastGlyph.get(glyph.cluster) === glyphs.length;
      glyphs.push({
        glyphId: glyph.glyphId,
        clusterId: cluster.clusterId,
        position: {
          x: x + (glyph.x - glyph.xOffset) * scale + before,
          y: baseline + piece.shift - (glyph.y - glyph.yOffset) * scale,
        },
        offset: { x: glyph.xOffset * scale, y: -glyph.yOffset * scale },
        advance: { x: glyph.xAdvance * scale + (atEnd ? extra : 0), y: -glyph.yAdvance * scale },
      });
    }
    objects.push({
      id,
      kind: "text",
      drawOrder: objects.length,
      stateId: this.state(style.color),
      bounds,
      logicalText: piece.text,
      displayText: piece.shaped ? piece.text : "",
      fontId: piece.run.face.id,
      fontSize: piece.size,
      language: this.doc.settings.locale,
      direction: "ltr",
      baseline: { x, y: baseline + piece.shift },
      glyphs,
      clusters,
    });
    if (!generated) {
      const sources = textSelected.map((s) => ({
        nodeId: s.fragment.origin.nodeId,
        ...(s.fragment.origin.kind === "dynamic-text"
          ? { bindingId: s.fragment.origin.bindingId }
          : {}),
        sourceText: {
          text: s.fragment.text,
          range: {
            start: Math.max(s.start, piece.start) - s.start,
            end: Math.min(s.end, piece.end) - s.start,
          },
        },
        logicalRange: {
          start: Math.max(s.start, piece.start) - piece.start,
          end: Math.min(s.end, piece.end) - piece.start,
        },
      }));
      const first = sources[0];
      this.ir.semantics.push({
        objectId: id,
        nodeId: sources.length === 1 && first ? first.nodeId : paragraph.nodeId,
        readingOrder: this.ir.semantics.length,
        pageIndex: this.pageIndex,
        sectionId: this.sectionId,
        ...(this.sectionId !== this.sectionSourceId
          ? { sectionSourceId: this.sectionSourceId }
          : {}),
        ...(sources.length ? { sourceRanges: sources } : {}),
        ...(sources.length === 1 && first
          ? {
              sourceText: first.sourceText,
              ...(first.bindingId ? { bindingId: first.bindingId } : {}),
            }
          : {}),
        ...(paragraph.instancePath
          ? {
              repeatInstance: paragraph.instancePath.map((p) => ({ nodeId: p.nodeId, key: p.key })),
            }
          : {}),
        ...(textSelected.length === 1 && textSelected[0]?.controlId
          ? { controlId: textSelected[0].controlId }
          : {}),
        ...(style.link ? { link: style.link } : {}),
      });
    }
    for (const source of detachedControls)
      if (source.start !== piece.start)
        this.emptyControlAnchor(source, paragraph, piece, x + width, baseline);
    if (!generated)
      for (const source of selected)
        if (source.controlId && !detachedControls.has(source)) {
          this.metadata(paragraph, source.controlId.length);
          this.reserveObjects(1);
          this.ir.markers.push({
            id: `marker${this.ir.markers.length}`,
            pageId: `page${this.pageIndex}`,
            kind: "control-geometry",
            bounds: { ...bounds },
            nodeId: source.fragment.origin.nodeId,
            objectId: id,
            controlId: source.controlId,
            signatureCoverage: "none",
          });
        }
    if (style.underline || style.link)
      path(false, style.color, baseline + piece.shift + piece.size * 0.1, 0);
    if (style.strikethrough) path(false, style.color, baseline + piece.shift - piece.size * 0.3, 0);
    return width;
  }
}

function requiredLayoutValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing internal layout value");
  return value;
}
