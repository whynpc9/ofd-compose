import { createHash } from "node:crypto";
import { canonicalSerialize } from "@ofd-compose/layout-ir";
import { expect, it } from "vitest";
import { layout } from "../src/index.js";
import expected from "./expected.json";
import { fonts, narrative, options } from "./fixtures.js";

it("checks the shared IR baseline with independent Node crypto over transported bytes", async () => {
  const { ir } = await layout(narrative(), await fonts(), {
    ...options,
    page: { ...options.page, contentBox: { ...options.page.contentBox, width: 70 } },
  });
  expect(createHash("sha256").update(canonicalSerialize(ir), "utf8").digest("hex")).toBe(
    expected.narrative,
  );
});
