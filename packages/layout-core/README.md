# Layout Core: paragraphs and pagination

Issues [09](../../.scratch/first-release/issues/09-layout-core-paragraphs-and-lines.md) and
[10](../../.scratch/first-release/issues/10-layout-core-pagination-headers-footers-watermark.md) implement `layout(ResolvedDocument, LayoutFont[], LayoutOptions)` in shared TypeScript.
The host supplies locked font bytes (or promises) and explicit page/default-font/formatting
options. All fonts finish loading and are digest/style checked before shaping or measuring.
No filesystem, network, DOM, Canvas, system-font fallback or `Intl` is used by this package.

The exported paragraph profile and its feature list are frozen; each invocation owns its internal profile copy.
The result contains canonical integer-µm `ir`, its `semanticMap`, diagnostic-free success,
and paragraph-relative UTF-16 `lines` with **mm** geometry for inspection. Nonsemantic `work` counters report shaped units, candidate/run visits and expanded output-text units. Failure throws
`LayoutError` (code/nodeId) or the existing Typography/IR validation error. Never pass the
returned canonical IR back to `canonicalizeLayoutIR`.

```ts
const result = await layout(resolved, [
  { family: "Noto", weight: 400, italic: false, sha256: lockedDigest, bytes: fontBytes },
], {
  page: { width: 210, height: 297, contentBox: { x: 20, y: 20, width: 170, height: 257 } },
  defaultStyle: { fontFamily: "Noto", fontSize: 12 },
  formattingPolicy: { version: "binding-1", locale: "zh-CN", timeZone: "UTC",
    tzdataVersion: "2026a", rounding: "half-up" },
});
```

The formatting policy must describe the actual binding policy used by the host; layout
checks locale/time zone agreement and records the whole policy in LayoutIdentity. It does
not retroactively verify date computations. Font family is an explicit host alias; each
family/weight/italic tuple must map to exactly one static file, independently of arrival or
resource-array order. Bold selects weight 700, regular 400; italic must be a real face.
A paragraph-base face is resolved only when a marker or an otherwise empty line actually needs it; explicit visible overrides can therefore render without loading an unused base face.
A Chinese italic request fails if that exact font lacks Chinese glyphs.

## Paragraph model

`Paragraph.layout` is optional and is copied by Binding Core into ResolvedDocument. It
uses mm, with these defaults: body role, left alignment, zero indents and paragraph spacing,
1.2 × actual ascent+descent line height, 12.7 mm default Tab interval. Explicit `tabStops`
are positive, strictly increasing, left-aligned distances from the paragraph's left-indent
origin; after the last stop, the default grid applies. A negative `firstLineIndent` gives
hanging indentation and cannot place text outside the content area. Paragraph spaces add;
there is no implicit collapsing inside a page; page-edge rules are defined below. Fixed line height is mm and rejects metric overlap.

Heading role chooses levels 1–6 = 24/20/18/16/14/12 pt, bold; paragraph and inline styles
can override these defaults. List numbering has an explicit `listId`, decimal/lower-alpha/
upper-alpha/bullet format, optional restart `start` and suffix. The bullet is middle dot
U+00B7 within the existing P0 repertoire. Numbering continues by list identity in resolved
body order. For a paragraph expanded by a RepeatBlock, explicit `start` initializes only its
first occurrence within the same parent-instance chain; subsequent inner instances increment.
A new outer group initializes its own start, and a separate non-repeated paragraph with an
explicit start still restarts the list. Markers use the same script itemization as body text, including Latin/Han/Kana suffixes. They must be well-formed single-line text without Tab or break controls. Markers are shaped text before the first line; default indent reserves marker
width plus 2 mm. A supplied indent must fit the marker. Generated labels have no source
semantic entry; source-text extraction follows Semantic Map reading order and therefore
returns the original ResolvedDocument text, without generated labels or decoration paths.

