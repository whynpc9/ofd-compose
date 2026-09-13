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
/** Bound image-size 2.0.2's repeated suffix copying before calling its JPEG parser. */
export function jpegHeader(bytes: Uint8Array, budget: MediaBudget): Uint8Array {
  if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217)
    fail("MODEL_INVALID", "JPEG is missing EOI");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2,
    segments = 0,
    sofEnd = 0;
  while (offset + 4 <= bytes.length) {
    if (++segments > 256 || offset > 65536) fail("RESOURCE_LIMIT", "JPEG header budget exceeded");
    if (bytes[offset] !== 255) fail("MODEL_INVALID", "Malformed JPEG marker");
    const marker = bytes[offset + 1],
      length = view.getUint16(offset + 2),
      end = offset + 2 + length;
    if (length < 2 || end > bytes.length) fail("MODEL_INVALID", "Truncated JPEG segment");
    if (end > 65536) fail("RESOURCE_LIMIT", "JPEG header budget exceeded");
    if (marker === 192 || marker === 193 || marker === 194) {
      if (length < 8 || sofEnd) fail("MODEL_INVALID", "Invalid JPEG frame header");
      sofEnd = end;
    }
    if (marker === 218) {
      if (!sofEnd) fail("MODEL_INVALID", "JPEG scan precedes frame header");
      // The probe only needs metadata through SOF. Whole bytes are retained for the writer.
      budget.charge("workUnits", sofEnd * segments);
      const header = bytes.subarray(0, sofEnd);
      if (bytes[3] === 192 || bytes[3] === 193 || bytes[3] === 194) {
        const padded = new Uint8Array(header.length + 4);
        padded.set([255, 216, 255, 224, 0, 2]);
        padded.set(header.subarray(2), 6);
        return padded;
      }
      return header;
    }
    if (marker === 225 && sofEnd)
      fail("UNSUPPORTED_FEATURE", "JPEG metadata after SOF requires normalization");
    offset = end;
  }
  return fail("MODEL_INVALID", "JPEG is missing a scan");
}
