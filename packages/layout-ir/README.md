# Layout IR

`@ofd-compose/layout-ir` is the shared contract between layout and fixed-primitive
writers. It performs no shaping, measurement, line breaking or pagination.
The implementation follows [spec §9](../../.scratch/first-release/spec.md) and
[ADR-0001](../../docs/decisions/ADR-0001-technology-baseline.md).

## Public entry points

- `LayoutIRSchema` / `LayoutIR`: construction format, top-left origin, lengths in **mm**.
- `validateLayoutIR(unknown)`: throws `IRValidationError` with `code` and `path` for
  schema, duplicate identity/order, missing or wrong-kind references, page bounds,
  subset maps, UTF-16 ranges or inconsistent clusters. Unknown `irVersion` fails
  with `IR_VERSION_UNSUPPORTED`. Versions are independent of `modelVersion`.
- `validateCanonicalLayoutIR(unknown)`: validates the integer-um writer transport
  against its schema, the same relational checks, semantic digest and canonical
  ordering/IDs/deduplicated definitions. It
  never changes units, order or IDs, and rejects mm construction input.
- `canonicalizeLayoutIR(unknown)`: validates and returns a new
  `CanonicalLayoutIR` with `units: "um"` and `canonicalizationVersion`.
  `CanonicalLayoutIRSchema` describes that separate writer transport.
  Passing an already canonical IR to this function is an explicit schema error;
  it never quantizes twice. The input is never mutated.
- `serializeLayoutIR` / `digestLayoutIR`: canonical serialization / lowercase
  SHA-256 over its UTF-8 bytes, without BOM or trailing newline.
- `canonicalSerialize` / `digestCanonical`: deterministic JSON primitives for
  already canonical payloads (including the `um` result). Writers hash the exact
  transmitted bytes, and must not reserialize or re-quantize in another language.
- `clusterOffsetTable`, `clustersAtOffset`, `offsetsForCluster`,
  `validateUtf16Range`: public UTF-16 mapping and range validation.

JSON Schema 2020-12 artifacts live in [`schemas/layout-ir`](../../schemas/layout-ir/).
They are checked for freshness and independently compiled with Ajv in Node tests.
The object validator checks structural canonical form, not the original JSON text
spelling or whitespace. Producers must use `canonicalSerialize` for wire bytes.
Schema validation alone cannot check graph references or cluster relationships;
TypeScript transport consumers use `validateCanonicalLayoutIR` before writing;
non-TS writers must apply equivalent relational checks after JSON Schema validation.

## Geometry and order, canonical version 0

Construction lengths are finite numbers in ±1,000,000 mm. Canonical lengths are
integers in ±1,000,000,000 µm. Quantization rounds the shortest decimal spelling
**half away from zero**: `1.2345 → 1235`, `-1.2345 → -1235`,
`1.0055 → 1006`, `-0.0005 → -1`. Error is at most 0.0005 mm per scalar.
Negative zero becomes zero. Dimensions that are required positive (paper and font
size) must remain positive after quantization; invalid post-rounding geometry fails.
This is the issue 08 PoC baseline, pending WP0 error/capacity evaluation and WP0.10
freeze; it is not a claim about writer or reader geometric accuracy.

Only schema-annotated lengths are quantized: boxes, page size, baseline, glyph
position/advance/offset, path commands, matrix translations, line width and dashes.
Matrix a/b/c/d coefficients, color/opacity, font axis values, glyph IDs and image
pixel dimensions retain their original numeric meaning. Every finite dimensionless
number is serialized in shortest decimal notation expanded without an exponent;
nonfinite values and values beyond JavaScript's safe integer magnitude are rejected.
Keys sort by UTF-16 code units, independently of locale. JSON strings retain their
code units (no Unicode normalization); arrays remain ordered unless explicitly
listed below. Undefined, sparse arrays, accessors, non-JSON objects and cycles fail.

- Pages sort by contiguous zero-based `pageIndex`; objects sort by unique per-page
  `drawOrder`; semantics sort by unique global `readingOrder`. Changing these
  values changes the digest. Reordering their storage arrays does not.
- Page/object IDs become `p0` / `p0o0`, etc. Resources and graphics states sort by
  their complete canonical definitions, deduplicate equivalent definitions and
  receive `r0` / `s0` IDs. Every reference is rewritten. Same font bytes with a
  different face, weight, style, feature or variation remain distinct instances.
- Font subset maps sort by original glyph ID. An absent map with a subset digest
  means retain-GIDs; an explicit map is original → subset and must cover every
  referenced glyph. Both sides of an explicit map are unique.
