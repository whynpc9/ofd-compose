// Explicit maintenance command only: build first, then inspect the fixture diff.
import { readFile, writeFile } from "node:fs/promises";
import { lineBreakOpportunities, TypographyCore } from "../dist/index.mjs";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("fonts/manifest.json", root), "utf8"));
const cases = JSON.parse(await readFile(new URL("tests/cases.json", root), "utf8"));
const core = new TypographyCore();
const metrics = [];
for (const entry of manifest) {
  metrics.push(core.loadFont(await readFile(new URL(`fonts/${entry.file}`, root)), entry.sha256));
}
const shapes = cases.map(({ name: _name, font, ...input }) =>
  core.shape({ ...input, fontSha256: manifest[font].sha256 }),
);
// These fixture texts also serve as complete paragraphs; real callers must not
// compute this per shaped run when a paragraph spans multiple font/style runs.
const paragraphBreaks = cases.map(({ text }) => lineBreakOpportunities(text));
await writeFile(
  new URL("tests/expected.json", root),
  `${JSON.stringify({ metrics, shapes, paragraphBreaks }, null, 2)}\n`,
);
