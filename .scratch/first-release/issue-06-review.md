# Issue 06 review

基线：`e459b430017447fe86dc6a68c1348e5e50da1fe9`；首轮实现：`05f7340f32e322f1bc68ad7f6272bda29ce616d3`。
PR：[Issue 06: deterministic Typography Core](https://github.com/whynpc9/ofd-compose/pull/4)。

## Standards

首轮和字符范围修复复审均 0 项有效发现。符合 ADR-0001 的单一 TypeScript/HarfBuzz 链路、fontkit 仅读取度量、摘要资源身份、无系统字体/locale 回退要求。`node:buffer` 仅为类型导入。未发现值得提出的 Fowler 基线异味。

复审独立核验了字符范围的 71 个有序无重叠区间、71850 个码点和 SHA-256，确认 GB2312 的 7445 字符没有遗漏；UTF-16 位置计算正确。

## Spec

本地首轮为 0 项发现；GitHub 独立 review 识别出下述遗漏并已修复。本地修复复审为 0 项有效发现。新增范围是 WP0.4 版本化候选，最终业务批准继续留在 issue 19，没有代替该决策。

复审建议增加准入表 count/digest 重算测试，已采纳：资源测试枚举实际 `isP0Character` 准入码点，按 uint32 big-endian 重算摘要与数量。

## GitHub review disposition

- **P2 — Reject characters outside the P0 repertoire**，线程 `PRRT_kwDOUUjwf86huAN4`，依据 spec.md §8 / ADR-0001 字符范围行。**采纳并修复**：整形前强制执行版本化、字体独立的码点准入；返回 `CHARACTER_OUT_OF_PROFILE` 和 UTF-16 原文位置。用字体确含 glyph 的 ₦ 验证拒绝，用允许范围内缺字验证 `GLYPH_MISSING`。范围版本/摘要写入 `shapingAndLineBreakVersions`。

## Validation and remaining gates

- 全仓首次真实执行（无 Turbo 缓存）：Node 235、Chromium 44；修复新增 Node 3 项、Chromium 2 项。
- 修复后 Typography Core：Node 24、Chromium 21；全量输出共享字节基准及独立准入/cluster/断点/样式断言。
- .NET 10.0.302：本地和首轮 GitHub CI 均 46/46。
- 完整许可门禁：23 pnpm 生产包、85 开发包（4 个既有文档例外）、20 NuGet 包；字体/OFL/WASM 另做摘要校验。
- 首轮 GitHub CI `34678567287` 全绿，包含 golden corpus 可复现检查；修复提交需再次等待远端 CI。
- 字体子集、目标阅读器 CFF/TTF 互操作和最终业务字符清单属于后续 issues，本 PR 不宣称其验收完成。PR 尚未合并。

Standards：0 项遗留；Spec：0 项遗留；GitHub P2：2 项已修复。

## 第二轮 GitHub review

- **P2 — Compute line breaks at paragraph scope**，线程 `PRRT_kwDOUUjwf86huEp8`，评审提交 `543b1b0`。**采纳并修复**：从 run 的 `shape` 返回值移除断点；独立 `lineBreakOpportunities` 明确要求完整段落。样式 run 的末尾不再产生强制换行，跨 run 的单词和标点规则保留完整上下文。
- 验证：`hel` + 粗体 `lo world` 只在段落位置 6/11 产生断点，不在 run 边界 3 断行；`中）文` 不在闭标点前断行。完整段落断点和整形结果分别共享字节基准。Typography Core Node 25、Chromium 22 通过；Spec 复审 0 项有效发现。
- `543b1b0` 的 GitHub CI `34679002942` 全绿（Node 238、Chromium 46、.NET 46）。本轮增加 Node/Chromium 各 1 项；最终 PR checks 为最终验证状态。
