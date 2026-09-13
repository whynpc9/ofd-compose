import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type ImageOptions, type ImageSource, imageReference } from "@ofd-compose/document-model";
import type { LayoutIR } from "@ofd-compose/layout-ir";
import { imageSize } from "image-size";
import { fail, type MediaBudget, MediaError } from "./budget.js";
import { imageDimensions } from "./dimensions.js";
import { checkPng, jpegHeader } from "./image-structure.js";

export interface AuthorizedImage {
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly mimeType?: "image/png" | "image/jpeg";
}
/** Entries are bytes already authorized by the host, never files to open. */
export interface AuthorizedRoot {
  readonly id: string;
  readonly entries: readonly { readonly path: string; readonly resourceId: string }[];
}
export type ImageResource = Extract<LayoutIR["resources"][number], { kind: "image" }>;
export interface PreparedImage {
  readonly resource: ImageResource;
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function relativePath(path: string): string {
  if (
    !path ||
    path.length > 1024 ||
    !/^[A-Za-z0-9_./ -]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((s) => !s || s === "." || s === "..")
  )
    fail(
      "RESOURCE_FORBIDDEN",
      "Only safe relative paths in an explicitly authorized root are allowed",
    );
  return path;
}
function decode(text: string, budget: MediaBudget): { bytes: Uint8Array; mime?: string } {
  if (text.length > budget.limits.encodedCharacters)
    fail("RESOURCE_LIMIT", "Encoded image is too long");
  budget.charge("workUnits", text.length);
  let encoded = text,
    mime: string | undefined;
  if (text.startsWith("data:")) {
    const comma = text.indexOf(",");
    if (comma < 0 || comma > 64) fail("MODEL_INVALID", "Malformed image data URI");
    const header = text.slice(0, comma);
    const match = /^data:(image\/(?:png|jpeg|gif|bmp|tiff));base64$/.exec(header);
    if (!match)
      fail("MODEL_INVALID", "Image data URI requires a supported MIME and base64 encoding");
    mime = match[1];
    encoded = text.slice(comma + 1);
  } else if (/[:.\\]/.test(text) || (text.startsWith("/") && !text.startsWith("/9j/"))) {
    fail("RESOURCE_FORBIDDEN", "Arbitrary image URLs and absolute paths are forbidden");
  }
  if (!encoded.length || encoded.length % 4 !== 0) fail("MODEL_INVALID", "Malformed base64 image");
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const size = (encoded.length / 4) * 3 - padding;
  if (size > budget.limits.imageBytes) fail("RESOURCE_LIMIT", "Decoded image is too large");
  budget.charge("totalBytes", size);
  // Iterative validation avoids regular-expression stack growth on large input.
  for (let i = 0; i < encoded.length - padding; i++)
    if (alphabet.indexOf(encoded[i] as string) < 0) fail("MODEL_INVALID", "Malformed base64 image");
  const last = alphabet.indexOf(encoded[encoded.length - padding - 1] as string);
  if ((padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0))
    fail("MODEL_INVALID", "Noncanonical base64 padding bits");
  const bytes = new Uint8Array(size);
  for (let i = 0, j = 0; i < encoded.length; i += 4) {
    const word =
      (alphabet.indexOf(encoded[i] as string) << 18) |
      (alphabet.indexOf(encoded[i + 1] as string) << 12) |
      (Math.max(0, alphabet.indexOf(encoded[i + 2] as string)) << 6) |
      Math.max(0, alphabet.indexOf(encoded[i + 3] as string));
    bytes[j++] = word >>> 16;
    if (j < size) bytes[j++] = word >>> 8;
    if (j < size) bytes[j++] = word;
  }
  return { bytes, mime };
}
function detectedMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return "image/gif";
  if (bytes[0] === 66 && bytes[1] === 77) return "image/bmp";
  if (
    (bytes[0] === 73 && bytes[1] === 73 && bytes[2] === 42 && bytes[3] === 0) ||
    (bytes[0] === 77 && bytes[1] === 77 && bytes[2] === 0 && bytes[3] === 42)
  )
    return "image/tiff";
  return fail("MODEL_INVALID", "Unrecognized image signature");
}
export class ImageResolver {
  private readonly resources = new Map<string, AuthorizedImage>();
  private readonly paths = new Map<string, string>();
  constructor(
    private readonly budget: MediaBudget,
    resources: readonly AuthorizedImage[] = [],
    root?: AuthorizedRoot,
  ) {
    if (!Array.isArray(resources) || resources.length > budget.limits.images)
      fail("RESOURCE_LIMIT", "Too many authorized images");
    let suppliedBytes = 0;
    for (const entry of resources) {
      if (
        typeof entry.id !== "string" ||
        !entry.id ||
        entry.id.length > 256 ||
        this.resources.has(entry.id)
      )
        fail("MODEL_INVALID", "Invalid or duplicate external image resource ID");
      if (!(entry.bytes instanceof Uint8Array) || entry.bytes.byteLength > budget.limits.imageBytes)
        fail("RESOURCE_LIMIT", "Authorized image byte budget exceeded");
      suppliedBytes += entry.bytes.byteLength;
      if (suppliedBytes > budget.limits.totalBytes)
        fail("RESOURCE_LIMIT", "Authorized image total byte budget exceeded");
      this.resources.set(entry.id, entry);
    }
    if (root) {
      if (
        !root.id ||
        root.id.length > 256 ||
        !Array.isArray(root.entries) ||
        root.entries.length > budget.limits.images
      )
        fail("RESOURCE_FORBIDDEN", "Invalid authorized resource root");
      for (const entry of root.entries) {
        const path = relativePath(entry.path);
        if (this.paths.has(path) || !this.resources.has(entry.resourceId))
          fail("RESOURCE_FORBIDDEN", "Ambiguous or missing root resource");
        this.paths.set(path, entry.resourceId);
      }
    }
  }
  resolve(source: ImageSource, options: ImageOptions = {}): PreparedImage {
    this.budget.charge("images", 1);
    let bytes: Uint8Array, mime: string | undefined;
    if (typeof source === "string") ({ bytes, mime } = decode(source, this.budget));
    else {
      const reference = imageReference(source);
      if (!reference) fail("RESOURCE_FORBIDDEN", "Invalid image reference");
      const id =
        "resourceId" in reference
          ? reference.resourceId
          : this.paths.get(relativePath(reference.path));
      const resource = id === undefined ? undefined : this.resources.get(id);
      if (!resource) fail("RESOURCE_FORBIDDEN", "Image resource is not authorized");
      this.budget.charge("totalBytes", resource.bytes.byteLength);
      this.budget.charge("workUnits", resource.bytes.byteLength);
      bytes = new Uint8Array(resource.bytes);
      mime = resource.mimeType;
    }
    const detected = detectedMime(bytes);
    if (mime !== undefined && mime !== detected)
      fail("MODEL_INVALID", "Image MIME does not match its signature");
    if (detected !== "image/png" && detected !== "image/jpeg")
      fail(
        "UNSUPPORTED_FEATURE",
        "P0 writer input accepts only PNG/JPEG; GIF/BMP/TIFF are not normalized",
      );
    let size: ReturnType<typeof imageSize>;
    try {
      size = imageSize(
        detected === "image/png" ? bytes.subarray(0, 33) : jpegHeader(bytes, this.budget),
      );
    } catch (error) {
      if (error instanceof MediaError) throw error;
      return fail("MODEL_INVALID", "Invalid or truncated image header");
    }
    if (size.type !== (detected === "image/png" ? "png" : "jpg"))
      fail("MODEL_INVALID", "Image format detection disagrees");
    if (
      !Number.isSafeInteger(size.width) ||
      !Number.isSafeInteger(size.height) ||
      size.width < 1 ||
      size.height < 1 ||
      size.width > this.budget.limits.pixelDimension ||
      size.height > this.budget.limits.pixelDimension
    )
      fail("RESOURCE_LIMIT", "Image dimensions exceed pixel budget");
    this.budget.charge("pixels", size.width * size.height);
    if (size.orientation !== undefined && size.orientation !== 1)
      fail("UNSUPPORTED_FEATURE", "JPEG EXIF orientation requires normalization before P0 input");
    this.budget.charge("workUnits", bytes.length * 2);
    if (detected === "image/png") checkPng(bytes);
    const digest = bytesToHex(sha256(bytes));
    return {
      bytes,
      resource: Object.freeze({
        id: `media-image-${digest}`,
        kind: "image",
        digest,
        mimeType: detected,
        pixelWidth: size.width,
        pixelHeight: size.height,
      }),
      ...imageDimensions(size.width, size.height, options),
    };
  }
}
