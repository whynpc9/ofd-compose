export const moduleId = "@ofd-compose/typography-core" as const;
export { TypographyError, type TypographyErrorCode } from "./errors.js";
export type { FontMetrics } from "./metrics.js";
export {
  fontDigest,
  fontStylePolicy,
  lineBreakOpportunities,
  type PositionedGlyph,
  type ShapeRequest,
  shapingAndLineBreakVersions,
  TypographyCore,
} from "./typography.js";
