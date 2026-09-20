import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const output = process.argv[2] ?? ".scratch/issue16-output";
const highLevelEvidence = [];
for (const name of [
  "truetype",
  "cff",
  "combined",
  "geometry",
  "jpeg",
  "logical-display-printable",
  "multi-glyph",
  "nonidentity-contract",
  "duplicate-markers",
  "glyphless",
  "truetype-mapping",
  "cff-mapping",
  "nel-control",
  "visible-image",
  "rtl-wide",
  "rtl-order",
  "rtl-positions",
  "rtl-overlap",
  "spacing-cluster-semantic",
  "spacing-combining-semantic",
  "spacing-cluster",
  "spacing-combining",
  "spacing-semantic-runs",
  "spacing-mixed",
  "spacing-mixed-semantic",
  "spacing-columns",
  "spacing-leading",
  "spacing-trailing",
]) {
  const caseDirectory = name.startsWith("rtl-")
    ? path.join(output, "rtl")
    : name.startsWith("spacing-")
      ? path.join(output, "spacing")
      : output;
  const ir = JSON.parse(
    await fs.readFile(
      name.startsWith("spacing-") ||
        name.startsWith("rtl-") ||
        name.endsWith("-mapping") ||
        ["logical-display-printable", "nel-control", "visible-image"].includes(name)
        ? path.join(caseDirectory, `${name}.ir.json`)
        : `tests/ofd-writer/fixtures/${name}/ir.json`,
      "utf8",
    ),
  );
  const pdf = await getDocument({
    data: new Uint8Array(await fs.readFile(path.join(caseDirectory, `${name}.pdf`))),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  for (let p = 0; p < ir.pages.length; p++) {
    const page = await pdf.getPage(p + 1);
    const textContent = await page.getTextContent({
      disableNormalization: true,
      includeMarkedContent: true,
    });
    const expected = ir.pages[p].objects
      .filter((o) => o.kind === "text")
      .map((o) => o.logicalText)
      .join("");
    const operators = await page.getOperatorList();
    const actual = operators.fnArray
      .flatMap((op, i) =>
        op === OPS.showText
          ? operators.argsArray[i][0].filter((g) => typeof g === "object").map((g) => g.unicode)
          : [],
      )
      .join("");
    assert.equal(actual, expected, `${name} page ${p}`);
    const highLevel = textContent.items
      .filter((item) => "str" in item)
      .map((item) => item.str)
      .join("");
    const classification = "exact";
    assert.equal(highLevel, expected, `${name}: stock high-level text must match literally`);
    highLevelEvidence.push({ case: name, page: p, classification, expected, actual: highLevel });
    const widths = operators.fnArray.flatMap((op, i) =>
      op === OPS.showText
        ? operators.argsArray[i][0].filter((g) => typeof g === "object").map((g) => g.width)
        : [],
    );
    const expectedWidths = ir.pages[p].objects
      .filter((o) => o.kind === "text")
      .flatMap((o) =>
        o.clusters.flatMap((c) =>
          c.glyphIndices.map((i) => (o.glyphs[i].advance.x / o.fontSize) * 1000),
        ),
      );
    assert.equal(widths.length, expectedWidths.length);
    widths.forEach((width, i) => {
      assert.ok(Math.abs(width - expectedWidths[i]) < 1e-8, `${name} glyph ${i} W differs`);
    });
  }
  await pdf.destroy();
  console.log(`${name}: pdf.js exact logical text passed`);
}

await fs.writeFile(
  path.join(output, "pdfjs-high-level.json"),
  `${JSON.stringify(highLevelEvidence, null, 2)}\n`,
);
