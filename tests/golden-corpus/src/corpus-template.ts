import type {
  BindingPolicyVersion,
  BlockNode,
  InlineNode,
  TableRowNode,
  TemplateSource,
} from "@ofd-compose/document-model";

/**
 * 把 corpus 的 `template.txt`（README 约定）转成原生 TemplateSource：
 *
 * - 每行一个段落；`{expr}` 为旧标签（叙述类，issue 04）；
 * - `{#expr}` … `{/expr}` 为重复块 → RepeatBlock（序号退化键，`orderDependentIdentity: true`）；
 * - `{?expr}` … `{/?expr}` 为条件块 → ConditionalBlock；
 * - `@table-begin` … `@table-end` 为表格，`| a | b |` 为行，`| {#expr} |  |` … `| {/expr} |  |`
 *   为行组 → Table / RepeatRowGroup（issue 05）；
 * - `<run>` … `</run>` 只是旧引擎 run 切分的标注，转换时抹平（allowedDifferences: split-run-flattening）。
 *
 * 图片/条码标签 `{%expr}` 属于媒体用例（issue 11+），`isExecutableTemplate` 返回 false。
 * 这是测试支持代码，不是产品的受限导入器（issue 30）。
 */

export function isExecutableTemplate(templateText: string): boolean {
  return !/\{%/.test(templateText);
}

export interface CorpusTemplateOptions {
  readonly documentId: string;
  readonly bindingPolicyVersion: BindingPolicyVersion;
  /** 旧引擎以 UTC（DateTimeKind.Utc）解释带 Z 的时间；corpus 预期文本据此转录。 */
  readonly timeZone?: string;
  readonly templateId?: string;
  readonly legacyCommit?: string;
}

class Ids {
  private counter = 0;
  next(prefix: string): string {
    return `${prefix}${this.counter++}`;
  }
}

const REPEAT_OPEN = /^\{#(.+)\}$/;
const REPEAT_CLOSE = /^\{\/(.+)\}$/;
const COND_OPEN = /^\{\?(.+)\}$/;
const COND_CLOSE = /^\{\/\?(.+)\}$/;

function stripRuns(text: string): string {
  return text.replace(/<\/?run>/g, "");
}

function inlinesOf(text: string, ids: Ids): InlineNode[] {
  const line = stripRuns(text);
  const inlines: InlineNode[] = [];
  let last = 0;
  for (const match of line.matchAll(/\{([^{}]+)\}/g)) {
    if (match.index > last) {
      inlines.push({ kind: "text", nodeId: ids.next("t"), text: line.slice(last, match.index) });
    }
    inlines.push({
      kind: "dynamic-text",
      nodeId: ids.next("d"),
      bindingId: ids.next("b"),
      expression: { kind: "legacy", text: match[1] as string },
    });
    last = match.index + match[0].length;
  }
  if (last < line.length) {
    inlines.push({ kind: "text", nodeId: ids.next("t"), text: line.slice(last) });
  }
  return inlines;
}

function paragraphOf(text: string, ids: Ids): BlockNode {
  return { kind: "paragraph", nodeId: ids.next("p"), inlines: inlinesOf(text, ids) };
}

/** 按 `|` 切单元格；标签内部的管道（`{a|format:…}`）不是单元格分隔符。 */
function splitCells(line: string): string[] {
  const trimmed = stripRuns(line).trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    throw new Error(`table row must be wrapped in '|': ${line}`);
  }
  const cells: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of trimmed.slice(1, -1)) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    if (ch === "|" && depth === 0) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

class Parser {
  private index = 0;
  constructor(
    private readonly lines: readonly string[],
    private readonly ids: Ids,
  ) {}

  blocks(closer?: (line: string) => boolean): BlockNode[] {
    const blocks: BlockNode[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index] as string;
      if (closer?.(line)) return blocks;
      this.index++;
      const trimmed = line.trim();
      const condOpen = trimmed.match(COND_OPEN);
      const repeatOpen = COND_CLOSE.test(trimmed) ? null : trimmed.match(REPEAT_OPEN);
      if (condOpen) {
        const expression = condOpen[1] as string;
        const children = this.blocks((l) => l.trim() === `{/?${expression}}`);
        this.expectClose(`{/?${expression}}`);
        blocks.push({
          kind: "conditional-block",
          nodeId: this.ids.next("c"),
          bindingId: this.ids.next("bc"),
          expression: { kind: "legacy", text: expression },
          children,
        });
      } else if (repeatOpen) {
        const expression = repeatOpen[1] as string;
        const children = this.blocks((l) => l.trim() === `{/${expression}}`);
        this.expectClose(`{/${expression}}`);
        blocks.push({
          kind: "repeat-block",
          nodeId: this.ids.next("r"),
          bindingId: this.ids.next("br"),
          expression: { kind: "legacy", text: expression },
          repeatKey: { kind: "ordinal", orderDependentIdentity: true },
          children,
        });
      } else if (trimmed === "@table-begin") {
        blocks.push(this.table());
      } else if (REPEAT_CLOSE.test(trimmed) || COND_CLOSE.test(trimmed)) {
        throw new Error(`unexpected block close: ${line}`);
      } else {
        blocks.push(paragraphOf(line, this.ids));
      }
    }
    if (closer) throw new Error("unterminated block");
    return blocks;
  }

  private expectClose(expected: string): void {
    const line = this.lines[this.index];
    if (line === undefined || line.trim() !== expected) {
      throw new Error(`expected ${expected}`);
    }
    this.index++;
  }

  private table(): BlockNode {
    const rows = this.rows((l) => l.trim() === "@table-end");
    this.expectClose("@table-end");
    return { kind: "table", nodeId: this.ids.next("tbl"), rows };
  }

  private rows(closer: (line: string) => boolean): TableRowNode[] {
    const rows: TableRowNode[] = [];
    while (this.index < this.lines.length) {
      const line = this.lines[this.index] as string;
      if (closer(line)) return rows;
      this.index++;
      const cells = splitCells(line);
      const marker = (cells[0] ?? "").match(REPEAT_OPEN);
      if (marker && cells.slice(1).every((c) => c === "")) {
        const expression = marker[1] as string;
        const groupRows = this.rows((l) => splitCells(l)[0] === `{/${expression}}`).map((row) => {
          if (row.kind !== "table-row") throw new Error("nested row groups are not supported");
          return row;
        });
        this.expectRowClose(`{/${expression}}`);
        rows.push({
          kind: "repeat-row-group",
          nodeId: this.ids.next("rg"),
          bindingId: this.ids.next("brg"),
          expression: { kind: "legacy", text: expression },
          repeatKey: { kind: "ordinal", orderDependentIdentity: true },
          rows: groupRows,
        });
        continue;
      }
      if (REPEAT_CLOSE.test(cells[0] ?? "")) {
        throw new Error(`unexpected row-group close: ${line}`);
      }
      rows.push({
        kind: "table-row",
        nodeId: this.ids.next("row"),
        cells: cells.map((cell) => ({
          kind: "table-cell" as const,
          nodeId: this.ids.next("cell"),
          blocks: [paragraphOf(cell, this.ids)],
        })),
      });
    }
    throw new Error("unterminated table");
  }

  private expectRowClose(expected: string): void {
    const line = this.lines[this.index];
    if (line === undefined || splitCells(line)[0] !== expected) {
      throw new Error(`expected row-group close ${expected}`);
    }
    this.index++;
  }
}

export function templateFromText(
  templateText: string,
  options: CorpusTemplateOptions,
): TemplateSource {
  if (!isExecutableTemplate(templateText)) {
    throw new Error("template.txt contains media tags; not executable at ResolvedDocument level");
  }
  const lines = templateText.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  const body = new Parser(lines, new Ids()).blocks();

  return {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: options.documentId,
    revisionId: "corpus",
    settings: {
      locale: "zh-CN",
      timeZone: options.timeZone ?? "UTC",
      bindingPolicyVersion: options.bindingPolicyVersion,
    },
    styles: {},
    body,
    provenance: {
      source: "legacy-docx-import",
      ...(options.templateId === undefined ? {} : { templateId: options.templateId }),
      ...(options.legacyCommit === undefined ? {} : { legacyCommit: options.legacyCommit }),
    },
  };
}
