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
  LayoutIdentityInputSchema,
  LayoutIRSchema,
  serializeLayoutIR,
} from "../src/index.js";

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
  await expect(`${JSON.stringify(expected, null, 2)}\n`).toMatchFileSnapshot(
    path.join(root, "packages/layout-ir/tests/expected.json"),
  );
  expect(
    createHash("sha256")
      .update(canonicalSerialize({ a: "😀", b: 1e-7 }))
      .digest("hex"),
  ).toHaveLength(64);
});
