import {
  BindingPolicyVersionSchema,
  documentModelSchemaVersion,
  InputControlSchema,
  modelVersion,
  ParagraphLayoutSchema,
  ProvenanceSchema,
  TemplateSettingsSchema,
  TextStyleSchema,
} from "@ofd-compose/document-model";
import { expressionLanguageVersion } from "@ofd-compose/template-compiler";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

/**
 * ResolvedDocument v0：本次绑定的实际内容与数据实例关系（spec §3 三个不可互替对象之一）。
 * DynamicText 已成为带来源映射的文本片段；结构节点已展开：ConditionalBlock 为假时整块消失，
 * RepeatBlock / RepeatRowGroup 的每个实例平铺为带 `instancePath` 的块 / 行。文档不再含表达式求值所需的任何东西。
 */
export const resolvedDocumentFormat = "ofd-compose/resolved-document@0" as const;

const identifier = Type.String({ minLength: 1 });

export const ValueStateSchema = Type.Union(
  [Type.Literal("value"), Type.Literal("null"), Type.Literal("missing")],
  { description: "Missing 与 Null 分别表示。" },
);

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
    valueState: ValueStateSchema,
  },
  { additionalProperties: false },
);

export const ResolvedTextFragmentSchema = Type.Object(
  {
    kind: Type.Literal("text"),
    text: Type.String(),
    styleId: Type.Optional(identifier),
    origin: Type.Union([StaticOriginSchema, DynamicTextOriginSchema]),
    styleInheritance: Type.Optional(
      Type.Union([Type.Literal("inherit-paragraph"), Type.Literal("explicit")]),
    ),
  },
  { additionalProperties: false },
);

/** 输入控件不参与绑定，原样进入 ResolvedDocument（与模板侧同一 schema）。 */
export const ResolvedInputControlSchema = InputControlSchema;

export const ResolvedFragmentSchema = Type.Union([
  ResolvedTextFragmentSchema,
  ResolvedInputControlSchema,
]);

/**
 * 重复实例身份（spec §4）：模板 nodeId + 重复键。`keyKind: ordinal` 为退化键（重排数据会改变实例身份）。
 */
export const RepeatInstanceSchema = Type.Object(
  {
    nodeId: identifier,
    bindingId: identifier,
    key: Type.String(),
    keyKind: Type.Union([Type.Literal("path"), Type.Literal("ordinal")]),
    /** 实例在展开序列中的序号（0 起）。 */
    ordinal: Type.Integer({ minimum: 0 }),
    /** 该实例当前项在原始数据中的路径（如 `orders[1]`）。 */
    dataPath: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** 外层到内层的重复实例链；不在任何重复内的节点省略该字段。 */
const instancePath = Type.Optional(Type.Array(RepeatInstanceSchema, { minItems: 1 }));

export const ResolvedParagraphSchema = Type.Object(
  {
    kind: Type.Literal("paragraph"),
    nodeId: identifier,
    styleId: Type.Optional(identifier),
    instancePath,
    layout: Type.Optional(ParagraphLayoutSchema),
    fragments: Type.Array(ResolvedFragmentSchema),
  },
  { additionalProperties: false },
);

const resolvedTableCellOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("table-cell"),
      nodeId: identifier,
      styleId: Type.Optional(identifier),
      blocks: Type.Array(block),
    },
    { additionalProperties: false },
  );

const resolvedTableRowOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("table-row"),
      nodeId: identifier,
      instancePath,
      cells: Type.Array(resolvedTableCellOf(block), { minItems: 1 }),
    },
    { additionalProperties: false },
  );

const resolvedTableOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("table"),
      nodeId: identifier,
      styleId: Type.Optional(identifier),
      instancePath,
      /** RepeatRowGroup 已展开：每个实例的行带自身 instancePath。 */
      rows: Type.Array(resolvedTableRowOf(block)),
    },
    { additionalProperties: false },
  );

export const ResolvedBlockSchema = Type.Recursive(
  (This) => Type.Union([ResolvedParagraphSchema, resolvedTableOf(This)]),
  { $id: "ResolvedBlock" },
);

export const ResolvedTableCellSchema = resolvedTableCellOf(ResolvedBlockSchema);
export const ResolvedTableRowSchema = resolvedTableRowOf(ResolvedBlockSchema);
export const ResolvedTableSchema = resolvedTableOf(ResolvedBlockSchema);

/** ConditionalBlock 的求值记录（块本身在为假时不出现在正文中）。 */
export const ResolvedConditionalSchema = Type.Object(
  {
    nodeId: identifier,
    bindingId: identifier,
    expression: Type.String(),
    visible: Type.Boolean(),
    valueState: ValueStateSchema,
    dataPath: Type.Optional(Type.String()),
    instancePath,
  },
  { additionalProperties: false },
);

