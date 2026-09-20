import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { SourceContentWireSchema } from "../src/index.js";

it("keeps the container wire schema derived from its TypeBox contract", async () => {
  const generated = JSON.parse(
    await readFile(
      new URL("../../../schemas/containers/source-content.schema.json", import.meta.url),
      "utf8",
    ),
  );
  expect(generated).toEqual({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...JSON.parse(JSON.stringify(SourceContentWireSchema)),
  });
});
