import { isResolvedDocument, type ResolvedDocument } from "@ofd-compose/binding-core";
import type { ParagraphLayout, TextStyle } from "@ofd-compose/document-model";
import { effectiveParagraphStyle } from "@ofd-compose/layout-core";
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

class EditingRepeatIdentities {
  private readonly identities = new Map<string, { key: string; ordinal: number }>();
  private readonly scopes = new Map<string, number>();
  constructor(private readonly budget: RenderBudget) {}
  remap(path: unknown[], existingOnly = false) {
    let prefix = "";
    for (const item of path) {
      const frame = item as Record<string, unknown>;
      if (typeof frame.nodeId !== "string" || typeof frame.key !== "string")
        throw new RenderError("MODEL_INVALID", "Invalid repeat identity");
      this.budget.charge(
        "render",
        128 + prefix.length * 4 + frame.nodeId.length * 4 + frame.key.length * 4,
      );
      const scope = `${prefix}${frame.nodeId.length}:${frame.nodeId}`;
      prefix = `${scope}${frame.key.length}:${frame.key}`;
      let identity = this.identities.get(prefix);
      if (!identity) {
        if (existingOnly)
          throw new RenderError("MODEL_INVALID", "Semantic repeat has no source occurrence");
        identity = {
          key: `instance-${this.identities.size}`,
          ordinal: this.scopes.get(scope) ?? 0,
        };
        this.scopes.set(scope, identity.ordinal + 1);
        this.identities.set(prefix, identity);
      }
      frame.key = identity.key;
      if ("keyKind" in frame) {
        frame.keyKind = "ordinal";
        frame.ordinal = identity.ordinal;
      }
    }
  }
}

function normalizeSourceLinks(
  document: ResolvedDocument,
  defaults: TextStyle,
  budget: RenderBudget,
) {
  const original = document.styles;
  const replacements = new Map<string | undefined, string>();
  const groups = new Map<string, string>(),
    reservedGroups = new Set<string>();
  let nextGroup = 0;
  const reserveGroups = (value: unknown): void => {
    budget.charge("render", 32);
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (typeof node.shapingGroup === "string") reservedGroups.add(node.shapingGroup);
    for (const child of Object.values(node)) reserveGroups(child);
  };
  reserveGroups(document.body);
  let next = 0;
  const effective = (node: { styleId?: string }, inherited: TextStyle): TextStyle => {
    const own = node.styleId ? original[node.styleId] : undefined;
    budget.charge("render", 128 + (node.styleId?.length ?? 0) * 4);
    const style = { ...inherited, ...own };
    if (style.link) {
      let id = replacements.get(node.styleId);
      if (!id) {
        do {
          budget.charge("render", 32);
          id = `editing-underline-${next++}`;
        } while (Object.hasOwn(document.styles, id));
        replacements.set(node.styleId, id);
        const normalized = { ...own, underline: true };
        delete normalized.link;
        document.styles[id] = normalized;
      }
      node.styleId = id;
    }
    return style;
  };
  const inline = (node: { style?: TextStyle }) => {
    budget.charge("render", 128);
    if (node.style?.link || defaults.link) node.style = { ...node.style, underline: true };
    if (node.style) delete node.style.link;
  };
  const walk = (value: unknown, inherited: TextStyle): void => {
    budget.charge("render", 32);
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    let style = inherited;
    if (node.kind === "paragraph")
      style = effective(
        node,
        effectiveParagraphStyle(defaults, undefined, node.layout as ParagraphLayout | undefined),
      );
    else if ((node.kind === "text" && "origin" in node) || node.kind === "input-control") {
      const originalStyle = effective(
        node,
        node.styleInheritance === "explicit" ? defaults : inherited,
      );
      if (node.kind === "text" && originalStyle.link) {
        const identity = [node.shapingGroup ?? null, originalStyle];
        prepayCanonical(identity, budget, "render", 8);
        const key = canonicalSerialize(identity);
        let group = groups.get(key);
        if (!group) {
          do {
            budget.charge("render", 32);
            group = `editing-run-${nextGroup++}`;
          } while (reservedGroups.has(group));
          groups.set(key, group);
        }
        node.shapingGroup = group;
      }
    }
    for (const key of ["header", "footer"] as const)
      if (node[key] && typeof node[key] === "object") inline(node[key] as { style?: TextStyle });
    if (Array.isArray(node.watermarks))
      for (const watermark of node.watermarks) if (watermark.kind === "text") inline(watermark);
    for (const child of Object.values(node)) walk(child, style);
  };
  walk(document.body, defaults);
  walk(document.settings, defaults);
}

