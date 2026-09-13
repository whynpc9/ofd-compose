import type { ImageSource } from "./schema.js";

/** Project raw JSON business records using two constant field lookups, never key enumeration.
 * Exactly one reference field must be present. Unrelated input fields are not copied into
 * ResolvedDocument; its ImageSource schema remains strict. Accessors are not JSON data.
 */
export function imageReference(input: unknown): Exclude<ImageSource, string> | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const resource = Object.getOwnPropertyDescriptor(input, "resourceId");
  const path = Object.getOwnPropertyDescriptor(input, "path");
  if ((!resource && !path) || (resource && path)) return undefined;
  const descriptor = resource ?? path;
  if (
    !descriptor ||
    !("value" in descriptor) ||
    !descriptor.enumerable ||
    typeof descriptor.value !== "string"
  )
    return undefined;
  const value = descriptor.value;
  if (resource) {
    if (!value.length || value.length > 256 || !/^[A-Za-z0-9._:-]+$/.test(value)) return undefined;
    return { resourceId: value };
  }
  if (!value.length || value.length > 1024) return undefined;
  return { path: value };
}
