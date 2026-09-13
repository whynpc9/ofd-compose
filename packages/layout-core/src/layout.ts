import {
  type ResolvedDocument,
  ResolvedDocumentSchema,
  type ResolvedParagraph,
  type ResolvedTextFragment,
} from "@ofd-compose/binding-core";
import { type ParagraphLayout, type TextStyle, TextStyleSchema } from "@ofd-compose/document-model";
import {
  canonicalizeLayoutIR,
  canonicalSerialize,
  digestLayoutIdentity,
  digestSemanticDocument,
  irVersion,
  type LayoutIR,
  type TextObject,
} from "@ofd-compose/layout-ir";
import {
  type FontMetrics,
  lineBreakOpportunities,
  shapingAndLineBreakVersions,
  TypographyCore,
} from "@ofd-compose/typography-core";
import { Value } from "@sinclair/typebox/value";

export const layoutEngineVersion = "ofd-compose/paragraph-layout@0";
export const paragraphProfile = Object.freeze({
  name: "paragraphs-ltr",
  version: "0",
  features: Object.freeze([
    "paragraphs",
    "headings",
    "numbering",
    "text-decoration",
    "source-ranges",
  ]),
});
const pt = 25.4 / 72;
export class LayoutError extends Error {
  constructor(
    readonly code:
      | "LAYOUT_INPUT"
      | "LAYOUT_UNSUPPORTED"
      | "LAYOUT_OVERFLOW"
      | "LAYOUT_LIMIT"
      | "FONT_UNAVAILABLE",
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
  page: {
    width: number;
    height: number;
    contentBox: { x: number; y: number; width: number; height: number };
  };
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
  start: number;
  end: number;
  fragment: ResolvedTextFragment;
}
interface Run {
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

/** One-page layout. Resource I/O belongs to the host; every promise settles before metrics/shaping. */
export async function layout(
  document: ResolvedDocument,
  resources: readonly LayoutFont[],
  options: LayoutOptions,
) {
  // Own inputs before any await: arrival timing and caller mutation cannot change layout identity.
  const doc = JSON.parse(canonicalSerialize(document)) as ResolvedDocument;
  const opts = JSON.parse(canonicalSerialize(options)) as LayoutOptions;
  if (!Value.Check(TextStyleSchema, opts.defaultStyle))
    throw new LayoutError("LAYOUT_INPUT", "Invalid default style");
  if (!Value.Check(ResolvedDocumentSchema, doc))
    throw new LayoutError("LAYOUT_INPUT", "Invalid ResolvedDocument");
  const fontInputs = resources.map(({ bytes, ...definition }) => ({
    definition: { ...definition },
    bytes:
      bytes instanceof Uint8Array
        ? Promise.resolve(new Uint8Array(bytes))
        : bytes.then((value) => new Uint8Array(value)),
  }));
  const loaded = await Promise.all(
    fontInputs.map(async ({ definition, bytes }) => ({ definition, bytes: await bytes })),
  );
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
  return new ParagraphLayouter(doc, faces, core, opts).layout();
}

class ParagraphLayouter {
  private readonly ir: LayoutIR;
  private readonly lines: LayoutLine[] = [];
  private readonly counts = new Map<string, number>();
  private readonly initializedRepeatStarts = new Set<string>();
  private shapedUnits = 0;
  private candidateVisits = 0;
  private runVisits = 0;
  private outputTextUnits = 0;
  private y: number;
  constructor(
    private readonly doc: ResolvedDocument,
    private readonly faces: Face[],
    private readonly core: TypographyCore,
    private readonly options: LayoutOptions,
  ) {
    const { page, formattingPolicy, defaultStyle } = options;
    const profile = { ...paragraphProfile, features: [...paragraphProfile.features] };
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
    this.y = page.contentBox.y;
    this.ir = {
      irVersion,
      units: "mm",
      origin: "top-left",
      identity: {
        inputDigest: digestLayoutIdentity({
          resolvedDocumentDigest: digestSemanticDocument(doc),
          resources: faces.map((f) => ({ kind: "font", digest: f.definition.sha256 })),
          layoutEngineVersion,
          shapingVersion: canonicalSerialize(shapingAndLineBreakVersions),
          lineBreakVersion: `${shapingAndLineBreakVersions.linebreak}/chinese-v1`,
          formattingPolicy,
          profile,
          layoutOptions: {
            ...JSON.parse(canonicalSerialize(options)),
            fonts: faces.map((f) => f.definition),
          },
        }),
        layoutProfile: profile,
      },
      resources: faces.map((f) => ({
        id: f.id,
        kind: "font",
        originalDigest: f.definition.sha256,
        faceIndex: 0,
        weight: f.definition.weight,
        style: f.definition.italic ? "italic" : "normal",
        features: {},
        variations: {},
      })),
      graphicsStates: [],
      pages: [
        {
          ...page,
          id: "page",
          pageIndex: 0,
          orientation: page.width <= page.height ? "portrait" : "landscape",
          sectionId: doc.documentId,
          objects: [],
        },
      ],
      semantics: [],
      markers: [],
    };
    // Validate geometry/identity even for an empty document before doing expensive work.
    canonicalizeLayoutIR(this.ir);
  }
  layout() {
    this.doc.body.forEach((block, index) => {
      if (block.kind !== "paragraph")
        throw new LayoutError("LAYOUT_UNSUPPORTED", "Tables belong to issue 13", block.nodeId);
      this.paragraph(block, index);
    });
    const ir = canonicalizeLayoutIR(this.ir);
    return {
      ir,
      semanticMap: ir.semantics,
      lines: this.lines,
      diagnostics: [],
      work: {
        shapedUnits: this.shapedUnits,
        candidateVisits: this.candidateVisits,
        runVisits: this.runVisits,
        outputTextUnits: this.outputTextUnits,
      },
    };
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
    this.shapedUnits += text.length;
    if (this.shapedUnits > 2_000_000)
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
      if (span.start === span.end) continue;
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
      const { style, face } = selected;
      for (let i = span.start; i < span.end; ) {
        const char = String.fromCodePoint(text.codePointAt(i) ?? 0);
        const control = isControl(char);
        script = scriptOf(char) ?? script;
        const previous = runs.at(-1);
        if (
          previous &&
          previous.end === i &&
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
    const nominal = (run.style.fontSize ?? this.options.defaultStyle.fontSize) * pt;
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
      this.runVisits++;
      if (this.runVisits > 2_000_000)
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
  private paragraph(paragraph: ResolvedParagraph, paragraphIndex: number) {
    const properties = paragraph.layout ?? {};
    if (properties.tabStops?.some((value, i, values) => i > 0 && value <= (values[i - 1] ?? 0)))
      throw new LayoutError("LAYOUT_INPUT", "Tab stops must increase", paragraph.nodeId);
    const heading =
      properties.role === "heading"
        ? { fontSize: [24, 20, 18, 16, 14, 12][(properties.headingLevel ?? 1) - 1], bold: true }
        : {};
    const base = { ...this.options.defaultStyle, ...heading, ...this.style(paragraph.styleId) };
    let text = "";
    const spans: Span[] = [];
    for (const fragment of paragraph.fragments) {
      if (fragment.kind !== "text")
        throw new LayoutError(
          "LAYOUT_UNSUPPORTED",
          "InputControl layout is not implemented",
          paragraph.nodeId,
        );
      if (fragment.text.length > 100_000 - text.length || !fragment.text.isWellFormed())
        throw new LayoutError(
          "LAYOUT_INPUT",
          "Paragraph must be well-formed UTF-16 with at most 100000 units",
          paragraph.nodeId,
        );
      spans.push({ start: text.length, end: text.length + fragment.text.length, fragment });
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
    const box = this.options.page.contentBox;
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
    this.y += properties.spaceBefore ?? 0;
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
        this.candidateVisits++;
        if (this.candidateVisits > 2_000_000)
          throw new LayoutError("LAYOUT_LIMIT", "Line selection exceeds 2000000 candidate visits");
        const measured = this.measure(text, runs, start, candidate.position, properties, indent);
        if (measured.reduce((sum, p) => sum + p.width, 0) > available + 1e-9) break;
        end = candidate.position;
        pieces = measured;
        forced = candidate.required && end < text.length;
        if (candidate.required) break;
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
      if (this.y + height > box.y + box.height + 1e-9)
        throw new LayoutError(
          "LAYOUT_OVERFLOW",
          "Single-page content height exceeded; pagination belongs to issue 10",
          paragraph.nodeId,
        );
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
      this.lines.push({
        nodeId: paragraph.nodeId,
        paragraphIndex,
        start,
        end,
        x,
        y: this.y,
        width: gaps.length ? available : width,
        height,
        baseline,
      });
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
      if (start === text.length) {
        if (!terminalEmptyPending) break;
        terminalEmptyPending = false;
      }
    } while (start <= text.length);
    this.y += properties.spaceAfter ?? 0;
    if (this.y > box.y + box.height + 1e-9)
      throw new LayoutError(
        "LAYOUT_OVERFLOW",
        "Paragraph spacing exceeds single page",
        paragraph.nodeId,
      );
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
    // Reserve wire-text expansion before allocating glyphs, paths or sourceText mappings.
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
        sourceUnits += span.fragment.text.length;
        if (sourceUnits > 8_000_000 - this.outputTextUnits)
          throw new LayoutError(
            "LAYOUT_LIMIT",
            "Output source text exceeds 8000000 UTF-16 units",
            paragraph.nodeId,
          );
        selected.push(span);
      }
    const outputUnits =
      piece.text.length * (piece.shaped ? 2 : 1) + sourceUnits * (selected.length === 1 ? 2 : 1);
    if (outputUnits > 8_000_000 - this.outputTextUnits)
      throw new LayoutError(
        "LAYOUT_LIMIT",
        "Output logical/display/source text exceeds 8000000 UTF-16 units",
        paragraph.nodeId,
      );
    this.outputTextUnits += outputUnits;
    const objects = this.ir.pages[0]?.objects;
    if (!objects) throw new Error("Missing page");
    const ownGaps = gaps.slice(upperBound(gaps, piece.start), upperBound(gaps, piece.end));
    const gapSet = new Set(ownGaps);
    const width = piece.width + ownGaps.length * extra;
    const top = baseline - piece.ascent;
    const bounds = { x, y: top, width, height: piece.ascent + piece.descent };
    const style = piece.run.style;
    const path = (fill: boolean, value: string | undefined, y: number, height: number) => {
      const id = `object${objects.length}`;
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
    if (style.highlight) path(true, style.highlight, top, bounds.height);
    const id = `object${objects.length}`;
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
      const sources = selected.map((s) => ({
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
        ...(style.link ? { link: style.link } : {}),
      });
    }
    if (style.underline || style.link)
      path(false, style.color, baseline + piece.shift + piece.size * 0.1, 0);
    if (style.strikethrough) path(false, style.color, baseline + piece.shift - piece.size * 0.3, 0);
    return width;
  }
}
