# 09: Layout Core：段落与行

**What to build:** 自研 Layout Core 把 ResolvedDocument 中的段落（静态文本 + DynamicText 行内序列）排成行：调用 Typography Core 整形，按 UAX #14 候选断点加中文禁则（行首/行尾）决定断行，处理对齐、缩进、段距、行高、Tab 与编号，输出单页 Layout IR 文本对象与 Semantic Map（nodeId/bindingId/来源文本范围）。同一输入在重复运行与双端得到相同 IR 摘要。

**Blocked by:** 05 Binding Core 全部 P0 操作与结构展开, 06 Typography Core, 08 Layout IR 契约与规范化

**Status:** ready-for-human

- [x] 段落、标题、列表（编号）的行内序列整形与断行；DynamicText 与静态文本在同一行、同一次断行
- [x] 中西文混排、标点禁则以字符分类规则实现（行首/行尾各有用例），按词断行，Tab 停靠
- [x] 对齐（左/中/右/两端）、首行/悬挂缩进、段前后距、行高（倍数/固定）
- [x] 文本样式：字号、字重、斜体、下划线、删除线、上下标、颜色、高亮、链接，均落入 IR 文字与路径对象
- [x] 输出 IR 文字对象含原始逻辑文本、显示文本、字体实例、glyph ID、位置/advance、cluster；Semantic Map 含来源范围
- [x] 整形/度量前等待全部字体就绪；异步到达顺序不影响 IR（测试）
- [x] 确定性：重复运行、Node 与浏览器模式 IR 摘要一致；corpus 叙述用例的 IR 文本抽取等于 ResolvedDocument 文本

## Comments

### 2026-09-13 — Paragraph layout implementation

- Branch `codex/issue-09-layout-core-paragraphs` is based on reviewed issue 08 SHA `630bf9927c32971525e14f68cc170f171e0b9a0b`; the PR targets `codex/issue-08-layout-ir` and depends on PR #5. No merge or v0 freeze is implied.
- Added optional paragraph layout and text verticalAlign/link fields; Binding Core preserves layout and explicit DynamicText style inheritance. Shared Layout Core now shapes same-style/script fragments together, applies whole-paragraph UAX #14 plus Chinese opening/closing classes, reshapes candidate lines, and emits one-page text/path IR with exact static font identities.
- Heading/list numbering, left/center/right/justify, first/hanging indent, paragraph spacing, multiple/fixed line heights, left tab stops, real bold/italic, underline/strikeout/highlight/link and script baselines are exercised with locked real fonts. Controls/newlines keep logical text; terminal breaks produce a following empty line.
- Cross-origin `of` + DynamicText `fice` forms a real ligature. Optional ordered `semantic.sourceRanges` maps one cluster to both source identities. Source and object logical ranges are independently UTF-16 checked, repeat chains survive, array order contributes to semanticDigest. Both exported JSON schemas and independent Ajv/validator tests are updated; all existing issue 08 fixture bytes remain unchanged.
- Verification: full uncached repository TypeScript build/typecheck/Node tests passed; latest focused totals Layout Core **14/14**, Layout IR **93/93** (repository aggregate **346**). Full real Chromium run passed, with latest Layout Core **13/13**, IR **82/82** (aggregate **142**). Corpus 08's two committed narrative paragraphs bind and extract exactly; Node `crypto` independently verifies the shared canonical-byte hash. Lint/diff hygiene and license gate passed (23 production pnpm, 85 dev pnpm with four existing exceptions, 20 NuGet).
- Scope remains LTR horizontal P0 paragraphs. Tables/InputControl layout fail explicitly; oversized words, too-small line heights and page overflow fail without truncation or pagination. Full browser/OS matrix, writers/readers, subsetting and page layout remain later issues. See `packages/layout-core/README.md` for defaults and compatibility.
- .NET: locked restore with SDK 10.0.302, single-node build (0 warnings/errors), then MTP `--no-build --no-restore`: **46 passed, 0 failed, 0 skipped** on macOS arm64. The MTP named pipe needed execution outside the filesystem/network sandbox; no product failure was suppressed.
- PR bot review at the final pushed head and CI are still required and will be tracked on the PR; `ready-for-human` records local implementation evidence, not final acceptance.

### 2026-09-13 — First bot review and supplemental two-axis review

- Bot completed review of `b704bca` at 03:39:07 UTC. Its blank-line metrics P2 is valid: empty paragraphs and terminal blank lines now use the same OS/2/hhea metrics and script scaling as visible text. Shared tests compare default heights and fixed-height acceptance/rejection thresholds, including a heading ending in a newline.

#### Standards

