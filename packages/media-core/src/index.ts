import type { ResolvedBlock, ResolvedDocument, ResolvedMedia } from "@ofd-compose/binding-core";
import type { Diagnostic, ImageSource } from "@ofd-compose/document-model";
import { digestCanonical } from "@ofd-compose/layout-ir";
import { barcode, type PreparedBarcode } from "./barcodes.js";
import { fail, MediaBudget, MediaError, type MediaLimits } from "./budget.js";
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
 * Errors return no partial output. Resource digests are computed from owned byte snapshots.
 * Persist mediaIdentity with layout options; merge image digests into LayoutIdentity.resources.
 */
export function prepareMedia(document: ResolvedDocument, options: MediaOptions = {}) {
  const diagnostics: Diagnostic[] = [];
  const blocks: PreparedMediaBlock[] = [];
  let current: ResolvedMedia | undefined;
  try {
    const budget = new MediaBudget(options.limits);
    const resolver = new ImageResolver(budget, options.resources, options.root);
    let visited = 0;
    const visit = (body: readonly ResolvedBlock[], depth: number): void => {
      if (!Array.isArray(body) || depth > 32 || body.length > 200000)
        fail("RESOURCE_LIMIT", "Media document traversal budget exceeded");
      for (const block of body) {
        if (++visited > 200000) fail("RESOURCE_LIMIT", "Media document traversal budget exceeded");
        if (block.kind === "table") {
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
    return { ok: true as const, blocks, mediaIdentity, diagnostics };
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
