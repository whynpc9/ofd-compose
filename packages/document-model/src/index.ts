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
  type ValidateTemplateSourceOptions,
  type ValidateTemplateSourceResult,
  validateTemplateSource,
} from "./validate.js";
