import { ResolvedDocumentSchema } from "@ofd-compose/binding-core";
import { TextStyleSchema } from "@ofd-compose/document-model";
import { CanonicalLayoutIRSchema } from "@ofd-compose/layout-ir";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

const id = Type.String({ minLength: 1, maxLength: 256 });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const bytes = Type.Integer({ minimum: 1, maximum: 33554432 });
const version = Type.String({ minLength: 1, maxLength: 128 });
export const EditingFontSchema = Type.Object(
  {
    family: id,
    weight: Type.Integer({ minimum: 1, maximum: 1000 }),
    italic: Type.Boolean(),
    sha256: digest,
  },
  { additionalProperties: false },
);
export const EditingImageSchema = Type.Object(
  {
    id,
    sha256: digest,
    byteLength: bytes,
    mimeType: Type.Optional(Type.Union([Type.Literal("image/png"), Type.Literal("image/jpeg")])),
  },
  { additionalProperties: false },
);
export const RenderProfileSchema = Type.Object(
  {
    version: Type.Literal("ofd-compose/render@0"),
    layout: Type.Object(
      {
        page: Type.Optional(
          Type.Object(
            {
              width: Type.Number(),
              height: Type.Number(),
              contentBox: Type.Object(
                { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() },
                { additionalProperties: false },
              ),
            },
            { additionalProperties: false },
          ),
        ),
        pagination: Type.Optional(
          Type.Object(
            {
              maxPages: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
              maxIterations: Type.Optional(Type.Integer({ minimum: 1, maximum: 16 })),
            },
            { additionalProperties: false },
          ),
        ),
        defaultStyle: Type.Object(
          {
            ...TextStyleSchema.properties,
            fontFamily: id,
            fontSize: Type.Number({ exclusiveMinimum: 0 }),
          },
          { additionalProperties: false },
        ),
        formattingPolicy: Type.Object(
          {
            version: Type.String(),
            locale: Type.String(),
            timeZone: Type.String(),
            tzdataVersion: Type.String(),
            rounding: Type.String(),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const common = {
  resources: Type.Object(
    {
      fonts: Type.Array(EditingFontSchema, { maxItems: 64 }),
      images: Type.Array(EditingImageSchema, { maxItems: 64 }),
      layout: CanonicalLayoutIRSchema.properties.resources,
    },
    { additionalProperties: false },
  ),
  semanticMap: Type.Object(
    {
      entries: CanonicalLayoutIRSchema.properties.semantics,
      decorations: Type.Array(id, { maxItems: 200000 }),
      pageDecorations: Type.Array(
        Type.Object(
          {
            objectId: id,
            pointer: Type.String({ minLength: 1, maxLength: 2048 }),
            sectionPage: Type.Integer({ minimum: 1, maximum: 1000 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 200000 },
      ),
    },
    { additionalProperties: false },
  ),
  irDigest: digest,
};
export const SourceContentSchema = Type.Object(
  { resolvedDocument: ResolvedDocumentSchema, renderProfile: RenderProfileSchema, ...common },
  { additionalProperties: false },
);
// The container first checks structural shape, then content/resource integrity, then version support.
// Both schemas share all structural definitions; only version assertions move to the final stage.
export const SourceContentWireSchema = Type.Object(
  {
    resolvedDocument: Type.Object(
      {
        ...ResolvedDocumentSchema.properties,
        format: version,
        modelVersion: version,
        templateSchemaVersion: version,
        expressionLanguageVersion: version,
        bindingPolicyVersion: version,
      },
      { additionalProperties: false },
    ),
    renderProfile: Type.Object(
      { ...RenderProfileSchema.properties, version },
      { additionalProperties: false },
    ),
    ...common,
  },
  { additionalProperties: false },
);
export type SourceContent = Static<typeof SourceContentSchema>;
export type EditingFont = Static<typeof EditingFontSchema>;
export type EditingImage = Static<typeof EditingImageSchema>;
export type RenderProfile = Static<typeof RenderProfileSchema>;
/** Input must already be bounded and snapshotted by the caller's shared budget. */
export function isSourceContent(value: unknown): value is SourceContent {
  return Value.Check(SourceContentSchema, value);
}
