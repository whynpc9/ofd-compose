import type { DiagnosticCode } from "@ofd-compose/document-model";

export class MediaError extends Error {
  constructor(
    readonly code: DiagnosticCode,
    message: string,
  ) {
    super(message);
    this.name = "MediaError";
  }
}
export function fail(code: DiagnosticCode, message: string): never {
  throw new MediaError(code, message);
}
/** Host configuration is data, not accessor callbacks. Fixed field reads avoid enumeration. */
export function configurationRecord(
  input: unknown,
  code: DiagnosticCode = "MODEL_INVALID",
): asserts input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail(code, "Media configuration entry must be a non-null record");
}
export function configurationField(
  input: object,
  key: string,
  code: DiagnosticCode = "MODEL_INVALID",
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor && !("value" in descriptor))
    fail(code, "Media configuration must contain data fields, not accessors");
  return descriptor?.value;
}
/** Hard ceilings apply even when callers supply larger per-job limits. */
export const mediaLimits = Object.freeze({
  images: 64,
  bindings: 256,
  encodedCharacters: 12_000_000,
  imageBytes: 8_000_000,
  totalBytes: 32_000_000,
  pixelDimension: 32768,
  pixels: 40_000_000,
  pathCommands: 100_000,
  metadataCharacters: 1_000_000,
  barcodeCharacters: 256,
  workUnits: 64_000_000,
});
export type MediaLimits = { readonly [K in keyof typeof mediaLimits]: number };
export class MediaBudget {
  readonly limits: MediaLimits;
  private readonly used = {
    images: 0,
    bindings: 0,
    totalBytes: 0,
    pixels: 0,
    pathCommands: 0,
    metadataCharacters: 0,
    workUnits: 0,
  };
  constructor(limits: Partial<Record<keyof MediaLimits, number>> = {}) {
    configurationRecord(limits);
    const values: { -readonly [K in keyof MediaLimits]: number } = { ...mediaLimits };
    for (const key of Object.keys(mediaLimits) as (keyof MediaLimits)[]) {
      const supplied = configurationField(limits, key);
      const value = supplied === undefined ? mediaLimits[key] : supplied;
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > mediaLimits[key]
      )
        fail("RESOURCE_LIMIT", `Invalid media limit: ${key}`);
      values[key] = value;
    }
    this.limits = Object.freeze(values);
  }
  charge(key: keyof MediaBudget["used"], amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits[key] - this.used[key])
      fail("RESOURCE_LIMIT", `Media budget exceeded: ${key}`);
    this.used[key] += amount;
  }
}
