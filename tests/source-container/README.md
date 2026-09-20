# Source-container evidence

The test uses only synthetic `office 中文` → `edited office 中文新` content. No business
file, account credential, license purchase or EULA acceptance is part of this test.

1. Build the workspace (`pnpm build`) before the .NET suite. `worker.mjs` calls the
   real built Node Worker, never a mock or a reimplemented layout engine.
2. Build then run `dotnet test --solution dotnet/OFDCompose.slnx --no-build --no-restore`.
   Set `OFD17_EVIDENCE` to an owned output directory to retain initial/edited OFD plus
   exact source and IR fixtures. Tests extract from the first OFD, save only the
   validated filled source, change the text/revision, explicitly supply the locked
   full font from the test host's manifest, and finalize without original Data.
3. Build `tests/ofd-writer/java` and invoke `ReaderGate <evidence>/fixtures <evidence>
   initial edited` (the Docker image entrypoint is ReaderGate). This reuses the fixed
   independently pinned Java 2.3.7 Reader's text, glyph, cluster, resource and geometry
   checks, plus `getAttachmentList/getAttachmentFile` for actual attachment extraction.
   CI runs this in a network-disabled container after the ordinary 11 OFD fixtures.
4. Regenerate the source schema with `node tools/containers/generate-schema.mjs`.
   It derives the structural contracts from the TypeBox document/IR schemas;
   version strings remain structurally strings so version rejection follows resource
   validation. The Worker still uses the original strict versioned schemas.

Local library observation, 2026-09-20: .NET extraction and the real round-trip passed;
Java attachment part equality and SHA-256 checks passed, initial 7 / edited 15 glyphs,
maximum geometry error 0 mm. Full-font denial, missing font, corrupt bytes and using a
subset as the full font fail without output. New-glyph assertions inspect real Worker
IR, and Java checks the produced OFD glyph IDs/coordinates against that IR.

**Desktop target reader: Not verified.** Foxit Phantom 11.3.2009 was inventoried but
its installation metadata does not declare OFD support. Computer Use timed out without
an application observation. No actual desktop extraction, visual display, license
entitlement or supported-OFD claim follows from those observations. ADR-0005 remains
Proposed, and the single/multiple attachment decision remains open for issue 19.

Local validation snapshot after review fixes: fresh Node 615, fresh Chromium 405,
full .NET 364 (170 container cases plus the unchanged 194 baseline cases).
Lint, typecheck/build, locked NuGet restore and strict dependency licensing passed.
Old OFD fixtures regenerated without a diff; existing 11-case Java Reader geometry
baseline and pinned pdf.js strict/accepted-whitespace gates also passed. See
`reader-evidence.json` for concrete artifact/part/full-font/subset hashes.

Bot review regressions also cover replacing an authorized or inline source image while
recomputing every affected digest, real true/false checkbox OFD output, owned snapshots
of caller-controlled JSON/object maps, and standard numeric attachment IDs/MaxUnitID.

Further review regressions preserve valid empty paragraphs without source ranges, reject
wrong XML root names at all five native package entry kinds, and reject two source-image
IDs being swapped while the overall image digest set remains unchanged.

IR identity tests change both the leading and trailing digest halves and mutate DocID
with a recomputed inventory hash. Font family/weight/italic mutations and orphaned
resource blobs are rejected. Distribution has one identity-only part; native has five.

Both profiles require declared resource IDs to be referenced by page
objects. ZIP preflight and parsing use one owned byte snapshot; a switching-memory
regression cannot substitute a second archive after validation.

Root-attribute leak mutations were already rejected before the traversal clarification
(`XDocument.Descendants` includes its root); four regression cases preserve that boundary.
Further tests cover a two-family permutation, the explicit resource-map permutation,
and a native resource declaration whose image was removed from all page objects.

Source coverage rejects added renderable occurrences with no semantic mapping. Watermark
objects carry bounded JSON pointers to their actual page/section source settings;
swapping watermark assets is rejected. Source capture is opt-in and tests require exactly
the same IR with or without it. Fixed-writer XML uses contextual element/attribute rules,
and MaxUnitID must cover actual package IDs before adding the attachment.

Coverage is checked per source occurrence and per UTF-16 interval, including whitespace
and line breaks; changing a fragment and rehashing its semantic text cannot hide an
unmapped prefix, suffix or middle range. Image occurrences require all source items.
The XML grammar also validates single-value cardinality, finite numeric values,
glyph integers and fixed-writer path command syntax, preventing hidden source text in
otherwise valid XML contexts.

The page-decoration map binds text/image watermarks and page bands to actual output;
removing the witness or changing visible text after rehashing is rejected. Optional
`dataPath` provenance is stripped and cannot be reintroduced. Numeric OFD IDs must use
canonical decimal spelling. Path local commands/paint are compared directly; barcode
value/options use an explicit trusted host resolver running the existing pinned
media-core encoder. The actual combined fixture verifies Code128 and EAN13 through
that bridge. Missing/denied/incorrect resolver results fail closed. These checks supplement the unified trusted-render page comparison below.

Generated numbering also has paragraph origins: decimal/alpha markers, custom suffixes,
continuation/restart and repeated list starts are validated without changing the IR.

Effective source font styles are checked against the actual original font digest with
family, weight and italic together. Same-family regular/bold and regular/italic fixtures
reject rehashed paragraph/fragment changes. Numbering verification explicitly delegates
to the same Layout Core function as real layout, with no second .NET numbering algorithm;
missing, denied or over-budget host requests fail closed.

The first mapped appearance of each renderable source occurrence must follow source
traversal order, and semantic targets must follow physical page/object order. Rehashed
source-only swaps and combined source/semantic swaps fail; repeated table headers and
later fragments of an existing occurrence remain supported.

