# 08: Layout IR 契约与规范化

**What to build:** 任何组件都可以构造、校验、规范化并对 Layout IR 求摘要：IR 包含身份、资源、页面、图形状态、文字（含 glyph/cluster）、路径、图片、语义与标记九部分；规范化后对象顺序、ID、数值精度与序列化确定；相同 LayoutIdentity 输入在 Node 与浏览器得到相同 SHA-256。写入器与排版器都以此契约为唯一接口。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-human

- [x] IR TypeBox schema 覆盖 spec IR 契约一节的全部部分；`irVersion` 独立于 `modelVersion`
- [x] 坐标左上原点、毫米语义；规范化用 1/1000 mm 整数（精度与舍入规则以测试记录，供 WP0.10 调整）
- [x] 文本范围用 UTF-16 offset 且禁止切断代理对；提供 cluster ↔ offset 转换表
- [x] 确定性序列化（键排序、固定数字格式）与 SHA-256 摘要；运行时间/机器标识等放非语义 provenance
- [x] LayoutIdentity 的规范化输入定义与摘要函数
- [x] 一组 fixture IR（单页文字、表格边框、图片、条码矩形、跨页重复表头标记），供写入器票提前开工
- [x] 同一 fixture 在 Node 与浏览器模式下摘要一致；打乱对象输入顺序后规范化结果不变

## Comments

### 2026-09-13 — Implementation and local acceptance

- Baseline: `origin/main` = `6457636`; isolated branch `codex/issue-08-layout-ir`.
- Added `packages/layout-ir`: nine-part TypeBox contract, mm construction and separate integer-um writer schema, relational/UTF-16 validation, cluster conversion table, canonical serialization and SHA-256, LayoutIdentity input contract.
- Deterministic IDs preserve draw/reading order and font instance distinctions. Only mm lengths are quantized; ties round half away from zero with a 0.0005 mm scalar error bound. Canonical input is explicitly rejected to prevent double quantization.
- Five synthetic contract fixtures, JSON Schema 2020-12 artifacts and Node-crypto reference digests are committed. Resource hashes/glyphs are synthetic; real asset/shaping/reader acceptance belongs to the dependent writer and WP0 matrix work.
- Local verification: Layout IR Node 38/38, Chromium 34/34; full `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:browser` passed (unchanged packages can use Turbo cache). .NET locked restore and single-node build passed with SDK 10.0.302; MTP tests 46/46 after separate build and `dotnet test --solution ... --no-build --no-restore` (build flags otherwise reach the MTP executable). License check uses the task NuGet cache via `NUGET_PACKAGES`.
- Reference: [Layout IR contract and conventions](../../../packages/layout-ir/README.md). PR bot review and CI remain pending; `ready-for-human` does not authorize merge. WP0.10 precision/capacity freeze and unexecuted runtime/reader matrices remain separate gates.

- PR: https://github.com/whynpc9/ofd-compose/pull/5. First head `df63f74` passed all GitHub CI gates. During review wait, tightened OpenType tag dictionaries with `additionalProperties: false`, with TypeBox and independent Ajv negative tests; final-head bot/CI evidence is tracked on the PR.

### 2026-09-13 — First bot review dispositions

- Bot reviewed `644d7e2` and reported two P2 findings. Both are valid against `TypographyCore.shape`.
- Vertical directions: added `ttb`/`btt` to construction and canonical schemas; dual-runtime tests preserve vertical advance/offset geometry and assert direction affects the digest. Independent Ajv checks cover both schemas.
- OpenType feature bounds: limited feature values to 0..0xffffffff, matching the shaper. Added maximum/overflow/negative/fraction cases in both runtimes and exported-schema tests.
- Targeted verification after fixes: Node 44/44, Chromium 38/38, typecheck/build/lint and diff hygiene passed. Awaiting fresh bot review and CI on the follow-up head; earlier completion is not final-head approval.

### 2026-09-13 — Second bot review disposition

- Bot reviewed `fecd31f` and correctly identified the missing public validator for canonical writer input. Added `validateCanonicalLayoutIR` (canonical schema, shared relational validation and semantic digest verification), exported it from the package and reused it in canonicalization postconditions. No unit conversion or mutation occurs during transport validation.
- Dual-runtime cases cover all canonical JSON fixtures and negative references, duplicate IDs, split-surrogate clusters, marker/page mismatch and stale semantic digests. Node 51/51, Chromium 45/45 passed; typecheck/build/lint and diff hygiene passed. Fresh-head bot/CI completion remains tracked on PR #5.

### 2026-09-13 — Third bot review dispositions

- Bot reviewed `aff1432`. Both new findings are valid and fixed: Binding Core explicitly classifies `ResolvedDocument.runtime` as nonsemantic; it is now excluded with `provenance`. Separately declared LayoutIdentity formatting-policy fields remain semantic. Real Compiler → Binding Core documents now have pinned, equal Node/Chromium document and LayoutIdentity digests.
- Canonical transport validation now compares against shared structural normalization (no unit conversion), rejecting noncanonical array ordering, IDs and duplicate definitions without mutating input. Added negative pages/objects/resources/states/semantics/markers/features/clusters/IDs/duplicate definitions cases.
- Verification: Node 63/63, Chromium 57/57, typecheck/build/lint/diff checks passed. Fresh-head bot/CI evidence remains on PR #5; no merge performed.