Adjacent fragments of the same effective style and script merge before shaping, even across
StaticText/DynamicText boundaries. Explicit DynamicText style inheritance survives binding;
`explicit` uses defaults plus its own style, while the default merges paragraph style.
The complete paragraph feeds Unicode 17 UAX #14. Opening/closing Chinese punctuation classes
filter optional candidates; actual break positions respect shaped clusters, and candidate
line slices are reshaped before accepting a width. Words wider than the available line
fail visibly; this profile does not perform emergency word splitting or hyphenation.
CR/LF/CRLF and U+2028/U+2029 are mandatory breaks, and Tab/newline logical text is retained
in zero-glyph text objects. A terminal break creates a following empty line.

Left/center/right alignment applies to each line. Justification distributes remaining width
between shaped space clusters or legal Han/punctuation cluster boundaries on non-final, non-mandatory lines.
It preserves clusters and never stretches lines containing Tabs. For center/right alignment on a tabbed line, only the unanchored prefix before the first Tab
is centered/right-aligned within its first tab cell; that Tab's advance shrinks by the same
offset. Every segment following a Tab remains anchored to its declared paragraph-relative
stop. Multiple Tabs, first-line/hanging indents and wrapped lines use the same rule. Thus
`A\tB` with a 20 mm stop keeps B at that stop for all four alignments; center/right moves A
within the preceding cell. Lines without Tabs use ordinary whole-line alignment. Trailing spaces retain their
shaped advance in the width calculation; whitespace is not trimmed from source extraction.

Font size, bold, italic, underline, strikeout, color, highlight, links, superscript/subscript
are emitted as fixed text and path objects. Superscript/subscript use 65% font size and
explicit baseline shifts of −35%/+20% of the original size. Decoration thickness/positions
are fixed profile ratios; highlighter rectangles paint before text. Links retain their
original target in Semantic Map and imply an underline; URL navigation/annotation handling
belongs to the consumer. Font geometry comes from HarfBuzz and OS/2 or hhea line metrics;
advance-based bounds are layout metadata, not exact outline ink bounds.

## Source mapping and compatibility

A ligature such as `of` + DynamicText `fice` can span two source identities. Issue 08's
single `sourceText` cannot represent that relationship, so issue 09 adds optional
`semantics[].sourceRanges[]`: nodeId, optional bindingId, fragment-local source text/range,
and object-local logicalRange. Array order remains logical source order and contributes
to semanticDigest. Each range is independently checked as well-formed UTF-16 without
splitting a surrogate pair; one cluster may overlap several source ranges. Single-source
runs also retain the earlier nodeId/bindingId/sourceText fields. Zero-length fragments remain ordered source entries: boundary entries attach to the preceding object, while paragraph-start entries attach to the first (possibly empty) object. They are not duplicated across run/line boundaries.
Multi-source run nodeId
is the containing paragraph; repeat-instance chains remain on that semantic entry.

Text model verticalAlign/link, paragraph layout, resolved styleInheritance and IR
sourceRanges/link are optional additions to provisional v0, not a version freeze. Existing
v0 instances and issue 08 fixtures remain valid and byte-identical. The updated exported
construction/canonical JSON Schemas include the new properties; older strict consumers
must update their schema before accepting newly populated fields.

## Scope and evidence

This is the LTR horizontal paragraph profile over Typography Core's existing P0 repertoire.
Latin/Han/Greek/Cyrillic/Kana/Bopomofo script runs are itemized without ICU; common and combining
characters inherit the neighboring script. Full Unicode bidi, vertical paragraph layout,
emergency wrapping, tables and input-control rendering are not implemented.
Unsupported block/control types fail; an unbreakable line that exceeds the content width or
height fails with `LAYOUT_OVERFLOW`. Per paragraph limit is 100000 UTF-16 units, checked fragment-by-fragment before text concatenation or run construction; malformed UTF-16 fragments fail at the same point. Per-job
reshaping work is bounded at 2000000 units; candidate and run visits each have the same 2000000-operation ceiling (including control-only text). Before cloning, input JSON is bounded to 200000 nodes, depth 128 and 8000000 UTF-16 string/key units, with non-JSON object types rejected. Document body text has a separate cumulative 1000000-unit limit. Input count limits are 10000 paragraphs and 100000 fragments per document; output count limits are 100000 source mappings and 100000 text/path objects. A data-descriptor preflight rejects over-budget input before document copying/font loading, without invoking accessors. Output cardinality is reserved before mapping/object allocation. These independent counts include empty fragments and blank paragraphs. Expanded logical/display/source text is bounded at
8000000 UTF-16 units, counting repeated source strings in the wire representation; controls
cannot bypass this output budget. Chinese boundary classes are precomputed in two linear passes so candidates sharing a long whitespace run use constant-time checks. Candidate consumption is monotonic; run/source lookups and
gap counts use ordered indexes, and glyph-cluster membership uses maps. Full strings are checked
once before per-source logical-range boundary checks.

