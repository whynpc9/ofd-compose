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

Local validation snapshot after review fixes: fresh Node 613, fresh Chromium 403,
full .NET 317 (123 container cases plus the unchanged 194 baseline cases). The final
schema-work precharge received an additional four-case Node/Chromium targeted rerun.
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
that bridge. Missing/denied/incorrect resolver results fail closed. These are local
content checks, not a complete independent re-layout proof (see the container README).

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
