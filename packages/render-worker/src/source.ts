import { isResolvedDocument, type ResolvedDocument } from "@ofd-compose/binding-core";
import type { CanonicalLayoutIR } from "@ofd-compose/layout-ir";
import { canonicalSerialize, digestCanonical } from "@ofd-compose/layout-ir";
import { prepayCanonical, type RenderBudget, RenderError, snapshot } from "./budget.js";
import type { RenderProfile } from "./index.js";

/** Remove nonprinted evaluation/provenance while retaining node, binding and repeat identities.
 * Display text (including sensitive text deliberately printed by the caller) is preserved. */
export function minimizeResolved(
  document: ResolvedDocument,
  budget: RenderBudget,
): ResolvedDocument {
  const result = snapshot(document, budget);
  if (!isResolvedDocument(result)) throw new RenderError("MODEL_INVALID", "Invalid editing source");
  delete result.provenance;
  result.runtime = {
    temporalPolyfillVersion: "not-retained",
    tzdataSource: "runtime-icu",
    tzdataVersion: null,
  };
  result.structure = { conditionals: [], repeats: [] };
  const styles = new Set<string>();
  const visit = (value: unknown): void => {
    budget.charge("render", 32);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "dynamic-text") record.expression = "";
    if (typeof record.styleId === "string") styles.add(record.styleId);
    for (const child of Object.values(record)) visit(child);
  };
  visit(result.body);
  visit(result.settings);
  for (const name of Object.keys(result.styles)) if (!styles.has(name)) delete result.styles[name];
  return result;
}

export interface EditingFont {
  family: string;
  weight: number;
  italic: boolean;
  sha256: string;
  byteLength: number;
}
export interface EditingImage {
  id: string;
  sha256: string;
  byteLength: number;
  mimeType?: string;
}
export interface SourceContent {
  resolvedDocument: ResolvedDocument;
  renderProfile: RenderProfile;
  resources: {
    fonts: EditingFont[];
    images: EditingImage[];
    layout: CanonicalLayoutIR["resources"];
  };
  semanticMap: CanonicalLayoutIR["semantics"];
  irDigest: string;
}
export function createSourceContent(
  document: ResolvedDocument,
  ir: CanonicalLayoutIR,
  profile: RenderProfile,
  fonts: EditingFont[],
  images: (EditingImage & { bytes: Uint8Array })[],
  budget: RenderBudget,
) {
  const minimal = minimizeResolved(document, budget);
  const imageIds = new Set<string>();
  const visit = (value: unknown): void => {
    budget.charge("render", 32);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.resourceId === "string") imageIds.add(record.resourceId);
    if (typeof record.path === "string")
      throw new RenderError("RESOURCE_FORBIDDEN", "Editing source cannot contain file paths");
    for (const child of Object.values(record)) visit(child);
  };
  visit(minimal);
  const assets = images.filter((image) => imageIds.has(image.id));
  const content: SourceContent = {
    resolvedDocument: minimal,
    renderProfile: snapshot(profile, budget),
    resources: {
      // Full font identity is authorization input, never the identity of embedded subset bytes.
      fonts: fonts.filter((font) =>
        ir.resources.some((r) => r.kind === "font" && r.originalDigest === font.sha256),
      ),
      images: assets.map(({ bytes: _bytes, ...identity }) => identity),
      layout: ir.resources,
    },
    semanticMap: ir.semantics,
    irDigest: digestCanonical(ir),
  };
  prepayCanonical(content, budget, "render", 8);
  const json = canonicalSerialize(content);
  budget.check();
  return { json, assets };
}
