import { type Static, type TProperties, Type } from "@sinclair/typebox";

export const irVersion = "ofd-compose/layout-ir@0" as const;
export const canonicalizationVersion = "ofd-compose/canonical@0" as const;
const object = <T extends TProperties>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const id = Type.String({ minLength: 1 });
const uint = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const finite = Type.Number({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER });
const unit = Type.Number({ minimum: 0, maximum: 1 });
export const JsonValueSchema = Type.Recursive(
  (self) =>
    Type.Union([
      Type.Null(),
      Type.Boolean(),
      finite,
      Type.String(),
      Type.Array(self),
      Type.Record(Type.String(), self),
    ]),
  { $id: "LayoutJsonValue" },
);
export const LayoutProfileSchema = object({
  name: id,
  version: id,
  features: Type.Array(id, { uniqueItems: true }),
});
/** Identity accepts the canonical semantic digest of ResolvedDocument, never its run provenance.
 * digestSemanticDocument computes it from the caller's already validated document. */
export const LayoutIdentityInputSchema = object({
  resolvedDocumentDigest: digest,
  resources: Type.Array(
    object({ digest, kind: Type.Union([Type.Literal("font"), Type.Literal("image")]) }),
  ),
  layoutEngineVersion: id,
  shapingVersion: id,
  lineBreakVersion: id,
  formattingPolicy: object({
    version: id,
    locale: id,
    timeZone: id,
    tzdataVersion: id,
    rounding: id,
  }),
  profile: LayoutProfileSchema,
  layoutOptions: JsonValueSchema,
});
export type LayoutIdentityInput = Static<typeof LayoutIdentityInputSchema>;

/** All lengths use mm at construction and integer micrometres in canonical IR.
 * Matrix a/b/c/d, alpha, color components and font-axis values are dimensionless. */
