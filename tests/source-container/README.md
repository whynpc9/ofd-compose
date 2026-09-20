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
4. Regenerate the source schema with `python3 tools/containers/generate-schema.py`.
   It derives the structural contracts from the checked-in document/IR schemas;
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
