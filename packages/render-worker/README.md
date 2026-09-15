# Render Worker — Issue 14 / WP0.5a

`render(TemplateSource, Data, ResourcePack, RenderProfile, control?)` is the shared Node/browser
library seam. Build with `pnpm build` before importing the public package in plain Node.
Default exports resolve ESM build artifacts; the `development` condition and TypeScript types
resolve sources for Vite/editor tooling. These private workspace packages keep source-based
TypeScript types (`tsdown.dts=false`); full `tsc --noEmit` remains a required gate. It runs compile → bind → prepareMedia → shape/layout → hb-subset → canonical IR.
Success contains `resolvedDocument`, `ir` (integer micrometres), `semanticMap`, `diagnostics`,
writer `fonts`/`images`, `identity` and budget observations. Failure contains **only**
`ok:false` and structured diagnostics. No partial document or writer resources escape.

```ts
import { render } from "@ofd-compose/render-worker";
const result = await render(template, data, {
  fonts: [{ family: "Noto", weight: 400, italic: false,
    sha256: fontLock, byteLength: fontBytes.length, bytes: fontBytes }],
  images: [{ id: "chart", sha256: imageLock,
    byteLength: imageBytes.length, bytes: imageBytes }],
  subsetWasm: { byteLength: wasmBytes.length, bytes: wasmBytes },
}, {
  version: "ofd-compose/render@0",
  layout: {
    page: { width: 210, height: 297,
      contentBox: { x: 20, y: 20, width: 170, height: 257 } },
    defaultStyle: { fontFamily: "Noto", fontSize: 12 },
    formattingPolicy: { version: "binding-1", locale: "zh-CN", timeZone: "UTC",
      tzdataVersion: "2026a", rounding: "half-up" },
  },
}, { signal, limits: { workUnits: 512_000_000 } });
```

## Identity and resource ownership

- Resource arrays use dense own data slots; indexed accessors, sparse entries and custom
  iterators are rejected without invoking them.
- Hosts load fixed authorized bytes (or promises for those bytes), declare exact lengths and
  SHA-256 locks, and supply the pinned subset WASM. There are no filesystem, URL or network
  resolver callbacks in Core. A resource ID is scoped to this invocation; jobs never share an
  image authorization cache. All entries, including duplicates, consume the input budget.
  Root-page and section image watermarks resolve through the same Media budget, PNG/JPEG
  validation and resource pack; their descriptors and bytes reach layout and writers.
- Before the first await, the entry point makes bounded descriptor-only JSON snapshots and
  copies direct byte arrays. Promised buffers are copied on arrival and checked against both
  length and digest. All entries finish before media or layout runs. Missing font/image entries
  fail with `FONT_MISSING`/`RESOURCE_FORBIDDEN`; invalid fonts do not fall back to installed fonts. Stage-error location
  fields (node/binding/data path/page index when present) survive diagnostic conversion.
- Identity contains template revision/schema, expression and binding-policy versions, template,
  input-data, compiled, resolved, media and layout-configuration digests, layout-input digest,
  subset version and final IR digest. Top-level provenance and BindingRuntime envelopes are
  excluded from semantic digests; source mappings, version/profile and media identities remain.
- `withFontSubsets` attaches subset identities and rewrites canonical resource references
  **without quantizing micrometres again**. The returned digest is calculated from these final
  delivered bytes. Writer resources use the resulting canonical `resourceId`.
- Original font digest identifies the full static face. `subsetDigest` identifies different
  bytes; they are never interchangeable. The existing Layout IR font schema already carries
  `originalDigest`, `subsetDigest`, and `glyphIdMap`; this change uses those fields without
  changing or relaxing its schema. Writers use IR clusters for text extraction/ToUnicode.

## Pinned subsetting adapter

The installed `harfbuzzjs@1.6.0` export map and `dist/index.d.mts` expose no JS subset function.
The shipped `dist/harfbuzz-subset.wasm` has no imports; it exports the C ABI used in
[src/subset.ts](src/subset.ts). Its SHA-256 is:

`e3bf5ad5841bfdcc37878dff5330a13eea071b5860471d9d6515e31506e4ff96`.

