import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { SourceContentWireSchema, SourceReplayIdentityWireSchema } from "../src/index.js";

it("keeps the container wire schemas derived from their TypeBox contracts", async () => {
  for (const [name, schema] of Object.entries({
    "source-content": SourceContentWireSchema,
    "replay-identity": SourceReplayIdentityWireSchema,
  })) {
    const generated = JSON.parse(
      await readFile(
        new URL(`../../../schemas/containers/${name}.schema.json`, import.meta.url),
        "utf8",
      ),
    );
    expect(generated).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...JSON.parse(JSON.stringify(schema)),
    });
  }
});
