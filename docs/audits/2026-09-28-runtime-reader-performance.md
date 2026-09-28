# Audit — 2026-09-28 — Issue 18 runtime, readers and performance

Status: in progress; no issue 19 protocol/profile freeze is authorized by this audit.
Base: issue 17 `4bfa4c9b513d17f31a5eebfcd9fdd42a89a05421` (PR #14).

The reproducible implementation is in `tests/runtime-matrix/README.md`. Final pinned
source/image/input identities and raw performance files will be attached after the
clean-container runs. Development host smoke is not clean-container acceptance.

## Confirmed capacity boundary

The unchanged public Worker rejects the synthetic 6000-row table before layout:
`RESOURCE_LIMIT`, phase `bind`, message `JSON properties exceed budget`.
The input remains in the corpus and benchmark as an explicit negative outcome. The
existing layout-only 6000-row/500-page test does not establish end-to-end Worker support.
A separate 1000-row/84-page synthetic input completes Worker rendering. Neither input
is a supplied host business template. Business long-table evidence: **Not verified**.
No resource ceiling was relaxed and no existing stress test was removed.

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

The existing seven shared suites ran with explicit engine/executable overrides. Actual
versions were obtained from launched Playwright browsers, not inferred from download
labels. Chrome 154.0.8037.58 passed 409 tests in 7 uncached tasks. Chrome for Testing
153.0.8010.12 passed the same 409 tests in 7 uncached tasks; this is Google's fixed
Early Stable build of the previous stable major, not a claim to its latest patch.
Playwright Firefox 155.0 passed 338 tests in six suites and 71 Worker tests in a separate
corrected run. The first Worker attempt lost the engine override in Turbo and was
interrupted; it is excluded from Firefox evidence. This is 409 covered tests across
two runs, not an uninterrupted full run or a stock desktop Firefox application claim.

See `tests/runtime-matrix/evidence/2026-09-28/browser/` for exact commands, actual launch
outputs, per-suite counts, official release URLs, and checksums. Complete browser stdout
was observed in the execution session but not captured to files; retained counters are
explicitly summaries. No desktop OFD rendering is inferred from these kernel tests.

## Other regression checks

Node: 619 tests passed, 21/21 tasks, zero cached tasks, serial `pnpm test --concurrency=1`.
The added observation test verifies full result equality and correctly nested shape
intervals. Full stdout and its checksum are stored in the dated evidence directory.
Workspace TypeScript: 12/12 tasks passed. Biome lint and `git diff --check` passed.

The new .NET RuntimeProbe dependency lock was generated, then locked restore and
Release build passed with exact SDK 10.0.302 from the cached official MCR image.
Build: 0 warnings, 0 errors, 4.25 seconds. SDK/index/platform identity and explicitly
labelled command summaries are retained under the dated `dotnet/` evidence directory.
The final container uses that pinned SDK digest and asserts the SDK version; a native
build emits a portable managed DLL with no apphost, then each target's actual CLR
executes it. This build check is not the pending whole-solution or runtime matrix result.
