export const moduleId = "@ofd-compose/layout-core" as const;

export { borderPath } from "./graphics.js";
export {
  LayoutError,
  type LayoutFont,
  type LayoutLine,
  type LayoutOptions,
  layout,
  layoutEngineVersion,
  layoutResourceLimits,
  lineBreakVersion,
  mediaRegionProfile,
  paragraphProfile,
  permitsChineseBreak,
  tableProfile,
} from "./layout.js";

export { type NumberingInput, numberingAlgorithmVersion, numberingLabel } from "./numbering.js";
