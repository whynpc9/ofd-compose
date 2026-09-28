# 18: 跨运行时、阅读器矩阵与性能（WP0.9）

**What to build:** 团队获得首版关键证据：同一 golden corpus 在 Linux x64 与 arm64 干净容器（无 Word/LibreOffice/Chromium）中渲染得到相同规范化 IR；生成的 OFD/PDF 在三款目标阅读器的固定版本中显示、复制、搜索正确并留存截图；浏览器矩阵复跑一致；冷/热启动、单页、50 页与真实长表格的分项性能数据；未执行的环境明确标注 `Not verified`。

**Blocked by:** 15 OfdIrWriter, 16 PdfIrWriter, 17 源附件协议与回编辑 round-trip

**Status:** needs-info

- [x] 多架构容器镜像（aspnet 10 基础 + Node 24），x64 与 arm64 分别运行 corpus，IR 摘要一致；任一架构未跑标 `Not verified`
- [x] 浏览器矩阵（Chromium 最近两版 + Firefox）复跑内核测试，记录实际版本
- [ ] 三款目标阅读器（数科 / 福昕 / WPS 候选）：记录版本、系统、许可可用性；对 CFF 字体子集与 TrueType 备选分别截图并测试复制/搜索；文字、边框、图片分区域判断
- [ ] 若任一阅读器对 CFF（retain-gids 子集）失败，记录并推动字体家族切换决策
- [ ] 性能：指定硬件与数据，绑定/整形/布局/子集/写出分项 p50/p95 与峰值内存；冷/热启动；单页、50 页、真实长表格
- [x] 证据存入 dated Audit 文档，供 WP0.10 引用


## Comments

2026-09-28: implementation and executed evidence are in
`tests/runtime-matrix/` and `docs/audits/2026-09-28-runtime-reader-performance.md`.
Measured source SHA: `5ead51614a41ceb6b581f2a469b211508220b55b`.
Linux arm64 (native architecture in VM) and x64 (**emulated on ARM**, not native x64
performance) each executed the same 34 inputs with Node 24.19.0 and .NET 10.0.12.
All 28 positive cases actually wrote both formats; 6 explicit negatives were retained.
Canonical IR/input/resource/complete-diagnostic comparison passed; five corrupted or
incomplete evidence counterexamples were rejected. Container package/executable/SDK
inventories, image/source/font/WASM/output hashes and raw logs are retained.

Chromium major 154 and 153 and Firefox 155 each passed a complete 409-test, seven-suite
forced serial run with full stdout/stderr, version probes and exit 0 retained. These
logged runs supersede the earlier summary-only / split-Firefox evidence. Node 619 and exact-SDK .NET 494/0-fail/0-skip passed.
Formal measurements retain 172 raw rows per architecture (20 cold + 3 discarded warmups
+ 20 hot for each of four cases), per-stage p50/p95 and separate process memory peaks.
The successful scale samples are synthetic 1/50 pages and 1000 rows/84 pages. The
unchanged 6000-row intended 500-page input returns `RESOURCE_LIMIT` at bind; its failure
cost is recorded, not successful rendering throughput. No existing stress scale or
resource limit was reduced.

Status remains needs-info: three target desktop readers' licensed/versioned display,
copy/search, per-region screenshots and issue17 attachment extraction are **Not verified**;
real host business long-table data was not provided. Actual paired CFF/TTF files and
initial/edited source-attachment handoff files are saved with hashes. No desktop CFF
failure was observed, so no font-family switch is claimed. ADR-0005 remains Proposed;
issue17 is not waived and issue19 cannot freeze a profile from these missing gates.
