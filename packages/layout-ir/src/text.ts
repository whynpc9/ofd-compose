import type { TextObject } from "./schema.js";

export class IRValidationError extends Error {
  constructor(
    public readonly code: string,
    public readonly path: string,
    message: string,
  ) {
    super(`${code} at ${path}: ${message}`);
    this.name = "IRValidationError";
  }
}
export function fail(code: string, path: string, message: string): never {
  throw new IRValidationError(code, path, message);
}

export function validateUtf16Range(
  text: string,
  range: { start: number; end: number },
  path = "range",
): void {
  const boundary = (offset: number) => {
    const before = text.charCodeAt(offset - 1),
      after = text.charCodeAt(offset);
    return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
  };
  if (
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > text.length ||
    !boundary(range.start) ||
    !boundary(range.end)
  )
    fail("IR_TEXT_RANGE", path, "Expected UTF-16 boundaries without splitting a surrogate pair");
}

/** Table supports ligatures, combining marks, astral characters and non-monotonic RTL glyph order. */
export function clusterOffsetTable(text: TextObject): TextObject["clusters"] {
  const clusters = [...text.clusters].sort((a, b) => a.displayRange.start - b.displayRange.start);
  const ids = new Set<number>(),
    glyphs = new Set<number>();
  let displayEnd = 0;
  for (const cluster of clusters) {
    const path = `clusters/${cluster.clusterId}`;
    validateUtf16Range(text.logicalText, cluster.logicalRange, path);
    validateUtf16Range(text.displayText, cluster.displayRange, path);
    if (
      ids.has(cluster.clusterId) ||
      cluster.displayRange.start !== displayEnd ||
      cluster.displayRange.end === displayEnd
    )
      fail("IR_CLUSTER_MAP", path, "Clusters must uniquely partition display text");
    ids.add(cluster.clusterId);
    displayEnd = cluster.displayRange.end;
    if (cluster.glyphIndices.length === 0)
      fail("IR_CLUSTER_MAP", path, "Cluster must reference a glyph");
    for (const index of cluster.glyphIndices) {
      if (
        !Number.isSafeInteger(index) ||
        glyphs.has(index) ||
        text.glyphs[index]?.clusterId !== cluster.clusterId
      )
        fail(
          "IR_CLUSTER_MAP",
          path,
          "Glyph index missing, duplicated or assigned to another cluster",
        );
      glyphs.add(index);
    }
  }
  if (displayEnd !== text.displayText.length || glyphs.size !== text.glyphs.length)
    fail("IR_CLUSTER_MAP", "clusters", "Unmapped text or glyphs");
  return clusters.map((c) => ({
    ...c,
    logicalRange: { ...c.logicalRange },
    displayRange: { ...c.displayRange },
    glyphIndices: [...c.glyphIndices].sort((a, b) => a - b),
  }));
}
export function clustersAtOffset(
  text: TextObject,
  offset: number,
  space: "logical" | "display" = "display",
): number[] {
  validateUtf16Range(space === "logical" ? text.logicalText : text.displayText, {
    start: offset,
    end: offset,
  });
  return clusterOffsetTable(text)
    .filter((c) => {
      const range = space === "logical" ? c.logicalRange : c.displayRange;
      return range.start <= offset && offset < range.end;
    })
    .map((c) => c.clusterId);
}
export function offsetsForCluster(
  text: TextObject,
  clusterId: number,
): TextObject["clusters"][number] {
  const entry = clusterOffsetTable(text).find((c) => c.clusterId === clusterId);
  if (!entry) fail("IR_CLUSTER_MAP", "clusterId", "Unknown cluster");
  return entry;
}
