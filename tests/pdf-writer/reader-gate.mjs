import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

const output = process.argv[2] ?? ".scratch/issue16-output";
for (const name of [
  "truetype",
  "cff",
  "combined",
  "geometry",
  "jpeg",
  "logical-display",
  "multi-glyph",
  "nonidentity-contract",
  "duplicate-markers",
  "glyphless",
  "truetype-mapping",
  "cff-mapping",
]) {
  const ir = JSON.parse(
    await fs.readFile(
      name.endsWith("-mapping")
        ? path.join(output, `${name}.ir.json`)
        : `tests/ofd-writer/fixtures/${name}/ir.json`,
      "utf8",
    ),
  );
  const pdf = await getDocument({
    data: new Uint8Array(await fs.readFile(path.join(output, `${name}.pdf`))),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  for (let p = 0; p < ir.pages.length; p++) {
    const page = await pdf.getPage(p + 1);
    await page.getTextContent({
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
    const widths = operators.fnArray.flatMap((op, i) =>
      op === OPS.showText
        ? operators.argsArray[i][0].filter((g) => typeof g === "object").map((g) => g.width)
        : [],
    );
    const expectedWidths = ir.pages[p].objects
      .filter((o) => o.kind === "text")
      .flatMap((o) => o.glyphs.map((g) => (g.advance.x / o.fontSize) * 1000));
    assert.equal(widths.length, expectedWidths.length);
    widths.forEach((width, i) => {
      assert.ok(Math.abs(width - expectedWidths[i]) < 1e-8, `${name} glyph ${i} W differs`);
    });
  }
  await pdf.destroy();
  console.log(`${name}: pdf.js exact logical text passed`);
}
