import { type Static, type TSchema, Type } from "@sinclair/typebox";

/**
 * Document Model v0（issue 04 + issue 05）。
 *
 * 覆盖：段落 + 行内序列（静态文本、DynamicText、InputControl）；结构节点 ConditionalBlock / RepeatBlock /
 * RepeatRowGroup；表格 v0（行/单元格结构，版式属性待 issue 13/23）。媒体绑定等随后续票加入；
 * v0 冻结前的新增字段均为向后兼容扩展（旧实例仍合法），冻结后 `modelVersion` 递增并提供迁移。
 *
 * 身份约定（spec §4）：
 * - `nodeId`：节点结构身份，全文档唯一；
 * - `bindingId`：绑定身份，与 nodeId 分离，全文档唯一；数据路径只存在于表达式中，不与两者复合。
 */

export const modelVersion = "0" as const;
export const documentModelSchemaVersion = "ofd-compose/document-model@0" as const;

const identifier = Type.String({ minLength: 1, maxLength: 256, pattern: "^[A-Za-z0-9._:-]+$" });

export const bindingPolicyVersions = ["strict-1", "legacy-compat-1"] as const;
export type BindingPolicyVersion = (typeof bindingPolicyVersions)[number];

export const BindingPolicyVersionSchema = Type.Union(
  bindingPolicyVersions.map((v) => Type.Literal(v)),
  {
    description: "绑定策略版本：strict-1（新模板）或 legacy-compat-1（迁移模板，节点级兼容政策）。",
  },
);

/** 模板显式锁定的确定性设置（spec 用户故事 8）。 */
export const TemplateSettingsSchema = Type.Object(
  {
    locale: Type.String({
      minLength: 2,
      description: "BCP 47 locale 标签（如 zh-CN）。v0 仅记录；数字/日期格式化为固定不变文化。",
    }),
    timeZone: Type.String({
      minLength: 1,
      description: "IANA 时区（如 Asia/Shanghai、UTC）。带偏移的日期时间值按此时区取字段。",
    }),
    bindingPolicyVersion: BindingPolicyVersionSchema,
  },
  { additionalProperties: false },
);

export const TextStyleSchema = Type.Object(
  {
    fontFamily: Type.Optional(Type.String({ minLength: 1 })),
    /** 字号，单位 pt。 */
    fontSize: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    bold: Type.Optional(Type.Boolean()),
    italic: Type.Optional(Type.Boolean()),
    underline: Type.Optional(Type.Boolean()),
    strikethrough: Type.Optional(Type.Boolean()),
    /** #RRGGBB。 */
    color: Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" })),
    highlight: Type.Optional(Type.String({ pattern: "^#[0-9A-Fa-f]{6}$" })),
  },
  { additionalProperties: false },
);

