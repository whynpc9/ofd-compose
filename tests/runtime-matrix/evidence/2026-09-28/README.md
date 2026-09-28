# Captured evidence, 2026-09-28

`source.json` pins the code actually executed in both clean images. `corpus-input.json.gz`
is the exact input file, losslessly compressed to keep repetitive synthetic data out of
the review diff. `corpus-input-archive.json` records compressed and original SHA-256.
Decompress with `gzip -dc corpus-input.json.gz > corpus-input.json`; the original SHA
must equal `source.json.corpusSha256` and both architecture environment records.

`arm64/` and `amd64/` contain actual JSONL rows, completion hashes, inventories,
image inspection and captured command stdout. The amd64 runtime executes under
emulation on the ARM host; it does not establish native x64 performance.
`comparison.json` is the strict input/IR/resources/diagnostics comparison;
`mutation.stdout.txt` records five rejected counterexamples derived from copies of
these real runs. Counterexample files are temporary and never replace raw evidence.

`readers/` contains actual paired CFF/TTF OFD and PDF files, with input/IR/subset/output
identities. They are handoff material, not screenshots or desktop acceptance.
`desktop-readers.json` preserves the missing target reader/license/GUI gates.

`browser/` now retains three complete, forced, serial runs with exact version probes,
commands, full stdout/stderr and exit codes. These supersede its historical summaries.
Initial `dotnet/*.summary.txt` identify summaries where full stdout was not captured;
the later whole-solution logs are retained separately. Summaries are not raw logs.
`node.stdout.txt` is the captured complete Node test run. Generated evidence is excluded
from formatter rewrites so raw file hashes remain valid.
