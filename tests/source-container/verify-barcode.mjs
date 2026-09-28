import assert from "node:assert/strict";
import {
  numberingAlgorithmVersion,
  numberingLabel,
} from "../../packages/layout-core/dist/index.mjs";
import { canonicalSerialize } from "../../packages/layout-ir/dist/index.mjs";
import { barcode, barcodeGeneratorVersion } from "../../packages/media-core/dist/index.mjs";

// Test-host bridge only. The .NET library never launches a process or resolves a path.
const chunks = [];
let length = 0;
for await (const chunk of process.stdin) {
  length += chunk.length;
  assert.ok(length <= 16 * 1024 * 1024);
  chunks.push(chunk);
}
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
if (request.algorithmVersion) {
  assert.equal(request.algorithmVersion, numberingAlgorithmVersion);
  const counts = new Map(),
    starts = new Set();
  process.stdout.write(
    canonicalSerialize(
      request.paragraphs.map((paragraph) => numberingLabel(paragraph, counts, starts)),
    ),
  );
} else {
  assert.ok(length <= 16384);
  assert.equal(request.generatorVersion, barcodeGeneratorVersion);
  process.stdout.write(canonicalSerialize(barcode(request.value, request.options).path.commands));
}
