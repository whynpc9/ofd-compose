# Layout Core: paragraphs and lines

Issue [09](../../.scratch/first-release/issues/09-layout-core-paragraphs-and-lines.md)
implements `layout(ResolvedDocument, LayoutFont[], LayoutOptions)` in shared TypeScript.
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
there is no implicit collapsing. Fixed line height is mm and rejects metric overlap.

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
emergency wrapping, tables, input-control rendering and page breaking are not implemented.
Unsupported block/control types fail; content, spacing or unbreakable text exceeding the one
page fails with `LAYOUT_OVERFLOW`. Per paragraph limit is 100000 UTF-16 units, checked fragment-by-fragment before text concatenation or run construction; malformed UTF-16 fragments fail at the same point. Per-job
reshaping work is bounded at 2000000 units; candidate and run visits each have the same 2000000-operation ceiling (including control-only text). Before cloning, input JSON is bounded to 200000 nodes, depth 128 and 8000000 UTF-16 string/key units, with non-JSON object types rejected. Document body text has a separate cumulative 1000000-unit limit. Input count limits are 10000 paragraphs and 100000 fragments per document; output count limits are 100000 source mappings and 100000 text/path objects. A data-descriptor preflight rejects over-budget input before document copying/font loading, without invoking accessors. Output cardinality is reserved before mapping/object allocation. These independent counts include empty fragments and blank paragraphs. Expanded logical/display/source text is bounded at
8000000 UTF-16 units, counting repeated source strings in the wire representation; controls
cannot bypass this output budget. Chinese boundary classes are precomputed in two linear passes so candidates sharing a long whitespace run use constant-time checks. Candidate consumption is monotonic; run/source lookups and
gap counts use ordered indexes, and glyph-cluster membership uses maps. Full strings are checked
once before per-source logical-range boundary checks. Pagination remains issue 10.

`test` includes shared real-font geometry/source/negative cases, the committed corpus 08
narrative, repeat execution, controlled font readiness, and independent Node `crypto`
verification of the shared canonical-byte SHA-256 fixture. `test:browser` runs the shared
cases in actual Chromium. The pinned digest was generated on Node 24.14.1 with locked fonts
and shaper; explicit geometric and text assertions give independent behavioral evidence.
This proves the tested Node/Chromium pair; another Chromium version, Firefox, Linux x64/arm64,
font subsetting, output writers and target readers remain their respective WP0 gates.

Repeated same-pack layout uses Typography Core's bounded immutable-face cache; Font/Buffer state remains per core. See its README for the reproduced native failure, recovery tests, GC constraints and required host isolation for hard memory bounds.

Font acquisition is bounded before ownership copies: at most 64 resources, 32 MiB per buffer and 128 MiB across supplied buffers (including repeated resources). All direct buffers are preflighted before any copy; promised buffers reserve cumulative bytes on arrival and failed acquisition stops later copies. Font definitions also bound family aliases and validate static identity fields. Digest/static-face checks still run after the full resource barrier.
