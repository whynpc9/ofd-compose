import { TypographyError } from "./errors.js";
import { repertoireCodePointCount, repertoireRanges, repertoireSha256 } from "./repertoire-data.js";

/** Frozen WP0.4 candidate. Final business corpus approval remains issue 19. */
export const p0CharacterRepertoire = Object.freeze({
  version: "wp0.4-p0-repertoire-v1",
  sha256: repertoireSha256,
  codePointCount: repertoireCodePointCount,
});

export function isP0Character(codePoint: number): boolean {
  if (!Number.isInteger(codePoint)) return false;
  let low = 0;
  let high = repertoireRanges.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const range = repertoireRanges[middle];
    if (!range) return false;
    if (codePoint < range[0]) high = middle - 1;
    else if (codePoint > range[1]) low = middle + 1;
    else return true;
  }
  return false;
}

export function assertP0Characters(text: string): void {
  const offsets: number[] = [];
  let offset = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isP0Character(codePoint)) offsets.push(offset);
    offset += character.length;
  }
  if (offsets.length) {
    throw new TypographyError(
      "CHARACTER_OUT_OF_PROFILE",
      `Text contains characters outside ${p0CharacterRepertoire.version}`,
      offsets,
    );
  }
}