- Clusters sort by display range and get ordinal IDs; glyph storage order remains
  visual/shaping order. Glyph-index membership lists sort numerically. Markers
  sort by all their content except temporary ID and get `m0`, etc. Profile features
  and LayoutIdentity resource manifests are sets; other arrays retain order.
- Source identities (`nodeId`, binding/control/table IDs, section source,
  repeat-instance keys) are semantic and are never renamed.

A text glyph's `position` is the positioned glyph origin; the writer places it at
`position + offset` before the graphics-state transform. `baseline` describes the
run baseline and is not added a second time. `advance` is the shaped advance, never
an instruction to remeasure text. Font size and all glyph geometry are physical
lengths. Path `coordinateSpace: local` uses the graphics-state transform; `page`
means already positioned page coordinates (no second graphics-state transform).
Image pixels map through the image object's matrix into local physical space,
then through the graphics-state matrix into page space. Bounds are page-space
metadata; they do not imply another translation or scaling. Each clip uses the
local space of its owning state/image, with an explicit fill rule. Only `normal`
blend mode and sRGB color are in this provisional profile; unsupported modes fail.

## Text, semantics and identity

All ranges are half-open UTF-16 offsets `[start,end)` and cannot bisect a surrogate
pair. Display clusters uniquely cover all displayed text and all glyph indices.
Logical ranges are explicit and may overlap for display transformations; a logical
offset can therefore return multiple clusters. Run direction preserves the shaper's `ltr`/`rtl`/`ttb`/`btt` values, including vertical advances and offsets. OpenType feature values are unsigned 32-bit integers, matching TypographyCore. Glyph order may be RTL/nonmonotonic,
and clusters can represent ligatures or combining sequences. End-of-text offset
maps to no cluster. Source text ranges are checked against their supplied source
text, not against a potentially transformed display string.

Semantics record source nodes, bindings, nested repeat keys, controls, table
coordinates/spans, reading order, source ranges and repeated header identity.
Markers carry hit/selection/control geometry, never paint, and explicitly declare
`signatureCoverage: "none"`. This declaration does not perform cryptographic
signing or claim that a marker is protected by a signature.

`identity.semanticDigest` is optional on mm construction input. Normalization
always computes SHA-256 of the canonical semantic map and includes it in output;
a supplied digest must match or normalization fails. Top-level IR `provenance`
(runtime/machine/log metadata) is validated as JSON but omitted from canonical IR.

`LayoutIdentityInputSchema` defines the complete canonical identity input:
semantic ResolvedDocument digest, the complete font/image SHA-256 manifest, layout
engine/shaping/line-break versions, versioned formatting policy with explicit
locale/time zone/tzdata/rounding, capability profile and layout options. Call
`digestSemanticDocument` on an **already validated ResolvedDocument** to obtain
its semantic digest: top-level `provenance` and Binding Core
`runtime` are excluded. The latter records the observed runtime ICU tzdata version
(Node reports a version while browsers report null), not semantic content. Nested
source/origin maps, semantic settings and versions remain; the separately declared
LayoutIdentity formatting policy still locks the required tzdata/rounding policy. `digestLayoutIdentity` sorts/deduplicates
the manifest and sorts feature sets before hashing; every other declared field
contributes. Callers must provide the full resource closure, including original
fonts rather than only output subsets, and the actual options used by layout.
The IR `identity.inputDigest` is this result; hashing alone does not prove that a
producer faithfully laid out those inputs.

## Fixtures and verification

Import factories from `@ofd-compose/layout-ir/fixtures`, or consume the committed
`fixtures/*.mm.json` and `fixtures/*.canonical.json`: single-page text (astral
character + ligature), table border, clipped image, barcode-like rectangles, and
two-page repeated header with selection marker. Each canonical JSON file ends in
one newline for repository readability; remove that newline to compare the
canonical payload digest. These are **synthetic contract fixtures**: font/image
hashes and glyphs are placeholders, not an asset pack or a shaping/decodable-barcode
acceptance claim. Writer integration must supply real font subsets/image bytes
and independently verify output geometry/text under issues 15/16.

`pnpm --filter @ofd-compose/layout-ir test` runs contract/negative tests, generates
no files normally, and checks committed artifact snapshots. Use `test -- -u`
when intentionally updating fixtures/schema (or `vitest run -u` in this package).
`pnpm --filter @ofd-compose/layout-ir test:browser` reruns the same contract cases
in real Chromium against hashes independently calculated with Node `crypto`.
Browser tests do not import the Node hashing API. This proves this tested runtime
pair; Firefox, another Chromium version, Linux x64/arm64 and target readers remain
WP0 matrix work, not implied by one local browser run.

The dual suite also runs the real Compiler → Binding Core document path and checks
its semantic document digest and LayoutIdentity against pinned Node baselines,
including the different runtime metadata observed by Node and Chromium.