Independent review of fixed range `630bf992...b704bca`: no hard documented-standard violations. Four nonblocking heuristics are deferred: repeated stretch-gap calculation, positional `emit` parameter clump, terse conversion/numbering/state names, and duplicated test extraction helpers. These do not alter current output behavior or require expanding this issue into a structural refactor.

#### Spec

Independent review reproduced one P2: punctuation-separated Chinese justified lines retained left-aligned width. Stretch opportunities now include legal UAX #14 / Chinese-rule boundaries adjacent to Han or punctuation; a real-font test verifies both 27 mm line width and actual final glyph position+advance. No other high-confidence missing requirements or scope creep were reported.

- Additional source inspection found inherited object properties could masquerade as styles in a supplied ResolvedDocument; style lookup now requires an own property and tests `constructor` as an absent style.
- Validation after fixes: Layout Core Node **17/17**, Chromium **16/16**, typecheck/build/lint/diff checks passed. Prior full repository/IR/.NET evidence remains applicable to unchanged components. The prior head's GitHub CI succeeded; the pushed revision still needs fresh bot/CI completion.

### 2026-09-13 — Second bot review: bounded work and anchored Tabs

- Bot completed `4ca0f67` at 03:52:34 UTC with four valid findings. Chinese break rules now inspect only adjacent code points after whitespace; line selection retains a monotonic candidate cursor, and run/source lookup skips consumed prefixes using ordered indexes. Glyph clusters and stretch gaps use maps/sets/binary searches; effective styles are cached per paragraph instead of serialized for every character.
- Target logical text was already fully checked with clusters. `sourceRanges.logicalRange` now performs only UTF-16 boundary checks; full source strings share a validation-pass cache. A 100000-character target with 100000 source mappings is asserted to receive exactly one full target validation; all prior UTF-16 negative cases still pass.
- Added deterministic work counters. A 1200-newline paragraph visits exactly 1200 candidates and 1200 runs. Candidate/run work each caps at 2000000 operations, including zero-glyph controls. Expanded logical/display/source text caps at 8000000 UTF-16 units, with reservation before glyph/path/sourceText mapping allocation. 100000 newlines and 100000 optional Tabs fail boundedly with `LAYOUT_LIMIT` instead of bypassing shaping limits.
- Tab fix preserves all alignment combinations. On center/right tabbed lines, only the prefix before the first Tab is aligned within the first tab cell, and that Tab's advance is shortened equally; every following segment remains anchored to its paragraph-relative stop. Tests cover A+Tab+B at 20 mm, multiple 20/40 mm stops, all four alignments, first-line/hanging indents and wrapped lines. No center/right+Tab exclusion remains.
- Latest focused validation: Layout Core Node **21/21** and Chromium **20/20**; Layout IR Node **94/94** and Chromium **82/82**; typecheck/build/lint/diff checks passed. Final-head bot/CI evidence is tracked on PR #6. The earlier duplicated stretch-width heuristic is addressed by sharing the width returned by emission; the other three nonblocking maintainability suggestions remain deferred.

### 2026-09-13 — Third bot review: early input bounds and repeated numbering

- Bot completed `777636e` at 04:14:53 UTC with two valid findings. Paragraph length and per-fragment UTF-16 validity are now checked during assembly, before concatenation or allocating runs. A regression spies on character iteration and proves oversized alternating text and malformed input never enter run construction; separately valid fragments whose combined length exceeds 100000 also fail early.
- Explicit list `start` initializes once for a repeated source paragraph within its parent-instance chain. Subsequent inner instances increment; a new outer group initializes its own start. Non-repeated explicit restarts are unchanged. Real Compiler → Binding Core flat/nested RepeatBlock fixtures verify `5,6,7` and `5,6,7,5,6` respectively.
- Validation: Layout Core Node **23/23**, Chromium **22/22**, typecheck/build/lint/diff checks passed. The previous head's CI is queued with no failure report; final-head CI and bot completion remain required on PR #6.

### 2026-09-13 — Supplementary mixed-whitespace work bound

- Directly checked the locked UAX #14 implementation: 2000 alternating space/Tab characters yield 1001 opportunities. Per-candidate whitespace skipping would revisit the same long run despite avoiding prefix slicing.
- Internal paragraph checks now preclassify preceding-opening/following-closing rules in two linear passes and answer candidates in constant time. The standalone single-boundary utility retains adjacent code-point lookup. Added 100000-character alternating space/Tab input to the shared control-budget regression; it fails boundedly before excessive measurement/output.
- Layout Core full Node 23/23 passed before expanding that existing case; its updated Node regression then passed (1 selected, 20 skipped), and the full Chromium suite passed 22/22. Shared narrative digest and corpus text remain unchanged. Build/typecheck/lint/diff checks passed. This supplements the second review's Chinese-check P1; latest pushed-head bot and CI remain required.

