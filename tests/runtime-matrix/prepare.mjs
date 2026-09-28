// Run with Node 24 --experimental-transform-types. Only preparation uses a TS parser.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isExecutableTemplate, templateFromText } from "../golden-corpus/src/corpus-template.ts";

const out = resolve(process.argv[2] ?? ".scratch/issue18-output/input");
await mkdir(out, { recursive: true });
const read = async (path) => JSON.parse(await readFile(path, "utf8"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const baseline = await read("tests/ofd-writer/fixtures/combined-input.json");
const profile = baseline.profile;
const labels = {
  "docx-tests/09-inline-image-data-uri": ["Report logo"],
  "docx-tests/10-block-image-centered": [],
  "docx-tests/11-images-in-loop": [],
  "docx-tests/12-real-png-scaling": ["File path image", "Data URI image", "Fit box image"],
  "docx-tests/13-barcodes-code128-ean13": ["Code128", "EAN13 centered"],
  "docx-tests/14-barcodes-upca-itf": [],
  "examples/06-images": ["Inline logo", "Gallery"],
  "examples/11-images-file-and-datauri-scaling": [
    "图片（文件路径 + maxWidth 等比缩放）",
    "图片（data URI + scale 等比缩放）",
    "图片（在固定宽高盒子中等比缩放，不拉伸变形）",
  ],
  "examples/12-barcodes": ["Code128 条形码（由模板参数指定类型和尺寸）", "EAN13 条形码（居中）"],
};
const negative = new Set([
  "docx-tests/09-inline-image-data-uri",
  "docx-tests/10-block-image-centered",
  "docx-tests/11-images-in-loop",
  "examples/06-images",
  "docx-tests/14-barcodes-upca-itf",
]);
const paragraph = (text, id) => ({
  kind: "paragraph",
  nodeId: id,
  inlines: [{ kind: "text", nodeId: `${id}-text`, text }],
});
const baseSource = (id, body) => ({
  schemaVersion: "ofd-compose/document-model@0",
  documentId: id,
  revisionId: "1",
  settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
  styles: {},
  body,
});
const cases = [];
const inputs = {};
for await (const path of glob("tests/golden-corpus/library/**/case.json")) {
  const dir = dirname(path);
  const name = dir.replace("tests/golden-corpus/library/", "");
  const manifest = await read(path),
    originalData = await read(`${dir}/data.json`),
    expected = await read(`${dir}/expected/semantics.json`);
  const text = Object.hasOwn(labels, name)
    ? undefined
    : await readFile(`${dir}/template.txt`, "utf8");
  for (const file of [
    path,
    `${dir}/data.json`,
    `${dir}/expected/semantics.json`,
    ...(text === undefined ? [] : [`${dir}/template.txt`]),
  ])
    inputs[file] = hash(await readFile(file));
  let source,
    data = originalData;
  const images = [];
  if (text !== undefined && isExecutableTemplate(text))
    source = templateFromText(text, {
      documentId: manifest.caseId,
      bindingPolicyVersion: manifest.nativeProfile.bindingPolicyVersion,
    });
  else {
    assert.ok(Object.hasOwn(labels, name), `Unaccounted media case ${name}`);
    const blocks = labels[name].map((text, i) => paragraph(text, `label${i}`));
    data = {};
    const descriptors = [];
    for (const value of Object.values(originalData)) {
      if (Array.isArray(value)) for (const item of value) descriptors.push(item.photo);
      else if (value && typeof value === "object" && "src" in value) descriptors.push(value);
    }
    const encoded = descriptors.find((d) => d.src.startsWith("data:"))?.src;
    for (const [i, { src, ...options }] of descriptors.entries()) {
      const id = `image${i}`;
      if (src.startsWith("assets/")) {
        const bytes = await readFile(`${dir}/${src}`);
        assert.ok(encoded);
        assert.equal(
          hash(bytes),
          hash(Buffer.from(encoded.slice(encoded.indexOf(",") + 1), "base64")),
        );
        images.push({ id, base64: bytes.toString("base64"), sha256: hash(bytes) });
        inputs[`${dir}/${src}`] = hash(bytes);
        data[id] = { resourceId: id };
      } else data[id] = src;
      blocks.push({
        kind: "image-binding",
        nodeId: id,
        bindingId: `b${id}`,
        expression: { kind: "legacy", text: id },
        options: { ...options, legacyPixelDpi: 96 },
      });
    }
    if (originalData.barcodes)
      for (const [i, [symbology, value]] of Object.entries(originalData.barcodes).entries()) {
        data[`barcode${i}`] = value;
        blocks.push({
          kind: "barcode-binding",
          nodeId: `barcode${i}`,
          bindingId: `bb${i}`,
          expression: { kind: "legacy", text: `barcode${i}` },
          options: { symbology, width: 95.25, height: 26.458333 },
        });
      }
    source = baseSource(manifest.caseId, blocks);
  }
  cases.push({
    id: name,
    kind: "library",
    source,
    data,
    profile,
    images,
    fontIndex: 0,
    expected: negative.has(name)
      ? {
          code: "MODEL_INVALID",
          message: name.endsWith("14-barcodes-upca-itf") ? "Expected union" : "CRC mismatch",
        }
      : {
          text:
            (expected.paragraphs ?? []).join("") +
            (expected.tables ?? []).flatMap((t) => t.rows.flat()).join(""),
          images: expected.media ?? [],
          barcodes: expected.barcodes?.length ?? 0,
        },
  });
}
assert.equal(cases.length, 28);
assert.equal(cases.filter((c) => c.expected.code).length, 5);
for (const pages of [1, 50]) {
  const body = Array.from({ length: pages }, (_, i) => ({
    ...paragraph(`第${i + 1}页 中文 office 2026`, `p${i}`),
    layout: { pageBreakBefore: i > 0 },
  }));
  cases.push({
    id: `synthetic-${pages}-page`,
    kind: "benchmark",
    source: baseSource(`synthetic-${pages}`, body),
    data: {},
    profile,
    images: [],
    fontIndex: 0,
    expected: { pages },
  });
}
const table = {
  kind: "table",
  nodeId: "table",
  layout: { columns: [{ kind: "fixed", value: 170 }], headerRows: 0 },
  rows: [
    {
      kind: "repeat-row-group",
      nodeId: "repeat",
      bindingId: "repeat-binding",
      expression: { kind: "legacy", text: "rows" },
      repeatKey: { kind: "ordinal", orderDependentIdentity: true },
      rows: [
        {
          kind: "table-row",
          nodeId: "row",
          layout: { height: 20, heightMode: "fixed" },
          cells: [
            {
              kind: "table-cell",
              nodeId: "cell",
              blocks: [
                {
                  kind: "paragraph",
                  nodeId: "p",
                  inlines: [
                    {
                      kind: "dynamic-text",
                      nodeId: "text",
                      bindingId: "value",
                      expression: { kind: "legacy", text: "name" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
cases.push({
  id: "synthetic-6000-row",
  kind: "benchmark",
  source: baseSource("synthetic-long-table", [table]),
  data: { rows: Array.from({ length: 6000 }, (_, i) => ({ name: `机构${i}` })) },
  profile,
  images: [],
  fontIndex: 0,
  expected: {
    code: "RESOURCE_LIMIT",
    message: "JSON properties exceed budget",
    intendedPages: 500,
    intendedTableCells: 6000,
  },
});
const supportedTable = structuredClone(cases.at(-1));
supportedTable.id = "synthetic-1000-row";
supportedTable.source.documentId = "synthetic-1000-row";
supportedTable.data.rows = supportedTable.data.rows.slice(0, 1000);
supportedTable.expected = { pages: 84, tableCells: 1000 };
cases.push(supportedTable);
const png = await readFile("tests/pdf-writer/fixtures/visible-rgba.png");
for (const [id, fontIndex] of [
  ["reader-cff", 0],
  ["reader-ttf", 2],
]) {
  const source = structuredClone(baseline.source);
  source.body = [
    paragraph("中文 office é 2026", "reader-text"),
    {
      ...table,
      border: { width: 0.2, color: "#000000" },
      rows: [
        {
          kind: "table-row",
          nodeId: "reader-row",
          cells: [
            {
              kind: "table-cell",
              nodeId: "reader-cell",
              blocks: [paragraph("边框 Border", "border-text")],
            },
          ],
        },
      ],
    },
    {
      kind: "image-binding",
      nodeId: "reader-image",
      bindingId: "image",
      expression: { kind: "legacy", text: "picture" },
      options: { width: "20mm" },
    },
  ];
  cases.push({
    id,
    kind: "reader",
    source,
    data: { picture: { resourceId: "picture" } },
    profile,
    images: [{ id: "picture", sha256: hash(png), base64: png.toString("base64") }],
    fontIndex,
    expected: { pages: 1, readerRegions: true },
  });
}
cases.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
await writeFile(
  `${out}/corpus.json`,
  `${JSON.stringify({ schema: "ofd-compose/runtime-matrix-input@1", provenance: "library native reconstructions and synthetic scale; no host business data", inputs: Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))), cases }, null, 2)}\n`,
);
console.log(
  `${cases.length} cases (28 library, 4 synthetic benchmark, 2 reader), 6 expected negatives`,
);
