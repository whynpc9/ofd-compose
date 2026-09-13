import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  type CanonicalLayoutIR,
  canonicalizationVersion,
  type LayoutIdentityInput,
  LayoutIdentityInputSchema,
  type LayoutIR,
  LayoutIRSchema,
} from "./schema.js";
import { canonicalSerialize, digestCanonical, quantizeMm } from "./serialize.js";
import { clusterOffsetTable, fail } from "./text.js";
import { assertSchema, validateCanonicalLayoutIR, validateLayoutIR } from "./validate.js";

function quantize(schema: TSchema, value: unknown): unknown {
  if (schema["x-unit"] === "mm") return quantizeMm(value as number);
  if (schema.anyOf) {
    const match = (schema.anyOf as TSchema[]).find((s) => Value.Check(s, value));
    if (!match) fail("IR_SCHEMA", "", "No matching union");
    return quantize(match, value);
  }
  if (schema.type === "array") return (value as unknown[]).map((v) => quantize(schema.items, v));
  if (schema.type === "object" && schema.properties)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        schema.properties[key] ? quantize(schema.properties[key], v) : v,
      ]),
    );
  return value;
}
function orderByContent<T>(items: T[]): T[] {
  return items.sort((a, b) => {
    const x = canonicalSerialize(a),
      y = canonicalSerialize(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
/** Canonical content IDs deduplicate equivalent definitions while rewriting every reference. */
function definitions<T extends { id: string }>(
  items: T[],
  prefix: string,
): { items: T[]; ids: Map<string, string> } {
  const keys = new Map<string, Omit<T, "id">>();
  const old = new Map<string, string>();
  for (const { id, ...content } of items) {
    const key = canonicalSerialize(content);
    keys.set(key, content);
    old.set(id, key);
  }
  const ids = new Map<string, string>();
  const keyIds = new Map<string, string>();
  const result = [...keys.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, content], index) => {
      const id = `${prefix}${index}`;
      keyIds.set(key, id);
      return { ...content, id } as T;
    });
  for (const [id, key] of old) ids.set(id, keyIds.get(key) as string);
  return { items: result, ids };
}
export function canonicalizeLayoutIR(input: unknown): CanonicalLayoutIR {
  validateLayoutIR(input);
  const ir = quantize(LayoutIRSchema, JSON.parse(canonicalSerialize(input))) as LayoutIR;
  for (const r of ir.resources)
    if (r.kind === "font" && r.glyphIdMap) r.glyphIdMap.sort((a, b) => a.original - b.original);
  const resources = definitions(ir.resources, "r"),
    states = definitions(ir.graphicsStates, "s");
  ir.resources = resources.items;
  ir.graphicsStates = states.items;
  const pageIds = new Map<string, string>(),
    objectIds = new Map<string, string>();
  ir.pages.sort((a, b) => a.pageIndex - b.pageIndex);
  for (const [index, page] of ir.pages.entries()) {
    const pageId = `p${index}`;
    pageIds.set(page.id, pageId);
    page.id = pageId;
    page.objects.sort((a, b) => a.drawOrder - b.drawOrder);
    for (const [position, item] of page.objects.entries()) {
      const id = `${pageId}o${position}`;
      objectIds.set(item.id, id);
      item.id = id;
      item.stateId = states.ids.get(item.stateId) as string;
      if (item.kind === "image") item.resourceId = resources.ids.get(item.resourceId) as string;
      if (item.kind === "text") {
        item.fontId = resources.ids.get(item.fontId) as string;
        const clusters = clusterOffsetTable(item),
          clusterIds = new Map(clusters.map((c, i) => [c.clusterId, i]));
        item.clusters = clusters.map((c, i) => ({ ...c, clusterId: i }));
        item.glyphs = item.glyphs.map((g) => ({
          ...g,
          clusterId: clusterIds.get(g.clusterId) as number,
        }));
      }
    }
  }
  ir.semantics.sort((a, b) => a.readingOrder - b.readingOrder);
  for (const s of ir.semantics) s.objectId = objectIds.get(s.objectId) as string;
  ir.markers = orderByContent(
    ir.markers.map(({ id: _id, ...marker }) => ({
      ...marker,
      pageId: pageIds.get(marker.pageId) as string,
      ...(marker.objectId ? { objectId: objectIds.get(marker.objectId) as string } : {}),
    })),
  ).map((m, i) => ({ ...m, id: `m${i}` }));
  ir.identity.layoutProfile.features.sort();
  const semanticDigest = digestCanonical(ir.semantics);
  if (ir.identity.semanticDigest && ir.identity.semanticDigest !== semanticDigest)
    fail(
      "IR_DIGEST_MISMATCH",
      "identity/semanticDigest",
      "Semantic digest does not match canonical map",
    );
  ir.identity.semanticDigest = semanticDigest;
  const { provenance: _provenance, ...semantic } = ir;
  const result = { ...semantic, units: "um" as const, canonicalizationVersion };
  validateCanonicalLayoutIR(result);
  return result;
}
export function serializeLayoutIR(input: unknown): string {
  return canonicalSerialize(canonicalizeLayoutIR(input));
}
export function digestLayoutIR(input: unknown): string {
  return digestCanonical(canonicalizeLayoutIR(input));
}
export function canonicalizeLayoutIdentity(
  input: unknown,
): LayoutIdentityInput & { canonicalizationVersion: typeof canonicalizationVersion } {
  assertSchema(LayoutIdentityInputSchema, input);
  const identity = JSON.parse(canonicalSerialize(input)) as LayoutIdentityInput;
  identity.resources = orderByContent([
    ...new Map(identity.resources.map((r) => [canonicalSerialize(r), r])).values(),
  ]);
  identity.profile.features.sort();
  return { ...identity, canonicalizationVersion };
}
export function digestLayoutIdentity(input: unknown): string {
  return digestCanonical(canonicalizeLayoutIdentity(input));
}
/** Caller validates the ResolvedDocument with document-model/binding-core first. Only the
 * top-level nonsemantic provenance envelope is excluded; nested origin/source maps are retained. */
export function digestSemanticDocument(input: Record<string, unknown>): string {
  canonicalSerialize(input);
  const { provenance: _provenance, ...semantic } = input;
  return digestCanonical(semantic);
}
