# Experimental source attachments (issue 17 / WP0.8)

`SourceContainer.Create` seals a **fresh OfdIrWriter output** as `NativeEditable` or
`Distribution`. It never lays out a page. `Extract` returns validated source JSON
and source-image assets; it never binds expressions, opens a path/URL, loads a
font, executes attachments, or verifies signatures.

The experimental format has one `application/json` attachment named
`ofd-compose.json`, registered through standard OFD `Attachments.xml`. Its
`namespace=ofd-compose`, `protocol=ofd-compose/source@0`, and
`containerProfileVersion=ofd-compose/container-experimental@0` are explicit.
Five parts carry minimal ResolvedDocument, exact RenderProfile, resource inventory,
Semantic Map (entries plus an explicit decoration-object partition), and full IR identity. Each part's `content` is a **JSON string containing JSON text**;
its SHA-256 covers the UTF-8 bytes of that string's decoded value, so re-escaping
or indenting the outer manifest cannot change an inner digest. This is not nested
ZIP and not an executable format. The manifest also records versions, required
capabilities, producer/optional parent-artifact digest, IR digest, fixed object map,
and byte lengths/digests for the package entries (excluding manifest and its index).

Safety admission precedes logical validation: bounded ZIP central directory,
local/central names, ASCII paths, duplicate/case aliases, entry/expanded sizes,
compression ratio, nonoverlap, JSON depth/tokens/strings/duplicate keys, and XML
node/depth limits. DTDs and external resolution are prohibited. Experimental input
rejects ZIP64, encryption, extra fields, comments, and unknown compression methods;
it is not a general-purpose foreign-OFD importer. Logical checks then run protocol,
size, schema/minimality, digest, resource and semantic references, supported
versions/capabilities, signature policy. Shared per-operation work budgets and
cancellation bound copies, hashes, parsing, and output; failure returns no artifact.

`render(..., {sourceAttachment:true})` returns minimized source and needed original
image bytes. It omits original Data, expression bodies, conditional/repeat evaluation
logs, optional business-data paths, provenance and unused styles; it retains printed text, active input-control
semantics, stable node/binding identities and opaque repeat relationships and source ranges. It does not
redact values deliberately displayed in the document. Embedded image data is needed
content, not business-input retention. Full font metadata and byte lengths are
separate from Layout IR `originalDigest` / `subsetDigest`; full fonts are not embedded
as editing assets. `finalizeSource(content, authorizedPack)` checks those full font
locks before using the same media/layout/subset chain as `render`. The host must
supply an authorized content-addressed pack. A denied, missing, corrupt or subset-only
font fails; there is no system-font or URL fallback. `finalizeResolved` is the lower
level filled-document seam; neither seam compiles or rebinds. Callers assign a new
revision ID when editing. Re-rendered documents omit synthetic template/data hashes.

Distribution accepts no editing source/assets and emits only the hashed IR-identity part and an empty object map,
`derived-no-source` capability and `distribution` profile. Sealing an already-signed
input is rejected. Extraction reports `unsigned` or `present-unverified` only.
`internal-consistency-only` **does not mean authentic or signature-verified**; a party
able to replace content and recompute hashes can create an internally consistent file.

See ADR-0005. Single versus multiple attachments is **not frozen** until extraction
through at least one named desktop target reader is actually verified. The .NET and
Java Reader tests are independent library evidence, not desktop viewer acceptance.

Contracts live in `packages/source-protocol` as TypeBox; TypeScript types and the embedded
wire schema are derived from them. .NET manifest DTOs use a generated System.Text.Json
context. Extraction cross-checks declared layout resources against real OFD resource
XML and page references, then validates semantic node/binding/repeat/text ranges and
page links against the filled source and physical objects. Removing a whole resource
or semantic list and recomputing its digest does not satisfy these checks.

The full manifest IR digest must equal the hashed `irDigest` JSON-string part; its first
32 hex characters must also match the OFD DocID. This detects changing either half of
the manifest digest without updating protected parts, while remaining an internal
consistency check, not authentication. Resource XML/page references and resource-file
reachability are checked for both profiles. Font weight/italic/face and requested family
metadata are checked against the layout/source; unused family aliases are minimized.

The writer returns an explicit IR resource ID → OFD resource ID `ResourceMap`. Native
`Create` requires that map via `resourceMap:` and validates it against resource XML and
page references; the manifest retains it for extraction. Source text font-family
selection is checked against the mapped original font identity, including paragraph
styles and explicit fragment inheritance. The writer only returns its existing mapping;
this adds no layout or font selection to the writer and does not change writer bytes.
Both profiles reject declared resources unused by page objects.

Native semantic validation requires every renderable source occurrence to be mapped.
Page decoration origins (image/text watermarks, page bands and generated list labels) are returned by the layout stage as JSON pointers to the source
page settings; they do not enter Layout IR or change its digest. XML validation enforces
legal parent/child and attribute contexts, including text-bearing metadata boundaries.
Stale MaxUnitID values are rejected before allocating a new attachment ID.

