# 12: Layout Core：图片、路径与区域

**What to build:** 已冻结尺寸的图片与条码进入版面：独立图片段落、居中、图片列表与循环内图片按物理尺寸落位并参与分页；分隔线、边框、基础矢量路径输出为 IR 路径；固定区域（密集表单）与流式区域共存，固定区域的溢出按模板显式策略（报错/截断/缩放/最小字号）处理并产生诊断，不静默缩字或丢内容。

**Blocked by:** 10 Layout Core：分页、页眉页脚、水印, 11 Media Core：图片 + 条码（code128 / ean13）

**Status:** ready-for-human

- [x] 图片：原尺寸、显式尺寸、适配、倍率、最大边界、裁剪；独立段落/居中/列表三种版式；加载时未知尺寸的图片不得进入 IR
- [x] 条码矩形路径按物理尺寸落位，布局器不非均匀拉伸、不裁掉静区
- [x] 分隔线、段落/表格边框、基础矢量路径输出为 IR 路径（填充规则、描边、虚线、端点/连接）
- [x] 固定区域与流式区域；固定区域溢出默认 `LAYOUT_OVERFLOW`，显式策略生效时仍产生诊断
- [x] 图片跨页策略（整体移到下页/超页高报错）有用例
- [x] Semantic Map 记录图片/条码的 bindingId 与重复实例
- [x] 确定性与双端一致测试


## Implementation and local evidence (2026-09-13)

Implemented `layout(resolved, fonts, options, prepareMediaResult)` with private preparation
provenance, current source/byte validation, atomic image/barcode placement, crop/alignment/list
semantics, local vector paths and the `media-regions-ltr@0` profile. Fixed/flow regions implement
error, true clip, uniform scale and bounded real font reflow; every explicit policy diagnoses its
result. Model/Binding schemas carry optional placement, paths, regions and shared Stroke borders.
See `packages/layout-core/README.md` for precise units, bounds, overflow semantics and budgets.

The table-border checkbox covers the shared Stroke contract, retained table/cell border fields,
and `borderPath` geometry builder. Complete table geometry, shared-edge resolution and pagination
remain issue 13 and are not claimed here. Nested regions/page breaks inside regions are explicit
P0 input errors. Writer, reader, printer and Linux x64/arm64 acceptance remain separate gates.

Local checks executed without Turbo cache:

- Node: 508 passed (Layout 85, including 32 new media/region/geometry/decoder checks).
- Chromium: 301 passed (Layout 82); final profile rerun passed its shared pinned digest.
- .NET 10.0.302: locked restore, single-node build and 46 passed; no skipped tests.
- Schema gates 20, lint, TypeScript checks, all package builds and license whitelist passed.
- Golden generator reproduced 16 DOCX artifacts; scanner reproduced 28 templates / 106 tags
  without tracked or untracked golden-corpus changes.
- Existing 50-page, 1000-page, 160-live-TypographyCore and large-LRU stress tests retained.

Two independent local review axes identified and verified fixes for shared image budgets,
source fingerprint work, media container replacement, actual decoration-path scaling,
leftward aligned overflow, square cap bounds and cross-runtime expected digest. These local
checks do not replace the required remote current-head bot and CI review.

PR must use `codex/issue-11-media-core` as base (dependency PR #8 at
`6e09d19ccdb7b994bb67a31a77ec1b916de67196`). Remote bot/CI closure is pending; do not start issue 13
or merge this branch on the strength of local evidence alone. This local issue has no matching
GitHub issue number.
