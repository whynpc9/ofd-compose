export type TypographyErrorCode =
  | "FONT_MISSING"
  | "FONT_DIGEST_MISMATCH"
  | "FONT_INVALID"
  | "FONT_STYLE_UNAVAILABLE"
  | "GLYPH_MISSING"
  | "TYPOGRAPHY_LIMIT"
  | "TEXT_INVALID";

export class TypographyError extends Error {
  override readonly name = "TypographyError";

  constructor(
    readonly code: TypographyErrorCode,
    message: string,
    readonly clusters: readonly number[] = [],
  ) {
    super(message);
  }
}
