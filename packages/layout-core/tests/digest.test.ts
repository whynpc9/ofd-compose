import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalSerialize } from "@ofd-compose/layout-ir";
import { expect, it } from "vitest";
import { layout } from "../src/index.js";
import expected from "./expected.json";
import { fiftyPageDocument, fiftyPageOptions, fonts, narrative, options } from "./fixtures.js";

it("checks the shared IR baseline with independent Node crypto over transported bytes", async () => {
  const { ir } = await layout(narrative(), await fonts(), {
    ...options,
    page: { ...options.page, contentBox: { ...options.page.contentBox, width: 70 } },
  });
  expect(createHash("sha256").update(canonicalSerialize(ir), "utf8").digest("hex")).toBe(
    expected.narrative,
  );
});

import paginationExpected from "./pagination-expected.json";

it("checks the 50-page baseline using independent Node SHA-256", async () => {
  const { ir } = await layout(fiftyPageDocument(), await fonts(), fiftyPageOptions);
  expect(createHash("sha256").update(canonicalSerialize(ir), "utf8").digest("hex")).toBe(
    paginationExpected.fiftyPages,
  );
}, 20000);

it("positions the committed real PNG resource by verified pixel dimensions and digest", async () => {
  const bytes = await readFile(
    new URL(
      "../../../tests/golden-corpus/library/docx-tests/12-real-png-scaling/assets/real-chart.png",
      import.meta.url,
    ),
  );
  const pixelWidth = bytes.readUInt32BE(16),
    pixelHeight = bytes.readUInt32BE(20);
  const digest = createHash("sha256").update(bytes).digest("hex");
  expect([pixelWidth, pixelHeight, digest]).toEqual([
    1504,
    1356,
    "8edef45c3d93b5585f31e54f59b0cfe208155534ab1125e682b37d734bf5c8db",
  ]);
  const input = narrative();
  input.settings.page = {
    paper: "A4",
    orientation: "portrait",
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    watermarks: [
      {
        kind: "image",
        resourceId: "chart",
        x: 10,
        y: 20,
        width: 100,
        height: 60,
        opacity: 0.5,
        layer: "behind",
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      },
    ],
  };
  const { ir } = await layout(input, await fonts(), {
    ...options,
    images: [
      { kind: "image", id: "chart", digest, mimeType: "image/png", pixelWidth, pixelHeight },
    ],
  });
  const image = ir.pages[0]?.objects.find((o) => o.kind === "image");
  if (image?.kind !== "image") throw new Error("Missing image");
  expect(1000 * image.transform.a * pixelWidth + image.transform.e).toBeCloseTo(110000, 8);
  expect(1000 * image.transform.d * pixelHeight + image.transform.f).toBeCloseTo(80000, 8);
});
