import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalSerialize } from "../../packages/layout-ir/dist/index.mjs";
import { finalizeSource, render } from "../../packages/render-worker/dist/index.mjs";

const [mode, output, sourceFile] = process.argv.slice(2);
const fontManifest = JSON.parse(
  await readFile(new URL("../../packages/typography-core/fonts/manifest.json", import.meta.url)),
);
const font = fontManifest[0];
const full = new Uint8Array(
  await readFile(new URL(`../../packages/typography-core/fonts/${font.file}`, import.meta.url)),
);
const wasm = new Uint8Array(
  await readFile(
    new URL(
      "../../packages/render-worker/node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm",
      import.meta.url,
    ),
  ),
);
const pack = {
  fonts: [
    {
      family: "Noto",
      weight: 400,
      italic: false,
      sha256: font.sha256,
      byteLength: full.length,
      bytes: full,
    },
  ],
  subsetWasm: { byteLength: wasm.length, bytes: wasm },
};
const profile = {
  version: "ofd-compose/render@0",
  layout: {
    page: { width: 210, height: 297, contentBox: { x: 20, y: 20, width: 170, height: 257 } },
    defaultStyle: { fontFamily: "Noto", fontSize: 12 },
    formattingPolicy: {
      version: "binding-1",
      locale: "zh-CN",
      timeZone: "UTC",
      tzdataVersion: "2026a",
      rounding: "half-up",
    },
  },
};
let result;
if (mode === "combined" || mode === "two-images") {
  const fixture = JSON.parse(
    await readFile(new URL("../ofd-writer/fixtures/combined-input.json", import.meta.url)),
  );
  const bytes = new Uint8Array(
    JSON.parse(
      await readFile(
        new URL("../../packages/render-worker/tests/node-image.json", import.meta.url),
      ),
    ),
  );
  pack.images = [
    {
      id: "picture",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteLength: bytes.length,
      bytes,
    },
  ];
  if (mode === "two-images") {
    const corpus = JSON.parse(
      await readFile(new URL("../../packages/media-core/tests/fixtures.json", import.meta.url)),
    );
    const second = new Uint8Array(Buffer.from(corpus.jpeg, "base64"));
    pack.images.push({
      id: "second",
      sha256: createHash("sha256").update(second).digest("hex"),
      byteLength: second.length,
      bytes: second,
    });
    fixture.source.body = fixture.source.body.filter((b) => b.kind === "image-binding");
    fixture.source.body.push({
      ...fixture.source.body[0],
      nodeId: "second-image",
      bindingId: "second-binding",
      expression: { kind: "legacy", text: "secondImage" },
    });
    fixture.data.secondImage = { resourceId: "second" };
  }
  result = await render(fixture.source, fixture.data, pack, fixture.profile, {
    sourceAttachment: true,
  });
} else if (
  mode === "initial" ||
  mode === "empty-paragraph" ||
  mode === "two-fonts" ||
  mode === "watermarks" ||
  mode.startsWith("checkbox-")
) {
  const source = {
    schemaVersion: "ofd-compose/document-model@0",
    documentId: "source-roundtrip",
    revisionId: "revision-1",
    settings: { locale: "zh-CN", timeZone: "UTC", bindingPolicyVersion: "strict-1" },
    styles: { unused: { fontFamily: "UNUSED_STYLE_SECRET" } },
    provenance: { source: "native", templateId: "DEBUG_SECRET" },
    body: [
      {
        kind: "paragraph",
        nodeId: "p",
        inlines: [
          {
            kind: "dynamic-text",
            nodeId: "t",
            bindingId: "printed",
            expression: { kind: "legacy", text: "visible" },
          },
        ],
      },
    ],
  };
  if (mode === "watermarks") {
    const png = new Uint8Array(
      JSON.parse(
        await readFile(
          new URL("../../packages/render-worker/tests/node-image.json", import.meta.url),
        ),
      ),
    );
    const corpus = JSON.parse(
      await readFile(new URL("../../packages/media-core/tests/fixtures.json", import.meta.url)),
    );
    const jpeg = new Uint8Array(Buffer.from(corpus.jpeg, "base64"));
    pack.images = [
      {
        id: "first",
        sha256: createHash("sha256").update(png).digest("hex"),
        byteLength: png.length,
        bytes: png,
      },
      {
        id: "second",
        sha256: createHash("sha256").update(jpeg).digest("hex"),
        byteLength: jpeg.length,
        bytes: jpeg,
      },
    ];
    source.settings.page = {
      paper: "A4",
      orientation: "portrait",
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
      watermarks: ["first", "second"].map((resourceId, i) => ({
        kind: "image",
        resourceId,
        x: 10 + i * 30,
        y: 50,
        width: 10,
        height: 10,
        layer: "behind",
        opacity: 1,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      })),
    };
  }
  if (mode === "two-fonts") {
    const other = fontManifest[2];
    const bytes = new Uint8Array(
      await readFile(
        new URL(`../../packages/typography-core/fonts/${other.file}`, import.meta.url),
      ),
    );
    pack.fonts.push({
      family: "Second",
      weight: 400,
      italic: false,
      sha256: other.sha256,
      byteLength: bytes.length,
      bytes,
    });
    source.styles.second = { fontFamily: "Second" };
    source.body.push({
      kind: "paragraph",
      nodeId: "second-p",
      styleId: "second",
      inlines: [{ kind: "text", nodeId: "second-t", text: "second 中文" }],
    });
  }
  if (mode === "empty-paragraph") source.body[0].inlines = [];
  if (mode.startsWith("checkbox-"))
    source.body[0].inlines = [
      {
        kind: "input-control",
        nodeId: "check",
        controlId: "check-control",
        controlType: "checkbox",
        defaultValue: mode === "checkbox-true",
      },
    ];
  result = await render(
    source,
    {
      visible: "office 中文",
      unused: "UNUSED_SECRET",
      debug: "DEBUG_SECRET",
      token: "TOKEN_SECRET",
      credentials: { password: "PASSWORD_SECRET" },
    },
    pack,
    profile,
    { sourceAttachment: true },
  );
} else {
  const content = JSON.parse(await readFile(sourceFile, "utf8"));
  // Host-only authorization map. No path/URL supplied by the attachment is ever opened.
  for (const identity of content.resources.fonts) {
    assert.equal(
      identity.sha256,
      font.sha256,
      "Host has no authorized full font with requested digest",
    );
    assert.equal(identity.byteLength, full.length);
  }
  content.resolvedDocument.body[0].fragments[0].text = "edited office 中文新";
  content.resolvedDocument.revisionId = "revision-2";
  // An inert expression string must never be interpreted in this seam.
  content.resolvedDocument.body[0].fragments[0].origin.expression = "unknownFunction(secret)";
  result = await finalizeSource(content, pack, { sourceAttachment: true });
}
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
assert.ok(result.editingSource);
await mkdir(output, { recursive: true });
await writeFile(`${output}/ir.json`, canonicalSerialize(result.ir));
await writeFile(`${output}/source.json`, result.editingSource.json);
const resources = [];
for (const resource of [...result.fonts, ...result.images]) {
  const file = `${resource.resourceId}.bin`;
  await writeFile(`${output}/${file}`, resource.bytes);
  resources.push({
    resourceId: resource.resourceId,
    file,
    sha256: createHash("sha256").update(resource.bytes).digest("hex"),
  });
}
const sourceAssets = [];
for (const asset of result.editingSource.assets) {
  const file = `asset-${asset.sha256}.bin`;
  await writeFile(`${output}/${file}`, asset.bytes);
  sourceAssets.push({ sha256: asset.sha256, file });
}
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify({ identity: result.identity, resources, sourceAssets }, null, 2),
);
console.log(
  JSON.stringify({
    mode,
    revisionId: result.resolvedDocument.revisionId,
    irDigest: result.identity.irDigest,
    subsets: result.fonts.map((f) => f.subsetDigest),
    glyphs: result.ir.pages
      .flatMap((p) => p.objects)
      .filter((o) => o.kind === "text")
      .flatMap((o) => o.glyphs.map((g) => g.glyphId)),
  }),
);
