import { isResolvedDocument, type ResolvedDocument } from "@ofd-compose/binding-core";
import type { CanonicalLayoutIR } from "@ofd-compose/layout-ir";
import { canonicalSerialize, digestCanonical } from "@ofd-compose/layout-ir";
import type {
  EditingFont,
  EditingImage,
  RenderProfile,
  SourceContent,
} from "@ofd-compose/source-protocol";
import { isSourceContent } from "@ofd-compose/source-protocol";
import { prepayCanonical, type RenderBudget, RenderError, snapshot } from "./budget.js";

export type { EditingFont, EditingImage, SourceContent } from "@ofd-compose/source-protocol";

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

export function createSourceContent(
  document: ResolvedDocument,
  ir: CanonicalLayoutIR,
  profile: RenderProfile,
  fonts: EditingFont[],
  images: (EditingImage & { bytes: Uint8Array })[],
  budget: RenderBudget,
  watermarkSources: { objectId: string; pointer: string }[] = [],
) {
  const minimal = minimizeResolved(document, budget);
  const imageIds = new Set<string>();
  const fontFamilies = new Set<string>();
  const visit = (value: unknown): void => {
    budget.charge("render", 32);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.resourceId === "string") imageIds.add(record.resourceId);
    if (typeof record.fontFamily === "string") fontFamilies.add(record.fontFamily);
    if (typeof record.path === "string")
      throw new RenderError("RESOURCE_FORBIDDEN", "Editing source cannot contain file paths");
    for (const child of Object.values(record)) visit(child);
  };
  visit(minimal);
  visit(profile);
  const assets = images.filter((image) => imageIds.has(image.id));
  const semanticIds = new Set(ir.semantics.map((s) => s.objectId));
  const content: SourceContent = {
    resolvedDocument: minimal,
    renderProfile: snapshot(profile, budget),
    resources: {
      // Full font identity is authorization input, never the identity of embedded subset bytes.
      fonts: fonts.filter(
        (font) =>
          fontFamilies.has(font.family) &&
          ir.resources.some((r) => r.kind === "font" && r.originalDigest === font.sha256),
      ),
      images: assets.map(({ bytes: _bytes, ...identity }) => identity),
      layout: ir.resources,
    },
    semanticMap: {
      entries: ir.semantics,
      watermarks: watermarkSources,
      decorations: ir.pages
        .flatMap((page) => page.objects)
        .filter((object) => !semanticIds.has(object.id))
        .map((object) => object.id),
    },
    irDigest: digestCanonical(ir),
  };
  prepayCanonical(content, budget, "render", 8);
  if (!isSourceContent(content))
    throw new RenderError("MODEL_INVALID", "Generated source does not match the source protocol");
  const json = canonicalSerialize(content);
  budget.check();
  return { json, assets };
}
