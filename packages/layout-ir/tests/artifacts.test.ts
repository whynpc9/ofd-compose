import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { fixtureFactories, identityFixture } from "../fixtures/index.js";
import {
  CanonicalLayoutIRSchema,
  canonicalizeLayoutIR,
  canonicalSerialize,
  digestLayoutIdentity,
  digestLayoutIR,
  digestSemanticDocument,
  LayoutIdentityInputSchema,
  LayoutIRSchema,
  serializeLayoutIR,
} from "../src/index.js";

import { boundDocumentFixture } from "./bound-document.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
for (const [name, schema] of Object.entries({
  "layout-ir": LayoutIRSchema,
  "canonical-layout-ir": CanonicalLayoutIRSchema,
  "layout-identity-input": LayoutIdentityInputSchema,
})) {
  it(`${name} exports a valid, current JSON Schema 2020-12`, async () => {
    const document = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...JSON.parse(JSON.stringify(schema)),
    };
    const ajv = new Ajv2020({ strict: true, strictRequired: false });
    ajv.addKeyword("x-unit");
    const validate = ajv.compile(document);
    const sample =
      name === "layout-identity-input"
        ? identityFixture
        : name === "canonical-layout-ir"
          ? canonicalizeLayoutIR(fixtureFactories.text())
          : fixtureFactories.text();
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
    await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot(
      path.join(root, `schemas/layout-ir/${name}.schema.json`),
    );
  });
}
it("publishes writer fixtures and independent Node SHA-256 baselines", async () => {
  const expected: Record<string, string> = {};
  for (const [name, factory] of Object.entries(fixtureFactories)) {
    const input = factory(),
      serialized = serializeLayoutIR(input);
    expected[name] = createHash("sha256").update(serialized, "utf8").digest("hex");
    expect(digestLayoutIR(input)).toBe(expected[name]);
    await expect(`${JSON.stringify(input, null, 2)}\n`).toMatchFileSnapshot(
      path.join(root, `packages/layout-ir/fixtures/${name}.mm.json`),
    );
    await expect(`${serialized}\n`).toMatchFileSnapshot(
      path.join(root, `packages/layout-ir/fixtures/${name}.canonical.json`),
    );
  }
  expected.identity = digestLayoutIdentity(identityFixture);
  expected.boundDocument = digestSemanticDocument(boundDocumentFixture());
  expected.boundIdentity = digestLayoutIdentity({
    ...identityFixture,
    resolvedDocumentDigest: expected.boundDocument,
  });
  await expect(`${JSON.stringify(expected, null, 2)}\n`).toMatchFileSnapshot(
    path.join(root, "packages/layout-ir/tests/expected.json"),
  );
  expect(
    createHash("sha256")
      .update(canonicalSerialize({ a: "😀", b: 1e-7 }))
      .digest("hex"),
  ).toHaveLength(64);
});
it("exported schema rejects unrecognized OpenType tags independently of TypeBox", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addKeyword("x-unit");
  const validate = ajv.compile(JSON.parse(JSON.stringify(LayoutIRSchema)));
  const input = fixtureFactories.text();
  const font = input.resources.find((resource) => resource.kind === "font");
  if (font?.kind !== "font") throw new Error("Missing fixture font");
  font.features.invalidFeature = 1;
  expect(validate(input)).toBe(false);
});
it("exported schemas preserve vertical directions and enforce uint32 OpenType values", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addKeyword("x-unit");
  for (const schema of [LayoutIRSchema, CanonicalLayoutIRSchema]) {
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const input =
      schema === LayoutIRSchema
        ? fixtureFactories.text()
        : canonicalizeLayoutIR(fixtureFactories.text());
    const text = input.pages[0]?.objects[0];
    const font = input.resources.find((resource) => resource.kind === "font");
    if (text?.kind !== "text" || font?.kind !== "font")
      throw new Error("Missing fixture resources");
    font.features.liga = 0xffffffff;
    for (const direction of ["ttb", "btt"] as const) {
      text.direction = direction;
      expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    }
    font.features.liga = 0x100000000;
    expect(validate(input)).toBe(false);
  }
});
it("exported schemas enforce the shaper language syntax", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addKeyword("x-unit");
  for (const schema of [LayoutIRSchema, CanonicalLayoutIRSchema]) {
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const input =
      schema === LayoutIRSchema
        ? fixtureFactories.text()
        : canonicalizeLayoutIR(fixtureFactories.text());
    const text = input.pages[0]?.objects[0];
    if (text?.kind !== "text") throw new Error("Missing fixture text");
    for (const language of ["en_US", "en US", "a--b"]) {
      text.language = language;
      expect(validate(input)).toBe(false);
    }
    text.language = "zh-Hans-CN";
    expect(validate(input)).toBe(true);
  }
});
it("both exported schemas reject nonempty all-zero dash cycles", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addKeyword("x-unit");
  for (const schema of [LayoutIRSchema, CanonicalLayoutIRSchema]) {
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const input =
      schema === LayoutIRSchema
        ? fixtureFactories.text()
        : canonicalizeLayoutIR(fixtureFactories.text());
    const state = input.graphicsStates[0];
    if (!state) throw new Error("Missing fixture state");
    for (const dash of [[], [0, 1], [1, 0]]) {
      state.dash = dash;
      expect(validate(input)).toBe(true);
    }
    state.dash = [0, 0];
    expect(validate(input)).toBe(false);
  }
});

it("exported current-profile schemas require empty variation coordinates", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addKeyword("x-unit");
  for (const schema of [LayoutIRSchema, CanonicalLayoutIRSchema]) {
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const input =
      schema === LayoutIRSchema
        ? fixtureFactories.text()
        : canonicalizeLayoutIR(fixtureFactories.text());
    expect(validate(input)).toBe(true);
    const font = input.resources.find((resource) => resource.kind === "font");
    if (font?.kind !== "font") throw new Error("Missing fixture font");
    font.variations.wght = 400;
    expect(validate(input)).toBe(false);
  }
});
it("exported schemas bound glyph IDs and subset map IDs to uint32", () => {
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addKeyword("x-unit");
  for (const schema of [LayoutIRSchema, CanonicalLayoutIRSchema]) {
    const validate = ajv.compile(JSON.parse(JSON.stringify(schema)));
    const input =
      schema === LayoutIRSchema
        ? fixtureFactories.text()
        : canonicalizeLayoutIR(fixtureFactories.text());
    const text = input.pages[0]?.objects[0];
    const font = input.resources.find((resource) => resource.kind === "font");
    if (text?.kind !== "text" || font?.kind !== "font")
      throw new Error("Missing fixture font/text");
    const glyph = text.glyphs[0];
    if (!glyph) throw new Error("Missing fixture glyph");
    font.subsetDigest = "c".repeat(64);
    font.glyphIdMap = [{ original: 0xffffffff, subset: 0xffffffff }];
    glyph.glyphId = 0xffffffff;
    expect(validate(input)).toBe(true);
    const map = font.glyphIdMap[0];
    if (!map) throw new Error("Missing fixture mapping");
    for (const field of ["glyphId", "original", "subset"] as const) {
      if (field === "glyphId") glyph.glyphId = 0x100000000;
      else map[field] = 0x100000000;
      expect(validate(input)).toBe(false);
      glyph.glyphId = 0xffffffff;
      map.original = 0xffffffff;
      map.subset = 0xffffffff;
    }
  }
});
