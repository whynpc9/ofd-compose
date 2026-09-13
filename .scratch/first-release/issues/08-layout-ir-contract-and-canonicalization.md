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
- Local verification: Layout IR Node 51/51, Chromium 45/45; full `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:browser` passed (unchanged packages can use Turbo cache). .NET locked restore and single-node build passed with SDK 10.0.302; MTP tests 46/46 after separate build and `dotnet test --solution ... --no-build --no-restore` (build flags otherwise reach the MTP executable). License check uses the task NuGet cache via `NUGET_PACKAGES`.
- Reference: [Layout IR contract and conventions](../../../packages/layout-ir/README.md). PR bot review and CI remain pending; `ready-for-human` does not authorize merge. WP0.10 precision/capacity freeze and unexecuted runtime/reader matrices remain separate gates.

- PR: https://github.com/whynpc9/ofd-compose/pull/5. First head `df63f74` passed all GitHub CI gates. During review wait, tightened OpenType tag dictionaries with `additionalProperties: false`, with TypeBox and independent Ajv negative tests; final-head bot/CI evidence is tracked on the PR.

### 2026-09-13 — First bot review dispositions

- Bot reviewed `644d7e2` and reported two P2 findings. Both are valid against `TypographyCore.shape`.
- Vertical directions: added `ttb`/`btt` to construction and canonical schemas; dual-runtime tests preserve vertical advance/offset geometry and assert direction affects the digest. Independent Ajv checks cover both schemas.
- OpenType feature bounds: limited feature values to 0..0xffffffff, matching the shaper. Added maximum/overflow/negative/fraction cases in both runtimes and exported-schema tests.
- Targeted verification after fixes: Node 51/51, Chromium 45/45, typecheck/build/lint and diff hygiene passed. Awaiting fresh bot review and CI on the follow-up head; earlier completion is not final-head approval.

### 2026-09-13 — Second bot review disposition

- Bot reviewed `fecd31f` and correctly identified the missing public validator for canonical writer input. Added `validateCanonicalLayoutIR` (canonical schema, shared relational validation and semantic digest verification), exported it from the package and reused it in canonicalization postconditions. No unit conversion or mutation occurs during transport validation.
- Dual-runtime cases cover all canonical JSON fixtures and negative references, duplicate IDs, split-surrogate clusters, marker/page mismatch and stale semantic digests. Node 51/51, Chromium 45/45 passed; typecheck/build/lint and diff hygiene passed. Fresh-head bot/CI completion remains tracked on PR #5.

### 2026-09-13 — Third bot review dispositions

- Bot reviewed `aff1432`. Both new findings are valid and fixed: Binding Core explicitly classifies `ResolvedDocument.runtime` as nonsemantic; it is now excluded with `provenance`. Separately declared LayoutIdentity formatting-policy fields remain semantic. Real Compiler → Binding Core documents now have pinned, equal Node/Chromium document and LayoutIdentity digests.
- Canonical transport validation now compares against shared structural normalization (no unit conversion), rejecting noncanonical array ordering, IDs and duplicate definitions without mutating input. Added negative pages/objects/resources/states/semantics/markers/features/clusters/IDs/duplicate definitions cases.
- Verification: Node 63/63, Chromium 57/57, typecheck/build/lint/diff checks passed. Fresh-head bot/CI evidence remains on PR #5; no merge performed.
