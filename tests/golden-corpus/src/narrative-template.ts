import type { BindingPolicyVersion, InlineNode, TemplateSource } from "@ofd-compose/document-model";

/**
 * 把 corpus 的 `template.txt`（README 约定：每行一个段落，`{expr}` 为旧标签）转成原生 TemplateSource。
 *
 * 只覆盖"叙述类"模板：全部段落由静态文本与行内表达式组成。含控制块（`{#` `{/` `{?`）、
 * 图片/条码（`{%`）、表格（`@table-begin` / `| a | b |`）或跨 run 标注（`<run>`）的模板
 * 不在 issue 04 范围内（issue 05/11+），`isNarrativeTemplate` 返回 false。
 *
 * 这是测试支持代码，不是产品的受限导入器（issue 30）。
 */

const controlPatterns = [/\{#/, /\{\//, /\{\?/, /\{%/, /<run>/, /^@table-/m, /^\|/m];

export function isNarrativeTemplate(templateText: string): boolean {
  return !controlPatterns.some((pattern) => pattern.test(templateText));
}

export interface NarrativeTemplateOptions {
  readonly documentId: string;
  readonly bindingPolicyVersion: BindingPolicyVersion;
  /** 旧引擎以 UTC（DateTimeKind.Utc）解释带 Z 的时间；corpus 预期文本据此转录。 */
  readonly timeZone?: string;
  readonly templateId?: string;
  readonly legacyCommit?: string;
}

export function narrativeTemplateFromText(
  templateText: string,
  options: NarrativeTemplateOptions,
): TemplateSource {
  if (!isNarrativeTemplate(templateText)) {
    throw new Error("template.txt contains structure/media tags; not a narrative template");
  }
  const lines = templateText.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();

  let counter = 0;
  const body = lines.map((line, paragraphIndex) => {
    const inlines: InlineNode[] = [];
    let last = 0;
    for (const match of line.matchAll(/\{([^{}]+)\}/g)) {
      if (match.index > last) {
        inlines.push({
          kind: "text",
          nodeId: `t${counter++}`,
          text: line.slice(last, match.index),
        });
      }
      const id = counter++;
      inlines.push({
        kind: "dynamic-text",
        nodeId: `d${id}`,
        bindingId: `b${id}`,
        expression: { kind: "legacy", text: match[1] as string },
      });
      last = match.index + match[0].length;
    }
    if (last < line.length) {
      inlines.push({ kind: "text", nodeId: `t${counter++}`, text: line.slice(last) });
    }
    return { kind: "paragraph" as const, nodeId: `p${paragraphIndex}`, inlines };
  });

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
