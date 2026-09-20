import type { ResolvedParagraph } from "@ofd-compose/binding-core";
import { canonicalSerialize } from "@ofd-compose/layout-ir";

export const numberingAlgorithmVersion = "ofd-compose/numbering@0";
export type NumberingInput = Pick<ResolvedParagraph, "nodeId" | "layout" | "instancePath">;
/** Authoritative numbering rules shared by actual layout and explicitly trusted host verification. */
export function numberingLabel(
  paragraph: NumberingInput,
  counts: Map<string, number>,
  initializedRepeatStarts: Set<string>,
): string {
  const number = paragraph.layout?.numbering;
  let label = "";
  if (number) {
    let startValue = number.start;
    if (startValue !== undefined && paragraph.instancePath?.length) {
      // The innermost repeat varies item identity; its parent chain identifies the list group.
      const startKey = canonicalSerialize({
        listId: number.listId,
        nodeId: paragraph.nodeId,
        parents: paragraph.instancePath
          .slice(0, -1)
          .map((instance) => ({ nodeId: instance.nodeId, key: instance.key })),
      });
      if (initializedRepeatStarts.has(startKey)) startValue = undefined;
      else initializedRepeatStarts.add(startKey);
    }
    const count = startValue ?? (counts.get(number.listId) ?? 0) + 1;
    counts.set(number.listId, count);
    label =
      (number.format === "decimal"
        ? String(count)
        : number.format === "bullet"
          ? "·"
          : number.format === "upper-alpha"
            ? alpha(count).toUpperCase()
            : alpha(count)) + (number.suffix ?? (number.format === "bullet" ? " " : ". "));
  }
  return label;
}

function alpha(value: number): string {
  let result = "";
  for (let n = value; n > 0; n = Math.floor((n - 1) / 26))
    result = String.fromCharCode(97 + ((n - 1) % 26)) + result;
  return result;
}
