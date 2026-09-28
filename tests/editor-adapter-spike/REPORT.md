# Issue 35: bounded runtime feasibility evidence

Date: 2026-09-28. Integration base: `38aa0ade7a314891fd0a5e04152133956f2ad0a7` (issue18 / PR15). Functional prerequisite: issue07. ADR-0002 remains **Proposed**; issue35 remains **needs-info** for real OS IME acceptance.

## Finding for issue19

Route (a), owned source projected into canvas-editor with independent future IR preview, is feasible for the measured atom fixture **with an experimental patch**. An external observer relying on published asynchronous `contentChange` cannot identify intermediate A/B checkpoints; unmodified 1.0.2 loses selected source text on synthetic composition cancellation. No zero-fork or unconditional Go conclusion is justified. Windows Microsoft Pinyin and macOS Pinyin are **Not verified**. This does not approve production fork adoption or freeze issue20 contracts.

[Reproduction, protocol and manual OS steps](../../tools/editor-adapter-spike/README.md). [Source/patch verification](evidence/provenance.json). [Exact source-file baseline](../../tools/editor-adapter-spike/baseline.json). [Patch](../../tools/editor-adapter-spike/upstream.patch).

## Matrix

Each JSON contains case names, full source/mapping/projection/selection/stack states, event traces, actual browser version, and source hashes. “Pass” for an original-release negative control means the known defect was reproduced, not that the product behavior is acceptable.

| Case | Published 1.0.2 | Patched Chromium 153.0.8010.12 | Patched Firefox 155.0 |
| --- | --- | --- | --- |
| Nonempty selection cancellation | Reproduced loss of 甲乙 | Source/identity/selection/context/redo restored | Same |
| Synchronous A then B, asynchronous notification | Observers read B twice; A checkpoint not identified | Every undo/redo intermediate checkpoint matches immutable source | Same |
| Selected composition commit with redo branch | Not an acceptance claim | One entry; transient text absent from source; redo pruned | Same |
| Direct input, asynchronous paste callback, shortcut undo | Not measured as a fix | Pass through actual textarea handlers | Pass; explicitly synthetic clipboard payload |
| Bold shortcut success/failed capture | Not a fix claim | Before snapshot, style observer atomicity, complete rollback; unsupported shortcuts disabled | Same |
| Chinese style split, rich duplicate, delete | Not an acceptance claim | IDs preserved/reallocated uniquely as appropriate | Same |
| Binding expression change without display change; text; wrap | No owned-source association | Single history; intermediate domain states restored | Same |
| Undo then new edit | No owned-source association | Redo associations removed; new revision | Same |
| Reconciliation failure, reentry, undo restore failure | No owned-source association | Complete view/stacks/source rollback; no published revision | Same |
| Missing association | No owned-source registry | Fail-closed diagnostic; rollback; edit/save blocked | Same |
| Initial baseline, reset, clipping, association cleanup | No owned-source association | Pass | Same |
| Unknown source node | No owned-source model | Whole-document read-only, opaque payload preserved | Same |

Final local automated matrix: **16/16 cases per browser**, including two negative controls and fourteen patched cases; no browser page errors. [Chromium raw](evidence/chromium.json), [Firefox raw](evidence/firefox.json). These are actual macOS arm64 browser runs using synthetic events, not emulated OS IME or production UI acceptance. [Chromium image](evidence/chromium.png) was visually inspected and shows the synthetic readonly unknown-node fixture; images do not establish IME candidates or selection accuracy.

## Failures retained, not erased

- [First run](evidence/first-run/chromium.json): 6/12 per browser. The harness mistakenly supplied a compensation character despite upstream forcing one, shifting range/identity indices; text assertions also contained a wrong Chinese character. Corrected the fixture instead of loosening identity assertions. This run is **failed**.
- [Second Firefox run](evidence/second-run/firefox.json): 10/12. The adapter's queued cleanup after composing input canceled before Firefox's delayed compositionend commit. Fixed by excluding composing input from that cleanup. The raw before/during/after trace records the failure. Chromium was 12/12 on that run.
- [Third Firefox run](evidence/third-run/firefox.json): 11/12. Firefox's ClipboardEvent constructor discarded the synthetic DataTransfer initializer, producing an empty payload. [Independent diagnostic](evidence/firefox-clipboard-diagnostic.json) established that behavior; the final harness explicitly assigns synthetic clipboardData before dispatch. Native clipboard integration remains unverified.
- Upstream source/package archive downloads on this host failed TLS. The original source cache was verified against all 633 blobs of the fixed GitHub commit tree; seven issue07 published-file hashes were rechecked. The exact package SRI remains pinned from issue07, not falsely reported as freshly recomputed. CI uses fresh archives and verifies the pinned archive digests.

## Three evidence layers

