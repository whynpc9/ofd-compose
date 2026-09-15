import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ResolvedBlock, ResolvedDocument, ResolvedMedia } from "@ofd-compose/binding-core";
import type { JobContext } from "@ofd-compose/document-model";
import { type Diagnostic, type ImageSource, imageReference } from "@ofd-compose/document-model";
import { canonicalSerialize, digestCanonical } from "@ofd-compose/layout-ir";
import { barcode, type PreparedBarcode } from "./barcodes.js";
import {
  configurationField,
  configurationRecord,
  fail,
  MediaBudget,
  MediaError,
  type MediaLimits,
} from "./budget.js";
import { mediaVersion } from "./dimensions.js";
import {
  type AuthorizedImage,
  type AuthorizedRoot,
  ImageResolver,
  type PreparedImage,
} from "./images.js";

export * from "./barcodes.js";
export { MediaError, mediaLimits } from "./budget.js";
export { imageDimensions, mediaVersion } from "./dimensions.js";
export type { AuthorizedImage, AuthorizedRoot, ImageResource, PreparedImage } from "./images.js";
export interface MediaOptions {
  readonly resources?: readonly AuthorizedImage[];
  readonly root?: AuthorizedRoot;
  readonly limits?: Partial<Record<keyof MediaLimits, number>>;
}
export interface PreparedMediaBlock {
  readonly source: ResolvedMedia;
  readonly images?: readonly PreparedImage[];
  readonly barcode?: PreparedBarcode;
}
/** Charge source identity strings before media copies and canonical JSON construction. */
function chargeSource(source: ResolvedMedia, budget: MediaBudget): void {
  const text = (value: unknown, max: number): void => {
    if (typeof value !== "string" || value.length > max)
      fail("RESOURCE_LIMIT", "Media source metadata exceeds its budget");
    budget.charge("metadataCharacters", value.length);
    budget.charge("workUnits", value.length);
  };
  text(source.nodeId, 256);
  text(source.bindingId, 256);
  if (source.dataPath !== undefined) text(source.dataPath, 65536);
  if (source.instancePath !== undefined) {
    if (!Array.isArray(source.instancePath) || source.instancePath.length > 32)
      fail("RESOURCE_LIMIT", "Media instance metadata exceeds its depth budget");
    for (const instance of source.instancePath) {
      text(instance.nodeId, 256);
      text(instance.bindingId, 256);
      text(instance.key, 1000000);
      if (instance.dataPath !== undefined) text(instance.dataPath, 65536);
    }
  }
}
/** compile -> bind -> prepareMedia is the issue11 seam; block placement/pagination is issue12.
 * The document must already satisfy ResolvedDocumentSchema (e.g. successful bind output).
 * Media/configuration validation errors return no partial output. Resource digests use owned byte snapshots.
 * Persist mediaIdentity with layout options; merge image digests into LayoutIdentity.resources.
 */
