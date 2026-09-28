# Issue 35 runtime feasibility probe

This is a bounded, disposable **browser-only** experiment for ADR-0002 route (a), not an Editor SDK or a v1 contract. It loads the published canvas-editor 1.0.2 and a locally patched copy of exact upstream `83985f729cde373eccdcf25314227827b971bb63`. It does not consume Core, implement IR preview, publish a fork, or change issues 17/18 gates.

## Reproduce

From the repository root with the locked Node/pnpm dependencies installed:

```sh
node tools/editor-adapter-spike/prepare.mjs
pnpm exec playwright install chromium firefox
node tools/editor-adapter-spike/run-browser.mjs
```

`prepare` checks the source archive SHA-256 and npm archive SHA-512 SRI before extracting. It applies `upstream.patch` with zero fuzz to a disposable, ignored `.scratch/first-release/reference/issue35/patched` directory. No upstream checkout is edited. Source and package MIT attribution is in `LICENSE.upstream`.

A verified extracted cache can be used when downloads are unavailable:

```sh
node tools/editor-adapter-spike/prepare.mjs --cache /absolute/cache/issue35
```

The cache must contain `original/` and `package/`. Every one of 633 source files and the seven published files recorded by issue07 are SHA-256 checked against `baseline.json`. Those source files were independently matched to all 633 Git blob IDs returned by GitHub's fixed-commit recursive tree API. Cache mode explicitly reports `sriRecomputedThisRun: false`: the SRI is pinned from issue07's archive check, while current extracted bytes are verified by file hashes. On this host both codeload and npm archive endpoints failed TLS; GitHub API access worked. This is not a claim that a fresh archive was downloaded successfully.

The runner starts a temporary loopback Vite server, runs each browser independently, writes actual version, architecture, full case states, event traces, exceptions, and screenshots under `tests/editor-adapter-spike/evidence`, and exits nonzero on a failed case or page error. Screenshots show only the synthetic harness, not target OFD readers. Browser sandbox restrictions may require approval to launch the browser processes. A browser run does **not** verify OS IME behavior.

## Experimental protocol

The atom fixture uses Chinese text atoms `n1`–`n3` and a binding atom `n4`. IDs are per projected grapheme in this experiment; UTF-16 anchors have a node ID and offset. Style splits preserve IDs; rich duplicates get new IDs; deletion removes only deleted IDs. A document containing an unknown source node is entirely read-only and retains the opaque payload. Source metadata stays in the adapter, not inside every editor element.

The patched HistoryManager retains the **one** upstream undo/redo domain, with unique monotonically allocated `historyEntryId`s. Each entry holds an immutable adapter source/mapping/projection/selection snapshot, keyed within a session. The adapter's Map is an association registry, not a second undo stack. A synchronous capture hook runs before the next edit; the history restore closure captures the normalized, reconciled projection **after** identity repair. `contentChange` remains asynchronous invalidation only and creates no source transaction.

- `commit`: capture and validate source, identity mapping, projection, logical selection and context, then publish one revision. Binding changes with identical display text and whole-document structural wrapping use the same checkpoint entry.
- `undo` / `redo`: restore the target entry under a reentry guard. Revision increases; it never reuses a historic number. Failures restore the complete pre-action view and stack cursors without publishing a revision.
- `reset`: clear the old stack and publish the next baseline atomically through the adapter command boundary. The prototype requires `isSetCursor: true` on replacement so a baseline is immediately created.
- `discard`: restore a captured pre-edit view including live range, zone and position context, restore source, and preserve both stacks. No source revision is published. An incrementing external preview cancellation token is still required once issue24 adds actual preview tasks.
- Initial capture creates one entry; clipping and redo-branch replacement synchronously remove unreachable snapshot associations. History sequence numbers are never reused, including after failures/reset.
- Direct input (including asynchronous plain clipboard callbacks) begins a snapshot in the patched input handler. Composition starts before selection replacement. DOM capture covers supported deletion/Enter commands, and adapter commands cover the explicit probe command list. Temporary composing inputs mutate only editor projection, never source/history. Cancellation restores the full pre-composition view without `setValue` or clearing redo.

`current` in raw states is the immutable historical checkpoint; `liveSelection` and `view.range/context/zone` describe the current interaction selection, which can differ after a selection-only move. This distinction prevents selection movement from creating fake content revisions.

The patch touches HistoryManager, Draw snapshot/restore, an explicit experimental Editor bridge, composition cancellation, and input begin. It is a private fork dependency with maintenance cost. It is **not** a stable plugin, zero-fork implementation, or a redesign of layout/rendering.

## Evidence layers and decision boundary

1. Existing issue07 isolated-function probe: original handler with stub Draw/Range, useful diagnostic only.
2. This probe: real Chromium/Firefox Editor, real DOM/Canvas/workers, **synthetic** composition/input/paste/shortcut events. Expected failures of the original release are recorded as reproduced defects, not successful product behavior.
3. Real Windows Microsoft Pinyin and macOS Pinyin: **Not verified** until a real OS event trace and selection-replacement commit/cancel observation are captured. Neither CDP insertText nor pasting Chinese proves this layer.

Issue19 may assess route (a) as experimentally promising only within the measured subset. It cannot approve an unconditional Go or freeze zero fork while the OS gates and unsupported mutation paths remain open. ADR-0002 remains Proposed. No production fork or public API is approved here.

Issue20 should replace the atom AST with the canonical source hierarchy and node/instance/UTF-16 anchor rules, preserve the single-history/session/checkpoint invariant, and explicitly migrate stored anchors and snapshots. Do not persist this fixture format. Issue22 must cover all admitted commands and event orderings (including trailing final input, blur, and document switching), multi-instance disposal, CSP, selected text in tables/headers/footers, drag/drop, and cross-page selection. Issues24–26 must extend metadata/structure reconciliation to actual DynamicText/expression/repeat/condition semantics and stale preview cancellation. The probe's whole-document wrapper and one-character binding are representative protocol tests, not those features.

## Manual OS IME gate

Run `pnpm exec vite --config tools/editor-adapter-spike/vite.config.mjs`, open the loopback harness in a new test-only browser tab, and record OS build, browser version, input-source ID/version, keyboard layout and IME settings. Do not use personal documents or tabs.

1. Click Reset and Select 甲乙. Verify the highlighted selection is nonempty, and capture `probe.state()` before input.
2. Switch to the native OS Pinyin IME using its real input-source menu/shortcut. Type `ni` with OS key events. Capture the visible candidate UI and `probe.trace()`; intermediate source AST/revision/history must stay unchanged.
3. Commit with the IME's normal candidate-selection key. Expect 你丙名, one logical transaction, and undo restoring original text/IDs/mapping. Record the actual event sequence, including any final `input` after `compositionend`.
4. Reset; create a text edit and undo so redo exists, select 甲乙 again, start Pinyin and cancel with Esc. Compare source/IDs/mapping, live selection/context, history cursor, redo IDs and revision with the before snapshot. Redo must still restore the original edit.
5. Repeat on Chromium and Firefox on macOS Pinyin and Windows Microsoft Pinyin. Save raw traces and before/during/after screenshots with human observations and failures. If cancellation emits nonempty data or commits on blur, record that behavior; do not relabel it as a successful cancel.

The current macOS host has `com.apple.inputmethod.SCIM.ITABC` enabled but ABC selected; System Events reports accessibility disabled. No Windows test host is attached. These facts explain missing evidence, not passing results.
