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
]) {
  const ir = JSON.parse(
    await fs.readFile(
      name.endsWith("-mapping") || ["logical-display-printable", "nel-control"].includes(name)
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
    let classification = "exact";
    if (highLevel !== expected) {
      if (["truetype-mapping", "cff-mapping"].includes(name)) {
        assert.equal(expected, "A😀ffi");
        assert.equal(
          highLevel,
          "A 😀 ffi",
          "Only the two positioned cluster separators are allowed",
        );
        classification = "positioned-cluster-separators:2";
      } else if (["combined", "jpeg"].includes(name)) {
        const boundaries = new Set();
        let offset = 0;
        for (const object of ir.pages[p].objects.filter((o) => o.kind === "text")) {
          offset += object.logicalText.length;
          boundaries.add(offset);
        }
        const consumed = new Set();
        let source = 0;
        let inserted = 0;
        for (const character of highLevel) {
          if (expected.startsWith(character, source)) source += character.length;
          else {
            assert.equal(character, " ", "Only an ASCII separator may be synthesized");
            assert.ok(boundaries.has(source), "Separator must be at an IR object boundary");
            assert.ok(!consumed.has(source), "At most one separator per boundary");
            consumed.add(source);
            assert.ok(source > 0 && source < expected.length);
            assert.ok(
              !/\s/u.test(expected[source - 1]) && !/\s/u.test(expected[source]),
              "Real source whitespace cannot be rewritten",
            );
            inserted++;
          }
        }
        assert.equal(source, expected.length, "High-level text dropped source characters");
        classification = `object-boundary-separators:${inserted}`;
      } else assert.equal(highLevel, expected, `${name}: continuous text must extract exactly`);
    }
    highLevelEvidence.push({ case: name, page: p, classification, expected, actual: highLevel });
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

await fs.writeFile(
  path.join(output, "pdfjs-high-level.json"),
  `${JSON.stringify(highLevelEvidence, null, 2)}\n`,
);
