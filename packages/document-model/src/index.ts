export {
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticPhase,
  type DiagnosticSeverity,
  diagnosticCodes,
  hasErrors,
} from "./diagnostics.js";
export { toJsonSchemaDocument } from "./json-schema.js";
export * from "./schema.js";
export {
  defaultMaxStructureDepth,
  type ValidateTemplateSourceOptions,
  type ValidateTemplateSourceResult,
  validateTemplateSource,
} from "./validate.js";
export {
  findStructureDepthOverflow,
  isStructureBinding,
  isStructureContainer,
  type StructureDepthOverflow,
  type TemplateNode,
  type TemplateNodeVisit,
  walkTemplateNodes,
} from "./walk.js";
