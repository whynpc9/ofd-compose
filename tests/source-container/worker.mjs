import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { canonicalSerialize } from "../../packages/layout-ir/dist/index.mjs";
import { finalizeSource, render } from "../../packages/render-worker/dist/index.mjs";

const [mode, output, sourceFile, assetsFile] = process.argv.slice(2);
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
if (
  mode === "combined" ||
  mode === "two-images" ||
  mode === "cropped-images" ||
  mode === "header-atomics"
) {
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
  if (mode === "two-images" || mode === "cropped-images") {
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
  if (mode === "cropped-images")
    fixture.source.body[0].placement = { crop: { x: 0, y: 0, width: 1, height: 1 } };
  if (mode === "header-atomics") {
    const table = fixture.source.body.find((b) => b.kind === "table");
    const image = structuredClone(fixture.source.body.find((b) => b.kind === "image-binding"));
    Object.assign(image, {
      nodeId: "header-image",
      bindingId: "header-image-binding",
      options: { width: 5, height: 5 },
    });
    const barcode = structuredClone(fixture.source.body.find((b) => b.kind === "barcode-binding"));
    Object.assign(barcode, {
      nodeId: "header-barcode",
      bindingId: "header-barcode-binding",
      options: { ...barcode.options, width: 45, height: 2 },
    });
    table.layout = { ...table.layout, headerRows: 1, repeatHeader: true };
    table.rows.unshift({
      kind: "table-row",
      nodeId: "header",
      cells: [
        {
          kind: "table-cell",
          nodeId: "header-cell",
          blocks: [
            image,
            barcode,
            {
              kind: "path",
              nodeId: "header-path",
              width: 2,
              height: 1,
              fill: "#000000",
              commands: [
                { op: "move", x: 0, y: 0 },
                { op: "line", x: 2, y: 0 },
                { op: "line", x: 0, y: 1 },
                { op: "close" },
              ],
            },
          ],
        },
        {
          kind: "table-cell",
          nodeId: "header-title",
          blocks: [
            {
              kind: "paragraph",
              nodeId: "header-p",
              inlines: [{ kind: "text", nodeId: "header-t", text: "header" }],
            },
          ],
        },
      ],
    });
  }
  result = await render(fixture.source, fixture.data, pack, fixture.profile, {
    sourceAttachment: true,
  });
} else if (
  mode === "initial" ||
  mode === "control-metadata" ||
  mode === "decorated-paths" ||
  mode === "page-border" ||
  mode === "links" ||
  mode === "table-links" ||
  mode === "empty-bands" ||
  mode === "empty-bands-link" ||
  mode === "private-repeat" ||
  mode === "empty-control" ||
  mode === "path" ||
  mode === "list" ||
  mode === "text-watermarks" ||
  mode === "section-pages" ||
  mode === "whitespace" ||
  mode === "empty-paragraph" ||
  mode === "two-fonts" ||
  mode === "two-faces" ||
  mode === "two-italic-faces" ||
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
  if (mode === "control-metadata")
    source.body[0].inlines = [
      {
        kind: "input-control",
        nodeId: "select",
        controlId: "selection",
        controlType: "select",
        defaultValue: "shown",
        placeholder: "HIDDEN_PLACEHOLDER",
        options: ["shown", "HIDDEN_OPTION"],
        required: true,
      },
      {
        kind: "input-control",
        nodeId: "fallback",
        controlId: "fallback-value",
        controlType: "text",
        placeholder: "visible fallback",
        required: false,
      },
    ];
  if (mode === "decorated-paths" || mode === "page-border") {
    source.settings.page = {
      paper: "A4",
      orientation: "portrait",
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
      border: { inset: 5, width: 0.5, color: "#112233" },
    };
    if (mode === "decorated-paths") {
      source.styles.paint = { highlight: "#FFFF00", underline: true, strikethrough: true };
      source.body[0].styleId = "paint";
      source.body[0].layout = { border: { width: 0.3, color: "#445566" } };
      source.body.push({
        kind: "table",
        nodeId: "paint-table",
        border: { width: 0.2, color: "#006600" },
        layout: { columns: [{ kind: "fixed", value: 60 }] },
        rows: [
          {
            kind: "table-row",
            nodeId: "paint-row",
            cells: [
              {
                kind: "table-cell",
                nodeId: "paint-cell",
                border: { width: 0.4, color: "#AA0000" },
                layout: { background: "#E0E0E0", padding: 2 },
                blocks: [
                  {
                    kind: "paragraph",
                    nodeId: "paint-p",
                    inlines: [{ kind: "text", nodeId: "paint-text", text: "cell" }],
                  },
                ],
              },
            ],
          },
        ],
      });
    }
  }
  if (mode === "links") {
    source.styles.linked = {
      link: "https://example.invalid/?token=LINK_SECRET_STYLE",
      underline: false,
    };
    source.body[0].styleId = "linked";
    profile.layout.defaultStyle.link = "https://example.invalid/?token=LINK_SECRET_DEFAULT";
  }
  if (mode === "table-links") {
    source.styles.tableLink = { link: "https://example.invalid/?token=LINK_SECRET_TABLE" };
    source.body = [
      {
        kind: "table",
        nodeId: "table-links",
        styleId: "tableLink",
        rows: [
          {
            kind: "table-row",
            nodeId: "link-row",
            cells: [
              {
                kind: "table-cell",
                nodeId: "link-cell",
                styleId: "tableLink",
                blocks: source.body,
              },
            ],
          },
        ],
      },
    ];
  }
  if (mode === "empty-bands" || mode === "empty-bands-link")
    source.settings.page = {
      paper: "A4",
      orientation: "portrait",
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
      header: { height: 10, parts: [{ kind: "text", text: "" }] },
      footer: {
        height: 10,
        hiddenPages: [1],
        parts: [{ kind: "text", text: "UNRENDERED_BAND_SECRET" }],
      },
    };
  if (mode === "empty-bands-link")
    profile.layout.defaultStyle.link = "https://example.invalid/?token=HIDDEN_LINK";
  if (mode === "private-repeat")
    source.body = [
      {
        kind: "repeat-block",
        nodeId: "accounts",
        bindingId: "accounts-binding",
        expression: { kind: "legacy", text: "accounts" },
        repeatKey: { kind: "path", path: "account" },
        children: [
          {
            kind: "paragraph",
            nodeId: "account-p",
            layout: {
              section: {
                id: "account-section",
                page: {
                  paper: "A4",
                  orientation: "portrait",
                  margins: { top: 20, bottom: 20, left: 20, right: 20 },
                },
              },
            },
            inlines: [
              {
                kind: "dynamic-text",
                nodeId: "account-name",
                bindingId: "account-name-binding",
                expression: { kind: "legacy", text: "name" },
              },
            ],
          },
          {
            kind: "repeat-block",
            nodeId: "items",
            bindingId: "items-binding",
            expression: { kind: "legacy", text: "items" },
            repeatKey: { kind: "path", path: "id" },
            children: [
              {
                kind: "paragraph",
                nodeId: "item-p",
                inlines: [
                  {
                    kind: "dynamic-text",
                    nodeId: "item-label",
                    bindingId: "item-label-binding",
                    expression: { kind: "legacy", text: "label" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
  if (mode === "empty-control")
    source.body[0].inlines = [
      { kind: "text", nodeId: "before-empty", text: "a" },
      {
        kind: "input-control",
        nodeId: "empty",
        controlId: "empty-control",
        controlType: "text",
        defaultValue: "",
      },
      { kind: "text", nodeId: "after-empty", text: "b" },
    ];
  if (mode === "section-pages") {
    source.settings.page = {
      paper: "A4",
      orientation: "portrait",
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
      header: { height: 10, hideFirstPage: true, parts: [{ kind: "page-number" }] },
    };
    const paragraph = (nodeId, layout) => ({
      kind: "paragraph",
      nodeId,
      layout,
      inlines: [{ kind: "text", nodeId: `${nodeId}-text`, text: "section body" }],
    });
    source.body.push(
      paragraph("page-two", { pageBreakBefore: true }),
      paragraph("section-two", {
        section: {
          id: "next-section",
          page: { ...structuredClone(source.settings.page), startPageNumber: 11 },
        },
      }),
      paragraph("section-page-two", { pageBreakBefore: true }),
    );
  }
  if (mode === "list") {
    source.body[0].layout = {
      role: "list-item",
      numbering: { listId: "plain", format: "decimal" },
    };
    source.body.push({
      kind: "paragraph",
      nodeId: "alpha",
      layout: { numbering: { listId: "plain", format: "upper-alpha", start: 27, suffix: "项 " } },
      inlines: [{ kind: "text", nodeId: "alpha-text", text: "next" }],
    });
    source.body.push({
      kind: "repeat-block",
      nodeId: "repeat",
      bindingId: "repeat-binding",
      expression: { kind: "legacy", text: "items" },
      repeatKey: { kind: "ordinal", orderDependentIdentity: true },
      children: [
        {
          kind: "paragraph",
          nodeId: "repeat-p",
          layout: { numbering: { listId: "items", format: "decimal", start: 5 } },
          inlines: [{ kind: "text", nodeId: "repeat-t", text: "item" }],
        },
      ],
    });
  }
  if (mode === "path")
    source.body.push({
      kind: "path",
      nodeId: "path",
      width: 20,
      height: 20,
      fill: "#112233",
      commands: [
        { op: "move", x: 1.2345, y: 0 },
        { op: "line", x: 20, y: 0 },
        { op: "line", x: 0, y: 20 },
        { op: "close" },
      ],
    });
  if (mode === "text-watermarks")
    source.settings.page = {
      paper: "A4",
      orientation: "portrait",
      margins: { top: 20, bottom: 20, left: 20, right: 20 },
      header: { height: 10, parts: [{ kind: "text", text: "header " }, { kind: "page-number" }] },
      watermarks: ["first 中文", "second 中文"].map((text, i) => ({
        kind: "text",
        text,
        x: 30,
        y: 50 + i * 30,
        layer: "behind",
        opacity: 1,
        transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      })),
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
  if (["two-fonts", "two-faces", "two-italic-faces"].includes(mode)) {
    const other = fontManifest[mode === "two-fonts" ? 2 : mode === "two-faces" ? 1 : 3];
    const bytes = new Uint8Array(
      await readFile(
        new URL(`../../packages/typography-core/fonts/${other.file}`, import.meta.url),
      ),
    );
    pack.fonts.push({
      family: mode === "two-fonts" ? "Second" : "Noto",
      weight: mode === "two-faces" ? 700 : 400,
      italic: mode === "two-italic-faces",
      sha256: other.sha256,
      byteLength: bytes.length,
      bytes,
    });
    source.styles.second =
      mode === "two-fonts"
        ? { fontFamily: "Second" }
        : mode === "two-faces"
          ? { fontFamily: "Noto", bold: true }
          : { fontFamily: "Noto", italic: true };
    source.styles.regular = { bold: false, italic: false };
    source.body[0].styleId = "regular";
    source.body.push({
      kind: "paragraph",
      nodeId: "second-p",
      styleId: "second",
      inlines: [
        {
          kind: "text",
          nodeId: "second-t",
          text: mode === "two-italic-faces" ? "second only" : "second 中文",
        },
      ],
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
      visible: mode === "whitespace" ? "  office\t中文\r\n尾部  \n" : "office 中文",
      items: [{}, {}],
      ...(mode === "private-repeat"
        ? {
            accounts: ["A", "B"].map((suffix) => ({
              account: `PRIVATE_ACCOUNT_${suffix}`,
              name: `Public ${suffix}`,
              items: [
                { id: "PRIVATE_CHILD_SHARED", label: "visible child" },
                { id: "PRIVATE_CHILD_TWO", label: "other child" },
              ],
            })),
          }
        : {}),
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
  if (mode === "verify-generated") {
    pack.fonts = [];
    for (const identity of content.resources.fonts) {
      const authorized = fontManifest.find((font) => font.sha256 === identity.sha256);
      assert.ok(authorized, "Host has no authorized full font");
      const bytes = new Uint8Array(
        await readFile(
          new URL(`../../packages/typography-core/fonts/${authorized.file}`, import.meta.url),
        ),
      );
      pack.fonts.push({ ...identity, byteLength: bytes.length, bytes });
    }
    const ownedAssets = JSON.parse(await readFile(assetsFile, "utf8"));
    pack.images = await Promise.all(
      content.resources.images.map(async (image) => {
        const asset = ownedAssets.find((asset) => asset.sha256 === image.sha256);
        assert.ok(asset);
        return { ...image, bytes: new Uint8Array(await readFile(asset.file)) };
      }),
    );
  } else {
    // Host-only authorization map. No path/URL supplied by the attachment is ever opened.
    for (const identity of content.resources.fonts) {
      assert.equal(
        identity.sha256,
        font.sha256,
        "Host has no authorized full font with requested digest",
      );
    }
    if (mode !== "replay-unchanged") {
      content.resolvedDocument.body[0].fragments[0].text = "edited office 中文新";
      content.resolvedDocument.revisionId = "revision-2";
      // An inert expression string must never be interpreted in this seam.
      content.resolvedDocument.body[0].fragments[0].origin.expression = "unknownFunction(secret)";
    }
  }
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
