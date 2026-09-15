# PdfIrWriter — WP0.7

`WriteAsync(canonicalIr, irDigest, resources, limits, cancellationToken)` accepts canonical Layout IR bytes and owned Render Worker subset/image bytes. It returns a PDF 1.7 byte array, SHA-256 and an object map, or diagnostics with both outputs null. It does not read paths/URLs, shape, choose fonts, subset, paginate, or invoke OFD or a PDF generator library.

## Representation

- Page tree, shared resources, Flate streams, classic xref and trailer. ID is the first 128 bits of the canonical IR SHA-256; date fields are omitted. Enumeration is deterministic. No signing, attachments, encryption or PDF/A claim.
- One page CTM converts µm to points and flips Y. Primitive coordinates retain their supplied precision. Text uses `position + offset`, without adding baseline again. Text matrices counter-flip glyph outlines. Vertical runs retain supplied positions and glyph selection using Identity-H; no second vertical shaping pass.
- TrueType uses Type0 / Identity-H → CIDFontType2, FontFile2 and an explicit CIDToGIDMap. Codes distinguish `(subset GID, Unicode substring, IR x advance / font size)`; `/W` carries that advance in 1000-unit glyph space. Every glyph has an absolute text matrix.
- CFF uses **CIDFontType0**, with the unchanged Worker OTF bytes in **FontFile3 /Subtype /OpenType**. CID-keyed CFF maps subset GID through its charset; ROS comes from its explicit strings. Non-CID CFF uses GID as CID. Conflicting text/width mappings allocate another font dictionary sharing the same embedded bytes and descriptor. Never use `CIDFontType0C` as a font dictionary subtype or label an OTF container as raw CFF.
- Descriptor bbox, units/em, ascender, descender, cap height, italic angle, fixed pitch and PostScript name come from SFNT tables. Older OS/2 without cap height uses hhea ascent; StemV is a documented estimate of 80 (SFNT provides no universal stem-width field).
- Paths preserve cubic curves, fill rule, stroke, dash/cap/join and opacity. State clip coordinates are transformed into page space before applying the object CTM; image clips are installed in pixel space. JPEG uses original DCT bytes. PNG uses BigGustave, Flate RGB and an optional grayscale SMask.
- Object map values identify the page object and content stream object with offset/length in **decoded ASCII content bytes**; offsets are not positions in compressed data.

## Text profile and exactness

ToUnicode comes from logical cluster ranges, not cmap lookup. One glyph may map to multiple Unicode scalars, including supplementary characters; the same glyph may map differently at different source positions. A multi-glyph cluster partitions its scalar sequence in supplied glyph order (one scalar per glyph, remaining scalars on the last glyph). The relation remains inside the original cluster. Combining `q́` has separate q and zero-advance acute mappings.

The current lossless extraction profile requires nonoverlapping logical ranges in paint order, every nonempty cluster to have at least one glyph, and no more glyphs than logical Unicode scalars. Ambiguous overlapping/reordered mappings, excess glyphs, and nonempty glyphless text return `UNSUPPORTED_FEATURE`; no invisible replacement text or coarse whole-run mapping is inserted. Glyphless empty text is supported. CID CFF ROS using predefined standard-string SIDs is explicitly outside this profile. These are diagnosed writer boundaries, not changes to the canonical IR schema.

pdf.js `getTextContent` inserts layout spaces between distant columns and moves trailing spaces between items. The exact text gate uses **pdf.js's decoded showText glyph Unicode values**, preserving real spaces, without stripping whitespace or normalizing Unicode. PdfPig `Page.Text` equals the original logical text. PdfPig merges combining marks into the preceding Letter: the combined sample verifies exact text and base geometry; additional isolated-glyph tests verify both original q and acute coordinates independently. This limitation is not reported as a one-Letter-per-glyph proof.

## Resource limits

The shared internal validation sources are compiled separately into each writer, with no OFD assembly/API dependency in PDF. Existing canonical/hash/reference, SFNT/checksum/outline and image policy checks are preserved. JSON bytes/depth/tokens/string bytes, pages, objects, glyphs, path commands (including shared clip expansion), resource closure/bytes and decoded pixels are bounded. Conservative output reservation precedes decoding/emission; streams and final serialization also check output ceilings. PDF objects are capped at 100,000, font variants at 256 per subset and a ToUnicode destination at 512 bytes. PNG remains 8-bit noninterlaced, APNG rejected; JPEG remains 8-bit gray/RGB with EXIF orientation 1. Limits may only lower ceilings.

## Evidence and remaining gates

See [reader tests](../../tests/OFDCompose.PdfIrWriter.Tests/WriterTests.cs), [mapping tests](../../tests/OFDCompose.PdfIrWriter.Tests/MappingTests.cs), and [independent gates](../../../tests/pdf-writer/README.md). Formal device/printing profiles, target readers and business acceptance remain issues 18/19. This module does not claim production acceptance.

Normative source: Adobe **PDF Reference 1.7**, sixth edition, November 2006, §5.6 pp.436–438 (CID dictionaries and glyph selection), §5.8 pp.465–469 (font files/OpenType), §5.9 pp.469–475 (ToUnicode), §4 (graphics), §3.4 (file structure). [Official PDF](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf). This corrects the mixed subtype terminology in the original issue and ADR-0001 without changing the selected backend.
