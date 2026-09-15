# 13: Layout Core：表格

**What to build:** RepeatRowGroup 展开后的长表格可以跨页排版：列宽一致、自适应行高、合并单元格、边框、背景、垂直对齐、单元格内控件；跨页重复表头在视觉上多份、在 Semantic Map 中标记为重复身份而不是多条业务记录；表头与首行同页、标题与下段同页、基础孤行控制生效；超高单元格与跨页合并单元格有明确处理政策并可诊断。

**Blocked by:** 10 Layout Core：分页、页眉页脚、水印

**Status:** ready-for-human

- [x] 表格模型：列宽（固定/比例）、行高（固定/自适应）、合并单元格、边框、背景、垂直对齐
- [x] 跨页：行不被拆断（或按策略拆分）、跨页重复表头、表头与首行同页
- [x] Semantic Map：重复表头标记重复身份；每行映射到 RepeatRowGroup 实例键与表格行列
- [x] 标题与下段同页、基础孤行控制
- [x] 超高单元格与跨页合并单元格：明确政策 + `LAYOUT_OVERFLOW`/诊断
- [x] 真实规模长表格（数百行）样本排版，行数与数据一致、无丢行/重复行（文本抽取比对）
- [x] 确定性与双端一致测试


## Implementation and local evidence (2026-09-15)

