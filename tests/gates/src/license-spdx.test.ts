import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowed, normalize } from "../../../tools/license-check/check-licenses.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

async function loadAllowed(): Promise<Set<string>> {
  const raw = JSON.parse(
    await readFile(path.join(repoRoot, "tools/license-check/allowed-licenses.json"), "utf8"),
  ) as string[];
  return new Set(raw.map(normalize));
}

describe("SPDX expression evaluation", () => {
  it("accepts a single whitelisted license", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("MIT", allowed)).toBe(true);
    expect(isAllowed("Apache-2.0", allowed)).toBe(true);
  });

  it("rejects a single non-whitelisted license", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("GPL-3.0-only", allowed)).toBe(false);
  });

  it("accepts an OR expression when any side is allowed", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("MIT OR GPL-3.0-only", allowed)).toBe(true);
  });

  it("rejects an AND expression when any side is disallowed", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("MIT AND GPL-3.0-only", allowed)).toBe(false);
  });

  it("honours parentheses: (MIT OR GPL) AND GPL stays rejected", async () => {
    const allowed = await loadAllowed();
    // A naive split-on-OR accepts this via the "(MIT" fragment; GPL is a mandatory conjunct.
    expect(isAllowed("(MIT OR GPL-3.0-only) AND GPL-3.0-only", allowed)).toBe(false);
  });

  it("honours parentheses: (MIT OR GPL) AND Apache-2.0 is accepted", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("(MIT OR GPL-3.0-only) AND Apache-2.0", allowed)).toBe(true);
  });

  it("binds AND tighter than OR without parentheses", async () => {
    const allowed = await loadAllowed();
    // Parses as GPL-3.0-only OR (MIT AND Apache-2.0) → allowed.
    expect(isAllowed("GPL-3.0-only OR MIT AND Apache-2.0", allowed)).toBe(true);
  });

  it("treats WITH exceptions as part of the license and fails closed", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("Apache-2.0 WITH LLVM-exception", allowed)).toBe(false);
  });

  it("fails closed on malformed expressions", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("((MIT", allowed)).toBe(false);
    expect(isAllowed("MIT OR", allowed)).toBe(false);
    expect(isAllowed("", allowed)).toBe(false);
    expect(isAllowed("MIT AND (Apache-2.0 OR)", allowed)).toBe(false);
  });

  it("canonicalizes only whitelisted BSD variants", async () => {
    const allowed = await loadAllowed();
    expect(isAllowed("BSD-2-Clause", allowed)).toBe(true);
    expect(isAllowed("0BSD", allowed)).toBe(true);
    // Valid SPDX but not whitelisted: must not collapse into the allowed "bsd" bucket.
    expect(isAllowed("BSD-4-Clause", allowed)).toBe(false);
  });
});