`test` includes shared real-font geometry/source/negative cases, the committed corpus 08
narrative, repeat execution, controlled font readiness, and independent Node `crypto`
verification of the shared canonical-byte SHA-256 fixture. `test:browser` runs the shared
cases in actual Chromium. The pinned digest was generated on Node 24.14.1 with locked fonts
and shaper; explicit geometric and text assertions give independent behavioral evidence.
This proves the tested Node/Chromium pair; another Chromium version, Firefox, Linux x64/arm64,
font subsetting, output writers and target readers remain their respective WP0 gates.

Repeated same-pack layout uses Typography Core's bounded immutable-face cache; Font/Buffer state remains per core. See its README for the reproduced native failure, recovery tests, GC constraints and required host isolation for hard memory bounds.

Font acquisition is bounded before ownership copies: at most 64 resources, 32 MiB per buffer and 128 MiB across supplied buffers (including repeated resources). All direct buffers are preflighted before any copy; promised buffers reserve cumulative bytes on arrival and failed acquisition stops later copies. Font definitions also bound family aliases and validate static identity fields. Digest/static-face checks still run after the full resource barrier.


## Pages, sections and page-edge rules

Template `settings.page` (preserved by compile/bind) declares `paper: "A4" | "A5" |
{width,height}`, orientation and four margins in mm. Custom dimensions are normalized to
the selected orientation. Model settings take precedence over the legacy `options.page`
geometry; the latter remains supported for old callers and can be omitted with model settings.
A4 is 210×297 mm and A5 is 148×210 mm. The declared header/footer heights are subtracted
from the margin content area. Nonpositive/quantized-away content dimensions fail.

`Paragraph.layout.pageBreakBefore: true` is the explicit page-break representation. It
always advances a page, including an initial blank page. `layout.section: {id,page}` begins
a section on a new page; on the first paragraph it configures the initial page. Section occurrence IDs
are unique within the resolved document. A repeated section uses `@section:` plus a canonical JSON tuple of the source ID and all
enclosing node/key pairs. This namespace cannot collide with model-valid explicit source
IDs; the allocator also avoids the arbitrary implicit root document ID. Optional
`sectionSourceId` retains the original section ID on pages, semantics and inspection lines.
If a later non-repeated explicit section uses the public document ID, the implicit root
uses a separate `@root:` canonical identity and retains the document ID in sectionSourceId.
This keeps keyed occurrences stable under reordering and gives each occurrence its own page
numbering/hiding scope; non-repeated section IDs remain unchanged. Section start and explicit break both apply when
both are declared, deliberately producing a blank section page. This small model extension
supports the requested page/section contract without introducing another recursive container.

Lines are placed using the selected real font metrics. When the next line does not fit,
it starts at the next content box's top, with paragraph-relative text offsets, indentation,
source fragments and numbering identity preserved. Before-spacing is omitted at page top,
including after an automatic break. After-spacing consumes only the remaining page height;
it never creates a trailing empty page. Space before a paragraph can cause that paragraph
to advance, then is omitted on the new page. A single line taller than the content box fails
instead of repeatedly allocating empty pages. Widow/orphan and keep-with-next policies remain
their later issue's scope.

Every IR page records paper dimensions, orientation, contentBox, index and section source.
Each body Semantic Map entry and inspection line also records `pageIndex` and `sectionId`;
reading order remains the logical body order across page and section boundaries. IR validation
checks semantic page/section references. Generated labels, page bands and watermarks are
artifacts, excluded from body source extraction.

