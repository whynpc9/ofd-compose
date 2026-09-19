import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { getDocument, OPS, version } from "pdfjs-dist/legacy/build/pdf.mjs";

const expected = JSON.parse(await fs.readFile("tests/pdf-writer/accepted-whitespace.json", "utf8"));
assert.equal(version, expected.pdfjsVersion);
const source = await fs.readFile(
  "tests/pdf-writer/fixtures/whitespace-reader/worker-double/ir.json",
);
assert.equal(createHash("sha256").update(source).digest("hex"), expected.irSha256);
const ir = JSON.parse(source);
assert.equal(ir.pages.length, 1);
const objects = ir.pages[0].objects.filter((object) => object.kind === "text");
assert.equal(objects.map((object) => object.logicalText).join(""), expected.logicalText);
assert.equal(objects.map((object) => object.displayText).join(""), expected.displayText);
const pdf = await getDocument({
  data: new Uint8Array(
    await fs.readFile(
      `${process.argv[2] ?? ".scratch/issue16-output"}/accepted-whitespace/worker-double.pdf`,
    ),
  ),
  useSystemFonts: false,
  isEvalSupported: false,
}).promise;
const page = await pdf.getPage(1);
const operators = await page.getOperatorList();
const glyphs = operators.fnArray.flatMap((op, i) =>
  op === OPS.showText ? operators.argsArray[i][0].filter((glyph) => typeof glyph === "object") : [],
);
assert.equal(glyphs.length, expected.glyphCount);
assert.equal(glyphs.map((glyph) => glyph.unicode).join(""), expected.toUnicodeText);
const widths = objects.flatMap((object) =>
  object.clusters.flatMap((cluster) =>
    cluster.glyphIndices.map((i) => (object.glyphs[i].advance.x / object.fontSize) * 1000),
  ),
);
glyphs.forEach((glyph, i) => {
  assert.ok(Math.abs(glyph.width - widths[i]) < 1e-8);
});
const text = (await page.getTextContent({ disableNormalization: true })).items
  .filter((item) => "str" in item)
  .map((item) => item.str)
  .join("");
assert.equal(text, expected.highLevelText);
await pdf.destroy();
console.log(
  "worker-double: exact source/ToUnicode/widths; only pinned high-level o  f -> o f accepted",
);
