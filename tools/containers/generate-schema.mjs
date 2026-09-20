import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { SourceContentWireSchema } from "../../packages/source-protocol/dist/index.mjs";

const output = fileURLToPath(
  new URL("../../schemas/containers/source-content.schema.json", import.meta.url),
);
await writeFile(
  output,
  `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", ...SourceContentWireSchema }, null, 2)}\n`,
);
execFileSync(fileURLToPath(new URL("../../node_modules/.bin/biome", import.meta.url)), [
  "format",
  "--write",
  output,
]);