| Layer | Result | Limit |
| --- | --- | --- |
| Function diagnostic | [Original issue07 probe rerun](evidence/function-probe.json): selected cancel produces 丙 | Stub Draw/Range/Canvas; original defect only |
| Real browser, synthetic events | Chromium + Firefox 16/16 each | Actual Editor, Canvas, workers; synthetic composition/input/paste/shortcut |
| Real OS IME | **Not verified**: Windows Microsoft Pinyin; macOS Pinyin | No actual nonempty-selection candidate commit/cancel trace or IME screenshots |

macOS environment inspection: macOS 26.6.2 (25G83), arm64; Apple Simplified Pinyin input-source ID `com.apple.inputmethod.SCIM.ITABC` enabled, current input source ABC. System Events reported UI accessibility disabled. No Windows test host is attached. A test-only headed Chromium harness was opened for a bounded desktop attempt. CUA `getState()` returned inventory after 5.9 seconds, but app binding returned no window state and was interrupted after 155.1 seconds. No click, typing, input-source change, candidate UI or OS IME event was observed; the test browser/server were closed. No further CUA retries were made. These observations do not constitute either an OS IME pass or an editor IME failure.

## Handoff and remaining support surface

Issue20 must replace the provisional atom AST/whole-document wrap with canonical hierarchy and anchor rules while retaining session/checkpoint identity, immutable source snapshots, cleanup, atomic rollback and monotonic revisions. It must not turn editor indices into source identities or use text hashes to identify history entries.

Issue22 expands supported event orderings and mutation entry points (real clipboard, drag/drop, menus, blur, final input after compositionend, table contexts, header/footer editing, cross-page selection, multi-instance lifecycle and CSP). Issues24–26 replace the one-character binding/whole-document wrapping representatives with real business expression/structure transactions and actual stale-preview suppression. The experiment has no IR preview tasks, so “no transient source persistence” does not prove a preview scheduler exists.

No changes to issues17/18 reader, host sample, architecture/performance evidence, or ADR-0005 status. No .NET/Java source changed; local .NET/Java suites were not rerun for this probe. Repository CI retains those existing gates and adds this two-browser experiment with raw artifacts.

## Standards pre-review

At `e180db9`, the independent Standards reviewer found zero hard violations and one optional P3 duplication suggestion: historical and live logical-anchor conversion share the same short formula. It remains a nonblocking prototype cleanup suggestion; it does not change the OS gates or imply production readiness.

## Spec pre-review

At `e180db9`, the independent Spec reviewer found two actionable issues: P1 synchronous `renderChange` could expose restored projection before owned source restoration, and P2 a prepended copy could take the original atom ID. Both were fixed before PR submission. The six-file patch now buffers EventBus notifications throughout transactions and publishes them after source/view/history are coherent; element ownership distinguishes original objects from inserted copies. Two additional browser cases observe synchronous source/view/ID consistency through undo/redo/cancel/failure and verify prepend-copy/delete preserves the original AST. The reset case also verifies authoritative replacement metadata/IDs and failed-reset rollback. Earlier 12-case evidence is retained in [pre-review](evidence/pre-review/chromium.json).

Review counts: Standards 0 hard / 1 optional P3; Spec 2 (P1/P2), both addressed with the final 14-case browser matrix.

## PR bot review remediation

The review of `4cb7c26` identified one P2: storing a complete source object in an upstream history entry bypassed the required association-registry lookup. History entries now keep only their opaque ID and editor restore closure; Adapter restore resolves the composite session/entry key, validates it, and reports `HISTORY_ASSOCIATION_MISSING` if absent. The regression deliberately removes an undo target association, verifies complete before-state rollback with no new revision, and verifies subsequent edit/save refusal until a new session is loaded. Prior 14-case evidence is retained in `evidence/pre-bot/`.

A second bot review of `24c9ce7` found P1 mutating formatting shortcuts bypassed the pre-mutation snapshot. The probe now begins a transaction before its admitted Ctrl/Cmd+B action and explicitly disables unsupported formatting/list/title/cut shortcuts and Tab. A regression dispatches actual synthetic keydown events to the textarea, checks successful style commit/undo, catches only the deliberately injected reconciliation error, checks complete failed-edit rollback, and observes synchronous style/source consistency. Prior 15-case evidence is retained in `evidence/pre-shortcut/`.

The review of `4930739` requested stronger mixed-history evidence. The existing metadata/text/wrap case now compares the complete immutable checkpoint (AST, full mapping offsets, projection/styles, logical selection/context), the actual restored view and live selection, and exact revision advancement at every undo and redo; the post-undo branch also requires a new revision. This strengthens an existing case rather than adding a new feature. Prior evidence is retained in `evidence/pre-checkpoint-assertions/`.
