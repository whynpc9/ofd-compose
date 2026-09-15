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

PdfPig checks logical text and baseline coordinates against transformed IR with a 0.001 pt tolerance. Per-case `*-geometry.json` records measured maximum error. Baseline start error is below 0.001 pt; the separate PdfPig extent endpoint gate is 0.01 pt and measured at most 0.00144567 pt (Letter endpoints use `CharacterBoundingBox.Width`, per fixed reader source). pdf.js additionally checks every decoded `/W` width against IR advance/fontSize to 1e-8 font units. See committed `reader-evidence.json`. The exact pdf.js gate decodes its real `showText` glyph Unicode values; high-level `getTextContent` is independently checked exactly for continuous text, or using a finite object-boundary/known-cluster separator allowlist. Raw expected/actual results are saved in `pdfjs-high-level.json`. No whitespace stripping is used. The original `logical-display` control-prefix mapping is rejected rather than accepted with dropped printable text. PdfPig's combining-mark Letter merge is documented in the writer README and separately tested per isolated glyph.

`mutation-gate.py` modifies generated PDF streams, recomputes stream lengths and xref, then uses Poppler to detect ToUnicode text corruption, CID-to-glyph corruption, text-matrix displacement, removed clipping, changed cubic paths, image-local clipping and image pixel-scale corruption. The added owned 2x2 RGBA fixture makes image mutations visible; the original Worker geometry PNG is fully transparent and remains unchanged. The script asserts that each targeted mutation actually changes bytes and the independent reader/render result. It does not substitute for qpdf or positive geometry tests.

Run fresh test processes and compare output SHA-256 to verify process-independent determinism. PNG visual inspection uses `pdftoppm`; generated artifacts and scratch PDFs are ignored. CI runs readers, mutations and qpdf after .NET tests. Printing, reader product matrices, business fixtures and PDF/A are not accepted by these gates.

Image geometry compares all four PdfPig image corners against the IR mm-per-pixel linear terms and µm translations (0.001 pt tolerance), including PNG, JPEG and transformed/local-clipped image cases. The regression fails on the original missing-1000 implementation; image-scale and image-local-clip raster mutations are independently detected.

Regression boundaries also cover original glyph IDs 2^31 and 2^32−1 with a valid explicit subset map, BMP/supplementary format-suffixed mappings, and isolated MappingTests execution from an absent output directory. Each artifact writer creates its output directory independently.
