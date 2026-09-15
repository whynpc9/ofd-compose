import { bind, type JsonValue } from "@ofd-compose/binding-core";
import {
  type Diagnostic,
  type DiagnosticCode,
  type DiagnosticPhase,
  diagnosticCodes,
  type TemplateSource,
} from "@ofd-compose/document-model";
import { type LayoutFont, type LayoutOptions, layout } from "@ofd-compose/layout-core";
import {
  canonicalSerialize,
  digestCanonical,
  digestSemanticDocument,
  withFontSubsets,
} from "@ofd-compose/layout-ir";
import {
  type AuthorizedImage,
  barcodeGeneratorVersion,
  mediaVersion,
  prepareMedia,
} from "@ofd-compose/media-core";
import { compile } from "@ofd-compose/template-compiler";
import { fontDigest } from "@ofd-compose/typography-core";
import {
  prepayCanonical,
  RenderBudget,
  type RenderControl,
  RenderError,
  snapshot,
} from "./budget.js";
import { inspectFont, subsetFont, subsetVersion } from "./subset.js";

export { type RenderControl, renderLimits } from "./budget.js";
export { subsetVersion } from "./subset.js";

export interface ResourceBytes {
  /** Exact authorized length, checked before promise resolution and before copying. */
  byteLength: number;
  bytes: Uint8Array | Promise<Uint8Array>;
}
export interface ResourcePack {
  fonts: readonly (Omit<LayoutFont, "bytes"> & ResourceBytes)[];
  images?: readonly (Omit<AuthorizedImage, "bytes"> & ResourceBytes & { sha256: string })[];
  /** Host loads the exact pinned harfbuzzjs/dist/harfbuzz-subset.wasm; core does no I/O. */
  subsetWasm: ResourceBytes;
}
export interface RenderProfile {
  version: "ofd-compose/render@0";
  layout: Omit<LayoutOptions, "images" | "resourcePackDigest">;
}
const byteLengthGetter = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)?.get;
function actualByteLength(bytes: Uint8Array): number {
  if (!byteLengthGetter)
    throw new RenderError("MODEL_INVALID", "Typed-array byte length is unavailable");
  try {
    return byteLengthGetter.call(bytes) as number;
  } catch {
    throw new RenderError("MODEL_INVALID", "Expected genuine typed-array bytes");
  }
}
function field(input: unknown, key: string): unknown {
  if (!input || typeof input !== "object")
    throw new RenderError("MODEL_INVALID", "Expected resource record");
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (descriptor && !("value" in descriptor))
    throw new RenderError("MODEL_INVALID", "Resource accessors are forbidden");
  return descriptor?.value;
}
function list(input: unknown, ceiling: number): unknown[] {
  if (!Array.isArray(input) || input.length > ceiling)
    throw new RenderError("RESOURCE_LIMIT", "Resource count exceeds ceiling");
  if (
    Object.getPrototypeOf(input) !== Array.prototype ||
    Object.getOwnPropertyDescriptor(input, Symbol.iterator)
  )
    throw new RenderError("MODEL_INVALID", "Resource arrays must have the standard iterator");
  const entries: unknown[] = [];
  for (let i = 0; i < input.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!descriptor || !("value" in descriptor))
      throw new RenderError("MODEL_INVALID", "Resource arrays require dense data entries");
    entries.push(descriptor.value);
  }
  return entries;
}
function errorString(error: unknown, key: string, max: number): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = Object.getOwnPropertyDescriptor(error, key)?.value;
  return typeof value === "string" && value.length <= max ? value : undefined;
}
/** True shared Node/browser seam. Failure returns diagnostics only, never partial IR/resources. */
export async function render(
  source: TemplateSource,
  data: JsonValue,
  pack: ResourcePack,
  profile: RenderProfile,
  control: RenderControl = {},
) {
  const diagnostics: Diagnostic[] = [];
  let phase: DiagnosticPhase = "render";
  try {
    const budget = new RenderBudget(control.signal, control.limits);
    const template = snapshot(source, budget);
    const input = snapshot(data, budget);
    const settings = snapshot(profile, budget);
    if (
      settings.version !== "ofd-compose/render@0" ||
      Object.hasOwn(settings.layout, "images") ||
      Object.hasOwn(settings.layout, "resourcePackDigest")
    )
      throw new RenderError("MODEL_INVALID", "Unsupported render profile");
    // Capture every descriptor and reserve ALL declared sizes before copying any resource or awaiting.
    const specs: {
      kind: "font" | "image" | "wasm";
      metadata: unknown;
      source: Uint8Array | Promise<Uint8Array>;
      length: number;
    }[] = [];
    const add = (entry: unknown, kind: "font" | "image" | "wasm") => {
      budget.reserve("resources", 1);
      const length = field(entry, "byteLength");
      const ceiling =
        kind === "wasm" ? 2 * 1024 * 1024 : kind === "image" ? 8_000_000 : 32 * 1024 * 1024;
      if (
        typeof length !== "number" ||
        !Number.isSafeInteger(length) ||
        length < 1 ||
        length > ceiling
      )
        throw new RenderError("RESOURCE_LIMIT", "Invalid resource byte length");
      budget.reserve("resourceBytes", length);
      const bytes = field(entry, "bytes");
      if (!(bytes instanceof Uint8Array) && !(bytes instanceof Promise))
        throw new RenderError(
          kind === "font" ? "FONT_MISSING" : "RESOURCE_FORBIDDEN",
          "Resource bytes are unavailable",
        );
      if (bytes instanceof Uint8Array && actualByteLength(bytes) !== length)
        throw new RenderError("RESOURCE_FORBIDDEN", "Resource length differs from declaration");
      const keys =
        kind === "font"
          ? ["family", "weight", "italic", "sha256"]
          : kind === "image"
            ? ["id", "sha256", "mimeType"]
            : [];
      const metadata: Record<string, unknown> = {};
      for (const key of keys) {
        const value = field(entry, key);
        if (value !== undefined) metadata[key] = value;
      }
      if (
        kind !== "wasm" &&
        (typeof metadata.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(metadata.sha256))
      )
        throw new RenderError("MODEL_INVALID", "Invalid resource digest lock");
      if (
        kind === "font" &&
        (typeof metadata.family !== "string" ||
          metadata.family.length < 1 ||
          metadata.family.length > 256 ||
          typeof metadata.weight !== "number" ||
          !Number.isInteger(metadata.weight) ||
          metadata.weight < 1 ||
          metadata.weight > 1000 ||
          typeof metadata.italic !== "boolean")
      )
        throw new RenderError("MODEL_INVALID", "Invalid font resource metadata");
      if (
        kind === "image" &&
        (typeof metadata.id !== "string" ||
          metadata.id.length < 1 ||
          metadata.id.length > 256 ||
          (metadata.mimeType !== undefined &&
            metadata.mimeType !== "image/png" &&
            metadata.mimeType !== "image/jpeg"))
      )
        throw new RenderError("MODEL_INVALID", "Invalid image resource metadata");
      specs.push({ kind, metadata: snapshot(metadata, budget), source: bytes, length });
    };
    for (const entry of list(field(pack, "fonts"), 64)) add(entry, "font");
    for (const entry of list(field(pack, "images") ?? [], 64)) add(entry, "image");
    add(field(pack, "subsetWasm"), "wasm");
    let failed = false;
    const own = (spec: (typeof specs)[number], bytes: Uint8Array) => {
      if (failed) throw new RenderError("RESOURCE_FORBIDDEN", "Resource acquisition stopped");
      budget.check();
      if (!(bytes instanceof Uint8Array) || actualByteLength(bytes) !== spec.length)
        throw new RenderError("RESOURCE_FORBIDDEN", "Resource length differs from declaration");
      budget.charge("render", spec.length * 2);
      const copy = new Uint8Array(bytes);
      const metadata = spec.metadata as { sha256?: string };
      const expected = spec.kind === "wasm" ? subsetVersion.wasmSha256 : metadata.sha256;
      const digest = fontDigest(copy);
      if (digest !== expected)
        throw new RenderError(
          spec.kind === "font" ? "FONT_DIGEST_MISMATCH" : "RESOURCE_FORBIDDEN",
          "Resource digest differs from authorization",
        );
      if (spec.kind === "font") inspectFont(copy);
      return { ...spec, bytes: copy, digest };
    };
    // Direct arrays are copied synchronously. Promised arrays are copied in their first continuation.
    const pending = specs.map((spec) => {
      let task: Promise<ReturnType<typeof own>>;
      try {
        task =
          spec.source instanceof Uint8Array
            ? Promise.resolve(own(spec, spec.source))
            : spec.source.then((bytes) => own(spec, bytes));
      } catch (error) {
        failed = true;
        task = Promise.reject(error);
      }
      return task.catch((error: unknown) => {
        failed = true;
        if (error instanceof RenderError) throw error;
        throw new RenderError(
          spec.kind === "font" ? "FONT_MISSING" : "RESOURCE_FORBIDDEN",
          "Authorized resource failed to arrive",
        );
      });
    });
    const loaded = await budget.wait(Promise.all(pending)).catch((error: unknown) => {
      failed = true;
      throw error;
    });
    const resourceRecords = loaded.map(({ kind, metadata, length, digest }) => ({
      kind,
      metadata,
      byteLength: length,
      digest,
    }));
    prepayCanonical(resourceRecords, budget, "render", 16);
    const resourcePackDigest = digestCanonical(
      resourceRecords.sort((a, b) => {
        const left = canonicalSerialize(a),
          right = canonicalSerialize(b);
        return left < right ? -1 : left > right ? 1 : 0;
      }),
    );
    phase = "compile";
    budget.charge(phase, budget.used.jsonNodes);
    const compiled = compile(template, { job: budget });
    diagnostics.push(...compiled.diagnostics);
    if (!compiled.ok) return { ok: false as const, diagnostics };
    phase = "bind";
    const bound = bind(compiled.template, input, { job: budget });
    diagnostics.push(...bound.diagnostics);
    if (!bound.ok) return { ok: false as const, diagnostics };
    // Validate and prepay generated JSON before media/layout canonicalization.
    snapshot(bound.document, budget, "bind");
    phase = "media";
    const images = loaded
      .filter((item) => item.kind === "image")
      .map((item) => ({ ...(item.metadata as Omit<AuthorizedImage, "bytes">), bytes: item.bytes }));
    const media = prepareMedia(bound.document, { resources: images }, budget);
    diagnostics.push(...media.diagnostics);
    if (!media.ok) return { ok: false as const, diagnostics };
    const fonts = loaded
      .filter((item) => item.kind === "font")
      .map((item) => ({ ...(item.metadata as Omit<LayoutFont, "bytes">), bytes: item.bytes }));
    phase = "layout";
    budget.check();
    const layoutOptions: LayoutOptions = { ...settings.layout, resourcePackDigest };
    if (media.watermarkImages.length)
      layoutOptions.images = media.watermarkImages.map(({ sourceId, resource }) => ({
        ...resource,
        id: sourceId,
      }));
    const laid = await layout(bound.document, fonts, layoutOptions, media, budget);
    diagnostics.push(...laid.diagnostics);
    phase = "subset";
    const wasmBytes = loaded.find((item) => item.kind === "wasm")?.bytes;
    if (!wasmBytes) throw new RenderError("RESOURCE_FORBIDDEN", "Subset WASM missing");
    const subsets: Awaited<ReturnType<typeof subsetFont>>[] = [];
    for (const font of fonts) {
      const resources = new Set(
        laid.ir.resources
          .filter((r) => r.kind === "font" && r.originalDigest === font.sha256)
          .map((r) => r.id),
      );
      if (subsets.some((s) => s.originalDigest === font.sha256)) continue;
      const glyphs = new Set<number>();
      let referenced = false;
      for (const page of laid.ir.pages)
        for (const object of page.objects)
          if (object.kind === "text" && resources.has(object.fontId)) {
            referenced = true;
            for (const glyph of object.glyphs) glyphs.add(glyph.glyphId);
          }
      if (!referenced) continue;
      subsets.push(await subsetFont(font.bytes, font.sha256, [...glyphs], wasmBytes, budget));
    }
    budget.check();
    phase = "render";
    prepayCanonical(laid.ir, budget, phase, 8);
    prepayCanonical(
      subsets.map(({ bytes: _bytes, ...identity }) => identity),
      budget,
      phase,
      8,
    );
    prepayCanonical(template, budget, phase);
    prepayCanonical(input, budget, phase);
    prepayCanonical(compiled.template, budget, phase);
    prepayCanonical(bound.document, budget, phase);
    const ir = withFontSubsets(laid.ir, subsets);
    const identity = {
      resourcePackDigest,
      templateVersion: {
        schemaVersion: template.schemaVersion,
        documentId: template.documentId,
        revisionId: template.revisionId,
      },
      expressionLanguageVersion: compiled.template.expressionLanguageVersion,
      bindingPolicyVersion: bound.document.bindingPolicyVersion,
      templateDigest: digestSemanticDocument(template),
      dataDigest: digestCanonical(input),
      compiledDigest: digestSemanticDocument({ ...compiled.template }),
      resolvedDocumentDigest: digestSemanticDocument(bound.document),
      mediaVersion,
      barcodeGeneratorVersion,
      mediaDigest: media.mediaIdentity,
      layoutConfiguration: settings,
      layoutConfigurationDigest: digestCanonical(settings),
      layoutInputDigest: ir.identity.inputDigest,
      subsetVersion,
      irDigest: digestCanonical(ir),
    };
    const subsetIndex = new Map(subsets.map((subset) => [subset.originalDigest, subset]));
    const imageIndex = new Map<string, Uint8Array>();
    for (const block of media.blocks)
      for (const image of block.images ?? []) imageIndex.set(image.resource.digest, image.bytes);
    for (const image of media.watermarkImages) imageIndex.set(image.resource.digest, image.bytes);
    const writerFonts = [];
    const writerImages = [];
    for (const resource of ir.resources) {
      if (resource.kind === "font") {
        const subset = subsetIndex.get(resource.originalDigest);
        if (!subset) throw new RenderError("FONT_MISSING", "Writer font subset missing");
        writerFonts.push({ resourceId: resource.id, ...subset });
      } else {
        const bytes = imageIndex.get(resource.digest);
        if (!bytes) throw new RenderError("RESOURCE_FORBIDDEN", "Writer image bytes missing");
        writerImages.push({ resourceId: resource.id, digest: resource.digest, bytes });
      }
    }
    return {
      ok: true as const,
      resolvedDocument: bound.document,
      ir,
      semanticMap: ir.semantics,
      diagnostics,
      identity,
      fonts: writerFonts,
      images: writerImages,
      budget: { ...budget.used },
      stageWork: { ...budget.stages },
    };
  } catch (error) {
    const rawCode = errorString(error, "code", 64) ?? "MODEL_INVALID";
    const code: DiagnosticCode = diagnosticCodes.includes(rawCode as DiagnosticCode)
      ? (rawCode as DiagnosticCode)
      : rawCode.includes("LIMIT")
        ? "RESOURCE_LIMIT"
        : rawCode === "FONT_UNAVAILABLE"
          ? "FONT_MISSING"
          : "MODEL_INVALID";
    const nodeId = errorString(error, "nodeId", 256);
    const bindingId = errorString(error, "bindingId", 256);
    const dataPath = errorString(error, "dataPath", 65536);
    const pageIndex =
      error && typeof error === "object"
        ? Object.getOwnPropertyDescriptor(error, "pageIndex")?.value
        : undefined;
    diagnostics.push({
      ...(nodeId === undefined ? {} : { nodeId }),
      ...(bindingId === undefined ? {} : { bindingId }),
      ...(dataPath === undefined ? {} : { dataPath }),
      ...(typeof pageIndex === "number" && Number.isSafeInteger(pageIndex) && pageIndex >= 0
        ? { pageIndex }
        : {}),
      code,
      severity: "error",
      phase,
      message: errorString(error, "message", 65536) ?? "Render failed",
    });
    return { ok: false as const, diagnostics };
  }
}
