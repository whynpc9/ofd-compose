# OfdIrWriter — issue 15 / WP0.6

`WriteAsync(canonicalIrBytes, irSha256, resources, limits?, cancellationToken?)`
accepts the **final** Worker integer-µm transport plus its exact subset/image bytes.
Success returns the final OFD bytes, their SHA-256, and every painted IR object's
OFD ID array. Failure returns diagnostics and no partial bytes/map. The current
mapping is one output object per IR object; the public map permits one-to-many.
Markers and source/reading-order metadata remain in the canonical IR; source
attachments/navigation are issue 17, not silently inferred from document order.

## Fixed backend and adaptations

Core/Packaging and the test Reader are vendored unmodified from
[`ofdrw.net b0df084`](../../../third_party/ofdrw.net/README.md), MIT,
upstream version `0.1.0-preview.5`. Their local build targets net10.0. No Converter
package is included; Layout source is pinned but no flowing builder is called.
The original repository was read only. JsonSchema.Net 7.3.4 (MIT), BigGustave 1.0.6
(Unlicense), and JpegLibrary 0.4.32 (MIT) are locked in `packages.lock.json`.

The adapter creates XML exclusively with XElement/XAttribute/XText from validated
IR; callers cannot supply SourceXml. It sets the standard 2016 namespace and
`DocType=OFD` instead of upstream's legacy defaults. Packaging has three relevant
limitations addressed **before returning or testing** the final archive:

- It omits DocID. The finalizer adds 32 lowercase hex digits from the first 128 bits
  of the complete canonical IR SHA-256. This is a deterministic document identifier,
  not an authenticity/security assertion or an independent random UUID.
- It rounds image/path CTM coefficients to three decimal places. The finalizer
  restores those six numbers from the adapter's exact matrices.
- Intermediate XML serialization normalizes CRLF. The finalizer restores the original
  logical TextCode and uses XML entitization for CR, preserving control characters
  representable in XML 1.0 and escaping markup characters.

Both Readers consume these final archives. The finalizer also checks entry paths,
entry/expanded sizes, unique IDs, font/image references and returned object IDs.
It accepts only its own generated ZIP. XML parsing prohibits DTD and external
resolution. Font/image bytes are copied unchanged through both packaging stages.
ZIP entries use a fixed 1980 timestamp. Repeat tests compare all entry names and
payload hashes; no document field is ignored. Returned SHA-256 hashes the final ZIP.

## Geometry and text

All length fields divide by 1000 once; no re-quantization, measuring, shaping,
font selection or subsetting occurs. Glyph origin is `position + offset`.
`baseline` is never added again. DeltaX/DeltaY are differences between successive
**glyph origins**, including zero/negative/vertical advances; they do not follow
UTF-16 character count. Each TextObject has a page-sized, zero-origin Boundary so
IR bounds metadata does not create another translation or clip. Page clipping
still applies.

CGTransform explicitly maps logical UTF-16 code ranges to subset glyph IDs. Normal
ordered cluster partitions keep individual n:m cluster maps (ligatures, combining
marks, surrogate pairs included). Reordered/overlapping logical cluster ranges use
one n:m map for the entire run to preserve the visual glyph stream. In that case,
per-cluster selection/source navigation must use the retained canonical IR, not a
reader's inferred character positions. This does not claim device-level selection
behavior. The pinned Java Reader uses UTF-16 code counts; broader reader handling
of supplementary characters remains a device gate.

LogicalText is the extractable TextCode, while displayText determines the upstream
shaped glyph stream. Source strings/ranges are separately validated and never
substituted for logical text. Glyphless text uses a nonpainting (`Fill=false`,
`Stroke=false`) TextObject with the genuine Worker .notdef subset; no glyph is
invented. Painted glyphs with empty logical text return `UNSUPPORTED_FEATURE`.

Local paths use the state CTM; page-space paths do not apply it again. Fill rules,
stroke, dash, cap/join, opacity and draw order are explicit. State clips use their
state transform; an image clip's pixel coordinates use state × pixel matrix.
Separate OFD Clip elements intersect these regions. Image CTM maps the OFD unit
square using state × pixel matrix × pixel dimensions. Tiny/fractional coefficients
remain intact. Colors/alpha are rounded to OFD's 8-bit values (maximum channel
error 1/510); this is distinct from coordinate precision.

## Validation and budgets

Before JSON DOM allocation: 32 MiB wire size, 2M tokens, 8 MiB aggregate encoded
strings, depth 64; exact wire hash and canonical spelling/order. Shared schema plus
relational validation covers resource/state/object IDs, page containment, canonical
definitions, subset maps, cluster membership/coverage, UTF-16 boundaries, semantic
source ranges/page identities and semantic digest. No transported semantic field
is removed before hashing.

Before resource copies: 128 entries, 32 MiB each, 160 MiB total, exact resource
closure/digests. SFNT checks cover directory bounds/nonoverlap/checksums, header and
style/metrics metadata, TrueType loca/contours/composite references/cycles, and CFF
INDEX/charset/FDSelect/FDArray/Private/Subrs structure. It does not execute TrueType
instructions or CFF charstrings, or certify every future reader's font parser.

Before full image decoding: MIME signatures, PNG CRCs and bounded zlib expansion,
actual dimensions and cumulative 16M pixels. Current PNG profile: 8-bit,
noninterlaced; JPEG: 8-bit grayscale/three components. Other real variants return
`UNSUPPORTED_FEATURE`. JPEG decoding uses a 128 MiB bounded memory pool and block
count budget. These decoder checks do not replace the runtime's hard process limit.

Before object expansion: 1000 pages, 200k objects, 1M glyphs, 1M path commands
**including every repeated state clip**, conservative XML/copy reservation, 4096
ZIP entries, 256 MiB output. Limits may only be lowered. Generated archive copying
has additional entry/path/byte checks. These are logical limits, not a promise that
peak process RSS equals output size; the host must isolate/terminate a worker for
hard CPU/RSS limits.

## Verification

See [reader gate](../../../tests/ofd-writer/README.md). Committed real Worker fixtures
include issue 14's unchanged four-page combination, CFF, TrueType, empty text, and a
JPEG combination. Separate explicitly derived fixtures cover vertical/offsets,
nonidentity high-precision transforms, page/local cubic paths, combined clips,
logical/display differences with CRLF/XML characters, and glyphless logical text.
The combined IR hash equals issue 14's `expected.json`; no synthetic equivalent IR
replaces that sample. Existing stress tests remain unchanged.

Reader extraction/geometry and byte identity are automated. Reader rendering,
printing, selection/copy/search in target devices, CFF/TTF visual interoperability,
and the final production geometric tolerance remain issues 18/19. The 0.05 mm PoC
observation line is not a production acceptance threshold.