function removeUnrenderedBands(
  document: ResolvedDocument,
  rendered: ReadonlySet<string>,
  budget: RenderBudget,
) {
  const walk = (value: unknown, pointer: string): void => {
    budget.charge("render", 32 + pointer.length * 2);
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    for (const name of ["header", "footer"] as const) {
      const band = node[name] as Record<string, unknown> | undefined;
      if (band && Array.isArray(band.parts) && !rendered.has(`${pointer}/${name}`)) {
        band.parts = [];
        delete band.style;
        delete band.alignment;
      }
    }
    for (const [key, child] of Object.entries(node))
      walk(child, `${pointer}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`);
  };
  walk(document.body, "/body");
  walk(document.settings, "/settings");
}

/** Remove nonprinted evaluation/provenance while retaining node/binding and opaque repeat relationships.
 * Display text (including sensitive text deliberately printed by the caller) is preserved. */
export function minimizeResolved(
  document: ResolvedDocument,
  budget: RenderBudget,
  repeats = new EditingRepeatIdentities(budget),
  defaults: TextStyle = {},
  renderedBands?: ReadonlySet<string>,
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
  normalizeSourceLinks(result, defaults, budget);
  if (renderedBands) removeUnrenderedBands(result, renderedBands, budget);
  const styles = new Set<string>();
  const visit = (value: unknown): void => {
    budget.charge("render", 32);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.kind === "dynamic-text") {
      record.expression = "";
      record.valueState = "value";
    }
    if (record.kind === "input-control") {
      delete record.options;
      delete record.required;
      if (Object.hasOwn(record, "defaultValue")) delete record.placeholder;
    }
    if (Array.isArray(record.instancePath)) repeats.remap(record.instancePath);
    delete record.dataPath;
    if (typeof record.styleId === "string") styles.add(record.styleId);
    for (const child of Object.values(record)) visit(child);
  };
  visit(result.body);
  visit(result.settings);
  for (const name of Object.keys(result.styles)) {
    budget.charge("render", 32);
    if (!styles.has(name)) delete result.styles[name];
    else {
      const style = result.styles[name];
      if (style?.link) {
        style.underline = true;
        delete style.link;
      }
    }
  }
  return result;
}

export function createSourceContent(
  document: ResolvedDocument,
  ir: CanonicalLayoutIR,
  profile: RenderProfile,
  fonts: EditingFont[],
  images: (EditingImage & { bytes: Uint8Array })[],
  budget: RenderBudget,
  pageDecorationSources: { objectId: string; pointer: string; sectionPage: number }[] = [],
) {
  const repeats = new EditingRepeatIdentities(budget);
  const renderedBands = new Set<string>();
  for (const origin of pageDecorationSources) {
    budget.charge("render", 64 + origin.pointer.length * 2);
    renderedBands.add(origin.pointer);
  }
  const minimal = minimizeResolved(
    document,
    budget,
    repeats,
    profile.layout.defaultStyle,
    renderedBands,
  );
  const editingProfile = snapshot(profile, budget);
  if (editingProfile.layout.defaultStyle.link) editingProfile.layout.defaultStyle.underline = true;
  delete editingProfile.layout.defaultStyle.link;
  const semantics = snapshot(ir.semantics, budget);
  const sectionNames = new Set(ir.semantics.map((semantic) => semantic.sectionId));
  const privateSections = new Map<string, string>();
  let nextSection = 0;
  for (const semantic of semantics) {
    budget.charge("render", 32);
    if (semantic.repeatInstance) repeats.remap(semantic.repeatInstance, true);
    delete semantic.link;
    if (
      semantic.sectionId?.startsWith("@section:") ||
      semantic.sectionId?.startsWith("@@section:")
    ) {
      const original = semantic.sectionId;
      budget.charge("render", original.length * 4 + 64);
      let alias = privateSections.get(original);
      if (!alias) {
        do {
          budget.charge("render", 32);
          alias = `@editing-section:${nextSection++}`;
        } while (sectionNames.has(alias));
        privateSections.set(original, alias);
      }
      semantic.sectionId = alias;
    }
  }
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
    renderProfile: editingProfile,
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
      entries: semantics,
      pageDecorations: pageDecorationSources,
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
