import { fail, type MediaBudget } from "./budget.js";

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
/** Validate the PNG container without inflating pixels. Writers still validate compressed pixels. */
export function checkPng(bytes: Uint8Array): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8,
    chunks = 0,
    hasData = false;
  while (offset + 12 <= bytes.length) {
    if (++chunks > 4096) fail("RESOURCE_LIMIT", "PNG chunk budget exceeded");
    const length = view.getUint32(offset),
      end = offset + 12 + length;
    if (end > bytes.length) fail("MODEL_INVALID", "Truncated PNG chunk");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (chunks === 1 && (type !== "IHDR" || length !== 13))
      fail("MODEL_INVALID", "Invalid PNG IHDR");
    if (chunks > 1 && type === "IHDR") fail("MODEL_INVALID", "Duplicate PNG IHDR");
    if (type === "acTL") fail("UNSUPPORTED_FEATURE", "Animated PNG requires normalization");
    let crc = 0xffffffff;
    for (let i = offset + 4; i < end - 4; i++)
      crc = (crcTable[(crc ^ (bytes[i] as number)) & 255] as number) ^ (crc >>> 8);
    if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(end - 4))
      fail("MODEL_INVALID", "PNG chunk CRC mismatch");
    if (type === "IDAT" && length > 0) hasData = true;
    if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || !hasData)
        fail("MODEL_INVALID", "Invalid PNG termination");
      return;
    }
    offset = end;
  }
  fail("MODEL_INVALID", "PNG is missing IEND");
}
/** Read TIFF IFD0 using its declared offset, not image-size's fixed offset=8 assumption. */
function checkExif(bytes: Uint8Array): void {
  if (bytes.length < 6 || ![69, 120, 105, 102, 0, 0].every((v, i) => bytes[i] === v)) return;
  if (bytes.length < 14) fail("MODEL_INVALID", "Truncated JPEG EXIF header");
  const tiff = new DataView(bytes.buffer, bytes.byteOffset + 6, bytes.length - 6);
  const endian = tiff.getUint16(0);
  if (endian !== 0x4949 && endian !== 0x4d4d) fail("MODEL_INVALID", "Invalid EXIF byte order");
  const little = endian === 0x4949;
  if (tiff.getUint16(2, little) !== 42) fail("MODEL_INVALID", "Invalid EXIF TIFF marker");
  const offset = tiff.getUint32(4, little);
  if (offset < 8 || offset + 2 > tiff.byteLength) fail("MODEL_INVALID", "Invalid EXIF IFD offset");
  const count = tiff.getUint16(offset, little);
  if (count > 1024) fail("RESOURCE_LIMIT", "EXIF entry budget exceeded");
  if (offset + 2 + count * 12 + 4 > tiff.byteLength) fail("MODEL_INVALID", "Truncated EXIF IFD");
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    if (tiff.getUint16(at, little) !== 274) continue;
    if (tiff.getUint16(at + 2, little) !== 3 || tiff.getUint32(at + 4, little) !== 1)
      fail("MODEL_INVALID", "Invalid EXIF orientation field");
    const orientation = tiff.getUint16(at + 8, little);
    if (orientation < 1 || orientation > 8) fail("MODEL_INVALID", "Invalid EXIF orientation");
    if (orientation !== 1)
      fail("UNSUPPORTED_FEATURE", "JPEG EXIF orientation requires normalization before P0 input");
  }
}
/** Bound image-size 2.0.2's repeated suffix copying before calling its JPEG parser. */
export function jpegHeader(bytes: Uint8Array, budget: MediaBudget): Uint8Array {
  if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    fail("MODEL_INVALID", "JPEG is missing EOI");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2,
    segments = 0,
    sofEnd = 0,
    sofStart = 0;
  while (offset + 4 <= bytes.length) {
    if (++segments > 256 || offset > 65536) fail("RESOURCE_LIMIT", "JPEG header budget exceeded");
    if (bytes[offset] !== 255) fail("MODEL_INVALID", "Malformed JPEG marker");
    // JPEG permits any number of 0xff fill bytes before the marker code.
    while (bytes[offset + 1] === 255) {
      if (++offset > 65536) fail("RESOURCE_LIMIT", "JPEG header budget exceeded");
    }
    if (offset + 4 > bytes.length) fail("MODEL_INVALID", "Truncated JPEG marker");
    const marker = bytes[offset + 1];
    // TEM is a standalone marker and has no segment-length field.
    if (marker === 1) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2),
      end = offset + 2 + length;
    if (length < 2 || end > bytes.length) fail("MODEL_INVALID", "Truncated JPEG segment");
    if (end > 65536) fail("RESOURCE_LIMIT", "JPEG header budget exceeded");
    if (marker === 192 || marker === 193 || marker === 194) {
      if (length < 8 || sofEnd) fail("MODEL_INVALID", "Invalid JPEG frame header");
      sofEnd = end;
      sofStart = offset;
    }
    if (marker === 218) {
      if (!sofEnd) fail("MODEL_INVALID", "JPEG scan precedes frame header");
      // Metadata has been validated above. Probe only the original frame dimensions,
      // avoiding both upstream repeated suffix copies and its fixed EXIF IFD offset.
      const header = new Uint8Array(6 + sofEnd - sofStart);
      header.set([255, 216, 255, 224, 0, 2]);
      header.set(bytes.subarray(sofStart, sofEnd), 6);
      budget.charge("workUnits", header.length * 2);
      return header;
    }
    if (marker === 225) checkExif(bytes.subarray(offset + 4, end));
    if (marker === 225 && sofEnd)
      fail("UNSUPPORTED_FEATURE", "JPEG metadata after SOF requires normalization");
    offset = end;
  }
  return fail("MODEL_INVALID", "JPEG is missing a scan");
}