/** 结构化表达式配置（可视化配置面板保存的形态）。与旧文本语法编译为同一 AST。 */
export const StructuredStepSchema = Type.Union([
  Type.Object(
    {
      op: Type.Literal("sort"),
      key: Type.String({ minLength: 1 }),
      direction: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal("take"), count: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal("first") }, { additionalProperties: false }),
  Type.Object({ op: Type.Literal("last") }, { additionalProperties: false }),
  Type.Object(
    { op: Type.Literal("nth"), rank: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal("at"), index: Type.Integer() }, { additionalProperties: false }),
  Type.Object(
    { op: Type.Literal("maxby"), key: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    { op: Type.Literal("minby"), key: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Union([Type.Literal("get"), Type.Literal("pick")]),
      path: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ op: Type.Literal("count") }, { additionalProperties: false }),
  Type.Object(
    {
      op: Type.Literal("if"),
      whenTrue: Type.String(),
      whenFalse: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      op: Type.Literal("format"),
      kind: Type.Union([
        Type.Literal("number"),
        Type.Literal("numeric"),
        Type.Literal("percent"),
        Type.Literal("percentage"),
        Type.Literal("permille"),
        Type.Literal("per-mille"),
        Type.Literal("per_mille"),
        Type.Literal("date"),
        Type.Literal("datetime"),
        Type.Literal("time"),
      ]),
      pattern: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
]);

export const StructuredExpressionSchema = Type.Object(
  {
    kind: Type.Literal("structured"),
    /** 数据路径：`a.b[0]`、`.`（当前项）、`$`（根）、`$.a`。 */
    source: Type.String({ minLength: 1 }),
    steps: Type.Array(StructuredStepSchema),
  },
  { additionalProperties: false },
);

export const LegacyExpressionSchema = Type.Object(
  {
    kind: Type.Literal("legacy"),
    /** 旧 NDocxTemplater 管道文本，如 `institutions|maxby:revenue|get:name`（不含花括号）。 */
    text: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const ExpressionSourceSchema = Type.Union([
  LegacyExpressionSchema,
  StructuredExpressionSchema,
]);

export const StaticTextSchema = Type.Object(
  {
    kind: Type.Literal("text"),
    nodeId: identifier,
    text: Type.String(),
    styleId: Type.Optional(identifier),
  },
  { additionalProperties: false },
);

export const DynamicTextSchema = Type.Object(
  {
    kind: Type.Literal("dynamic-text"),
    nodeId: identifier,
    bindingId: identifier,
    expression: ExpressionSourceSchema,
    styleId: Type.Optional(identifier),
    /**
     * 显式样式继承规则：inherit-paragraph = 使用段落样式（默认）；explicit = 只用自身 styleId。
     */
    styleInheritance: Type.Optional(
      Type.Union([Type.Literal("inherit-paragraph"), Type.Literal("explicit")]),
    ),
  },
  { additionalProperties: false },
);

export const InputControlSchema = Type.Object(
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
    /** 数字控件的默认值保留十进制文本表达，不转浮点。 */
    defaultValue: Type.Optional(Type.Union([Type.String(), Type.Boolean()])),
    required: Type.Optional(Type.Boolean()),
    options: Type.Optional(Type.Array(Type.String())),
    styleId: Type.Optional(identifier),
  },
  { additionalProperties: false },
);

export const InlineNodeSchema = Type.Union([
  StaticTextSchema,
  DynamicTextSchema,
  InputControlSchema,
]);

export const ParagraphSchema = Type.Object(
  {
    kind: Type.Literal("paragraph"),
    nodeId: identifier,
    styleId: Type.Optional(identifier),
    inlines: Type.Array(InlineNodeSchema),
  },
  { additionalProperties: false },
);

/**
 * 重复键（spec §4）：实例身份 = 模板 nodeId + 重复键。
 * - `path`：相对当前项的数据路径（如 `id`、`meta.code`），值必须是标量且在同一重复内唯一；
 * - `ordinal`：以序号作退化键；模板必须显式确认「重排数据会改变实例身份」。
 */
export const RepeatKeySchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("path"), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("ordinal"),
      orderDependentIdentity: Type.Literal(true, {
        description: "确认：使用序号作退化键时，重排数据会改变实例身份。",
      }),
    },
    { additionalProperties: false },
  ),
]);

/** 表格单元格：内容为块序列（段落 / 条件块 / 重复块 / 嵌套表格）。 */
const tableCellOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("table-cell"),
      nodeId: identifier,
      styleId: Type.Optional(identifier),
      blocks: Type.Array(block),
    },
    { additionalProperties: false },
  );

const tableRowOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("table-row"),
      nodeId: identifier,
      cells: Type.Array(tableCellOf(block), { minItems: 1 }),
    },
    { additionalProperties: false },
  );

/** RepeatRowGroup：表格中按序列重复的一组行；每个实例展开为 `rows` 的一份拷贝。 */
const repeatRowGroupOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("repeat-row-group"),
      nodeId: identifier,
      bindingId: identifier,
      expression: ExpressionSourceSchema,
      repeatKey: RepeatKeySchema,
      rows: Type.Array(tableRowOf(block), { minItems: 1 }),
    },
    { additionalProperties: false },
  );

/**
 * 表格 v0：只承载绑定语义所需的行/单元格结构；列宽、边框、合并、跨页表头等版式属性随 issue 13/23 加入。
 */
const tableOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("table"),
      nodeId: identifier,
      styleId: Type.Optional(identifier),
      rows: Type.Array(Type.Union([tableRowOf(block), repeatRowGroupOf(block)]), { minItems: 1 }),
    },
    { additionalProperties: false },
  );

/** ConditionalBlock：表达式为假（按绑定策略的 truthiness 表）时整块不出现，不留空段。 */
const conditionalBlockOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("conditional-block"),
      nodeId: identifier,
      bindingId: identifier,
      expression: ExpressionSourceSchema,
      children: Type.Array(block),
    },
    { additionalProperties: false },
  );

