# 10: Layout Core：分页、页眉页脚、水印

**What to build:** 多页文档可以排版：A4/A5/自定义纸张、方向、页边距按物理单位生效；段落跨页自动分页、显式分页符、页首页尾的空白/段距规则固定；页眉页脚预留高度并支持页码、起始页码、指定页隐藏、页面边框；"共 N 页"域通过有界二次排版收敛，否则报 `PAGINATION_NOT_CONVERGED`；文字/图片水印按 IR 图形状态输出。

**Blocked by:** 09 Layout Core：段落与行

**Status:** ready-for-human

- [x] 页面/节设置：纸张、方向、边距、每页纸张与内容区在 IR 页面部分逐页记录
- [x] 段落自动分页与显式分页符；页首不留段前距、页尾处理规则有用例
- [x] 页眉页脚：预留高度、页码域、起始页码、首页/指定页隐藏、页面边框
- [x] 页数域：有界迭代收敛；不收敛返回 `PAGINATION_NOT_CONVERGED`
- [x] 水印：文字/图片、透明度、变换、层级，使用 IR 已定义的图形状态
- [x] 50 页级别样本排版通过，页数与断行在重复运行与双端一致
- [x] Semantic Map 记录页面/节来源与阅读顺序


## Implementation / evidence (2026-09-13)

- Implements shared `layout()` pagination with fixed-font line geometry, physical page settings in `settings.page`, `Paragraph.layout.section` and explicit `pageBreakBefore`. Binding preserves these optional v0 fields. Header/footer reservation, page-number/total-page fields, hiding, borders and text/image watermarks emit Layout IR.
- Semantics and inspection lines record page/section identity with global body reading order. JSON Schema artifacts are synchronized; old model/IR instances remain valid. The layout engine identity is now `ofd-compose/paginated-layout@0`.
- Page-top before-spacing is omitted; page-bottom after-spacing is clipped. Fixed-height page bands wrap or fail explicitly; total-page convergence uses bounded full passes and reports `PAGINATION_NOT_CONVERGED` on exhaustion.
- Work budgets are shared across pages/decorations/iterations. Page and image-descriptor limits reject known over-budget requests before resource acquisition/copying. Watermark states use linear traversal; transformed page bounds cover rotation and reflection.
- Local regression: Node 382 passed (complete workspace run plus the final 46-test layout rerun), Chromium 175 passed (complete workspace run plus the final 43-test layout rerun), .NET 46/46; typecheck, build, lint and license gate passed. .NET MTP required execution outside the sandbox for its named pipe.
- Local evidence: 50 pages / 1250 real-font shaped lines, shared canonical digest, repeated Node/Chromium equality, independent Node SHA-256; 1000 pages / 16000 image watermarks / 17000 total objects; real committed PNG digest/dimensions and pixel-to-mm geometry. The 50-page content is explicitly synthetic, meeting this issue's capacity/determinism requirement; it is not an anonymized host business sample.
- Independent Standards review: one CPU state-scan finding fixed and statically verified. Independent Spec review: transformed watermark bounds fixed and statically verified; no remaining implementation finding. These reviews do not substitute for the remote bot.
- PR is stacked on issue09 / PR #6; dependencies and this PR remain unmerged. Remote bot review and CI must be read at the final PR head before delivery; this record does not claim they have already completed.

### Scope of evidence

Fixed reserved band heights are deliberate (no auto-height page-band profile). Image bytes are supplied/validated by the host and writer; Layout accepts authorized digest/dimension descriptors and does not fetch/decode media. Actual native RSS/timeout enforcement remains host Worker isolation. Host business samples, long tables, other browser/architecture versions and reader/writer interoperability remain their later issue gates, not extra blockers for issue10.


## Bot review round 1

The completed bot review of `7eea848af1fc916053d82de415a80c37d2131b1c` reported two valid P2 findings: inactive root total-page fields causing unnecessary convergence passes, and external image IDs colliding with generated IR IDs. The fix checks only rendered total-page fields, ignores overridden root geometry, validates unique image source IDs and maps them to a collision-free internal namespace. Shared tests cover root overrides, wholly hidden fields, arbitrary generated-looking image IDs, duplicate IDs and malformed descriptors. Final-head review remains required after this fix is pushed.


## Bot review round 2

The completed bot review of `45bd0c84d77128079a763c4fe3ffc8855ed13dd5` found that section markers copied by RepeatBlock expansion shared their static section ID. The fix derives each effective occurrence ID from a canonical tuple of the source section and complete repeat-instance node/key chain, in an internal namespace that also avoids the arbitrary implicit root ID. Optional page/semantic sectionSourceId retains the original source ID. A shared nested keyed-repeat test covers eight pages, stable identity after outer-group reordering, per-occurrence page numbering and first-page hiding, body source/repeat mapping, and page-budget rejection. Additional cases cover delimiter/escape/empty/Unicode keys, same-key different nodes, nested depth and intentional implicit-root collision. Non-repeated IDs remain unchanged. Final-head review remains required after this fix is pushed.
