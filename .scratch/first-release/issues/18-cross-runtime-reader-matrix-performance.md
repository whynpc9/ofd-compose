# 18: 跨运行时、阅读器矩阵与性能（WP0.9）

**What to build:** 团队获得首版关键证据：同一 golden corpus 在 Linux x64 与 arm64 干净容器（无 Word/LibreOffice/Chromium）中渲染得到相同规范化 IR；生成的 OFD/PDF 在三款目标阅读器的固定版本中显示、复制、搜索正确并留存截图；浏览器矩阵复跑一致；冷/热启动、单页、50 页与真实长表格的分项性能数据；未执行的环境明确标注 `Not verified`。

**Blocked by:** 15 OfdIrWriter, 16 PdfIrWriter, 17 源附件协议与回编辑 round-trip

**Status:** ready-for-agent

- [ ] 多架构容器镜像（aspnet 10 基础 + Node 24），x64 与 arm64 分别运行 corpus，IR 摘要一致；任一架构未跑标 `Not verified`
- [ ] 浏览器矩阵（Chromium 最近两版 + Firefox）复跑内核测试，记录实际版本
- [ ] 三款目标阅读器（数科 / 福昕 / WPS 候选）：记录版本、系统、许可可用性；对 CFF 字体子集与 TrueType 备选分别截图并测试复制/搜索；文字、边框、图片分区域判断
- [ ] 若任一阅读器对 CFF（retain-gids 子集）失败，记录并推动字体家族切换决策
- [ ] 性能：指定硬件与数据，绑定/整形/布局/子集/写出分项 p50/p95 与峰值内存；冷/热启动；单页、50 页、真实长表格
- [ ] 证据存入 dated Audit 文档，供 WP0.10 引用
