# Audit — 2026-09-28 — Issue 18 runtime, readers and performance

Status: executed runtime/browser/performance evidence is complete; issue 18 remains
**needs-info** for desktop readers and supplied business data. This is not a WP0.10
protocol/profile freeze. Base: issue 17 `4bfa4c9b513d17f31a5eebfcd9fdd42a89a05421` ([PR #14](https://github.com/whynpc9/ofd-compose/pull/14)).

## Frozen inputs and actual runtimes

Measured code: `d0627b31067c137fb438762eb53f89723b799a5f`. Subsequent evidence/reporting
changes do not change the measured Worker, writers, input generator or runtime sampler.
[Source identity](../../tests/runtime-matrix/evidence/2026-09-28/source.json) records the
Git archive, lockfile and built JS hashes. The exact input is retained losslessly in
[corpus-input.json.gz](../../tests/runtime-matrix/evidence/2026-09-28/corpus-input.json.gz),
with original SHA-256 `4796ec9c30bceeeee22717486abce25fd01c9fc9fcd7c13d23150b23c2ee741a`.
Fonts are the committed Noto Sans CJK SC CFF and LXGW WenKai TTF (OFL-1.1), with original
and subset hashes per case. Node, HarfBuzz, subset WASM, profile and writer output
identities are recorded in every raw row. Hashes establish experiment identity/internal
consistency, not signatures or authenticity.

| Environment | Actual execution | Runtime | Image ID |
| --- | --- | --- | --- |
| Linux arm64 | Native architecture in OrbStack VM on Apple M4 Max | Node 24.19.0; .NET/ASP.NET 10.0.12; no SDK | `sha256:526b8e0f79d9fdf17c9efd651ae5c8f1bf34bcabd479c748976d0fb54fdac632` |
| Linux x64 | **Emulated x64 on ARM host**, both Node and CLR report X64 | Node 24.19.0; .NET/ASP.NET 10.0.12; no SDK | `sha256:d1cacddc4ff8454e7d25d789429690d71614d93e30ece9ecd73af1935c3e7cd1` |

Images use the pinned official ASP.NET base and Node binary, with production JS dependencies.
The SDK 10.0.302 build stage is native and emits a portable managed DLL without an apphost;
actual target CLRs execute it. See [image locks](../../tests/runtime-matrix/image-lock.json),
[exact commands](../../tests/runtime-matrix/evidence/2026-09-28/docker/invocations.md), and
per-architecture inventories/image inspection. Actual runs used network none, read-only
root, 256 MiB tmpfs, 2 CPU quota (`cpu.max=200000 100000`) and 4 GiB memory limit.
Package/executable inventory found no Word, LibreOffice, Chromium/Chrome/Firefox or JVM;
`dotnet --list-sdks` was empty. This is executed evidence, not only a Dockerfile claim.

## Corpus and failure boundaries

[Strict comparison](../../tests/runtime-matrix/evidence/2026-09-28/comparison.json):
34 exact input/outcome matches, including canonical IR/resource identities and complete
diagnostics. All 28 positives ran both actual fixed writers on each architecture.
The original library contributes 23 positives and 5 explicit malformed-PNG / unsupported
barcode negatives. Two font-format reader pages and three successful synthetic scale
cases are additional positives. The sixth negative is the 6000-row capacity case below.
Five counterexamples (changed IR, lost negative, changed font, missing image identity,
and same architecture) were rejected after recomputing their untrusted file checksums.

The public Worker rejects the unchanged 6000-row intended 500-page table before layout:
`RESOURCE_LIMIT`, phase `bind`, message `JSON properties exceed budget`. That input and
its failure timing remain in both matrices. The existing layout-only 6000-row/500-page
unit test is not end-to-end Worker support. The separate 1000-row/84-page successful
sample supplements it; no resource ceiling or existing stress test was reduced.
Both are synthetic. Real host business long-table acceptance is **Not verified**.

## Performance method and results

Host: Apple M4 Max, 16 logical CPUs, 128 GiB RAM. Docker 29.4.0 / OrbStack Linux arm64.
This is a shared host, without exclusive CPU affinity; 13 other containers were running
at the inventory point. Agent builds/tests were completed before timed runs. Figures
are environment-specific reference data, not an SLO or native x64 capacity estimate.

Per architecture: 4 cases × (20 fresh-process cold + 3 discarded warmups + 20 hot) =
172 raw rows, of which 160 are measured samples. p50/p95 use nearest rank. Cold resets
Node and CLR processes/modules/JIT, not the OS page cache. Hot retains each process and
Node resource acquisition; Worker ownership checks, layout and subsetting still run.
All 344 raw rows reproduce their architecture's corpus input/outcome exactly; each
successful case also retained one stable OFD and PDF output digest throughout sampling.

1/50-page inputs have one short paragraph per page with explicit page breaks, not a
dense business report. The 1000-row sample binds a real repeated table through Worker
and emits 84 pages in both formats. Raw data and complete phase distributions:
[arm64](../../tests/runtime-matrix/evidence/2026-09-28/arm64/performance.json),
[x64 emulated](../../tests/runtime-matrix/evidence/2026-09-28/amd64/performance.json).
The adjacent `benchmark.jsonl`, completion hashes and environment files retain every
sample, including warmups and explicit failure outcomes.

Each timing cell below is **p50 / p95 in milliseconds**. Layout is exclusive of measured
shape calls. Write is the per-sample sum of actual OFD and PDF calls, then percentiled;
it is not a sum of independently calculated percentiles. Raw summaries also give each
format separately, compile, initial ownership/validation, media, final identity and
resource acquisition. Total includes both writers, spool/normal buffered file I/O and
cold startup. No fsync/durable-storage guarantee, HTTP/queue/network or source-attachment
cost is included. The subset is made once and identical bytes feed both formats.

### Native arm64 architecture

| Sample | Mode | Bind | Shape | Layout excl. | Subset | Both writers | Total | Peak Node / CLR MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 page | cold | 1.0 / 1.1 | 2.9 / 3.9 | 68.7 / 72.4 | 90.0 / 99.9 | 158.0 / 167.0 | 561.5 / 590.3 | 254.2 / 86.6 |
| 1 page | hot | 0.1 / 0.2 | 0.2 / 0.2 | 58.8 / 65.9 | 85.3 / 98.1 | 18.9 / 36.9 | 239.1 / 276.5 | 390.3 / 154.3 |
| 1000 rows / 84 pages | cold | 5.7 / 6.7 | 19.7 / 24.2 | 666.0 / 699.3 | 88.3 / 94.1 | 2082.1 / 2162.3 | 3718.2 / 3799.4 | 445.6 / 537.1 |
| 1000 rows / 84 pages | hot | 1.3 / 2.5 | 7.5 / 9.6 | 602.5 / 622.2 | 88.7 / 96.6 | 1293.1 / 1428.0 | 2665.2 / 2895.8 | 567.2 / 725.2 |
| 50 pages | cold | 1.1 / 1.3 | 8.7 / 12.1 | 156.3 / 173.6 | 87.0 / 90.2 | 369.1 / 398.7 | 962.3 / 1033.6 | 349.7 / 164.5 |
| 50 pages | hot | 0.2 / 0.2 | 2.6 / 4.0 | 117.4 / 130.2 | 72.5 / 86.3 | 117.9 / 158.3 | 454.2 / 501.5 | 456.8 / 209.8 |

### Emulated x64 on ARM — not native x64 performance

| Sample | Mode | Bind | Shape | Layout excl. | Subset | Both writers | Total | Peak Node / CLR MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 page | cold | 3.2 / 3.5 | 25.4 / 27.4 | 498.6 / 509.9 | 784.5 / 803.7 | 563.9 / 598.6 | 3312.9 / 3421.8 | 316.1 / 133.6 |
| 1 page | hot | 1.1 / 1.7 | 0.4 / 1.6 | 461.9 / 476.7 | 602.2 / 616.0 | 30.5 / 59.5 | 1587.5 / 1649.0 | 571.5 / 182.7 |
| 1000 rows / 84 pages | cold | 13.4 / 19.6 | 160.0 / 176.3 | 1491.5 / 1519.2 | 614.7 / 637.2 | 3615.8 / 3730.3 | 8368.1 / 8496.1 | 537.7 / 580.8 |
| 1000 rows / 84 pages | hot | 4.4 / 5.5 | 18.9 / 21.4 | 1333.0 / 1361.1 | 593.9 / 611.2 | 1720.8 / 1807.9 | 5177.8 / 5255.8 | 713.9 / 786.1 |
| 50 pages | cold | 3.7 / 4.2 | 63.6 / 67.3 | 673.4 / 695.4 | 616.1 / 631.7 | 924.1 / 970.5 | 3857.5 / 3934.2 | 351.0 / 212.4 |
| 50 pages | hot | 0.7 / 1.5 | 5.5 / 6.8 | 562.2 / 591.0 | 509.4 / 603.8 | 156.8 / 204.9 | 1868.7 / 1933.6 | 540.8 / 296.9 |

Memory columns are separate process lifetime high-water marks (hot includes warmup),
not per-stage peaks and not a simultaneous aggregate. They are never summed. The
6000-row rejection total p50/p95 is 314.5/339.7 ms cold and 140.0/146.3 ms hot on arm64,
and 1373.5/1426.6 ms cold and 585.6/601.4 ms hot under x64 emulation. These are **failure
path costs**, not successful 6000-row render throughput; shape/layout/subset/write were
not reached. Native x64 hardware performance remains **Not verified**.

## Desktop reader matrix — Not verified

Fresh filesystem inventory on 2026-09-28 found Foxit Phantom 11.3.2009 in `/Applications`.
No 数科 or WPS installation was found under `/Applications` or the user Applications
folder. This is a limited installed-application inventory, not proof of OFD support,
license availability, or installed software on other machines. The prior issue17 UI
attempt yielded no screenshot, and this audit does not reuse it as an observation.

| Candidate | Version / OS | License availability | CFF OFD/PDF text, border, image display | TTF OFD/PDF display | Copy / search | Screenshot | Issue17 source extraction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 数科 | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified |
| 福昕 | Phantom 11.3.2009 installed on macOS; OFD-capable target build Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified |
| WPS | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified | Not verified |

Open action: provide an available, legitimately licensed OFD-capable target environment;
follow the fixed CFF/TTF sample and text/region procedure in the harness README, record
actual version/OS/DPI and retain screenshots/copied Unicode/search hits and attachment
hashes. No CFF desktop failure has been observed, so there is no evidence here for a
font-family switch. ADR-0005 remains Proposed and issue 17 remains needs-info. Library
reader and browser kernel checks do not close these desktop gates.

## Browser kernel execution

The existing seven shared suites were rerun serially with explicit engine/executable
paths, `--force --concurrency=1`, at code SHA
`1b4c6db124bb9bdc349d5497370608aaa662f4f2`. Every retained log includes the exact command,
actual launch/version probe immediately before the test, full stdout/stderr and exit 0.
Each completed **7/7 suites, 409 tests, zero cached tasks, no failures or skipped suites**:
Chrome 154.0.8037.58, Chrome for Testing 153.0.8010.12, and Playwright Firefox 155.0.
CfT 153 is Google's fixed Early Stable build of the previous stable major, not a claim
to its latest patch. Playwright Firefox is not a stock desktop OFD reader.

See [complete browser evidence](../../tests/runtime-matrix/evidence/2026-09-28/browser/browser-matrix.json)
for raw logs, per-suite counts, exact versions, official release sources and checksums.
These logged full runs supersede the earlier summary-only and split-Firefox evidence.
The earlier Turbo override mistakes remain disclosed as excluded history; no invalid
run is promoted to a pass. No desktop OFD rendering is inferred from kernel tests.


The actual paired reader files and their hashes are in
[readers/](../../tests/runtime-matrix/evidence/2026-09-28/readers/manifest.json).
[Initial/edited source-attachment OFDs](../../tests/runtime-matrix/evidence/2026-09-28/readers/source-attachment/manifest.json)
from the full .NET run are retained for issue17 extraction handoff. They do not supply
a desktop screenshot or license/extraction result.

## Regression and review evidence

- Node: 619 passed, 21/21 tasks, zero cached tasks; complete stdout retained.
- .NET: exact SDK 10.0.302 with actual CLR/ASP.NET 10.0.10 (separate from the runtime matrix
  images at 10.0.12), locked restore and Release build passed; full MTP run
  **494 succeeded / 0 failed / 0 skipped**, five assemblies. Raw logs retained. An initial
  no-build invocation wrongly forwarded MSBuild-only flags, selected **0 tests / exit 5**,
  and is explicitly excluded; it is not a passing or partially passing test run.
- TypeScript: 12/12 tasks passed. Biome lint and `git diff --check` passed.
- License gate: 25 strict production pnpm packages, 91 dev packages with 4 documented
  exceptions, 28 strict NuGet packages. No package dependency was added for the harness.
- One bounded [two-axis pre-review](2026-09-28-issue18-pre-review.md): Standards 0 findings,
  Spec 0 confirmed implementation defects. This does not replace latest-head PR review/CI.

Issue 18 remains needs-info; desktop and real business gates cannot be inferred from
library/CI/browser success. ADR-0005 stays Proposed; this audit authorizes no issue19
freeze, font-family switch, merge or deployment.