export function prepareMedia(
  document: ResolvedDocument,
  options: MediaOptions = {},
  job?: JobContext,
) {
  const diagnostics: Diagnostic[] = [];
  const blocks: PreparedMediaBlock[] = [];
  let current: ResolvedMedia | undefined;
  try {
    configurationRecord(options);
    const limits = configurationField(options, "limits");
    if (limits !== undefined) configurationRecord(limits);
    const budget = new MediaBudget(limits as MediaOptions["limits"], job);
    const resolver = new ImageResolver(
      budget,
      configurationField(options, "resources"),
      configurationField(options, "root"),
    );
    let visited = 0;
    const visit = (body: readonly ResolvedBlock[], depth: number): void => {
      if (!Array.isArray(body) || depth > 32 || body.length > 200000)
        fail("RESOURCE_LIMIT", "Media document traversal budget exceeded");
      for (const block of body) {
        if (++visited > 200000) fail("RESOURCE_LIMIT", "Media document traversal budget exceeded");
        if (block.kind === "region") visit(block.children, depth + 1);
        else if (block.kind === "table") {
          if (block.rows.length > 10000)
            fail("RESOURCE_LIMIT", "Media table traversal budget exceeded");
          for (const row of block.rows) {
            if (++visited > 200000 || row.cells.length > 10000)
              fail("RESOURCE_LIMIT", "Media table traversal budget exceeded");
            for (const cell of row.cells) {
              if (++visited > 200000) fail("RESOURCE_LIMIT", "Media traversal budget exceeded");
              visit(cell.blocks, depth + 1);
            }
          }
        } else if (block.kind === "image-binding" || block.kind === "barcode-binding") {
          current = block;
          budget.charge("bindings", 1);
          chargeSource(block, budget);
          if (block.kind === "image-binding") {
            if (!Array.isArray(block.sources) || block.sources.length > budget.limits.images)
              fail("RESOURCE_LIMIT", "Image list budget exceeded");
            blocks.push({
              source: block,
              images: block.sources.map((s: ImageSource) => resolver.resolve(s, block.options)),
            });
          } else
            blocks.push({ source: block, barcode: barcode(block.value, block.options, budget) });
        }
      }
    };
    visit(document.body, 0);
    const mediaIdentity = digestCanonical({
      mediaVersion,
      blocks: blocks.map((block) => ({
        nodeId: block.source.nodeId,
        bindingId: block.source.bindingId,
        instancePath: block.source.instancePath ?? [],
        ...(block.images
          ? {
              images: block.images.map(({ resource, width, height }) => ({
                resource,
                width,
                height,
              })),
            }
          : {}),
        ...(block.barcode ? { barcode: block.barcode.geometryDigest } : {}),
      })),
    });
    const result = { ok: true as const, blocks, mediaIdentity, diagnostics };
    const identitySources = blocks.map(({ source }) =>
      source.kind === "image-binding"
        ? {
            ...source,
            sources: source.sources.map((value) =>
              typeof value === "string" ? value : imageReference(value),
            ),
          }
        : source,
    );
    // Reserve JSON escaping, UTF-8 copies and hashing before allocating the source
    // fingerprints. A second source hash and byte check are prepaid for layout consumption.
    for (const [index, block] of blocks.entries()) {
      let units = 0;
      const visit = (value: unknown): void => {
        units += 32;
        if (typeof value === "string") units += value.length * 6;
        else if (value && typeof value === "object")
          for (const [key, child] of Object.entries(value)) {
            units += key.length * 6 + 8;
            visit(child);
          }
      };
      visit(identitySources[index]);
      budget.charge("workUnits", units * 2);
      for (const image of block.images ?? []) budget.charge("workUnits", image.bytes.byteLength);
      if (block.barcode) budget.charge("workUnits", block.barcode.path.commands.length * 256);
    }
    const snapshot: LayoutMediaSnapshot = {
      mediaIdentity,
      blocks: blocks.map((block, index) => ({
        sourceDigest: digestCanonical(identitySources[index]),
        ...(block.images
          ? { images: block.images.map(({ bytes: _bytes, ...image }) => image) }
          : {}),
        ...(block.barcode ? { barcode: block.barcode } : {}),
      })),
    };
    layoutSnapshots.set(result, {
      json: canonicalSerialize(snapshot),
      blocks,
      containers: blocks.map((block) => ({
        block,
        images: block.images,
        entries: [...(block.images ?? [])],
      })),
      images: blocks.flatMap((block) =>
        (block.images ?? []).map((image) => ({
          image,
          bytes: image.bytes,
          digest: image.resource.digest,
        })),
      ),
    });
    return result;
  } catch (error) {
    if (!(error instanceof MediaError)) throw error;
    diagnostics.push({
      code: error.code,
      severity: "error",
      phase: "media",
      message: error.message,
      ...(current
        ? {
            nodeId: current.nodeId,
            bindingId: current.bindingId,
            ...(current.dataPath === undefined ? {} : { dataPath: current.dataPath }),
          }
        : {}),
    });
    return { ok: false as const, blocks: [], diagnostics };
  }
}

/** Private preparation provenance: layout consumes owned geometry, never caller-provided descriptors. */
export interface LayoutMediaSnapshot {
  mediaIdentity: string;
  blocks: {
    sourceDigest: string;
    images?: Omit<PreparedImage, "bytes">[];
    barcode?: PreparedBarcode;
  }[];
}
const layoutSnapshots = new WeakMap<
  object,
  {
    json: string;
    blocks: PreparedMediaBlock[];
    containers: {
      block: PreparedMediaBlock;
      images: readonly PreparedImage[] | undefined;
      entries: PreparedImage[];
    }[];
    images: { image: PreparedImage; bytes: Uint8Array; digest: string }[];
  }
>();
/** Only successful in-process prepareMedia results have this provenance. Returned geometry is owned. */
export function mediaForLayout(prepared: object): LayoutMediaSnapshot {
  const serialized = layoutSnapshots.get(prepared);
  if (!serialized)
    throw new MediaError("MODEL_INVALID", "Layout requires a successful prepareMedia result");
  const data = (object: object, key: string) => Object.getOwnPropertyDescriptor(object, key)?.value;
  if (
    data(prepared, "blocks") !== serialized.blocks ||
    serialized.blocks.length !== serialized.containers.length
  )
    throw new MediaError("MODEL_INVALID", "Prepared media containers changed after preparation");
  for (const [index, container] of serialized.containers.entries()) {
    if (
      data(serialized.blocks, String(index)) !== container.block ||
      data(container.block, "images") !== container.images ||
      (container.images &&
        (container.images.length !== container.entries.length ||
          container.entries.some(
            (entry, i) => data(container.images as object, String(i)) !== entry,
          )))
    )
      throw new MediaError("MODEL_INVALID", "Prepared image containers changed after preparation");
  }
  for (const entry of serialized.images) {
    if (
      Object.getOwnPropertyDescriptor(entry.image, "bytes")?.value !== entry.bytes ||
      bytesToHex(sha256(entry.bytes)) !== entry.digest
    )
      throw new MediaError("MODEL_INVALID", "Prepared image bytes changed after preparation");
  }
  return JSON.parse(serialized.json) as LayoutMediaSnapshot;
}