Implemented on `codex/issue-13-layout-tables`, based on the complete issue 12 commit
`bf09514ab6002cad3691676c75623b0502c3e6e2`. The PR base must be
`codex/issue-12-layout-media-regions` (dependency PR #9); do not merge either branch as part
of this task. This is a local Markdown issue number, not GitHub issue #13.

- Optional model/ResolvedDocument table, row and cell layout fields preserve existing fixtures;
  generated construction schemas are synchronized. Fully span-covered rows may have no cells.
- Real Typography/Media content uses fixed/proportional columns, fixed/auto heights, rectangular
  merged cells, background, top/middle/bottom alignment and control identity/geometry.
- Shared Stroke edges resolve cell/default conflicts, split at merged grid boundaries and paint
  once per physical segment; exterior strokes stay inside each table page fragment.
- Rows and connected row-span groups are atomic. Headers stay with the first body group and
  repeat through a separate semantic identity. Oversized/invalid geometry fails explicitly.
- Paragraph keep chains, heading keep-with-next and explicit widow/orphan minima use real
  measured lines; impossible policies return `LAYOUT_OVERFLOW`.
- Empty cells/controls, grid occupancy, span expansion, copied source metadata/text/glyphs,
  repeated headers and lookahead passes consume shared budgets before output copies. Header
  height lookups use a charged prefix sum rather than repeated scans.

Full local verification after code review fixes at `c5a3f1b77387024c350cd84c099406b9e24b8257`:

- Node **524 passed** (Layout 101), **0 cached**; all 27 test/typecheck/build tasks passed.
- Chromium **317 passed** (Layout 98), **0 cached**; all 6 browser tasks passed.
- **14 shared new tests**, including a 400-row synthetic table and 400 real bound RepeatRowGroup
  instances with locked fonts, exact business-source extraction, row/key correspondence, real
  geometry, repeated-run equality and the same pinned canonical digest in Node and Chromium.
- Existing 50-page, 1000-page, 160-live-TypographyCore, large-LRU and source-range pressure
  cases remain present and passed in the full runs.
- .NET SDK **10.0.302**, locked restore, serial build (zero warnings/errors), actual MTP discovery:
  **46 passed, 0 skipped**. MTP required execution outside sandbox due local IPC restrictions.
- Schema gates **20**, repository lint and license whitelist passed; golden corpus regenerated
  **16 DOCX**, scanned **28 templates / 106 tags**, with no corpus changes.

Independent Standards review found two concrete issues (uncharged repeated header summation;
page-top orphan enforcement), and Spec review independently found the widow/orphan split issue.
Both reviewers statically confirmed the fixes; executable regressions passed in both runtimes.
The suggested generic snapshot abstraction is deferred because probe rollback and reusable
cell capture have different state lifetimes; it was a nonblocking maintainability heuristic.

See `packages/layout-core/README.md` for policy, coordinate and allocation limits. Synthetic
capacity data is not a supplied anonymized business document. Final OFD/PDF extraction,
reader/printing interoperability and unrun architecture/browser matrices remain separate gates.
Remote bot review/CI must close on the latest PR head before this worker reports completion.


## PR #10 first review follow-up

The bot reviewed `dab4bd29e66938d5a94541fb7f6cc5126c638bf3` and raised four valid findings:

- `4011601519`: implicit heading policies now select the new `tables-ltr@0` profile, so
  LayoutIdentity cannot match the older paragraph-only behavior for the same heading source.
- `4011601528`: lookahead uses a region's explicit flow extent (zero for fixed regions), without
  pretending that a valid top-level region is nested or consuming its media/shaping a second time.
- `4011601533`: profile selection and paragraph dispatch share the effective nullish-default
  keep predicate; `keepWithNext:false` opts out unless widow/orphan fields are explicitly set.
- `4011601536`: the first table group height is a local return value; an empty resolved table
  returns zero and cannot reuse any earlier table's measurement.

Five additional shared regressions passed. Full post-fix Node **529** (Layout 106) and
Chromium **322** (Layout 103), all typechecks/builds and lint passed with **0 cached** tasks.
The earlier .NET 46/schema/golden/license evidence applies to unchanged cross-language
contracts and dependencies; the next remote CI run will recheck the full PR head.


## PR #10 second review follow-up

The bot reviewed `2e179f042c0ba874c1e94de17bcce671539b3689` and raised two valid findings:

- `4011655359`: lookahead now stops after the first independent media item, the table header
  and first connected row-span group, or the next paragraph's minimum legal initial lines.
  Table column inference still considers the full input under the shared work budget. A short
  paragraph unable to satisfy both split minima is kept whole. Policy paragraph measurement
  uses the page-count budget and IR coordinate ceiling rather than a fixed 100000-mm cutoff.
- `4011655362`: empty controls adjacent to text/other controls get distinct zero-text object
  anchors with their own Semantic Map `controlId`, source ranges, repeat identity and markers.
  Run boundaries preserve their source order without introducing printable text.

Eight additional shared regressions passed, including two independent 6000-row/line, 500-page
fixtures, a two-image list, four empty-control positions and an unsplittable short paragraph.
All **27 new shared tests** passed in Node/Chromium. Full post-fix verification: **Node 537**
(Layout 114), **Chromium 330** (Layout 111), typecheck/build/lint passed, **0 cached** tasks.
Independent Standards/Spec follow-up inspection confirmed the fixes without new concrete
findings. The latest remote head still requires its own bot and CI completion.


## PR #10 third review follow-up

The bot reviewed `01eedefb7291b63b56127526fa58a71ad9af51fe` and raised two valid findings:

- `4011757684`: cell measurement now uses its real parent height, and initial atomic lookahead
  uses the actual page content height. Explicit region overflow measurement is bounded by the
  Layout IR coordinate ceiling minus its origin, without a lower arbitrary 100000-mm cutoff.
  Tests cover 150000-mm lines/images on valid custom pages and a legal 100000-mm region that
  explicitly scales its taller cell content (with a diagnostic).
- `4011757689`: moving the original table to a new page does not consume a repeated-header
  identity; the index increments only when a duplicate header is actually painted.

Five additional shared regressions passed. Full local verification: **Node 542** (Layout 119),
**Chromium 335** (Layout 116), **0 cached**, with typecheck/build/lint passing. All **32 new
shared tests** run in both environments. Both independent review axes confirmed these fixes
without a concrete residual finding. Remote current-head closure remains required.


## PR #10 fourth review follow-up

The bot reviewed `9d33d1c376851aa56cf208ba345a53b93632796c` and raised two valid findings:

- `4011826445`: repeated headers now reference the original semantic entry's `nodeId`, for
  both text and control anchors. Metadata charging follows that exact identifier. The shared
  canonical digest was updated for the corrected semantic references.
- `4011826449`: preflight rejects explicit and inferred `rowCount × columnCount` grids over
  budget before document copying or font acquisition. Both paths are tested with font promises
  that never settle, proving that rejection does not wait for fonts.

Three additional shared tests passed; the zero-text amplification case now uses a large actual
semantic node ID. Full local verification: **Node 545** (Layout 122), **Chromium 338** (Layout
119), **0 cached**, with typecheck/build/lint passing. All **35 new shared tests** run in both
environments. Independent Standards and Spec follow-up review confirmed both fixes without a
concrete remaining issue. The latest head still requires remote bot/CI closure.
