import { expect, it, vi } from "vitest";
import { fixtureFactories } from "../fixtures/index.js";
import { validateLayoutIR } from "../src/index.js";

// This is an operation-count regression, not a wall-clock benchmark. Shared CI runners
// need headroom for the full 100k fixture while other package suites execute.
it("validates a large target once rather than once per fragment source range", () => {
  const ir = fixtureFactories.text();
  const target = ir.pages[0]?.objects[0];
  const semantic = ir.semantics[0];
  if (target?.kind !== "text" || !semantic) throw new Error("Missing fixture");
  const long = "A".repeat(100000);
  target.logicalText = long;
  target.displayText = "";
  target.glyphs = [];
  target.clusters = [];
  semantic.sourceRanges = Array.from({ length: 100000 }, (_, index) => ({
    nodeId: `source${index}`,
    sourceText: { text: "A", range: { start: 0, end: 1 } },
    logicalRange: { start: index, end: index + 1 },
  }));
  const original = String.prototype.isWellFormed;
  let targetChecks = 0;
  const spy = vi.spyOn(String.prototype, "isWellFormed").mockImplementation(function (
    this: string,
  ) {
    if (String(this) === long) targetChecks++;
    return original.call(this);
  });
  try {
    validateLayoutIR(ir);
    expect(targetChecks).toBe(1);
  } finally {
    spy.mockRestore();
  }
}, 30000);
