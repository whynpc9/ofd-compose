# 30: 受限 DOCX 导入器 + 差分参照工具

**What to build:** 迁移工程师对首批旧 DOCX 模板运行受限导入器，得到原生 TemplateSource + ResourcePack + MigrationReport：跨 Run 拆分的标签被修复且文本范围—样式映射保留，控制块配对被诊断，`path/src` 图片转为需宿主授权解析的资源引用；差分工具在隔离环境运行固定提交的旧 C# 引擎生成参照，与新 ResolvedDocument 做文本/结构/媒体差分，形成每份模板的人工确认记录。

**Blocked by:** 03 旧 DOCX 扫描器原型, 05 Binding Core 全部 P0 操作与结构展开, 20 v1 契约冻结

**Status:** ready-for-agent

- [ ] 导入器：段落/表格/图片/条码标签 → DynamicText / ConditionalBlock / RepeatBlock / RepeatRowGroup / ImageBinding / BarcodeBinding；样式范围映射，冲突报告；不做旧库的段落扁平化
- [ ] 旧格式别名与函数别名规范化；依赖隐式回溯/旧 truthiness/非数组循环的节点标注 legacy-compat 与 `LEGACY_SEMANTIC_CHANGE`
- [ ] 图片尺寸迁移固定 `legacyPixelDpi=96`；资源引用不含任意路径
- [ ] 差分工具：隔离运行 NDocxTemplater `9c02f26d` 生成参照 DOCX → 抽取文本/结构/媒体 → 与新 ResolvedDocument 差分；`allowedDifferences` 机制
- [ ] 首批模板（corpus 业务基线可得部分）的 MigrationReport 与确认记录模板
- [ ] 导入器不进入生产渲染链路（依赖边界测试）
