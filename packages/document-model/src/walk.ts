import type { BlockNode, InlineNode, StructureBinding, TableCell, TableRowNode } from "./schema.js";

/** 模板树中任一带 nodeId 的节点。 */
export type TemplateNode = BlockNode | TableRowNode | TableCell | InlineNode;

export interface TemplateNodeVisit {
  readonly node: TemplateNode;
  /** 结构嵌套深度：进入 ConditionalBlock / RepeatBlock / Table / RepeatRowGroup 各加一层。 */
  readonly structureDepth: number;
}

/** 结构容器：进入其子节点时结构嵌套深度加一。 */
export function isStructureContainer(node: TemplateNode): boolean {
  return (
    node.kind === "conditional-block" ||
    node.kind === "repeat-block" ||
    node.kind === "table" ||
    node.kind === "repeat-row-group"
  );
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

export function isStructureBinding(node: TemplateNode): node is StructureBinding {
  return (
    node.kind === "conditional-block" ||
    node.kind === "repeat-block" ||
    node.kind === "repeat-row-group"
  );
}
