# Issue 18 runtime and performance evidence

This test-only harness executes the public built Worker and both real .NET writers.
It never supplies precomputed IR as the render input. Production runtime containers
contain ASP.NET 10 and Node 24, production JS dependencies, pinned fonts/WASM,
and the fixed writers; browser and Java verifiers live outside them.

## Inputs and boundaries

`prepare.mjs` reconstructs all 28 library corpus cases using the existing text parser
and explicit native media recipes. It checks local media against the embedded partner.
23 are legal P0 inputs; 5 retain their existing explicit malformed PNG / unsupported
barcode diagnostics. Failing cases are not silently discarded.
Input JSON includes SHA-256 of the original fixtures, all source/data/profile values,
and image bytes. Both architectures consume exactly the same file and font manifests.

Additional cases: CFF and TTF reader pages; synthetic 1/50 pages (one short paragraph
per page, explicit page breaks, not a dense business report); a 1000-row/84-page
bound table; and the **original 6000-row intended 500-page scale**, which the actual
Worker rejects at bind with `RESOURCE_LIMIT: JSON properties exceed budget`.
That capacity rejection remains in both matrices and timing records. It is not a
successful 6000-row rendering benchmark. The 1000-row case is an additional supported
scale measurement, not a replacement or a host business-data claim. No host business
sample was provided, so real business long-table acceptance is **Not verified**.

## Reproduce

Use locked Node/pnpm from the repository. Restore dependencies and build as usual.
The .NET probe is included in `dotnet/OFDCompose.slnx`; restore lockfiles and build
with SDK 10.0.302, writable `DOTNET_CLI_HOME`, telemetry/first-run disabled, and
`-m:1 /nodeReuse:false /p:UseSharedCompilation=false --disable-build-servers`.

```sh
node --experimental-transform-types tests/runtime-matrix/prepare.mjs
# Commit implementation before freezing the context. This rebuilds JS and archives HEAD.
node tests/runtime-matrix/context.mjs /private/tmp/ofd18-context
# Run each build and validation sequentially; inspect/tag the actual produced image ID.
docker build --platform linux/arm64 -f tests/runtime-matrix/Dockerfile -t ofd18-arm64 /private/tmp/ofd18-context
docker build --platform linux/amd64 -f tests/runtime-matrix/Dockerfile -t ofd18-amd64 /private/tmp/ofd18-context
```

For each image, create a separate host output directory and use:

```sh
docker run --rm --platform linux/arm64 --network none --cpus 2 --memory 4g \
  --read-only --tmpfs /tmp:rw,size=256m \
  -e MATRIX_SOURCE_IDENTITY=/workspace/.matrix/source.json \
  -e MATRIX_EXECUTION_LABEL='native arm64 on ARM host' \
  -e MATRIX_IMAGE_ID='<actual docker image inspect Id>' \
  -v '<absolute output directory>:/evidence' ofd18-arm64 \
  tests/runtime-matrix/run.mjs corpus .matrix/corpus.json /evidence /probe/OFDCompose.RuntimeProbe.dll
# Repeat with mode benchmark, then for the amd64 image. On an ARM host label x64 emulated.
node tests/runtime-matrix/compare.mjs <arm64-output> <x64-output> <comparison.json>
node tests/runtime-matrix/mutation-gate.mjs <arm64-output> <x64-output>
node tests/runtime-matrix/summarize.mjs <output> <performance.json>
```

The runtime inventory records OS packages, missing prohibited executables, absent
SDK, actual Node/CLR architectures, source SHA/archive/lock/input hashes and image ID.
Keep `docker inspect`, build logs and exact invocation alongside evidence: labels alone
do not establish native execution. The pair comparator requires Linux arm64 and x64,
34 distinct same-input outcomes including 6 negatives, and both writers for every
positive. It verifies completion hashes; an interrupted partial file is not a pass.
Final ZIP/PDF byte equality is not the canonical-IR oracle; output hashes identify the
actual artifacts and each sample records subset identity and diagnostics.

## Measurement definitions

Default: 20 fresh-process cold samples, then 3 discarded warmups and 20 persistent-process
hot samples **per case**, sequentially. Environment overrides may increase these counts.
Nearest-rank p50/p95 are calculated from raw samples; no latency SLO is asserted.
Cold means new Node/CLR/module/JIT state; the OS page cache is not purged. Hot retains
Node font/wasm acquisition and process caches, while the real Worker still owns, checks
and subsets each request. CLR loads spool input on every sample. Node and CLR are separate
processes and their lifetime high-water memory marks are reported separately, never summed
or mislabelled as per-stage peaks. A hot process's marks include its warmups.

`RenderControl.observe` is an optional trusted-host hook; Core has no clock dependency.
Compile, bind, initial input/resource ownership, media, subset and final identity
intervals surround actual stages. `resources` includes source/data/profile snapshot
validation and authorized resource copying/digest checks, not just file acquisition. Shape measures actual TypographyCore.shape calls through a job-owned Worker decorator;
Layout Core has no observer interface or event calls.
`layoutExclusive = layout - shape`. This includes layout setup/font loading/line breaking
but excludes measured shape calls. Observer overhead is present in benchmark samples.
The dual test checks fully equal output/identity with and without observation.
A failed render may leave an open stage and has no timings for stages it never reached.

`resourceLoadMs` measures explicit filesystem resource acquisition outside Worker.
`renderMs` includes the complete Worker call, resource validation, all stages and identity
work. `ofdMs`/`pdfMs` surround both fixed writer calls, including their validation/compression;
subset runs once in Worker and identical bytes feed both. `wallMs` additionally includes
spool serialization/I/O, both actual outputs, IPC, and cold process startup. Source attachment
is off; reader attachment compatibility remains issue 17's separate gate. HTTP/queue/network
and business data are not measured. Do not call this HTTP endpoint performance.

## Browsers and desktop readers

`tools/browser-matrix/` controls existing shared kernel suites with explicit engine/path
and records the actual launched version. Turbo keys include both overrides. Retain each
suite's counts/logs and official version provenance; Playwright's bundled browser alone
is not a claim to the latest stable majors.

Desktop target readers are a distinct manual gate. For each licensed 数科/福昕/WPS version,
record OS/version/license availability, open both `reader-cff`/`reader-ttf` OFD and PDF,
record zoom/DPI/antialiasing, save screenshots and judge text/borders/images separately.
Copy exact text `中文 office é 2026` and search `中文` / `office`; preserve actual Unicode
and search-hit evidence. Then extract the issue17 attachment from its original/edited
OFDs and compare payload hashes. Do not use a library reader or installed-app presence
as desktop acceptance. Missing observations stay **Not verified**. An actual CFF failure
opens a font-family decision; neither this harness nor an environment gap switches fonts.