### 2026-09-13 — Fourth/fifth review and repeated-layout resource recovery

- Reviews of `cdb0e7d` / `cb804ec` added four valid P2 findings. Unused paragraph-base faces are now resolved lazily; empty source fragments do not force unused font loads. Ordered zero-length DynamicText sources retain nodeId/bindingId for empty, null and missing-value preview documents, with exactly one owner across run/line boundaries. Generated markers now use the normal script itemizer (Latin/Han/Kana suffix regression), and the exported profile/features are frozen with a per-invocation internal copy.
- The expanded full suite exposed a separate real runtime failure: Node reported HarfBuzz native memory-access errors during repeated same-pack Face/Blob creation and subsequent finalizers; the corresponding Chromium run stalled. The three new source tests separately passed. This failed run was not treated as acceptance.
- Inspection of locked harfbuzzjs 1.6.0 confirmed FinalizationRegistry cleanup and no public deterministic dispose/unregister. Typography Core now reuses only immutable static Face data by file SHA-256/face 0, with four-entry/128-MiB-file-byte LRU limits. Font/Buffer state remains per core; each provided byte buffer is copied and digest-checked before lookup, and local registration/style checks/128-MiB budget still apply. No private destroy, forced GC, dependency fork or WASM configuration change is used.
- These are cache-reference/file-byte limits, not native RSS or immediate reclamation guarantees. Arbitrary font rotation still requires host Worker/process memory limits and recycling. The README records this remaining lifecycle boundary instead of claiming it solved by LRU.
- Full recovery evidence: Layout Core Node **28/28**, Chromium **27/27**; Typography Node **28/28**, Chromium **25/25**, all with no runtime errors. The shared stress test keeps 160 cores live while loading/shaping the full 16,437,364-byte font (Node ~8.5s, Chromium ~33.9s); additional tests exercise eviction with live old cores, alternating faces, corrupted cached-digest declarations, unregistered access and separate per-core shaping features. Build/typecheck/lint/diff checks passed; final-head bot/CI is still required.
- Final local regression for this batch: uncached whole-repository build/typecheck/Node tests completed 24/24 tasks and **364 tests**; uncached whole-repository Chromium completed 5/5 tasks and **159 tests**. The earlier .NET 46/46 and license evidence remain applicable to unchanged .NET/dependencies.

### 2026-09-13 — Independent zero-length cardinality budgets

- Bot completed `3c42130` at 05:10:09 UTC with one valid P1: empty fragments contribute no text/work units. Added independent frozen limits: 10000 input paragraphs, 100000 input fragments, 100000 source mappings and 100000 IR objects per layout.
- A data-descriptor preflight checks array counts and paragraph text bounds before canonical document copying or font loading, without invoking input accessors. Mapping and text/path cardinality is reserved before output allocation, so zero-length sources and zero-glyph objects are charged independently of text bytes. Their semantic preservation remains intact below the limits.
- Shared tests submit 100001 empty DynamicText fragments and 10001 empty paragraphs, assert early `LAYOUT_LIMIT` with no font loading, and verify valid empty source/object counts. Layout Core Node **29/29**, Chromium **28/28**, typecheck/build/lint/diff checks passed. The prior head's CI succeeded; latest-head bot/CI remains required.

### 2026-09-13 — Document/font acquisition budgets and CI timeout

- Bot completed `6e7f580` at 05:33:19 UTC with two valid budget findings. Preflight now totals body text across the document (1000000 UTF-16 units), and bounds the complete document/options JSON tree (200000 nodes, depth 128, 8000000 string/key units) before copying. Plain JSON type checks avoid enumerating exotic typed-array objects; metadata cannot bypass the string budget.
- Font acquisition now limits 64 resources, 32 MiB per supplied buffer and 128 MiB total before ownership copies. All direct buffers are checked before any copy; promised buffers reserve bytes on arrival and failed acquisition stops later copies. Every buffer still passes the existing digest/static-face checks before shaping. Shared tests cover oversized individual/direct packs, excessive count, promised packs and a document-wide/metadata overflow, asserting no font registration occurs.
- CI run 34740365499 failed solely because the full-font eviction/alternation test took 5.499s on the shared runner, exceeding Vitest's default 5s. Its fixture count and assertions are unchanged; it now has an explicit 20s allowance. The separate 160-live-core stress still runs at full size with its existing 60s limit.
- Layout Core full Node **31/31**, full Chromium **30/30** passed; Typography Node **28/28**, Chromium **25/25** passed. Final synchronous acquisition-abort adjustment was additionally checked by the two focused budget cases in both runtimes (2 selected, 27 skipped); typecheck/lint/diff checks passed. Fresh-head CI and bot completion remain required.
