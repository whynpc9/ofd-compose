import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { normalizeStructure, orderByContent } from "./normalize.js";
import {
  type CanonicalLayoutIR,
  canonicalizationVersion,
  type LayoutIdentityInput,
  LayoutIdentityInputSchema,
  type LayoutIR,
  LayoutIRSchema,
} from "./schema.js";
import { canonicalSerialize, digestCanonical, quantizeMm } from "./serialize.js";
import { fail } from "./text.js";
import { assertSchema, validateCanonicalLayoutIR, validateLayoutIR } from "./validate.js";

function quantize(schema: TSchema, value: unknown): unknown {
  if (schema["x-unit"] === "mm") return quantizeMm(value as number);
  if (schema.anyOf) {
    const match = (schema.anyOf as TSchema[]).find((s) => Value.Check(s, value));
    if (!match) fail("IR_SCHEMA", "", "No matching union");
    return quantize(match, value);
  }
  if (schema.type === "array") return (value as unknown[]).map((v) => quantize(schema.items, v));
  if (schema.type === "object" && schema.properties)
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, v]) => [
        key,
        schema.properties[key] ? quantize(schema.properties[key], v) : v,
      ]),
    );
  return value;
}
export function canonicalizeLayoutIR(input: unknown): CanonicalLayoutIR {
  validateLayoutIR(input);
  const ir = quantize(LayoutIRSchema, JSON.parse(canonicalSerialize(input))) as LayoutIR;
  const result = normalizeStructure(ir);
  if (
    input.identity.semanticDigest &&
    input.identity.semanticDigest !== result.identity.semanticDigest
  ) {
    fail(
      "IR_DIGEST_MISMATCH",
      "identity/semanticDigest",
      "Semantic digest does not match canonical map",
    );
  }
  validateCanonicalLayoutIR(result);
  return result;
}
export function serializeLayoutIR(input: unknown): string {
  return canonicalSerialize(canonicalizeLayoutIR(input));
}
export function digestLayoutIR(input: unknown): string {
  return digestCanonical(canonicalizeLayoutIR(input));
}
export function canonicalizeLayoutIdentity(
  input: unknown,
): LayoutIdentityInput & { canonicalizationVersion: typeof canonicalizationVersion } {
  assertSchema(LayoutIdentityInputSchema, input);
  const identity = JSON.parse(canonicalSerialize(input)) as LayoutIdentityInput;
  identity.resources = orderByContent([
    ...new Map(identity.resources.map((r) => [canonicalSerialize(r), r])).values(),
  ]);
  identity.profile.features.sort();
  return { ...identity, canonicalizationVersion };
}
export function digestLayoutIdentity(input: unknown): string {
  return digestCanonical(canonicalizeLayoutIdentity(input));
}
/** Caller validates the ResolvedDocument with document-model/binding-core first. Only the
 * top-level provenance and BindingRuntime envelopes are excluded; nested origin/source maps are retained. */
export function digestSemanticDocument(input: Record<string, unknown>): string {
  canonicalSerialize(input);
  const { provenance: _provenance, runtime: _runtime, ...semantic } = input;
  return digestCanonical(semantic);
}
