# Issue 15 writer/reader gate

Production seam: [OfdIrWriter](../../dotnet/src/OFDCompose.OfdIrWriter/README.md).
The .NET Reader is pinned ofdrw.net; the independent engine is Java ofdrw Reader
2.3.7 in a Java 21 test container. Both read the **finalizer's delivered OFD**.
Java never writes the OFD and is not referenced by the production projects.

## Reproduce

1. `pnpm install --frozen-lockfile && pnpm build`
2. `node packages/render-worker/tests/generate-ofd-fixtures.mjs`
3. `node packages/render-worker/tests/generate-ofd-geometry.mjs`
4. Locked .NET restore/build, then set `OFD_WRITER_OUTPUT` to an owned temp directory
   and run `dotnet test --solution dotnet/OFDCompose.slnx --no-build --no-restore`.
5. `docker build -t ofd-compose-reader tests/ofd-writer/java`
6. Run that image with `--network none --memory 512m --cpus 2`, mount this fixture
   directory at `/fixtures:ro` and the previous output directory at `/input:ro`,
   and pass `/fixtures /input`.

CI runs fixture regeneration, .NET tests and the Java container. Regeneration
must leave fixtures unchanged. Scripts import the built public ESM Worker in
plain Node; they use no Vitest, Vite, DOM mock or TypeScript loader for rendering.
The static combination request was captured from issue 14's existing `combined()`
fixture; its final IR hash must match that issue's committed `expected.json`.

## Evidence boundary

The committed `reader-evidence.json` records the executed local Java Reader result.
It measures glyph origins and state/image/path matrices, path/clip commands and fill rules read through the actual
Reader object API; the harness applies those matrices to compare page coordinates.
.NET compares typed Reader text runs, object maps, all embedded resource bytes,
unique IDs, standard XML namespaces and deterministic final package entries.
.NET checks typed path data and the Reader-preserved clip XML; Java checks its
CT_Path/Clip model and AbbreviatedData parser. `mutation-gate.py` additionally
corrupts an owned copy of a path vertex, clip fill rule or cluster CodePosition and requires the Java
gate to reject it for that geometric reason.
The writer itself validates schema/canonical/reference/font/image/budget constraints.

Cases:

- `combined`: unchanged issue 14 100-row, four-page narrative/table/PNG/barcode result.
- `cff`, `truetype`, `glyphless`, `jpeg`: actual Worker outputs with real subset bytes.
- `multi-glyph`: real Worker `q́` shaping; a single cluster contains two glyphs
  (including the zero-advance mark), asserted during fixture generation.
- `nonidentity-contract`: explicitly synthetic original glyph IDs/digest with genuine
  Worker subset bytes, solely to test transport remapping. It is not evidence of
  a non-retain-GID Worker or of shaping against that synthetic original face.
- `geometry`: explicitly derived from real CFF/PNG resources and glyphs; vertical
  positions, offsets, deliberately unrelated baseline, local/page paths, state
  clips, image clips, high-precision/small/negative matrix coefficients and alpha.
- `logical-display`: explicit derivation with logical/display differences and CRLF,
  markup and quotation characters; uses the original real glyph stream.
- `glyphless-logical`: explicit derivation with nonempty logical text and zero glyphs.
- `duplicate-markers`: shared-contract-validated duplicate marker content with distinct
  canonical IDs; markers are ordered but not deduplicated.

Derived fixtures get new input/final IR digests and provenance in their separate
manifest. They are not claimed as unchanged Worker rendering decisions.

Negative tests include wrong IR/resource digests, missing references, malformed
TTF/CFF with recomputed digests, CID FDSelect outside its font, bad PNG CRC with
consistent transport hashes, APNG, all EXIF orientations in both byte orders with
non-default IFD offsets, unsupported JPEG processes, and byte/token/string/object/glyph/shared-clip/ZIP-entry budgets.
No old 6000-row/500-page, 50/1000-page, LRU or 100k source-range case was reduced.

A zero/near-zero object-coordinate error is not evidence of actual glyph rasterizing,
text selection or printing. The 0.05 mm PoC observation line remains provisional;
reader/device production interoperability and the final threshold are separate
issue 18/19 gates. Nothing here is a production acceptance or merge authorization.

## Dependencies

[Java dependency hashes and licenses](java/DEPENDENCIES.md) and
[.NET source pin/license](../../third_party/ofdrw.net/README.md) are committed.
The image root digest is fixed in Dockerfile. Java JAR hashes are compared against
the complete committed inventory during every container build.
