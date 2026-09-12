import type { BlockNode, InlineNode, StructureBinding, TableCell, TableRowNode } from "./schema.js";

/** 模板树中任一带 nodeId 的节点。 */
export type TemplateNode = BlockNode | TableRowNode | TableCell | InlineNode;

export interface TemplateNodeVisit {
  readonly node: TemplateNode;
  /** 结构嵌套深度：进入 ConditionalBlock / RepeatBlock / Table / RepeatRowGroup 各加一层。 */
  readonly structureDepth: number;
}

const structureContainerKinds: ReadonlySet<string> = new Set([
  "conditional-block",
  "repeat-block",
  "table",
  "repeat-row-group",
]);

/** 结构容器：进入其子节点时结构嵌套深度加一。 */
export function isStructureContainer(node: TemplateNode): boolean {
  return structureContainerKinds.has(node.kind);
}

/** 先序遍历模板正文（含表格行、单元格与行内节点）。 */
export function* walkTemplateNodes(
  blocks: readonly BlockNode[],
  structureDepth = 0,
): Generator<TemplateNodeVisit> {
  for (const block of blocks) {
    yield* walkNode(block, structureDepth);
  }
}

function* walkNode(node: TemplateNode, structureDepth: number): Generator<TemplateNodeVisit> {
  yield { node, structureDepth };
  const childDepth = isStructureContainer(node) ? structureDepth + 1 : structureDepth;
  switch (node.kind) {
    case "paragraph":
      for (const inline of node.inlines) yield { node: inline, structureDepth };
      return;
    case "conditional-block":
      yield* walkTemplateNodes(node.children, childDepth);
      return;
    case "repeat-block":
      yield* walkTemplateNodes(node.children, childDepth);
      return;
    case "table":
      for (const row of node.rows) yield* walkNode(row, childDepth);
      return;
    case "repeat-row-group":
      for (const row of node.rows) yield* walkNode(row, childDepth);
      return;
    case "table-row":
      for (const cell of node.cells) yield* walkNode(cell, structureDepth);
      return;
    case "table-cell":
      yield* walkTemplateNodes(node.blocks, structureDepth);
      return;
    default:
      return;
  }
}

export interface StructureDepthOverflow {
  /** 越界容器所在的结构深度（0 起）。 */
  readonly structureDepth: number;
  readonly nodeId?: string;
}

/**
 * 在 schema 校验之前、对**未受信任的原始输入**做有界的嵌套深度预检（迭代，不递归）。
 * 找到第一个结构深度超过 `maxStructureDepth` 的结构容器即返回；输入形态不合法的部分静默跳过（交给 schema 校验报告）。
 * 这样成千上万层的嵌套块不会先把递归的 `Value.Check` / 递归遍历推向栈溢出，而是得到 `RESOURCE_LIMIT`。
 */
export function findStructureDepthOverflow(
  body: unknown,
  maxStructureDepth: number,
): StructureDepthOverflow | undefined {
  if (!Array.isArray(body)) return undefined;
  const stack: { node: unknown; structureDepth: number }[] = [];
  for (let i = body.length - 1; i >= 0; i--) stack.push({ node: body[i], structureDepth: 0 });
  while (stack.length > 0) {
    const { node, structureDepth } = stack.pop() as { node: unknown; structureDepth: number };
    if (typeof node !== "object" || node === null || Array.isArray(node)) continue;
    const record = node as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind !== "string") continue;
    const isContainer = structureContainerKinds.has(kind);
    if (isContainer && structureDepth > maxStructureDepth) {
      return {
        structureDepth,
        ...(typeof record.nodeId === "string" ? { nodeId: record.nodeId } : {}),
      };
    }
    const childDepth = isContainer ? structureDepth + 1 : structureDepth;
    const children =
      kind === "conditional-block" || kind === "repeat-block"
        ? record.children
        : kind === "table" || kind === "repeat-row-group"
          ? record.rows
          : kind === "table-row"
            ? record.cells
            : kind === "table-cell"
              ? record.blocks
              : undefined;
    if (!Array.isArray(children)) continue;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], structureDepth: childDepth });
    }
  }
  return undefined;
}

export function isStructureBinding(node: TemplateNode): node is StructureBinding {
  return (
    node.kind === "conditional-block" ||
    node.kind === "repeat-block" ||
    node.kind === "repeat-row-group"
  );
}