Source cardinality is exact: atomic nodes appear once (images cover their source array),
and text intervals do not overlap. Repeated table headers must reproduce their complete
content once on each independently mapped table-body page. Duplicated physical image,
path, barcode and text objects with rehashed manifests are rejected. Section starts are
derived from ordered source sections and actual body pages; header/footer witnesses
must agree with the derived section page, including hidden first pages and blank pages.

Repeat business keys are replaced with opaque per-file instance labels consistently in
source and semantic parts, including parent scopes and generated section IDs. Visible
text remains unchanged; captured and ordinary IR remain identical. Nested path-key
fixtures confirm no raw account/child key is attached. Dynamic valueState is normalized
to the fixed filled-source value placeholder; missing/null input state is not retained
and cannot be reintroduced by rehashing.

Every applicable page must have witnesses for retained watermarks and nonempty visible
header/footer bands; removing both physical objects and maps is rejected. Empty and
hidden bands remain valid. Link targets are omitted from styles/settings/default
profile/semantics, including table/cell styles. Visible underlines are materialized,
and opaque shaping groups preserve original run boundaries so URL removal cannot
change ligatures. Shared paragraph-style rules and actual re-finalization tests require
identical pages, graphics states and resources after this projection.

Generated path decorations require a trusted `SourceRenderResolver` when present or
potentially requested by retained source paint settings. The host uses the real Worker
and fixed writer to recompute path XML, with explicit full-font authorization and owned
source-image assets. The container compares the complete generated-path set, page/object
positions and path/paint/clip payloads. It ignores only identifier/namespace serialization
and non-leaf formatting whitespace. Tests cover page/paragraph/cell borders, backgrounds,
highlight/underline changes, missing paths and attempts to relabel paths as paragraph
semantics. Typed physical-object mapping preserves legitimate trailing-line-break anchors.

Filled-control retention is explicit: keep node/control identity, type, style and the
currently displayed default value or visible placeholder. Omit option catalogs,
required-validation flags and placeholders shadowed by a default value. Rehashed
reintroduction is rejected; capture-on/off IR, reopened geometry and control IDs remain
unchanged. A host needing editing choices/validation must supply its own policy.

The complete IR SHA-256 is anchored in the sealed OFD DocInfo Keywords as the single
fixed `ofd-compose:ir-sha256:` value and must equal both manifest/part identities.
Changing the suffix in the attachment while keeping OFD bytes unchanged is rejected.
This remains internal consistency rather than authenticity; the fixed writer itself
is unchanged and sealing adds this envelope metadata.

`SourceRenderResolver` now also supplies real Worker table coordinates/spans/repeated
header relationships and actual generated page-band text. .NET compares those results
instead of implementing page-number formatting or visibility rules. Tables/page bands
therefore require the explicit authorized render host, even without path decorations.

Header/footer bands never rendered on any page retain only geometry and visibility;
their parts and text styling are removed after link normalization. Capture-on/off and
reopened geometry tests cover default links both enabled and absent. Extraction rejects
rehashing hidden text back into those bands. Editing-font identities retain family,
weight, italic and SHA-256 without an unverifiable byteLength; host resource packs still
validate actual lengths and digests, and attachment length reintroduction is rejected.

Signature presence is limited to the actual `Doc_0/Signs/` hierarchy or the OFD
`Signatures` declaration. A referenced resource named `Design.otf` stays unsigned
for both native and distribution profiles; declaration-only and sidecar-only signature
presence stays unverified and cannot be resealed.

Every native document now requires one trusted Worker/fixed-writer replay. Full page XML
is compared after explicit identifier/reference normalization: object/layer IDs are
serialization identities, while font/image references map to actual subset/image digests.
All geometry, text, paint, clips and order remain compared. This is source-to-page
internal consistency under the same renderer/profile/authorized resources, not source
authenticity, signature verification or a second independent layout implementation.
Regressions cover font size/color, alignment/indent/page breaks, image width/scale/crop,
and native path matrices; existing nested-repeat/link/multifont/table/header fixtures
must still create and extract. Conflicting full-font digests for one face are rejected
according to the real Worker's unique-face authorization rule.

Local red/green observation: all 11 schema-valid geometry/font-conflict counterexamples
were accepted under the previous validation boundary (11 failed assertions, 0 test
errors); the unified boundary passed all 339 .NET cases, including the original 324.
The full suite took 94.2 s versus the prior 324-case run at 72.5 s; these include different
test counts and are not an isolated performance benchmark. No dependency was added.
Full-font authorization and one real renderer replay are now required even for ordinary
native text/images. Desktop Reader remains Not verified.

Declared MultiMedia PNG/JPEG formats must match actual resource signatures after
reachability validation, for both native and distribution Create/Extract. Existing
case variants and JPG aliases remain accepted. Input-control semantics require the
exact controlId; source ranges inherit that identity from their enclosing semantic entry,
matching actual Layout Core output. Seven rehashed counterexamples were accepted before
these checks and rejected afterward; ordinary, empty and checkbox control fixtures pass.

The @1 container keeps original artifact IR identity separate from the sealed filled-source
replay identity computed by Create's trusted host. Extraction replays the minimal source,
profile and authorized resources and compares that independent declaration. Tests verify
original/replay IR digests may differ with identical pages/resources/graphics states,
unchanged replay stays stable, actual edits change replay identity, and rehashed document,
revision, permitted pagination-profile and font-family identity changes are rejected.
Complete image/font layout-resource metadata is compared against the same replay.
These checks do not authenticate a package whose attacker rewrites all associated content.
