// Contract geometry cases derived explicitly from genuine Worker subsets/glyphs.
// These are not claimed to be unmodified Worker output; identity changes with derivation.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalSerialize, validateCanonicalLayoutIR } from "@ofd-compose/layout-ir";

const root = new URL("../../../tests/ofd-writer/fixtures/", import.meta.url);
const base = JSON.parse(await readFile(new URL("cff/ir.json", root), "utf8"));
const manifest = JSON.parse(await readFile(new URL("cff/manifest.json", root), "utf8"));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const ir = structuredClone(base);
ir.identity.inputDigest = hash(`issue15-geometry-v1:${manifest.identity.irDigest}`);
for (const state of ir.graphicsStates) {
  state.transform = { a: 0.812345678, b: 0.300004, c: -0.2123456, d: 1.112345, e: 7000, f: 11000 };
  state.opacity = 0.5;
  state.dash = [1000, 500];
  state.dashOffset = 250;
  state.lineCap = "round";
  state.lineJoin = "bevel";
  state.clip = {
    coordinateSpace: "local",
    fillRule: "evenodd",
    commands: [
      { op: "move", x: 0, y: 0 },
      { op: "line", x: 190000, y: 0 },
      { op: "line", x: 190000, y: 270000 },
      { op: "close" },
    ],
  };
}
for (const page of ir.pages) {
  for (const [index, obj] of page.objects.entries()) {
    obj.direction = "ttb";
    obj.baseline = { x: 123000, y: 234000 };
    for (const [g, glyph] of obj.glyphs.entries()) {
      glyph.position = { x: 20000 + index * 10000, y: 20000 + g * 5000 };
      glyph.offset = { x: 301, y: -203 };
      glyph.advance = { x: 0, y: 5000 };
    }
  }
  for (const space of ["local", "page"]) {
    const index = page.objects.length;
    page.objects.push({
      id: `p0o${index}`,
      drawOrder: index,
      stateId: "s0",
      bounds: { x: 10000, y: 10000, width: 30000, height: 20000 },
      kind: "path",
      coordinateSpace: space,
      commands: [
        { op: "move", x: 10000, y: 10000 },
        { op: "cubic", x1: 20000, y1: 5000, x2: 25000, y2: 30000, x: 40000, y: 30000 },
        { op: "line", x: 10000, y: 10000 },
        { op: "close" },
      ],
      fillRule: "evenodd",
      fill: true,
      stroke: true,
    });
  }
}
const combinedIr = JSON.parse(await readFile(new URL("combined/ir.json", root), "utf8"));
const combinedManifest = JSON.parse(
  await readFile(new URL("combined/manifest.json", root), "utf8"),
);
const imageResource = combinedIr.resources.find((r) => r.kind === "image");
ir.resources[0].id = "r1";
for (const obj of ir.pages[0].objects) if (obj.kind === "text") obj.fontId = "r1";
ir.resources.unshift({ ...imageResource, id: "r0" });
const imageIndex = ir.pages[0].objects.length;
ir.pages[0].objects.push({
  id: `p0o${imageIndex}`,
  drawOrder: imageIndex,
  stateId: "s0",
  kind: "image",
  resourceId: "r0",
  bounds: { x: 10000, y: 10000, width: 10000, height: 10000 },
  transform: { a: 5.123456789, b: 0.000000123, c: -0.001, d: 7.12345, e: 20000, f: 22000 },
  clip: {
    coordinateSpace: "local",
    fillRule: "nonzero",
    commands: [
      { op: "move", x: 0, y: 0 },
      { op: "line", x: 750, y: 0 },
      { op: "line", x: 750, y: 750 },
      { op: "close" },
    ],
  },
});
const geometryResources = [
  {
    ...combinedManifest.resources.find((r) => r.resourceId === imageResource.id),
    resourceId: "r0",
    file: "r0.bin",
  },
  { ...manifest.resources[0], resourceId: "r1", file: "r1.bin" },
];
validateCanonicalLayoutIR(ir);
const target = new URL("geometry/", root);
await mkdir(target, { recursive: true });
await writeFile(new URL("ir.json", target), canonicalSerialize(ir));
await copyFile(
  new URL(
    `combined/${combinedManifest.resources.find((r) => r.resourceId === imageResource.id).file}`,
    root,
  ),
  new URL("r0.bin", target),
);
await copyFile(new URL(`cff/${manifest.resources[0].file}`, root), new URL("r1.bin", target));
await writeFile(
  new URL("manifest.json", target),
  `${JSON.stringify(
    {
      fixtureDerivation: "issue15-geometry-v1",
      workerBaseIrDigest: manifest.identity.irDigest,
      irDigest: hash(canonicalSerialize(ir)),
      resources: geometryResources,
    },
    null,
    2,
  )}\n`,
);
for (const [name, baseName, change] of [
  [
    "logical-display",
    "cff",
    (x) => {
      x.pages[0].objects[0].logicalText = "\r\n<&>\"'abc";
    },
  ],
  [
    "glyphless-logical",
    "glyphless",
    (x) => {
      x.pages[0].objects[0].logicalText = "Logical only";
    },
  ],
]) {
  const original = JSON.parse(await readFile(new URL(`${baseName}/ir.json`, root), "utf8"));
  const originalManifest = JSON.parse(
    await readFile(new URL(`${baseName}/manifest.json`, root), "utf8"),
  );
  change(original);
  original.identity.inputDigest = hash(`${name}:${originalManifest.identity.irDigest}`);
  validateCanonicalLayoutIR(original);
  const directory = new URL(`${name}/`, root);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL("ir.json", directory), canonicalSerialize(original));
  for (const r of originalManifest.resources)
    await copyFile(new URL(`${baseName}/${r.file}`, root), new URL(r.file, directory));
  await writeFile(
    new URL("manifest.json", directory),
    `${JSON.stringify(
      {
        fixtureDerivation: name,
        workerBaseIrDigest: originalManifest.identity.irDigest,
        irDigest: hash(canonicalSerialize(original)),
        resources: originalManifest.resources,
      },
      null,
      2,
    )}\n`,
  );
}
