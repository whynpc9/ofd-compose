import { expect, it } from "vitest";
import { fixtureFactories } from "../fixtures/index.js";
import {
  canonicalizeLayoutIR,
  digestCanonical,
  validateCanonicalLayoutIR,
  validateLayoutIR,
} from "../src/index.js";

function input() {
  const ir = fixtureFactories.text();
  const object = ir.pages[0]?.objects[0];
  const semantic = ir.semantics[0];
  if (object?.kind !== "text" || !semantic) throw new Error("Missing fixture");
  semantic.sourceRanges = [
    {
      nodeId: "static",
      sourceText: { text: "A😀", range: { start: 0, end: 3 } },
      logicalRange: { start: 0, end: 3 },
    },
    {
      nodeId: "dynamic",
      bindingId: "binding",
      sourceText: { text: "fi", range: { start: 0, end: 2 } },
      logicalRange: { start: 3, end: 5 },
    },
  ];
  semantic.repeatInstance = [{ nodeId: "repeat", key: "key" }];
  return ir;
}
it("preserves ordered multiple source ranges and repeat identity in canonical semantic digest", () => {
  const ir = input();
  const canonical = canonicalizeLayoutIR(ir);
  validateCanonicalLayoutIR(canonical);
  expect(canonical.semantics[0]?.sourceRanges).toEqual(ir.semantics[0]?.sourceRanges);
  expect(canonical.semantics[0]?.repeatInstance).toEqual([{ nodeId: "repeat", key: "key" }]);
  expect(canonical.identity.semanticDigest).toBe(digestCanonical(canonical.semantics));
  ir.semantics[0]?.sourceRanges?.reverse();
  expect(canonicalizeLayoutIR(ir).identity.semanticDigest).not.toBe(
    canonical.identity.semanticDigest,
  );
});
it("validates source and object logical UTF-16 ranges separately in both transports", () => {
  for (const canonical of [false, true])
    for (const field of ["sourceText", "logicalRange"] as const) {
      const ir = canonical ? canonicalizeLayoutIR(input()) : input();
      const source = ir.semantics[0]?.sourceRanges?.[0];
      if (!source) throw new Error("Missing source");
      if (field === "sourceText") source.sourceText.range.end = 2;
      else source.logicalRange.end = 2;
      expect(() => (canonical ? validateCanonicalLayoutIR(ir) : validateLayoutIR(ir))).toThrow();
    }
});

it("preserves repeated section source IDs and rejects mismatched page/semantic sources", () => {
  const ir = input();
  const page = ir.pages[0],
    semantic = ir.semantics[0];
  if (!page || !semantic) throw new Error("Missing page fixture");
  page.sectionId = "@section:occurrence";
  page.sectionSourceId = "original-section";
  semantic.pageIndex = page.pageIndex;
  semantic.sectionId = page.sectionId;
  semantic.sectionSourceId = "original-section";
  const canonical = canonicalizeLayoutIR(ir);
  expect(canonical.pages[0]?.sectionSourceId).toBe("original-section");
  expect(canonical.semantics[0]?.sectionSourceId).toBe("original-section");
  validateCanonicalLayoutIR(canonical);
  semantic.sectionSourceId = "wrong-section";
  expect(() => validateLayoutIR(ir)).toThrowError(/Semantic page\/section mismatch/);
});
