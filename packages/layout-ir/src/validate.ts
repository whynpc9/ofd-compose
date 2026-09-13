import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { normalizeStructure } from "./normalize.js";
import {
  type CanonicalLayoutIR,
  CanonicalLayoutIRSchema,
  irVersion,
  type LayoutIR,
  LayoutIRSchema,
} from "./schema.js";
import { canonicalSerialize, digestCanonical, formatNumber } from "./serialize.js";
import { clusterOffsetTable, fail, validateUtf16Range } from "./text.js";

export function assertSchema<T extends TSchema>(
  schema: T,
  input: unknown,
): asserts input is Static<T> {
  canonicalSerialize(input);
  if (!Value.Check(schema, input)) {
    const error = Value.Errors(schema, input).First();
    fail("IR_SCHEMA", error?.path ?? "", error?.message ?? "Invalid IR");
  }
}
function unique(values: readonly (string | number)[], path: string): void {
  if (new Set(values).size !== values.length)
    fail("IR_DUPLICATE_ID", path, "Duplicate identity or order");
}
export function validateLayoutIR(input: unknown): asserts input is LayoutIR {
  canonicalSerialize(input);
  if (
    input !== null &&
    typeof input === "object" &&
    "irVersion" in input &&
    input.irVersion !== irVersion
  ) {
    fail("IR_VERSION_UNSUPPORTED", "irVersion", "Unsupported IR version");
  }
  assertSchema(LayoutIRSchema, input);
  validateReferences(input);
}
/** Validates the writer transport in place without changing units, order or IDs. */
export function validateCanonicalLayoutIR(input: unknown): asserts input is CanonicalLayoutIR {
  assertSchema(CanonicalLayoutIRSchema, input);
  validateReferences(input);
  if (input.identity.semanticDigest !== digestCanonical(input.semantics)) {
    fail(
      "IR_DIGEST_MISMATCH",
      "identity/semanticDigest",
      "Semantic digest does not match transported map",
    );
  }
  if (canonicalSerialize(input) !== canonicalSerialize(normalizeStructure(input))) {
    fail(
      "IR_NON_CANONICAL",
      "",
      "Transport must use canonical ordering, IDs and deduplicated definitions",
    );
  }
}
/** Compare finite nonnegative lengths using the same shortest-decimal semantics as
 * quantization, without an epsilon that could hide a genuine boundary violation. */
function sumExceeds(left: number, right: number, limit: number): boolean {
  const parts = [left, right, limit].map((value) => formatNumber(value).split("."));
  const precision = Math.max(...parts.map(([, fraction = ""]) => fraction.length));
  const exact = parts.map(([integer, fraction = ""]) =>
    BigInt(`${integer}${fraction.padEnd(precision, "0")}`),
  );
  const [a, b, c] = exact as [bigint, bigint, bigint];
  return a + b > c;
}
export function validateReferences(
  input: Pick<LayoutIR, "resources" | "graphicsStates" | "pages" | "semantics" | "markers">,
): void {
  const resources = new Map(input.resources.map((r) => [r.id, r]));
  const states = new Set(input.graphicsStates.map((s) => s.id));
  const pages = new Map(input.pages.map((p) => [p.id, p]));
  const objects = new Map(
    input.pages.flatMap((p) => p.objects.map((o) => [o.id, { object: o, pageId: p.id }] as const)),
  );
  unique(
    [
      ...input.resources,
      ...input.graphicsStates,
      ...input.pages,
      ...input.pages.flatMap((p) => p.objects),
      ...input.markers,
    ].map((v) => v.id),
    "ids",
  );
  unique(
    input.pages.map((p) => p.pageIndex),
    "pages/pageIndex",
  );
  unique(
    input.semantics.map((s) => s.objectId),
    "semantics/objectId",
  );
  unique(
    input.semantics.map((s) => s.readingOrder),
    "semantics/readingOrder",
  );
  for (const resource of input.resources) {
    if (resource.kind === "font" && resource.glyphIdMap) {
      if (!resource.subsetDigest)
        fail("IR_RESOURCE", "resources", "Glyph map requires subset digest");
      unique(
        resource.glyphIdMap.map((g) => g.original),
        "resources/glyphIdMap/original",
      );
      unique(
        resource.glyphIdMap.map((g) => g.subset),
        "resources/glyphIdMap/subset",
      );
    }
  }
  for (const page of input.pages) {
    unique(
      page.objects.map((o) => o.drawOrder),
      `pages/${page.id}/drawOrder`,
    );
    if (page.pageIndex >= input.pages.length)
      fail("IR_PAGE_ORDER", `pages/${page.id}`, "Page indexes must be contiguous from zero");
    const box = page.contentBox;
    if (
      box.x < 0 ||
      box.y < 0 ||
      sumExceeds(box.x, box.width, page.width) ||
      sumExceeds(box.y, box.height, page.height)
    )
      fail("IR_PAGE_BOUNDS", `pages/${page.id}`, "Content box exceeds paper");
    for (const item of page.objects) {
      if (!states.has(item.stateId)) fail("IR_REFERENCE", item.id, "Missing graphics state");
      if (item.kind === "text") {
        const font = resources.get(item.fontId);
        if (font?.kind !== "font") fail("IR_REFERENCE", item.id, "Missing font instance");
        clusterOffsetTable(item);
        if (
          font.glyphIdMap &&
          item.glyphs.some((g) => !font.glyphIdMap?.some((m) => m.original === g.glyphId))
        )
          fail("IR_RESOURCE", item.id, "Glyph missing from subset map");
      } else if (item.kind === "image" && resources.get(item.resourceId)?.kind !== "image")
        fail("IR_REFERENCE", item.id, "Missing image resource");
    }
  }
  for (const semantic of input.semantics) {
    for (const source of semantic.sourceRanges ?? []) {
      validateUtf16Range(
        source.sourceText.text,
        source.sourceText.range,
        "semantics/sourceRanges/sourceText",
      );
      const target = objects.get(semantic.objectId)?.object;
      if (target?.kind !== "text")
        fail("IR_REFERENCE", "semantics/sourceRanges", "Source ranges require a text object");
      validateUtf16Range(
        target.logicalText,
        source.logicalRange,
        "semantics/sourceRanges/logicalRange",
      );
    }

    if (!objects.has(semantic.objectId)) fail("IR_REFERENCE", "semantics", "Missing object");
    if (semantic.sourceText)
      validateUtf16Range(
        semantic.sourceText.text,
        semantic.sourceText.range,
        "semantics/sourceText",
      );
  }
  for (const marker of input.markers) {
    if (
      !pages.has(marker.pageId) ||
      (marker.objectId && objects.get(marker.objectId)?.pageId !== marker.pageId)
    )
      fail("IR_REFERENCE", marker.id, "Marker page/object mismatch");
  }
}
