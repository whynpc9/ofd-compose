import { type CanonicalLayoutIR, canonicalizationVersion, type LayoutIR } from "./schema.js";
import { canonicalSerialize, digestCanonical } from "./serialize.js";
import { clusterOffsetTable } from "./text.js";

export function orderByContent<T>(items: T[]): T[] {
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
/** Internal structural normalization for already validated geometry. Never converts units.
 * Clone first: both producer normalization and writer validation leave their input untouched. */
export function normalizeStructure(
  input: Omit<LayoutIR, "units"> & { units: "mm" | "um" },
): CanonicalLayoutIR {
  const ir = JSON.parse(canonicalSerialize(input)) as Omit<LayoutIR, "units"> & {
    units: "mm" | "um";
  };
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
  ir.identity.semanticDigest = semanticDigest;
  const { provenance: _provenance, ...semantic } = ir;
  return {
    ...semantic,
    identity: { ...semantic.identity, semanticDigest },
    units: "um",
    canonicalizationVersion,
  };
}
