# Independent PDF gates

Production writer dependencies remain JsonSchema.Net 7.3.4, BigGustave 1.0.6 (Unlicense), JpegLibrary 0.4.32 (MIT); no PDF generation dependency. Test readers: PdfPig **0.1.11** and pdfjs-dist **5.4.149** (Apache-2.0, locked NuGet/pnpm). qpdf **11.3.0-1+deb12u1** (Apache-2.0) runs in a digest-pinned Debian test container. Poppler **22.12.0-2+deb12u3** is a separately invoked test executable in the same image, not a linked/shipped production component.

Run the solution tests first; they write `.scratch/issue16-output/` using committed Worker OFD fixtures (same canonical IR and subset bytes). Then:

```sh
node tests/pdf-writer/reader-gate.mjs
docker build -t ofd-compose-qpdf tests/pdf-writer
PDF_READER_IMAGE=ofd-compose-qpdf python3 tests/pdf-writer/mutation-gate.py
docker run --rm --network none -v "$PWD/.scratch/issue16-output:/pdf:ro" --entrypoint sh ofd-compose-qpdf \
  -c 'for f in /pdf/*.pdf; do qpdf --check "$f" || exit; done'
```

14 PDF cases include real TTF/CFF, combined report/table/chart/barcode/media, geometry (vertical text, high-precision CTM, cubic paths, even-odd clip, PNG alpha), JPEG, printable logical/display differences (the original control-prefix fixture is a negative), duplicate markers, zero-glyph empty text, two-glyph combining cluster, nonidentity subset map, U+0085 classification contrast, and TTF/CFF same-glyph different-Unicode mappings with supplementary and multi-character strings.

PdfPig checks logical text and baseline coordinates against transformed IR with a 0.001 pt tolerance. Per-case `*-geometry.json` records measured maximum error. Baseline start error is below 0.001 pt; the separate PdfPig extent endpoint gate is 0.01 pt and measured at most 0.00144567 pt (Letter endpoints use `CharacterBoundingBox.Width`, per fixed reader source). pdf.js additionally checks every decoded `/W` width against IR advance/fontSize to 1e-8 font units. See committed `reader-evidence.json`. The exact pdf.js gate decodes its real `showText` glyph Unicode values; high-level `getTextContent` is independently compared literally for every page of all 14 positive PDFs; there is no separator allowlist. Raw expected/actual results are saved in `pdfjs-high-level.json`. No whitespace stripping is used. The original `logical-display` control-prefix mapping is rejected rather than accepted with dropped printable text. PdfPig's combining-mark Letter merge is documented in the writer README and separately tested per isolated glyph.

`mutation-gate.py` modifies generated PDF streams, recomputes stream lengths and xref, then uses Poppler to detect ToUnicode text corruption, CID-to-glyph corruption, text-matrix displacement, removed clipping, changed cubic paths, image-local clipping and image pixel-scale corruption, incorrect Form BBox and incorrect Form font resources. The added owned 2x2 RGBA fixture makes image mutations visible; the original Worker geometry PNG is fully transparent and remains unchanged. The script asserts that each targeted mutation actually changes bytes and the independent reader/render result. It does not substitute for qpdf or positive geometry tests.

Run fresh test processes and compare output SHA-256 to verify process-independent determinism. PNG visual inspection uses `pdftoppm`; generated artifacts and scratch PDFs are ignored. CI runs readers, mutations and qpdf after .NET tests. Printing, reader product matrices, business fixtures and PDF/A are not accepted by these gates.

Image geometry compares all four PdfPig image corners against the IR mm-per-pixel linear terms and µm translations (0.001 pt tolerance), including PNG, JPEG and transformed/local-clipped image cases. The regression fails on the original missing-1000 implementation; image-scale and image-local-clip raster mutations are independently detected.

Regression boundaries also cover original glyph IDs 2^31 and 2^32−1 with a valid explicit subset map, BMP/supplementary format-suffixed and format-only mappings, and isolated MappingTests execution from an absent output directory. Each artifact writer creates its output directory independently.

Cancellation regression deterministically cancels after path enumeration starts and asserts emission stops before consuming the remaining commands; separate tests cover cancelled compression/finalization and writer reuse. Adding cancellation checkpoints leaves all 14 positive PDF hashes unchanged.

PNG/JPEG determinism is also checked under a custom numeric culture with a Unicode minus sign and comma decimal separator; image matrices use the same invariant formatter as other geometry. Both cases fail before the fix and pass after it.

Form grouping adds no visual change: `compare-renderings.py` verifies all 20 pages pixel-for-pixel against immutable pre-Form writer commit `7ecf477571045ad5dc9418c9141efc593f5e55b9` using the same fixed Poppler image. CI archives/builds that baseline and reruns the comparison. The object-map gate checks final Form-stream offsets and drawing coverage, and Form/shared clip expansion uses the aggregate command budget.

Resource cancellation tests cover cancellation after validation enumeration starts, decoder IO, and token propagation into font/JPEG helpers. All OFD validation regressions remain in the solution gate.

`fixtures/whitespace-reader/` contains immutable owned probes demonstrating the pinned reader's whitespace normalization. NBSP/LF glyph mappings are now explicit negatives; ASCII `A  B` (and real Worker `o  f`) remains a normal-input acceptance question, not a passing literal-exact case. Do not treat a green fixed-corpus gate as resolution of that pending decision.

Fallback Form reservations include the entire repeated graphics state (including dash arrays), not only clips; a low-output-budget regression detects otherwise highly-compressible repeated state expansion before emission.

Three RTL cases are stored separately under the generated `rtl/` directory. PdfPig geometry and both pdf.js Unicode/high-level extraction are checked in logical cluster order while retaining original glyph identities/coordinates. `rtl/reference/` requests the original visual emission order using the same glyphs and state. The two nonoverlap cases require exact pixels; the same-color transparent overlap permits only the five pixels / 15 channels measured in `rtl-raster-tolerance.json`, with maximum delta 1. The immutable 14-case / 20-page Form baseline retains zero tolerance. RTL reference raster tolerance is distinct from exact fresh-process PDF-byte determinism.

Parsing cancellation also covers token scanning, canonical quoting/recursion and reference iteration. Tests trigger cancellation during the owned input copy (including malformed JSON) and verify cancellation is not replaced by a validation diagnostic.

Five semantics-free spacing cases verify unrelated columns, a leading boundary space, a trailing boundary space, and widely separated printable/combining glyphs within one cluster. Stock high-level text is literal-exact; pre-fix PDFs in `fixtures/spacing-reference` are independent visual references, and CI requires unchanged pixels.