function contract(canonical: boolean) {
  const length = canonical
    ? Type.Integer({ minimum: -1_000_000_000, maximum: 1_000_000_000 })
    : Type.Number({ minimum: -1_000_000, maximum: 1_000_000, "x-unit": "mm" });
  const nonnegative = { ...length, minimum: 0 };
  const positive = { ...length, exclusiveMinimum: 0, minimum: 0 };
  const point = object({ x: length, y: length });
  const box = object({ x: length, y: length, width: nonnegative, height: nonnegative });
  const matrix = object({ a: finite, b: finite, c: finite, d: finite, e: length, f: length });
  const color = object({ space: Type.Literal("srgb"), r: unit, g: unit, b: unit });
  const command = Type.Union([
    object({ op: Type.Literal("move"), x: length, y: length }),
    object({ op: Type.Literal("line"), x: length, y: length }),
    object({
      op: Type.Literal("cubic"),
      x1: length,
      y1: length,
      x2: length,
      y2: length,
      x: length,
      y: length,
    }),
    object({ op: Type.Literal("close") }),
  ]);
  const fillRule = Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]);
  const clip = object({
    commands: Type.Array(command, { minItems: 1 }),
    fillRule,
    coordinateSpace: Type.Literal("local"),
  });
  const range = object({ start: uint, end: uint });
  const base = { id, drawOrder: uint, stateId: id, bounds: box };
  const graphic = Type.Union([
    object({
      ...base,
      kind: Type.Literal("text"),
      logicalText: Type.String(),
      displayText: Type.String(),
      fontId: id,
      fontSize: positive,
      language: Type.String({ pattern: "^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$" }),
      direction: Type.Union([
        Type.Literal("ltr"),
        Type.Literal("rtl"),
        Type.Literal("ttb"),
        Type.Literal("btt"),
      ]),
      baseline: point,
      glyphs: Type.Array(
        object({ glyphId: uint, position: point, advance: point, offset: point, clusterId: uint }),
      ),
      clusters: Type.Array(
        object({
          clusterId: uint,
          logicalRange: range,
          displayRange: range,
          glyphIndices: Type.Array(uint, { minItems: 1, uniqueItems: true }),
        }),
      ),
    }),
    object({
      ...base,
      kind: Type.Literal("path"),
      coordinateSpace: Type.Union([Type.Literal("local"), Type.Literal("page")]),
      commands: Type.Array(command, { minItems: 1 }),
      fillRule,
      fill: Type.Boolean(),
      stroke: Type.Boolean(),
    }),
    object({
      ...base,
      kind: Type.Literal("image"),
      resourceId: id,
      transform: matrix,
      clip: Type.Optional(clip),
    }),
  ]);
  return object({
    irVersion: Type.Literal(irVersion),
    origin: Type.Literal("top-left"),
    identity: object({
      inputDigest: digest,
      layoutProfile: LayoutProfileSchema,
      semanticDigest: Type.Optional(digest),
    }),
    resources: Type.Array(
      Type.Union([
        object({
          id,
          kind: Type.Literal("font"),
          originalDigest: digest,
          faceIndex: uint,
          weight: Type.Integer({ minimum: 1, maximum: 1000 }),
          style: Type.Union([
            Type.Literal("normal"),
            Type.Literal("italic"),
            Type.Literal("oblique"),
          ]),
          features: Type.Record(
            Type.String({ pattern: "^[ -~]{4}$" }),
            Type.Integer({ minimum: 0, maximum: 0xffffffff }),
            {
              additionalProperties: false,
            },
          ),
          variations: Type.Record(Type.String({ pattern: "^[ -~]{4}$" }), finite, {
            maxProperties: 0,
            additionalProperties: false,
          }),
          subsetDigest: Type.Optional(digest),
          glyphIdMap: Type.Optional(Type.Array(object({ original: uint, subset: uint }))),
        }),
        object({
          id,
          kind: Type.Literal("image"),
          digest,
          mimeType: Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")]),
          pixelWidth: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
          pixelHeight: Type.Integer({ minimum: 1, maximum: 1_000_000 }),
        }),
      ]),
    ),
    graphicsStates: Type.Array(
      object({
        id,
        transform: matrix,
        clip: Type.Optional(clip),
        fillColor: color,
        strokeColor: color,
        opacity: unit,
        blendMode: Type.Literal("normal"),
        lineWidth: nonnegative,
        dash: Type.Union([
          Type.Array(nonnegative, { maxItems: 0 }),
          Type.Array(nonnegative, { minItems: 1, contains: positive }),
        ]),
        dashOffset: length,
        lineCap: Type.Union([Type.Literal("butt"), Type.Literal("round"), Type.Literal("square")]),
        lineJoin: Type.Union([Type.Literal("miter"), Type.Literal("round"), Type.Literal("bevel")]),
        miterLimit: Type.Number({ minimum: 1, maximum: 1000 }),
      }),
    ),
    pages: Type.Array(
      object({
        id,
        pageIndex: uint,
        width: positive,
        height: positive,
        contentBox: box,
        orientation: Type.Union([Type.Literal("portrait"), Type.Literal("landscape")]),
        sectionId: id,
        objects: Type.Array(graphic),
      }),
      { minItems: 1 },
    ),
    semantics: Type.Array(
      object({
        objectId: id,
        nodeId: id,
        bindingId: Type.Optional(id),
        repeatInstance: Type.Optional(
          Type.Array(object({ nodeId: id, key: Type.String() }), { minItems: 1 }),
        ),
        controlId: Type.Optional(id),
        table: Type.Optional(
          object({
            tableId: id,
            row: uint,
            column: uint,
            rowSpan: Type.Integer({ minimum: 1 }),
            columnSpan: Type.Integer({ minimum: 1 }),
          }),
        ),
        readingOrder: uint,
        sourceText: Type.Optional(object({ text: Type.String(), range })),
        repeatedHeader: Type.Optional(object({ originalNodeId: id, instanceIndex: uint })),
      }),
    ),
    markers: Type.Array(
      object({
        id,
        pageId: id,
        kind: Type.Union([
          Type.Literal("non-painting"),
          Type.Literal("selection-hit"),
          Type.Literal("control-geometry"),
        ]),
        bounds: box,
        nodeId: id,
        objectId: Type.Optional(id),
        controlId: Type.Optional(id),
        signatureCoverage: Type.Literal("none"),
      }),
    ),
  });
}
export const LayoutIRSchema = object({
  ...contract(false).properties,
  units: Type.Literal("mm"),
  provenance: Type.Optional(Type.Record(Type.String(), JsonValueSchema)),
});
const canonicalContract = contract(true);
export const CanonicalLayoutIRSchema = object({
  ...canonicalContract.properties,
  identity: object({ ...canonicalContract.properties.identity.properties, semanticDigest: digest }),
  units: Type.Literal("um"),
  canonicalizationVersion: Type.Literal(canonicalizationVersion),
});
export type LayoutIR = Static<typeof LayoutIRSchema>;
export type CanonicalLayoutIR = Static<typeof CanonicalLayoutIRSchema>;
export type TextObject = Extract<LayoutIR["pages"][number]["objects"][number], { kind: "text" }>;