## Page bands, total pages and watermarks

`header` / `footer` have a positive fixed `height`, optional `style`, left/center/right
alignment and ordered `parts`: `{kind:"text",text}`, `{kind:"page-number"}` or
`{kind:"total-pages"}`. Parts share paragraph shaping/wrapping. Overflow of the declared
band height is an explicit `LAYOUT_OVERFLOW`; heights never silently expand into body text.
Band height is reserved even when hidden. Empty parts (or parts joining to an empty string)
reserve space only, without generating a blank paragraph or requiring a font. `hideFirstPage` and one-based `hiddenPages` refer
to physical page positions within the section; `startPageNumber` affects displayed page
numbers only. Total pages counts the entire physical document, including explicit blank pages.

Only total-page fields on actually visible bands participate in convergence; overridden root
settings and wholly hidden fields do not trigger a repeat pass. Total-page fields start with guess 1 and rerun the full layout until actual count equals the
guess. Fixed-height bands normally need at most two passes; `pagination.maxIterations`
(default/hard ceiling 4) bounds attempts, otherwise `PAGINATION_NOT_CONVERGED` is thrown.
The diagnostic can be exercised with a multi-page total-field document and maxIterations 1.
No partial IR is returned. `paginationPasses` and cumulative nonsemantic `work` report actual
work across every attempt. There is no auto-height header convergence/oscillation profile.

`border: {inset,width,color}` uses a closed stroked path within the paper edge. `watermarks`
accept text or image, opacity, an affine transform, and `layer: "behind" | "above"`. Text
is shaped with the same fonts; decoration paths use local coordinates so they rotate with
text. All watermark bounds are transformed to page-space bounding boxes. States use normal
blend/sRGB; background watermarks precede body objects, foreground watermarks follow them.
The renderer visits only newly created watermark states, with no full-document state search.

Images reference bounded, host-authorized `options.images` IR descriptors (ID, digest,
PNG/JPEG MIME and pixel dimensions). Source IDs may use any valid identifier; duplicate source
IDs are rejected, and internal resource IDs are allocated separately from generated font/page/
object IDs. Watermark references are rewritten to those internal IDs. Image matrix scale is width/pixelWidth and
height/pixelHeight; translations and transformed bounds carry physical placement. Layout does
not fetch, decode or authenticate image bytes. Host media validation and writers must supply
bytes matching the descriptor; this issue is IR layout evidence, not image-decoder/writer
acceptance. See Layout IR's matrix/unit convention.

## Pagination budgets and evidence

All issue09 input, font, shaping, candidate/run, source-mapping, output-text and object
budgets remain per invocation, shared across all pages, bands, watermarks and convergence
passes. Additional hard ceilings: 1000 pages per pass (caller may lower `maxPages`), 4 passes,
4000 page allocations across attempts, 30000 body/generated paragraph layouts, 64 image
descriptors and 100 million cumulative declared image pixels. There are at most 16 watermarks
per page. Object and state allocations are reserved before insertion; explicit minimum page
count is rejected before font acquisition. Band text is bounded before joining parts.
Image descriptors are checked before ownership copy. These are deterministic work/allocation
limits, not a native RSS ceiling; host Worker memory/time isolation remains required.

Shared Node/Chromium tests include physical sizes, mixed sections, real-font cross-page
text/range geometry, page-edge spacing, blank pages, hidden bands, numbering/restarts,
bounded total fields, watermark matrices/bounds/layers and negative budgets. The 50-page
fixture has 1250 actual shaped lines, repeated-run canonical-byte equality, a shared digest
and independent Node SHA-256. A separate 1000-page/16000-image-watermark test exercises the
state traversal at the hard page limit. The 50-page content is a **synthetic capacity sample
using real locked fonts**, not a supplied anonymized host business document. Real business
50-page acceptance, Firefox/other browser versions, Linux architecture matrix and final
OFD/PDF reader interoperability remain unverified.
