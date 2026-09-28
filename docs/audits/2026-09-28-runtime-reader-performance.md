# Audit — 2026-09-28 — Issue 18 runtime, readers and performance

Status: executed runtime/browser/performance evidence is complete; issue 18 remains
**needs-info** for desktop readers and supplied business data. This is not a WP0.10
protocol/profile freeze. Base: issue 17 `4bfa4c9b513d17f31a5eebfcd9fdd42a89a05421` ([PR #14](https://github.com/whynpc9/ofd-compose/pull/14)).

## Frozen inputs and actual runtimes

Measured code: `5ead51614a41ceb6b581f2a469b211508220b55b`. The Worker owns a fresh TypographyCore
per observed job and decorates its shape method. Layout Core only consumes its ordinary
typography dependency; it has no observer interface, clock or event invocation.
The earlier d0627b3 experiment is superseded by these freshly executed images and samples.
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
| Linux arm64 | Native architecture in OrbStack VM on Apple M4 Max | Node 24.19.0; .NET/ASP.NET 10.0.12; no SDK | `sha256:cbc4ff91d0d70ff37ec1b66249d043ca9de645f467d9077c88828eedb88d1b25` |
| Linux x64 | **Emulated x64 on ARM host**, both Node and CLR report X64 | Node 24.19.0; .NET/ASP.NET 10.0.12; no SDK | `sha256:e3eb3bc1fadf11f76914f42b6f62b47a287d6091fc35cc9112d155f71507e961` |

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
| 1 page | cold | 0.9 / 1.0 | 2.8 / 3.5 | 67.9 / 71.9 | 89.1 / 96.3 | 158.8 / 172.8 | 560.2 / 589.4 | 253.5 / 86.5 |
| 1 page | hot | 0.1 / 0.1 | 0.2 / 0.2 | 59.2 / 75.2 | 85.2 / 92.4 | 15.8 / 25.8 | 234.7 / 273.5 | 357.8 / 157.7 |
| 1000 rows / 84 pages | cold | 5.5 / 7.3 | 21.1 / 25.8 | 657.6 / 696.7 | 87.3 / 93.8 | 2060.8 / 2106.2 | 3675.2 / 3758.5 | 447.4 / 525.7 |
| 1000 rows / 84 pages | hot | 1.3 / 2.3 | 7.1 / 9.0 | 595.6 / 625.6 | 87.8 / 96.0 | 1276.8 / 1436.3 | 2629.1 / 2821.9 | 558.4 / 734.0 |
| 50 pages | cold | 1.1 / 1.4 | 8.3 / 11.8 | 152.8 / 172.2 | 88.2 / 94.8 | 367.9 / 385.2 | 964.0 / 1002.1 | 352.4 / 164.7 |
| 50 pages | hot | 0.2 / 0.2 | 2.5 / 4.5 | 115.9 / 126.2 | 71.0 / 79.8 | 100.9 / 140.5 | 443.7 / 509.1 | 460.6 / 212.0 |

### Emulated x64 on ARM — not native x64 performance

| Sample | Mode | Bind | Shape | Layout excl. | Subset | Both writers | Total | Peak Node / CLR MiB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 page | cold | 3.2 / 3.8 | 26.2 / 29.6 | 497.0 / 522.3 | 783.6 / 803.1 | 559.3 / 604.5 | 3319.2 / 3408.0 | 316.5 / 133.2 |
| 1 page | hot | 0.8 / 1.4 | 0.4 / 1.7 | 472.2 / 482.8 | 614.4 / 636.7 | 30.8 / 61.8 | 1623.8 / 1657.7 | 574.6 / 182.4 |
| 1000 rows / 84 pages | cold | 13.8 / 15.6 | 163.4 / 171.1 | 1500.8 / 1564.9 | 619.3 / 633.0 | 3659.8 / 3806.3 | 8467.6 / 8635.4 | 537.6 / 582.3 |
| 1000 rows / 84 pages | hot | 4.3 / 5.3 | 20.1 / 22.6 | 1374.9 / 1408.4 | 600.9 / 612.0 | 1756.9 / 1824.7 | 5271.3 / 5353.6 | 732.8 / 795.0 |
| 50 pages | cold | 3.5 / 4.3 | 63.8 / 69.9 | 673.0 / 698.5 | 617.1 / 638.9 | 934.6 / 960.4 | 3874.7 / 3923.5 | 351.5 / 211.7 |
| 50 pages | hot | 0.8 / 1.6 | 4.7 / 6.7 | 566.0 / 588.5 | 520.2 / 616.9 | 176.5 / 238.0 | 1896.7 / 2003.8 | 534.7 / 278.8 |

Memory columns are separate process lifetime high-water marks (hot includes warmup),
not per-stage peaks and not a simultaneous aggregate. They are never summed.
The 6000-row rejection total p50/p95 in milliseconds:

| Environment | Cold | Hot |
| --- | --- | --- |
| arm64 | 311.4 / 341.1 | 141.6 / 148.2 |
| x64 emulated | 1381.3 / 1405.7 | 587.7 / 600.6 |

These are **failure path costs**, not successful 6000-row throughput; shape/layout/subset/
write were not reached. Native x64 hardware performance remains **Not verified**.

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
`5ead51614a41ceb6b581f2a469b211508220b55b`. Every retained log includes the exact command,
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
- .NET local baseline at d0627b3 (before the observation-boundary refactor):
  exact SDK 10.0.302 with actual CLR/ASP.NET 10.0.10 (separate from the runtime matrix
  images at 10.0.12), locked restore and Release build passed; full MTP run
  **494 succeeded / 0 failed / 0 skipped**, five assemblies. Raw logs retained. An initial
  no-build invocation wrongly forwarded MSBuild-only flags, selected **0 tests / exit 5**,
  and is explicitly excluded; it is not a passing or partially passing test run.
  Current-head whole-solution status is the PR CI check; the refreshed runtime matrix
  executes the actual fixed writers for every positive new-Worker output.
- TypeScript: 12/12 tasks passed. Biome lint and `git diff --check` passed.
- License gate: 25 strict production pnpm packages, 91 dev packages with 4 documented
  exceptions, 28 strict NuGet packages. No package dependency was added for the harness.
- One bounded [two-axis pre-review](2026-09-28-issue18-pre-review.md): Standards 0 findings,
  Spec 0 confirmed implementation defects. This does not replace latest-head PR review/CI.

Issue 18 remains needs-info; desktop and real business gates cannot be inferred from
library/CI/browser success. ADR-0005 stays Proposed; this audit authorizes no issue19
freeze, font-family switch, merge or deployment.
