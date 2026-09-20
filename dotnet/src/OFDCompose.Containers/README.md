# Experimental source attachments (issue 17 / WP0.8)

`SourceContainer.Create` seals a **fresh OfdIrWriter output** as `NativeEditable` or
`Distribution`. It never lays out a page. `Extract` returns validated source JSON
and source-image assets; it never binds expressions, opens a path/URL, loads a
font, executes attachments, or verifies signatures.

The experimental format has one `application/json` attachment named
`ofd-compose.json`, registered through standard OFD `Attachments.xml`. Its
`namespace=ofd-compose`, `protocol=ofd-compose/source@0`, and
`containerProfileVersion=ofd-compose/container-experimental@0` are explicit.
Four parts carry minimal ResolvedDocument, exact RenderProfile, resource inventory,
and Semantic Map. Each part's `content` is a **JSON string containing JSON text**;
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
logs, provenance and unused styles; it retains printed text, active input-control
semantics, stable node/binding/repeat identities and source ranges. It does not
redact values deliberately displayed in the document. Embedded image data is needed
content, not business-input retention. Full font metadata and byte lengths are
separate from Layout IR `originalDigest` / `subsetDigest`; full fonts are not embedded
as editing assets. `finalizeSource(content, authorizedPack)` checks those full font
locks before using the same media/layout/subset chain as `render`. The host must
supply an authorized content-addressed pack. A denied, missing, corrupt or subset-only
font fails; there is no system-font or URL fallback. `finalizeResolved` is the lower
level filled-document seam; neither seam compiles or rebinds. Callers assign a new
revision ID when editing. Re-rendered documents omit synthetic template/data hashes.

Distribution accepts no editing source/assets and emits an empty parts/object map,
`derived-no-source` capability and `distribution` profile. Sealing an already-signed
input is rejected. Extraction reports `unsigned` or `present-unverified` only.
`internal-consistency-only` **does not mean authentic or signature-verified**; a party
able to replace content and recompute hashes can create an internally consistent file.

See ADR-0005. Single versus multiple attachments is **not frozen** until extraction
through at least one named desktop target reader is actually verified. The .NET and
Java Reader tests are independent library evidence, not desktop viewer acceptance.