/** RepeatBlock / RepeatRowGroup 的求值记录。 */
export const ResolvedRepeatSchema = Type.Object(
  {
    nodeId: identifier,
    bindingId: identifier,
    kind: Type.Union([Type.Literal("repeat-block"), Type.Literal("repeat-row-group")]),
    expression: Type.String(),
    valueState: ValueStateSchema,
    dataPath: Type.Optional(Type.String()),
    instanceCount: Type.Integer({ minimum: 0 }),
    /** 因 REPEAT_LIMIT 被截断。 */
    truncated: Type.Optional(Type.Literal(true)),
    instancePath,
  },
  { additionalProperties: false },
);

export const ResolvedStructureSchema = Type.Object(
  {
    conditionals: Type.Array(ResolvedConditionalSchema),
    repeats: Type.Array(ResolvedRepeatSchema),
  },
  { additionalProperties: false },
);

/** 绑定运行期来源（非语义 provenance；不进入 LayoutIdentity）。 */
export const BindingRuntimeSchema = Type.Object(
  {
    temporalPolyfillVersion: Type.String({ minLength: 1 }),
    tzdataSource: Type.Literal("runtime-icu"),
    tzdataVersion: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

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
    structure: ResolvedStructureSchema,
    runtime: BindingRuntimeSchema,
    provenance: Type.Optional(ProvenanceSchema),
  },
  {
    $id: "https://ofd-compose.local/schemas/document-model/resolved-document.schema.json",
    title: "OFD Compose ResolvedDocument v0",
    additionalProperties: false,
  },
);

export type ValueState = Static<typeof ValueStateSchema>;
export type StaticOrigin = Static<typeof StaticOriginSchema>;
export type DynamicTextOrigin = Static<typeof DynamicTextOriginSchema>;
export type ResolvedTextFragment = Static<typeof ResolvedTextFragmentSchema>;
export type ResolvedInputControl = Static<typeof ResolvedInputControlSchema>;
export type ResolvedFragment = Static<typeof ResolvedFragmentSchema>;
export type RepeatInstance = Static<typeof RepeatInstanceSchema>;
export type ResolvedParagraph = Static<typeof ResolvedParagraphSchema>;
export type ResolvedTableCell = Static<typeof ResolvedTableCellSchema>;
export type ResolvedTableRow = Static<typeof ResolvedTableRowSchema>;
export type ResolvedTable = Static<typeof ResolvedTableSchema>;
export type ResolvedBlock = Static<typeof ResolvedBlockSchema>;
export type ResolvedConditional = Static<typeof ResolvedConditionalSchema>;
export type ResolvedRepeat = Static<typeof ResolvedRepeatSchema>;
export type ResolvedStructure = Static<typeof ResolvedStructureSchema>;
export type BindingRuntime = Static<typeof BindingRuntimeSchema>;
export type ResolvedDocument = Static<typeof ResolvedDocumentSchema>;

/** 段落最终文本（叙述句验收的比较对象；InputControl 不贡献文本）。 */
export function paragraphText(paragraph: ResolvedParagraph): string {
  let text = "";
  for (const fragment of paragraph.fragments) {
    if (fragment.kind === "text") text += fragment.text;
  }
  return text;
}

/** 块的最终文本：段落文本；表格按行 / 单元格以 `\n` / `\t` 连接。 */
export function blockText(block: ResolvedBlock): string {
  if (block.kind === "paragraph") return paragraphText(block);
  return block.rows.map((row) => row.cells.map(cellText).join("\t")).join("\n");
}

/** 单元格最终文本：内部块文本以 `\n` 连接。 */
export function cellText(cell: ResolvedTableCell): string {
  return cell.blocks.map(blockText).join("\n");
}

/** 身份编码中转义分隔符 `=` `/` 与转义符 `\` 本身，使编码可逆、不同实例链不会串成同一文本。 */
function escapeIdentityPart(part: string): string {
  return part.replace(/[\\/=]/g, (ch) => `\\${ch}`);
}

/**
 * 重复实例链的稳定文本身份：`nodeId=key` 以 `/` 连接；nodeId 与 key 中的 `=` `/` `\` 以 `\` 转义。
 * 键是任意标量文本，不转义时 `[{a, "b/c=d"}]` 与 `[{a,"b"},{c,"d"}]` 会串成同一身份。
 */
export function instanceIdentity(instancePath: readonly RepeatInstance[] | undefined): string {
  return (instancePath ?? [])
    .map((i) => `${escapeIdentityPart(i.nodeId)}=${escapeIdentityPart(i.key)}`)
    .join("/");
}