/** RepeatBlock：对序列的每一项展开一份 `children`；子节点表达式以该项为当前作用域。 */
const repeatBlockOf = <T extends TSchema>(block: T) =>
  Type.Object(
    {
      kind: Type.Literal("repeat-block"),
      nodeId: identifier,
      bindingId: identifier,
      expression: ExpressionSourceSchema,
      repeatKey: RepeatKeySchema,
      children: Type.Array(block),
    },
    { additionalProperties: false },
  );

/**
 * 正文块（递归）：段落、表格、ConditionalBlock、RepeatBlock。
 * JSON Schema 中以 `$id: BlockNode` + `$ref` 表达递归。
 */
export const BlockNodeSchema = Type.Recursive(
  (This) =>
    Type.Union([ParagraphSchema, tableOf(This), conditionalBlockOf(This), repeatBlockOf(This)]),
  { $id: "BlockNode" },
);

export const TableCellSchema = tableCellOf(BlockNodeSchema);
export const TableRowSchema = tableRowOf(BlockNodeSchema);
export const RepeatRowGroupSchema = repeatRowGroupOf(BlockNodeSchema);
export const TableSchema = tableOf(BlockNodeSchema);
export const ConditionalBlockSchema = conditionalBlockOf(BlockNodeSchema);
export const RepeatBlockSchema = repeatBlockOf(BlockNodeSchema);

/** 扩展命名空间条目：`required` 为 true 且命名空间未知时加载被拒绝。 */
export const ExtensionEntrySchema = Type.Object(
  {
    required: Type.Boolean(),
    data: Type.Unknown(),
  },
  { additionalProperties: false },
);

export const ProvenanceSchema = Type.Object(
  {
    source: Type.Union([Type.Literal("native"), Type.Literal("legacy-docx-import")]),
    templateId: Type.Optional(Type.String({ minLength: 1 })),
    legacyCommit: Type.Optional(Type.String({ pattern: "^[0-9a-f]{40}$" })),
  },
  { additionalProperties: false },
);

export const TemplateSourceSchema = Type.Object(
  {
    schemaVersion: Type.Literal(documentModelSchemaVersion),
    documentId: Type.String({ minLength: 1 }),
    revisionId: Type.String({ minLength: 1 }),
    settings: TemplateSettingsSchema,
    styles: Type.Record(Type.String({ pattern: "^[A-Za-z0-9._:-]+$" }), TextStyleSchema),
    body: Type.Array(BlockNodeSchema),
    extensions: Type.Optional(
      Type.Record(Type.String({ pattern: "^[A-Za-z0-9._:/-]+$" }), ExtensionEntrySchema),
    ),
    provenance: Type.Optional(ProvenanceSchema),
  },
  {
    $id: "https://ofd-compose.local/schemas/document-model/template-source.schema.json",
    title: "OFD Compose TemplateSource (Document Model v0)",
    additionalProperties: false,
  },
);

export type TemplateSettings = Static<typeof TemplateSettingsSchema>;
export type TextStyle = Static<typeof TextStyleSchema>;
export type StructuredStep = Static<typeof StructuredStepSchema>;
export type StructuredExpression = Static<typeof StructuredExpressionSchema>;
export type LegacyExpression = Static<typeof LegacyExpressionSchema>;
export type ExpressionSource = Static<typeof ExpressionSourceSchema>;
export type StaticText = Static<typeof StaticTextSchema>;
export type DynamicText = Static<typeof DynamicTextSchema>;
export type InputControl = Static<typeof InputControlSchema>;
export type InlineNode = Static<typeof InlineNodeSchema>;
export type Paragraph = Static<typeof ParagraphSchema>;
export type RepeatKey = Static<typeof RepeatKeySchema>;
export type TableCell = Static<typeof TableCellSchema>;
export type TableRow = Static<typeof TableRowSchema>;
export type RepeatRowGroup = Static<typeof RepeatRowGroupSchema>;
export type TableRowNode = TableRow | RepeatRowGroup;
export type Table = Static<typeof TableSchema>;
export type ConditionalBlock = Static<typeof ConditionalBlockSchema>;
export type RepeatBlock = Static<typeof RepeatBlockSchema>;
export type BlockNode = Static<typeof BlockNodeSchema>;
/** 持有表达式绑定的结构节点（与 DynamicText 一样各有独立 bindingId）。 */
export type StructureBinding = ConditionalBlock | RepeatBlock | RepeatRowGroup;
export type ExtensionEntry = Static<typeof ExtensionEntrySchema>;
export type Provenance = Static<typeof ProvenanceSchema>;
export type TemplateSource = Static<typeof TemplateSourceSchema>;
