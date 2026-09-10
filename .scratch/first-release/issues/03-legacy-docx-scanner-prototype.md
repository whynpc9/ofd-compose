# 03: 旧 DOCX 扫描器原型（WP0.1a）

**What to build:** 迁移工程师对一批旧 DOCX 模板运行离线扫描器，得到每个模板位置的表达式、出现次数、数据路径、所需函数、格式模式（含 `numeric`、`percentage`、`per-mille`/`per_mille`、`datetime`/`time` 等别名）、资源引用、控制块配对情况、风险等级与迁移状态（可自动 / 需确认 / 不支持）的清单，以及 MigrationReport 骨架。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-human

- [x] .NET 离线工具读取 DOCX（OpenXML），识别 NDocxTemplater 全部标签形态，包括被 Word 拆分到多个 Run/Text 的标签
- [x] 输出清单与 MigrationReport 为 JSON，字段与 spec 迁移工具一节一致
- [x] 诊断未闭合、错配、孤立结束、跨容器配对与同层嵌套的控制块
- [x] 识别图片 `%`/`%%` 段落、尺寸参数、`path/src` 来源，以及条码类型与参数
- [x] 静态页眉页脚内容只作范围发现，报告中明确标注"非旧引擎动态渲染证据"
- [x] 对 corpus 中可获得的 DOCX（含测试程序生成的样例）运行并产出报告；报告纳入 corpus 目录
- [x] 不执行任何表达式、不读取任何图片路径

## Comments

**2026-09-10 (agent) 实现说明：**

- 工具：`dotnet/tools/OFDCompose.DocxScanner/`（CLI `scan` / `corpus` 两种模式，DocumentFormat.OpenXml 3.5.1）；`dotnet/tools/OFDCompose.CorpusDocxGenerator/` 把 16 个测试方法用例的 `template.txt` 生成确定性 `template.generated.docx`（测试程序生成的样例）。
- 标签识别与配对严格按旧引擎语义（`DocxTemplateEngine.cs` 固定提交 9c02f26d）：段内跨 Run 拼接（逐 `w:t` 偏移跟踪，`splitAcrossRuns`/`runCount` + `SPLIT_RUN_TAG`）、正文/表格行/单元格三级独立配对作用域、表达式序数精确比对；诊断码：`UNPAIRED_BLOCK_START`、`MISMATCHED_BLOCK_END`、`ORPHANED_BLOCK_END`（并记 `orphaned-block-end` 语义变化，旧引擎静默丢弃）、`CROSS_CONTAINER_PAIRING`、`INTERLEAVED_BLOCKS`（跨类型交叉）、`NESTED_BLOCK`（同层嵌套，info）。
- 资源引用：仅纯路径表达式做**属性查找**（非表达式求值），记录 sourceKey（src/data/base64/path/value 优先级）与 sizeKeys（含 `*Px`/`scaleRatio`/`keepAspectRatio` 等别名）、字符串形态分类（data-uri/absolute-path/relative-path/base64-like）；**从不打开任何被引用文件**（有测试证明引用不存在文件也能正常列出）；带管道表达式标 `valueUnknown`。
- 格式别名（numeric/percentage/per-mille/per_mille/datetime/time）报告原始与规范化主名，并记 `format-alias`；`upca`/`itf`/`at:-1`/`[-n]` 路径/文件路径图片来源各记对应 `legacySemanticChanges`。
- 页眉页脚：仅枚举 HeaderParts/FooterParts 列入 `headersFooters`，带固定说明「静态页眉页脚内容：旧引擎不处理页眉页脚（仅范围发现，非旧引擎动态渲染证据）」，不参与正文计数与配对。
- 产出：28 个模板全部扫描（12 个示例原件 + 16 个生成样例），报告在 `tests/golden-corpus/scan-reports/`（每模板一份 `ofd-compose/scan-report@1` + 聚合 `ofd-compose/migration-report@0` 骨架）。合计：106 个标签；23 可自动 / 5 需确认（at-negative-index ×2、file-path-image-source ×2、upca-to-ean13+itf-pad-left-zero ×1）/ 0 不支持。
- 确定性：报告无时间戳、排序稳定，输出布局与 Biome JSON 格式一致（lint 干净）；CI 新增「重跑扫描 + `git diff --exit-code`」复现性门禁。
- 测试：30 个 xUnit 用例（fixture 以 OpenXML 内存构建 DOCX），覆盖上述全部诊断码、条码参数/别名/默认值、页眉页脚、资源分类与生成器往返。
- 判断性补充（超出原清单字面）：`INLINE_CONTROL_TOKEN`/`INLINE_IMAGE_TOKEN`（行内控制/图片 token 的旧行为：擦除/保留字面量，info 级）与 `UNSUPPORTED_FORMAT_KIND`；`migrationStatus` 映射为 任一 error/warning 诊断或语义变化 → `needs-review`，`unsupported` 预留给未来能力缺口。