Native path validation compares local quantized commands and paint against the actual
OFD PathObject. Native barcodes additionally require an explicitly injected
`BarcodeGeometryResolver` on Create/Extract. The trusted host must run the pinned
`bwip-js@4.11.4/drawing-context@1` media-core algorithm on the bounded owned value/options
request and return its local millimetre command array; the container compares the
commands and black bars/no-stroke paint with the real OFD. Missing host capability
returns `BARCODE_VERIFIER_REQUIRED`; denial or resolver failure produces no successful
artifact/source. The attachment cannot select a resolver, executable or resource URL.
The host is responsible for execution time/cancellation and output limits. The test
bridge `tests/source-container/verify-barcode.mjs` uses the existing encoder with bounded
stdin/stdout and a 15-second cancellable host process; the library never launches it.

These checks validate local content/paint relationships; generated paths additionally use
the explicit real-render host described below. This is not a complete re-layout proof
for every object:
page placement, transforms, declared layout boxes and all layout styles are not rebuilt
by extraction. `internal-consistency-only` does not certify that arbitrary edited source
will reproduce every original pixel. Editing still goes through the real Worker, and
this experimental container profile remains unfrozen.

Numbered paragraphs similarly require an explicit `NumberingLabelsResolver`. The host
executes `numberingLabel` from Layout Core (`ofd-compose/numbering@0`), the same function
used by real layout; .NET has no independent counters, alpha formatting or repeat-start
rules. Its owned request includes only node/repeat identities and numbering descriptors,
not paragraph text or original Data. Request serialization is prepaid before traversal
and capped at 16 MiB; returned labels are bounded and matched to actual text/font faces.
Missing or denied capability fails closed. Effective font-face associations include
family, weight and italic through default, heading, paragraph and fragment overrides.

Semantic reading order is checked against physical page/object order and the first
appearance of each renderable source occurrence in source traversal. Repeated header
occurrences and later text fragments do not create new first appearances.

Occurrence cardinality is checked against source structure. Repeated table header
content is validated on each mapped table-body page; ordinary atomic nodes and text
ranges cannot gain duplicates. Section page numbers are derived from source section
boundaries and validated physical body pages; mutable page witnesses must agree.

Editing repeat identities use per-file opaque instance labels rather than raw business
keys. Parent scopes remain distinct and both source and semantic parts use the same
mapping; keyKind/ordinal describe the editing instances, not the original Data. Generated
repeat-section IDs are likewise replaced in the attachment. Only attachment snapshots
are changed, preserving the original IR. Dynamic valueState is the constant `value`
placeholder for filled text and conveys no original missing/null/value evaluation state.

Page-decoration completeness is derived for each source section/page, respecting hidden
and empty bands. Editing sources omit all unprinted link targets. Underline appearance
and opaque shaping equivalence groups retain original text geometry, using the same
paragraph-style rules as Layout Core; original capture-on/off IR remains identical.

Generated borders, backgrounds, highlights, underlines and other path decorations use an
explicit `SourceRenderResolver`. The request contains owned minimal source JSON and
owned source-image bytes. An authorized host supplies the locked full fonts, runs the
existing Worker/fixed-writer chain, and returns each generated PathObject XML with its
canonical object ID and physical page/index. The library compares the entire expected
set and fixed XML payload (including geometry, paint and clips); it neither implements
a second layout engine nor accepts a self-rehashed source digest as verification.

This capability is required whenever actual path decorations or retained settings that
can generate them exist. Without it, native Create/Extract returns
`SOURCE_RENDER_VERIFIER_REQUIRED`; denial or failed recomputation returns no successful
source/artifact. Full-font availability is therefore needed at this host verification
boundary for those native documents. The library never launches a process or resolves
attachment-chosen paths/URLs. The test host uses known font-manifest hashes, owned temp
files, a cancellable 45-second process and bounded output. This does not close the desktop
reader gate or certify every text/image placement or signature.

Filled input controls retain identity, type, style and their displayed value/fallback.
Choice catalogs (`options`), `required` flags and shadowed placeholders are not retained
in this minimal filled-source profile. Extraction rejects their reintroduction; any
editor choice or validation policy must be provided explicitly by its host.

The complete IR SHA-256 is anchored in the sealed OFD DocInfo Keywords as the single
fixed `ofd-compose:ir-sha256:` value and must equal both manifest/part identities.
Changing the suffix in the attachment while keeping OFD bytes unchanged is rejected.
This remains internal consistency rather than authenticity; the fixed writer itself
is unchanged and sealing adds this envelope metadata.

`SourceRenderResolver` now also supplies real Worker table coordinates/spans/repeated
header relationships and actual generated page-band text. .NET compares those results
instead of implementing page-number formatting or visibility rules. Tables/page bands
therefore require the explicit authorized render host, even without path decorations.
