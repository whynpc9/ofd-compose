import type {
  BindingPolicyVersion,
  BlockNode,
  ConditionalBlock,
  InlineNode,
  Paragraph,
  RepeatBlock,
  RepeatKey,
  RepeatRowGroup,
  Table,
  TableRow,
  TemplateSource,
} from "@ofd-compose/document-model";
import { type CompileOptions, compile } from "@ofd-compose/template-compiler";
import { type BindingPolicy, bind, blockText, type JsonValue } from "../src/index.js";

/** 测试夹具：按创建顺序生成唯一 nodeId / bindingId 的模板构造器。 */
export class TemplateBuilder {
  private counter = 0;

  id(prefix: string): string {
    return `${prefix}${this.counter++}`;
  }

  /** `静态{表达式}静态` → 段落。 */
  p(line: string, styleId?: string): Paragraph {
    const inlines: InlineNode[] = [];
    let last = 0;
    for (const m of line.matchAll(/\{([^{}]+)\}/g)) {
      if (m.index > last) {
        inlines.push({ kind: "text", nodeId: this.id("t"), text: line.slice(last, m.index) });
      }
      const n = this.counter++;
      inlines.push({
        kind: "dynamic-text",
        nodeId: `d${n}`,
        bindingId: `b${n}`,
        expression: { kind: "legacy", text: m[1] as string },
      });
      last = m.index + m[0].length;
    }
    if (last < line.length) {
      inlines.push({ kind: "text", nodeId: this.id("t"), text: line.slice(last) });
    }
    return {
      kind: "paragraph",
      nodeId: this.id("p"),
      ...(styleId === undefined ? {} : { styleId }),
      inlines,
    };
  }

  cond(expression: string, children: BlockNode[]): ConditionalBlock {
    const n = this.counter++;
    return {
      kind: "conditional-block",
      nodeId: `c${n}`,
      bindingId: `bc${n}`,
      expression: { kind: "legacy", text: expression },
      children,
    };
  }

  repeat(
    expression: string,
    children: BlockNode[],
    repeatKey: RepeatKey = { kind: "ordinal", orderDependentIdentity: true },
  ): RepeatBlock {
    const n = this.counter++;
    return {
      kind: "repeat-block",
      nodeId: `r${n}`,
      bindingId: `br${n}`,
      expression: { kind: "legacy", text: expression },
      repeatKey,
      children,
    };
  }

  /** 每个单元格一行文本（可含 `{表达式}`）。 */
  row(cells: readonly string[]): TableRow {
    return {
      kind: "table-row",
      nodeId: this.id("row"),
      cells: cells.map((text) => ({
        kind: "table-cell" as const,
        nodeId: this.id("cell"),
        blocks: [this.p(text)],
      })),
    };
  }

  rowGroup(
    expression: string,
    rows: TableRow[],
    repeatKey: RepeatKey = { kind: "ordinal", orderDependentIdentity: true },
  ): RepeatRowGroup {
    const n = this.counter++;
    return {
      kind: "repeat-row-group",
      nodeId: `rg${n}`,
      bindingId: `brg${n}`,
      expression: { kind: "legacy", text: expression },
      repeatKey,
      rows,
    };
  }

  table(rows: (TableRow | RepeatRowGroup)[]): Table {
    return { kind: "table", nodeId: this.id("tbl"), rows };
  }

  template(body: BlockNode[], settings: Partial<TemplateSource["settings"]> = {}): TemplateSource {
    return {
      schemaVersion: "ofd-compose/document-model@0",
      documentId: "doc",
      revisionId: "r1",
      settings: {
        locale: "zh-CN",
        timeZone: "UTC",
        bindingPolicyVersion: "strict-1",
        ...settings,
      },
      styles: {},
      body,
    };
  }
}

export function build(
  make: (b: TemplateBuilder) => BlockNode[],
  settings: Partial<TemplateSource["settings"]> = {},
): TemplateSource {
  const b = new TemplateBuilder();
  return b.template(make(b), settings);
}

export interface RenderOptions {
  readonly policy?: BindingPolicyVersion;
  readonly settings?: Partial<TemplateSource["settings"]>;
  readonly compileOptions?: CompileOptions;
  readonly bindingPolicy?: BindingPolicy;
}

/** compile + bind；编译失败直接抛出（编译期诊断另有专门用例）。 */
export function renderTemplate(
  template: TemplateSource,
  data: JsonValue,
  options: RenderOptions = {},
) {
  const compiled = compile(
    { ...template, settings: { ...template.settings, ...options.settings } },
    options.compileOptions,
  );
  if (!compiled.ok) {
    throw new Error(`compile failed: ${JSON.stringify(compiled.diagnostics, null, 2)}`);
  }
  const result = bind(compiled.template, data, {
    ...options.bindingPolicy,
    ...(options.policy === undefined ? {} : { bindingPolicyVersion: options.policy }),
  });
  return { ...result, texts: result.document.body.map(blockText) };
}

/** 段落行数组 → 模板 → 渲染（叙述类快捷方式）。 */
export function renderLines(
  lines: readonly string[],
  data: JsonValue,
  policy: BindingPolicyVersion = "strict-1",
  settings: Partial<TemplateSource["settings"]> = {},
) {
  return renderTemplate(
    build((b) => lines.map((line) => b.p(line))),
    data,
    { policy, settings },
  );
}

export const codesOf = (
  diagnostics: readonly {
    code: string;
    severity: string;
    dataPath?: string;
    details?: Readonly<Record<string, unknown>>;
  }[],
) => diagnostics.map((d) => [d.code, d.severity, d.dataPath, d.details?.rule] as const);