The shaping package reports HarfBuzz 14.3.0. The subset artifact is identified by its exact
bytes, since it does not export a version function. Required exports and parameter counts
are checked before allocation; mismatched bytes/ABI fail explicitly. C signatures and
ownership were checked against installed HarfBuzz 14.3 headers and the upstream
[subset](https://harfbuzz.github.io/harfbuzz-hb-subset.html) and
[blob](https://harfbuzz.github.io/harfbuzz-hb-blob.html) API references.

Each font gets an independent WASM instance. The adapter calls `malloc`, `hb_blob_create`
(READONLY=1, no destroy callback), `hb_face_create`, `hb_subset_input_create_or_fail`,
`hb_subset_or_fail`, and `hb_face_reference_blob`. `finally` releases each owned blob, face,
input and allocation exactly once. Glyph/unicode sets are borrowed from the input and are
not separately freed. No plan API is exported/used; `hb_subset_or_fail` owns its internal plan.
This lifecycle is separate from TypographyCore's FinalizationRegistry-managed objects.

Only fonts referenced by text objects are subsetted; unused font resources are pruned before
final canonicalization (input authorization/validation still covers the entire pack).
The glyph set is the union of actual IR glyph IDs plus .notdef. Flags are
`HB_SUBSET_FLAGS_RETAIN_GIDS=0x2`; default layout/composite closure stays enabled. The identity
map covers requested glyph IDs plus .notdef; closure components are internal to the font.
The unicode input set is empty: this is a glyph-addressed writer font, not a font for rerunning
Unicode shaping. Both CFF and TrueType tests compare the paths and advances at original GIDs;
the TrueType test inspects `loca/glyf` and proves a requested glyph is genuinely composite.

## Budgets and cancellation

The entry preflights JSON depth/count/string units and declared resource count/bytes before
copies. SFNT directory bounds, static outline signature and `maxp` glyph count are checked
before native allocation; TypographyCore's original font validation still applies.
A shared `JobContext` charges compile traversal, binding expansion/sorts, media preparation,
and every layout work counter across pagination/retry passes. Binding also prepays
  array indices/slices/element paths, object counts, JSON text, each comparison, truthiness and
  bounded decimal exponent expansion (before `toFixed`). Subsetting and snapshot/hash
work use the same job meter. Existing module ceilings remain in effect.

Default ceilings: 200k JSON nodes, 8M string units, depth 64, 128 resource entries, 160 MiB
input resources and 512M work units. Subset output reserves its entire 32 MiB accepted ceiling
**before** native execution, cumulatively 128 MiB (at most four distinct used subset fonts per job).
This conservative reservation can reject a job even if its eventual small subsets would fit.
Limits can only be lowered. `subsetBytes` reports reserved capacity, not actual output size.

Cancellation interrupts async acquisition and is checked at stage/work/native boundaries.
Synchronous JS/WASM cannot process an event-loop cancellation while executing. These meters
are not hard RSS/CPU limits: the host must use an isolated process and kill/rotate it for hard
time/memory limits. JS GC reclaims a discarded subset WASM instance; no global native subset
cache is retained. Typography's existing bounded immutable-face LRU remains unchanged and is
not a hard native-memory cap. Node process-pool/stdio hosting is a later issue.

## Verification scope

- A separate plain Node subprocess imports the built public package and runs the full combination
  without any test/TypeScript loader. Real Node runs without DOM/Canvas mocks; Core tsconfigs use `ES2024` only, Biome applies the
  same forbidden-global rules to render-worker, and runtime dependencies are audited in tests.
- Identical combination: ranking/rate narrative, 100-row dynamic table (4 pages), image,
  Code128 and EAN13. Logical IR extraction equals an independently constructed expected text.
- Node crypto independently hashes final canonical JSON and subset bytes. Chromium compares
  the same input's full identity to committed [expected.json](tests/expected.json).
- Library inventory is 28 cases: all 19 executable text/structure cases and 4 valid native
  media reconstructions reach IR. Four legacy tiny-PNG cases have invalid chunk CRCs and one
  requests UPC-A/ITF outside the current Code128/EAN13 schema; all five explicitly fail with
  no partial output. The source corpus is preserved. Reconstruction is test support, not DOCX
  import, and does not claim inline image placement beyond the current block media profile.
- [timing.json](tests/timing.json) records one preliminary first/hot observation on Node 24,
  macOS arm64. Resources, module import and subset inclusion are stated explicitly. These are
  not production capacity measurements, p50/p95, writer/reader acceptance or WP0.9 approval.

Run `pnpm --filter @ofd-compose/render-worker test` and `test:browser`.
To intentionally refresh the independent baseline/timing, run the Node-only test with
`UPDATE_RENDER_FIXTURES=1`; inspect the resulting identity change before committing.