### 2026-09-13 — Fourth bot review disposition

- Bot reviewed `6caef15` and correctly identified that boundary-only UTF-16 checks admitted lone surrogates. Full logical/display/source strings are now checked for well-formed UTF-16 before range checks, including logical text with no display clusters. Each run string is checked once to avoid quadratic per-cluster rescanning.
- Verification: Node 72/72, Chromium 66/66, typecheck/build/lint/diff checks passed. Both public validators and canonicalization reject malformed text with `IR_TEXT_INVALID`; existing valid astral/ligature/combining/vertical fixtures remain accepted. Fresh-head bot/CI completion remains on PR #5.

### 2026-09-13 — Fifth bot review and supplementary local review

- Bot reviewed `b9133fc`; its language-syntax P2 is valid. Both TypeBox/exported schemas now use TypographyCore's alphanumeric hyphen-separated syntax; invalid underscores/spaces/empty segments fail. Dual-runtime and independent Ajv tests cover accepted/rejected forms.
- Supplementary `code-review` of fixed range `6457636...b9133fc` ran Standards and Spec axes in separate read-only agents. Standards: 0 hard violations, 1 nonblocking duplicated-whole-document-traversal heuristic, deferred to WP0 capacity evaluation. Spec: 1 valid P2 (nonempty all-zero dash cycles); fixed in both construction/canonical schemas, including post-quantization failure. No other high-confidence scope/missing-requirement findings. This local review does not replace final-head bot evidence.
- Verification: Node 82/82, Chromium 74/74, typecheck/build/lint/diff checks passed. Seven valid bot findings plus the supplementary dash finding have implementation fixes; fresh-head review/CI remains on PR #5. No merge performed.

### 2026-09-13 — Decimal page-boundary regression

- Additional executable self-check reproduced a false `IR_PAGE_BOUNDS` for a 0.3 mm page with content x=0.1, width=0.2, caused by binary addition. Containment now compares exact sums of the shortest decimal spellings used by normalization, without epsilon tolerance; a genuine 0.20000000000000004 mm width still fails.
- Verification: Node 83/83, Chromium 75/75, typecheck/build/lint/diff checks passed. Fresh-head bot and CI remain required; no merge performed.

### 2026-09-13 — Sixth bot review initial assessment (superseded below)

- Bot reviewed `ca9cb5d` and suggested blanket rejection of nonempty font variations because today's TypographyCore uses static fonts. The cited implementation limitation is correct, but blanket IR rejection is not applied: issue 08 explicitly allows any component to construct the generic fixed IR, and the coordinator explicitly requires preserving distinct face/features/variations identities. Spec §10 places supported font types/features at release-profile/producer/writer boundaries. The independent Spec reviewer confirmed this distinction.
- Clarified README: preserving variation metadata is contract-level identity support, not a claim of implemented variable-font shaping/embedding. Current TypographyCore still rejects variable fonts; no new variation-aware shaping or capability flag is introduced. This is a documented boundary disposition, not an unresolved implementation finding.
- Seven prior valid bot findings and two additional verified issues (dash cycles and decimal containment) are fixed. Supplementary Standards duplicate-traversal suggestion remains nonblocking pending WP0 capacity evidence. Final-head bot completion and CI still required; no merge performed.

### 2026-09-13 — Coordinator resolution of static-font capability boundary

- The coordinator clarified that the earlier variations-preservation suggestion was overbroad, not a user hard constraint, and selected the current static-profile restriction. This supersedes the preceding boundary disposition and independent generic-contract interpretation.
- Accepted the bot finding. `variations` remains a field but both current v0 schemas require an empty mapping (`maxProperties: 0`), matching the exact-static-face producer. Nonempty maps, including nominal values, fail TypeBox/Ajv and both public validators. Supporting axes later requires an explicit profile/version change with real shaping/subset/writer evidence; no variation-aware shaping is added here.
- Current supported face/feature identities remain distinct. Verification: Node 85/85, Chromium 76/76, typecheck/build/lint/diff checks passed. All eight valid bot findings now have implementation fixes; fresh final-head bot completion/CI are still required. No merge performed.

### 2026-09-13 — Seventh bot review disposition

- Bot reviewed `4f90b36`; glyph and subset-map identifiers above uint32 were accepted. Fixed all three fields (`glyphId`, map `original`, map `subset`) to 0..0xffffffff, sharing the same uint32 schema as OpenType feature values.
- Both public validators and exported schemas reject overflow, negative and fractional IDs; the maximum legal value survives canonicalization without truncation. Verification: Node 90/90, Chromium 80/80, typecheck/build/lint/diff checks passed. All nine valid bot findings have implementation fixes; final-head bot/CI completion still required, no merge performed.
