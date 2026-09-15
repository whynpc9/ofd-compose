import { fontDigest, TypographyCore } from "@ofd-compose/typography-core";
import { RenderBudget, RenderError } from "./budget.js";

export const subsetVersion = Object.freeze({
  package: "harfbuzzjs@1.6.0",
  retainGids: true,
  wasmSha256: "e3bf5ad5841bfdcc37878dff5330a13eea071b5860471d9d6515e31506e4ff96",
});
// The pinned package exports no JS subsetting API. These are its actual WASM C exports.
interface SubsetExports {
  memory: { buffer: ArrayBuffer };
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_glyph_set(input: number): number;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set_flags(input: number, flags: number): void;
  hb_set_clear(set: number): void;
  hb_set_add(set: number, glyph: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}
// Structural types avoid adding DOM types to the shared runtime-neutral core.
const wasm = (
  globalThis as unknown as {
    WebAssembly: {
      instantiate(bytes: Uint8Array): Promise<{ instance: { exports: unknown } }>;
    };
  }
).WebAssembly;

/** SFNT preflight before native allocation; full static-face validation still runs in TypographyCore. */
export function inspectFont(bytes: Uint8Array): number {
  if (bytes.length < 12 || bytes.length > 32 * 1024 * 1024)
    throw new RenderError("FONT_INVALID", "Invalid SFNT length");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = view.getUint32(0);
  if (signature !== 0x4f54544f && signature !== 0x00010000)
    throw new RenderError("FONT_INVALID", "Only static CFF/TrueType SFNT supported");
  const tables = view.getUint16(4);
  if (tables < 1 || tables > 128 || 12 + tables * 16 > bytes.length)
    throw new RenderError("FONT_INVALID", "Invalid SFNT directory");
  const tags = new Set<number>();
  let glyphs = 0;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16,
      tag = view.getUint32(at),
      offset = view.getUint32(at + 8),
      length = view.getUint32(at + 12);
    if (tags.has(tag) || offset < 12 + tables * 16 || offset > bytes.length - length)
      throw new RenderError("FONT_INVALID", "Invalid SFNT table bounds");
    tags.add(tag);
    if (tag === 0x66766172) throw new RenderError("FONT_INVALID", "Variable fonts are forbidden");
    if (tag === 0x6d617870) {
      if (length < 6) throw new RenderError("FONT_INVALID", "Invalid maxp");
      glyphs = view.getUint16(offset + 4);
    }
  }
  if (glyphs < 1) throw new RenderError("FONT_INVALID", "Missing glyph count");
  return glyphs;
}
export async function subsetFont(
  bytes: Uint8Array,
  originalDigest: string,
  glyphIds: readonly number[],
  wasmBytes: Uint8Array,
  budget = new RenderBudget(),
) {
  budget.check();
  const count = inspectFont(bytes);
  if (glyphIds.length > count)
    throw new RenderError("RESOURCE_LIMIT", "Glyph set exceeds font glyph count");
  const ids = [...new Set([0, ...glyphIds])].sort((a, b) => a - b);
  if (ids.some((id) => !Number.isInteger(id) || id < 0 || id >= count))
    throw new RenderError("FONT_INVALID", "Invalid subset glyph ID");
  if (wasmBytes.length > 2 * 1024 * 1024 || fontDigest(wasmBytes) !== subsetVersion.wasmSha256)
    throw new RenderError("RESOURCE_FORBIDDEN", "Subset WASM differs from the pinned artifact");
  budget.charge("subset", bytes.length * 2 + count * 32 + ids.length);
  // Validate original identity and static metrics before calling the native subsetter.
  const metrics = new TypographyCore().loadFont(bytes, originalDigest);
  // Reserve the full accepted output ceiling before entering the non-cooperative native call.
  // This is a conservative per-font reservation, not a measurement of native RSS.
  budget.reserve("subsetBytes", 32 * 1024 * 1024);
  const { instance } = await budget.wait(wasm.instantiate(wasmBytes));
  budget.check();
  const api = instance.exports as SubsetExports;
  const arities = {
    _initialize: 0,
    malloc: 1,
    free: 1,
    hb_blob_create: 5,
    hb_blob_destroy: 1,
    hb_blob_get_length: 1,
    hb_blob_get_data: 2,
    hb_face_create: 2,
    hb_face_destroy: 1,
    hb_face_reference_blob: 1,
    hb_subset_input_create_or_fail: 0,
    hb_subset_input_destroy: 1,
    hb_subset_input_glyph_set: 1,
    hb_subset_input_unicode_set: 1,
    hb_subset_input_set_flags: 2,
    hb_set_clear: 1,
    hb_set_add: 2,
    hb_subset_or_fail: 2,
  } as const;
  for (const [name, arity] of Object.entries(arities)) {
    const fn = api[name as keyof typeof arities];
    if (typeof fn !== "function" || fn.length !== arity)
      throw new RenderError("RESOURCE_FORBIDDEN", `Unsupported subset ABI: ${name}`);
  }
  if (!(api.memory?.buffer instanceof ArrayBuffer))
    throw new RenderError("RESOURCE_FORBIDDEN", "Subset memory export missing");
  api._initialize();
  let pointer = 0,
    blob = 0,
    face = 0,
    input = 0,
    result = 0,
    output = 0;
  try {
    pointer = api.malloc(bytes.length);
    if (!pointer) throw new RenderError("RESOURCE_LIMIT", "Subset allocation failed");
    new Uint8Array(api.memory.buffer, pointer, bytes.length).set(bytes);
    // HB_MEMORY_MODE_READONLY = 1; input allocation lives until the input face/blob are destroyed.
    blob = api.hb_blob_create(pointer, bytes.length, 1, 0, 0);
    face = api.hb_face_create(blob, 0);
    input = api.hb_subset_input_create_or_fail();
    if (!blob || !face || !input)
      throw new RenderError("FONT_INVALID", "Subset initialization failed");
    api.hb_set_clear(api.hb_subset_input_unicode_set(input));
    const glyphSet = api.hb_subset_input_glyph_set(input);
    api.hb_set_clear(glyphSet);
    for (const id of ids) api.hb_set_add(glyphSet, id);
    // HB_SUBSET_FLAGS_RETAIN_GIDS = 0x2. Other defaults preserve glyph closure and metrics.
    api.hb_subset_input_set_flags(input, 2);
    budget.check();
    result = api.hb_subset_or_fail(face, input);
    if (!result) throw new RenderError("FONT_INVALID", "HarfBuzz rejected font subsetting");
    output = api.hb_face_reference_blob(result);
    const length = api.hb_blob_get_length(output);
    if (!length || length > 32 * 1024 * 1024)
      throw new RenderError("RESOURCE_LIMIT", "Subset output exceeds font ceiling");

    budget.charge("subset", length);
    const subsetBytes = new Uint8Array(
      new Uint8Array(api.memory.buffer, api.hb_blob_get_data(output, 0), length),
    );
    const digest = fontDigest(subsetBytes);
    if (inspectFont(subsetBytes) <= (ids.at(-1) ?? 0))
      throw new RenderError("FONT_INVALID", "Subset lost retained glyph IDs");
    return {
      originalDigest,
      subsetDigest: digest,
      outline: metrics.outline,
      bytes: subsetBytes,
      glyphIdMap: ids.map((id) => ({ original: id, subset: id })),
    };
  } finally {
    if (output) api.hb_blob_destroy(output);
    if (result) api.hb_face_destroy(result);
    if (input) api.hb_subset_input_destroy(input);
    if (face) api.hb_face_destroy(face);
    if (blob) api.hb_blob_destroy(blob);
    if (pointer) api.free(pointer);
  }
}
