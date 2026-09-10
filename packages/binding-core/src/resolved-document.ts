import {
  BindingPolicyVersionSchema,
  documentModelSchemaVersion,
  modelVersion,
  ProvenanceSchema,
  TemplateSettingsSchema,
  TextStyleSchema,
} from "@ofd-compose/document-model";
import { expressionLanguageVersion } from "@ofd-compose/template-compiler";
import { type Static, Type } from "@sinclair/typebox";

/**
 * ResolvedDocument v0：本次绑定的实际内容与数据实例关系（spec §3 三个不可互替对象之一）。
 * DynamicText 已成为带来源映射的文本片段；不再含表达式求值所需的任何东西。
 */
export const resolvedDocumentFormat = "ofd-compose/resolved-document@0" as const;

const identifier = Type.String({ minLength: 1 });

export const StaticOriginSchema = Type.Object(
  { kind: Type.Literal("static"), nodeId: identifier },
  { additionalProperties: false },
);

export const DynamicTextOriginSchema = Type.Object(
  {
    kind: Type.Literal("dynamic-text"),
    nodeId: identifier,
    bindingId: identifier,
    /** 规范化旧管道文本（来源映射的人可读锚点）。 */
    expression: Type.String(),
    /** 结果对应的数据路径（尽力追踪，如 `institutions[1].revenue`）。 */
    dataPath: Type.Optional(Type.String()),
    /** Missing 与 Null 分别表示。 */
    valueState: Type.Union([Type.Literal("value"), Type.Literal("null"), Type.Literal("missing")]),
  },
  { additionalProperties: false },
);

export const ResolvedTextFragmentSchema = Type.Object(
  {
    kind: Type.Literal("text"),
    text: Type.String(),
    styleId: Type.Optional(identifier),
    origin: Type.Union([StaticOriginSchema, DynamicTextOriginSchema]),
  },
  { additionalProperties: false },
);

export const ResolvedInputControlSchema = Type.Object(
  {
    kind: Type.Literal("input-control"),
    nodeId: identifier,
    controlId: identifier,
    controlType: Type.Union([
      Type.Literal("text"),
      Type.Literal("number"),
      Type.Literal("select"),
      Type.Literal("date"),
      Type.Literal("radio"),
      Type.Literal("checkbox"),
    ]),
    placeholder: Type.Optional(Type.String()),
    defaultValue: Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
    required: Type.Optional(Type.Boolean()),
    options: Type.Optional(Type.Array(Type.String())),
    styleId: Type.Optional(identifier),
  },
  { additionalProperties: false },
);

export const ResolvedFragmentSchema = Type.Union([
  ResolvedTextFragmentSchema,
  ResolvedInputControlSchema,
]);

export const ResolvedParagraphSchema = Type.Object(
  {
    kind: Type.Literal("paragraph"),
    nodeId: identifier,
    styleId: Type.Optional(identifier),
    fragments: Type.Array(ResolvedFragmentSchema),
  },
  { additionalProperties: false },
);

export const ResolvedBlockSchema = Type.Union([ResolvedParagraphSchema]);

export const ResolvedDocumentSchema = Type.Object(
  {
    format: Type.Literal(resolvedDocumentFormat),
    modelVersion: Type.Literal(modelVersion),
    templateSchemaVersion: Type.Literal(documentModelSchemaVersion),
    expressionLanguageVersion: Type.Literal(expressionLanguageVersion),
    bindingPolicyVersion: BindingPolicyVersionSchema,
    documentId: Type.String({ minLength: 1 }),
    revisionId: Type.String({ minLength: 1 }),
    settings: TemplateSettingsSchema,
    styles: Type.Record(Type.String(), TextStyleSchema),
    body: Type.Array(ResolvedBlockSchema),
    provenance: Type.Optional(ProvenanceSchema),
  },
  {
    $id: "https://ofd-compose.local/schemas/document-model/resolved-document.schema.json",
    title: "OFD Compose ResolvedDocument v0",
    additionalProperties: false,
  },
);

export type StaticOrigin = Static<typeof StaticOriginSchema>;
export type DynamicTextOrigin = Static<typeof DynamicTextOriginSchema>;
export type ResolvedTextFragment = Static<typeof ResolvedTextFragmentSchema>;
export type ResolvedInputControl = Static<typeof ResolvedInputControlSchema>;
export type ResolvedFragment = Static<typeof ResolvedFragmentSchema>;
export type ResolvedParagraph = Static<typeof ResolvedParagraphSchema>;
export type ResolvedBlock = Static<typeof ResolvedBlockSchema>;
export type ResolvedDocument = Static<typeof ResolvedDocumentSchema>;

/** 段落最终文本（叙述句验收的比较对象；InputControl 不贡献文本）。 */
export function paragraphText(paragraph: ResolvedParagraph): string {
  let text = "";
  for (const fragment of paragraph.fragments) {
    if (fragment.kind === "text") text += fragment.text;
  }
  return text;
}
