Status: ready-for-agent
Source plan: OFD Compose 实施计划 v0.3（2026-09-10）
Related ADRs: docs/decisions/ADR-0001-technology-baseline.md

# OFD Compose（元版）首版闭环实现 Spec

**Spec 版本：** v1 · 基于《OFD Compose（元版）原生文档排版平台实施计划 v0.3》（2026-09-10）
**覆盖范围：** 实施计划中的 WP0（可行性、语料与架构准入）与 WP1（模板设计—绑定—渲染首版闭环），以及 WP0/WP1 必须一并定义的 OFD 容器源附件协议基础。
**不覆盖：** WP2（容器服务与证据链）、WP3（完整单文档编辑 SDK）、WP4（发布收敛）。这些应作为后续独立 spec，在 WP0 的 ADR 产出后再制定。
**状态：** 待评审。本 spec 的实现决策以计划 v0.3 的"建议基线"为准；凡计划中标注"必须通过 WP0 才能冻结"的项，在本 spec 中以"待 WP0 ADR 冻结"标记，实施顺序上先于依赖它们的工作。

> 术语约定：本 spec 使用计划 v0.3 的词汇——TemplateSource、ResolvedDocument、Layout IR、Semantic Map、RenderProfile、ResourcePack、DynamicText、InputControl、ConditionalBlock、RepeatBlock / RepeatRowGroup、ImageBinding、BarcodeBinding、OfdIrWriter、PdfIrWriter、capability profile、golden corpus、MigrationReport、LayoutIdentity。仓库尚无独立术语表；本 spec 的"补充说明"节列出了应在 WP0 中固化为术语表的词条。

---

## 问题陈述（Problem Statement）

UniDmrCore 目前用 DOCX 模板承载简报、报表等文书：模板作者在 Word 中书写含 NDocxTemplater 标签的段落与表格，业务系统填入数据后再经 DOCX→PDF/OFD 转换得到定稿文件。使用者面对以下问题：

1. **版面不可复现。** 同一模板与数据在不同 Word/LibreOffice 版本、不同字体环境下分页与断行不同；定稿文件无法在服务端确定性地重新生成。
2. **模板语义藏在自由文本里。** 排序、Top-N、极值项、比率格式化等叙述表达式以字符串标签存于 OpenXML Run 中，Word 拆分 Run 会破坏标签，作者无法在保存前得到校验，错误只在渲染时暴露。
3. **定稿载体不可回编辑。** 导出的 OFD/PDF 是固定版面的转换产物，不携带模板语义或已填写文档，无法在不重新跑业务数据的情况下修订。
4. **生产链路依赖办公软件进程。** 服务端渲染依赖 Word/LibreOffice 或浏览器截图，运维成本高、安全边界不清、缺字/溢出等失败常被静默降级为整页图片或"少内容的成功"。
5. **旧能力迁移无据可依。** 现有 DOCX 模板已经在用叙述段落中的动态文本、重复表格行、动态图片与八种条形码；替代方案若只做"字段替换 + 分页"，业务无法切换。

## 解决方案（Solution）

交付 OFD Compose 首版：一个以结构化文档模型与确定性排版为核心、直接输出矢量 OFD 与 PDF 的模板设计与渲染平台。

从使用者视角：

- **模板作者**在模板设计工作台中可视化制作模板：设置页面/样式/表格，从数据 schema 的字段树中拖入绑定，在段落行内插入 DynamicText（可通过字段选择器 + 排序/取项/极值/格式配置，或通过高级表达式输入），配置重复行组/重复块、条件块、动态图片与条形码，用样例数据实时预览分页；保存前得到节点级校验诊断；发布版本化模板产物。
- **宿主开发者**（UniDmrCore 接入方）通过公开的 HTTP 契约提交模板、数据与内容寻址的资源包，得到可验证的矢量 OFD/PDF 产物、Layout IR 摘要、Semantic Map 与结构化诊断；无需接触 canvas-editor 或 OFD 写入器的私有 API。
- **迁移工程师**用离线扫描器读取旧 DOCX 模板，得到表达式/格式模式/作用域/媒体/条码的清单与 MigrationReport（可自动 / 需确认 / 不支持），再经受限导入或人工重建产出原生 TemplateSource，并用 golden corpus 完成新旧语义差分确认。
- **平台运维**在无 Word / LibreOffice / Chromium 的 Linux 容器中部署 API 与隔离 Worker，得到资源预算、取消、超时、幂等、日志脱敏与无外网字体分发能力。
- **文件接收方**打开原生可回编辑 profile 的 OFD 时，能在三款目标阅读器中正确显示、复制、搜索正文；文件内携带最小化的 ResolvedDocument 与资源清单，可在平台中重新打开修订。

架构上遵循"编辑层管流，OFD 管版"：TemplateSource + Data → ResolvedDocument → Layout IR + Semantic Map → OfdIrWriter / PdfIrWriter。浏览器与 Node Worker 共享同一套 TypeScript 的编译、绑定、媒体、整形与排版内核；.NET 门面只负责契约、鉴权衔接、限额、隔离与固定图元写出，不做度量与分页。

---

## 用户故事（User Stories）

### A. 模板作者 —— 设计与绑定

1. 作为模板作者，我想在工作台中新建 A4/A5/自定义纸张的模板并设置方向、页边距与物理单位，以便版面尺寸与最终打印一致。
2. 作为模板作者，我想编辑段落、标题、列表、表格、图片、分页符、分隔线与区域，并设置字号、字重、斜体、下划线、删除线、上下标、颜色、高亮与链接，以便排出与旧简报同等丰富的版式。
3. 作为模板作者，我想导入数据 schema 并以字段树浏览嵌套对象与数组，以便不用手改 JSON 就能找到可绑定的字段。
4. 作为模板作者，我想把字段拖入段落行内生成 DynamicText，它与前后静态文本处于同一行、参与同一次断行，以便写出"营收最高的是 X，收入为 Y 元。"这样的叙述句而不产生多余换段。
5. 作为模板作者，我想通过可视化配置对列表做排序（sort）、截取（take）、取首/尾/第 N 项（first/last/nth/at）、取极值项（maxby/minby）、取字段（get/pick）、计数（count）与行内条件短语（if），以便复刻旧简报中的排名与极值叙述。
6. 作为模板作者，我想以高级表达式输入旧 NDocxTemplater 语法（如 `institutions | maxby:revenue | get:name`），并看到它被编译为与可视化配置相同的 AST，以便两种输入方式保存同一产物。
7. 作为模板作者，我想对数字设置千分位、小数精度、负数与零的显示，对比率设置百分比/千分比，对日期设置 `yyyy-MM-dd`、`yyyy年M月`、含冒号时间等模式，并在设计时就知道哪些模式受支持，以便格式化错误不留到渲染时。
8. 作为模板作者，我想显式锁定模板的 locale、时区与舍入策略，以便同一模板在任何服务器上产出同样的日期与数字。
9. 作为模板作者，我想把一组段落/表格/图片包进 ConditionalBlock，以便在数据为假时整块不出现且不留空段。
10. 作为模板作者，我想把表格行组绑定为 RepeatRowGroup、把一组段落或复合块绑定为 RepeatBlock，并为实例指定稳定重复键，以便重复内容有可追溯的实例身份。
11. 作为模板作者，我想让重复列表来自排序/截取后的结果，以便"前 5 名机构表"直接由表达式驱动。
12. 作为模板作者，我想在重复块内再嵌套重复或条件，并在作用域内引用当前项、父级项与根数据，以便表达机构→科室两级明细。
13. 作为模板作者，我想分别配置字段缺失、`null`、空字符串、`0`、`false`、空数组时的显示与显隐行为，以便空数据的版面是设计出来的而不是意外。
14. 作为模板作者，我想插入 ImageBinding 绑定到单图或图片列表（data URI / base64 / 宿主授权资源），设置宽高、最大边界、缩放倍率与保持比例，并可放入循环，以便动态图片按物理尺寸稳定落位。
15. 作为模板作者，我想插入 BarcodeBinding 并选择 code128/code39/code93/codabar/ean13/ean8/upca/itf，设置物理尺寸、静区、pure 与居中，以便条码可被扫描且尺寸符合业务要求。
16. 作为模板作者，我想在条码值不满足所选码制的长度/字符/校验位规则时立即得到诊断，以便不会打印出错误业务值。
17. 作为模板作者，我想插入人工填写的 InputControl（文本/数字/下拉/日期/单选/复选）并设置占位、默认值与必填，且它与 DynamicText 在语义上分开，以便后续填写模式不与数据驱动内容混淆。
18. 作为模板作者，我想设置页眉页脚、页码、起始页码、指定页隐藏、页面边框与文字/图片水印，以便报表符合机构版式规范。
19. 作为模板作者，我想设置表格的合并单元格、列宽、行高、边框、背景、垂直对齐，并声明跨页重复表头、表头与首行同页，以便长表格跨页可读。
20. 作为模板作者，我想设置标题与下段同页、基础孤行控制，以便简报标题不会孤悬页尾。
21. 作为模板作者，我想在固定区域（密集表单）中显式声明溢出策略（报错 / 截断 / 缩放 / 最小字号），并在使用非默认策略时得到诊断，以便不会有内容被静默缩字或丢弃。
22. 作为模板作者，我想加载样例数据并实时看到分页预览，预览与正式渲染使用同一套规则，以便所见即所得。
23. 作为模板作者，我想在保存/发布前运行校验，得到未绑定字段、不支持的函数或格式模式、作用域歧义、字体缺失、表格越界、条码参数错误等节点级诊断，以便发布的模板一定能渲染。
24. 作为模板作者，我想发布版本化的模板产物并附带兼容声明（模型版本、表达式语言版本、绑定策略版本、所需字体与资源锁），以便宿主知道该模板需要什么能力。
25. 作为模板作者，我想撤销/重做、格式刷、查找替换，并在设计/只读/打印预览模式间切换而不发生未记录的内容转换，以便日常编辑高效可靠。
26. 作为模板作者，我想用中文输入法输入、进行组合输入与跨页选区，且新字形、复杂表格、撤销与重排后光标位置正确，以便编辑体验与常规编辑器一致。
27. 作为模板作者，我想把模板保存为文件或通过宿主存取适配接口保存，而不必依赖平台自带账号或模板库，以便宿主决定模板的存储与审批。

### B. 宿主开发者 —— 渲染与集成

28. 作为宿主开发者，我想调用能力发现接口获得引擎、字体包、输出后端、capability profile 与版本兼容矩阵，以便在提交前判断模板要求的能力是否可用。
29. 作为宿主开发者，我想提交模板做校验并得到节点级诊断与能力版本，以便在业务发布流程中前置检查。
30. 作为宿主开发者，我想提交 TemplateSource + Data + ResourcePack + RenderProfile 并同时请求 OFD 与 PDF，得到结果 manifest 与产物集合，以便一次调用取得双格式。
31. 作为宿主开发者，我想请求的所有格式全部成功才被标记为整体成功，部分成功只作为明确诊断返回，以便不会误发不完整结果。
32. 作为宿主开发者，我想提交已填写的 ResolvedDocument 进行定稿而不再次执行数据绑定，以便人工确认过的内容不被重新计算。
33. 作为宿主开发者，我想得到预览接口返回的分页摘要、IR 摘要与缩略图，且它与正式输出使用同样规则，以便业务界面可先行展示。
34. 作为宿主开发者，我想在每个产物中获得模板版本、表达式语义版本、数据输入摘要、编译产物摘要、ResolvedDocument 摘要、媒体/条码版本、排版配置、IR 摘要与最终产物摘要，以便在业务系统中持久化完整的技术身份链。
35. 作为宿主开发者，我想每条诊断都包含 code / severity / phase / nodeId / bindingId / dataPath / pageIndex / message，以便把错误精确定位到模板节点与数据路径。
36. 作为宿主开发者，我想所有资源以内容寻址方式随请求提供，或通过我方实现的授权资源解析接口解析，Worker 不会访问任意 URL、文件路径或我方数据库，以便安全边界清晰。
37. 作为宿主开发者，我想请求带有幂等身份（调用方资源作用域 + 输入摘要 + profile + 输出格式），重复提交得到同一结果，以便重试安全。
38. 作为宿主开发者，我想通过 .NET 调用 SDK 或最小调用示例接入，以便 UniDmrCore 不需要理解引擎内部。
39. 作为宿主开发者，我想由我方提供业务指标的统计口径、聚合值与码表，而平台只对已提供的数据做版本化的显示计算，以便业务逻辑不进入平台。
40. 作为宿主开发者，我想通过 SDK 在浏览器中嵌入设计工作台，并接收校验事件、source-map 事件与渲染配置回调，以便在我方界面中集成模板设计。
41. 作为宿主开发者，我想旧的异步预览结果不会覆盖较新的修订，以便并发预览下界面不回退。

### C. 迁移工程师 —— DOCX 能力与文件迁移

42. 作为迁移工程师，我想对一批受控旧 DOCX 运行扫描器，得到每个模板位置的表达式、出现次数、数据路径、所需函数、格式模式（含 `numeric`、`percentage`、`per-mille`、`datetime` 等别名）、资源引用、控制块配对情况与风险等级，以便基于实际使用而非 README 决定迁移范围。
43. 作为迁移工程师，我想扫描器识别被 Word 拆分到多个 Run/Text 的标签，并保留文本范围到样式的映射，以便迁移后标签两侧的独立样式不丢失。
44. 作为迁移工程师，我想扫描器诊断未闭合、错配、孤立结束、跨容器配对与同层嵌套的控制块，以便不把结构错误带入新模板。
45. 作为迁移工程师，我想得到 MigrationReport，逐节点标注"可自动 / 需确认 / 不支持"，以及依赖隐式作用域回溯、旧 truthiness、非数组循环、UPC-A→EAN13 转换、ITF 补零等 `LEGACY_SEMANTIC_CHANGE` 项，以便有据地决定是否接受语义差异。
46. 作为迁移工程师，我想受限导入器输出原生 TemplateSource + ResourcePack，其中旧 `path/src` 图片引用被转换为需宿主授权解析的资源引用而不是任意路径，以便新模板不携带越权读取。
47. 作为迁移工程师，我想为旧模板固定 `legacyPixelDpi=96` 的图片尺寸兼容配置并验证物理尺寸，以便旧图片尺寸在新平台中一致。
48. 作为迁移工程师，我想在隔离的差分工具中运行固定提交的旧 C# 引擎产出参照，并与新 ResolvedDocument 做文本/结构/媒体差分，以便迁移证据可重复。
49. 作为迁移工程师，我想每份首批模板都有旧函数映射、样式/媒体差异、语义对照结果与人工确认记录，以便业务切换有完整证据。

### D. 平台运维 —— 部署与运行

50. 作为平台运维，我想在不含 Word / LibreOffice / Chromium 的干净 Linux x64 与 arm64 镜像中运行 API 与 Worker，以便部署面最小。
51. 作为平台运维，我想 Worker 常驻且有界，作业有超时、取消、内存/CPU/展开节点预算，原生调用无法合作取消时可终止隔离 Worker，以便单个坏作业不拖垮服务。
52. 作为平台运维，我想配置无外网模式下的字体包与资源供应，字体按文件摘要锁定，缺字体时作业失败而不回退到系统字体，以便结果可复现。
53. 作为平台运维，我想日志中不出现密钥、完整业务数据或整份 ResolvedDocument，以便合规。
54. 作为平台运维，我想 ZIP/XML/图片/字体输入有大小与结构限制、禁用 XML 外部实体、阻止路径穿越与远程资源读取，以便恶意输入不导致资源耗尽或越权。
55. 作为平台运维，我想部署产物附带 SBOM、第三方与字体许可清单、锁文件，以便许可审计。
56. 作为平台运维，我想得到冷/热启动、单页、50 页、真实长表格的 p50/p95 与峰值内存分项数据（绑定/整形/布局/子集/写出/排队），以便容量规划。

### E. 排版内核与写入器开发者 —— 确定性与输出

57. 作为排版内核开发者，我想排版核心不引用 DOM、光标、事件、观察器，并能在真实 Node 中执行（不用 Canvas mock 或空 DOM），以便服务端与浏览器共用同一内核。
58. 作为排版内核开发者，我想浏览器与 Node 共享同一整形（HarfBuzz/WASM 或等价）、断行、字体回退、格式化与资源身份实现，以便两端字形与分页一致。
59. 作为排版内核开发者，我想对相同规范化输入（LayoutIdentity）在重复运行、支持浏览器与 x64/arm64 上得到相同的规范化 IR，以便确定性可自动验证。
60. 作为排版内核开发者，我想 IR 记录原始逻辑文本、显示文本、字体实例、glyph ID、位置/advance/offset 与 cluster 映射，以便写入器不再做任何度量或字形选择。
61. 作为排版内核开发者，我想 IR 的语义部分记录 nodeId、bindingId、重复实例、控件、表格行列、阅读顺序与来源文本范围，且跨页重复表头被标记为重复身份，以便下游不会把它误算为业务记录。
62. 作为写入器开发者，我想 OfdIrWriter 只消费 IR 的固定图元、字体子集、图片、附件与标签，不换行、不分页、不缩字、不选回退字体，以便版面来源唯一。
63. 作为写入器开发者，我想 PdfIrWriter 从同一 IR 直接生成定位字形、嵌入子集字体并带可抽取文本映射的 PDF，不经 OFD→PDF，以便双格式几何一致。
64. 作为写入器开发者，我想写出后返回 IR objectId → 输出文件 objectId 的完整映射（允许一对多），以便语义标签不绑定到猜测的 ID。
65. 作为写入器开发者，我想在 IR 含有当前后端 profile 不支持的图元/合成方式时得到 `UNSUPPORTED_FEATURE` 错误而非静默近似，以便失败可见。
66. 作为写入器开发者，我想后端切换（ofdrw.net ↔ Java ofdrw）只能通过显式记录后端名称、版本、能力与失败原因的 ADR 发生，作业失败后不会偷偷换后端，以便渲染配置身份可信。

### F. 文件接收方与回编辑者 —— 容器与源附件

67. 作为文件接收方，我想生成的 OFD/PDF 正文是可检索、可复制、可抽取的文本对象，边框为路径，不是整页位图或透明文字层，以便文件可用于检索与存档。
68. 作为文件接收方，我想文件在至少三款目标阅读器的固定版本中显示一致，以便不依赖特定阅读器。
69. 作为回编辑者，我想原生可回编辑 profile 的 OFD 携带 `ofd-compose` 命名空间的 manifest、最小化 ResolvedDocument、资源清单与 Semantic Map，以便在平台中重新打开。
70. 作为回编辑者，我想重新打开时默认加载文件内的 ResolvedDocument 而非重新执行模板，以便看到的就是当时定稿的内容；重新绑定数据是显式的新操作。
71. 作为回编辑者，我想重新打开后能修改文字、插入原字体子集中不存在的字符并再次导出，且资源与完整字体身份可取回，以便回编辑真正可用。
72. 作为回编辑者，我想打开文件时依次检查协议、大小、JSON schema、摘要、资源完整性、版本兼容，而不是以附件名称判断可信，以便伪造的源附件被拒绝。
73. 作为文件分发者，我想选择显式声明为非回编辑派生物的分发 profile（不带编辑源），以便对外分发不夹带内部数据。
74. 作为文件分发者，我想源附件默认不包含整份输入 JSON、未使用字段、未打印敏感值、调试信息、访问令牌或资源凭证，以便最小化泄露面。

### G. 评审与质量 —— 证据

75. 作为评审人，我想 golden corpus 分为库级基线（NDocxTemplater 15 个 DOCX 测试方法与示例 01–12 的场景）与业务基线（脱敏真实模板/数据/旧输出），并分别标记，以便区分"库支持"与"业务已用"。
76. 作为评审人，我想每个 DOCX 兼容用例记录 legacyCommit / templateId / dataDigest / expectedSemantic / allowedDifferences / nativeProfile / result，以便审计可追溯。
77. 作为评审人，我想 WP0 结束时得到 ADR：引擎继续/替换、允许的 fork 范围、首版字符与版式 profile、OFD/PDF 后端选择、性能参考与未解风险，以便 WP1 的冻结项有据可依。
78. 作为评审人，我想所有未实际执行的 arm64、阅读器、宿主业务测试在证据矩阵中保留 `Not verified`，以便不因其他项通过而误标完成。

---

## 实现决策（Implementation Decisions）

### 1. 交付范围与阶段门禁

- 本 spec 实现 WP0 与 WP1。WP0 是证据阶段：每个 WP0 子项产出可重复的测试或 ADR；**WP1 的模型/IR/协议冻结不得在 WP0.10 ADR 完成前发生**。
- WP0 的 Go/No-Go 条件按计划 v0.3 §5 执行。No-Go（必须靠 Chromium、排版与交互不可解耦、正文只能转轮廓/位图、无法导出稳定 source-map、字体语义无法保持）触发时，先更新 ADR 评估受控 fork 或替代内核，不进入 WP1 大规模实现。
- 工作包按证据解锁，不按日历。本 spec 不含排期。

### 2. 模块划分（对应计划 §3.1 组件表）

共享 TypeScript 包（浏览器与 Node 双端运行）：

| 模块 | 职责 | 对外接口（概念） |
| --- | --- | --- |
| Document Model | 自有 JSON schema：信封（schemaVersion/documentId/revisionId）、样式表、页面/节、正文树、页眉页脚、资源清单、扩展命名空间、来源信息；节点稳定 `nodeId`，绑定独立 `bindingId` + `path` | schema 校验、序列化/反序列化、版本迁移 |
| Template Compiler | 可视化配置与旧文本语法 → 版本化 AST；类型检查；来源映射（模板位置 ↔ 旧表达式 ↔ AST 节点） | compile(TemplateSource) → CompiledTemplate + Diagnostics |
| Binding Core | 路径求值、显示表达式、条件/重复展开、格式化、Missing/Null 区分、诊断、预算 | bind(CompiledTemplate, Data, BindingPolicy) → ResolvedDocument + Diagnostics |
| Media Core | 图片尺寸解析与规范化、条码生成（矢量路径优先）、资源内容寻址与几何冻结 | resolveMedia(ResolvedDocument, ResourcePack) → 冻结资源 + Diagnostics |
| Typography Core | 字体解析、回退决策、整形、字形度量、断行机会、缺字报告 | shape/measure 接口供 Layout Core 调用 |
| Layout Core | 段落/表格/区域排版、分页、页眉页脚与页数域收敛、IR 与 Semantic Map 生成 | layout(ResolvedDocument, ResourcePack, LayoutOptions) → LayoutIR + SemanticMap + Diagnostics |
| Layout IR | IR schema、规范化（对象顺序、确定性 ID、数值精度、序列化）、LayoutIdentity 哈希 | canonicalize / digest |
| Editor Adapter (canvas-editor) | 自有模型 ↔ canvas-editor 模型双向转换（显式支持清单）、命令与选区桥接、统一内核注入 | 内部接口，不对宿主暴露 |
| Editor SDK | 设计/只读/打印预览模式、模型加载导出、schema/字典适配、校验事件、资源注入、source-map 事件 | 稳定公共 API |
| Render Worker | Node 进程内的编排：compile → bind → media → layout → IR；无 DOM | render(RenderRequest) → RenderResult |

.NET 10 侧：

| 模块 | 职责 |
| --- | --- |
| API / Job Host | HTTP 契约校验、鉴权衔接、限额、排队（P0 有界同步）、Worker 隔离与生命周期、结果 manifest、幂等、日志脱敏 |
| OfdIrWriter | 基于 ofdrw.net 低层对象与打包：固定图元、字形映射、字体子集、图片、附件、标签、包结构；返回对象映射 |
| PdfIrWriter | 经准入的开源 PDF 写入依赖：定位字形、嵌入子集、文本映射；返回对象映射 |
| Containers（WP0/WP1 子集） | 源附件与 manifest 写入/提取、协议/摘要/schema 校验 |
| Client SDK | .NET 调用 SDK 或最小调用示例 |

工具：

| 模块 | 职责 |
| --- | --- |
| Legacy DOCX Scanner | 离线读取 DOCX（OpenXML），输出扫描清单与风险 |
| Legacy DOCX Importer | 受限导入：标签、块、样式范围、资源 → TemplateSource + ResourcePack + MigrationReport |
| Legacy Reference Runner | 隔离运行固定提交的旧 C# 引擎产出差分参照（仅测试工具，不进生产） |

可选适配器：Java ofdrw 后端仅在 WP0.10 ADR 显式启用时纳入部署。

### 3. 文档生命周期与身份

- 三个对象不可互替：TemplateSource（绑定语义）、ResolvedDocument（本次实际内容与数据实例关系）、Layout IR（版面）。
- 每次渲染分别产生并返回：模板版本、表达式语义版本（`expressionLanguageVersion`）、绑定策略版本（`bindingPolicyVersion`）、数据输入摘要、编译产物摘要、ResolvedDocument 摘要、媒体/条码生成器版本、排版配置、IR 摘要、最终产物摘要。宿主持久化，平台生成与校验。
- `modelVersion`、`irVersion`、`containerProfileVersion`、依赖版本相互独立，以兼容矩阵管理。
- LayoutIdentity = canonical(ResolvedDocument, 完整资源摘要, 排版引擎版本, 整形与断行版本, 格式化策略, 支持特性 profile, 排版选项)。运行时间、机器标识、耗时、日志 ID 存于非语义 provenance，不进入身份。
- 定稿接口输入 ResolvedDocument，不重新执行表达式。

### 4. Document Model 与绑定节点类型

- 内容节点类型（P0）：段落、标题、列表、表格（含合并单元格、列宽、行高、边框、背景、垂直对齐）、图片、分页符、分隔线、区域（固定/流式）、页眉页脚、水印。
- 行内内容序列元素：静态文本 run、DynamicText、InputControl、行内图片（受限，P0 仅独立图片段落/居中/列表）。
- 结构节点：ConditionalBlock、RepeatBlock、RepeatRowGroup。
- 媒体绑定节点：ImageBinding、BarcodeBinding。
- `DynamicText`：持有 AST 引用、显式样式继承规则、来源信息；不是输入框，不生成独立段落。
- `InputControl`：文本/数字/下拉/日期/单选/复选；占位、默认值、必填；数字字段保留十进制表达，不统一转浮点。
- 重复实例身份由模板 nodeId + 重复键生成；键重复报错；使用序号作为退化键时在模板中标注"重排数据会改变实例身份"。
- 未知的必需扩展字段在加载时拒绝，而不是丢弃；已知可选扩展保留透传。
- canvas-editor 映射通过 Editor Adapter 的显式支持清单进行；`conceptId` 不作为业务字段编码/控件 ID/实例 ID 的复合载体。

### 5. 显示表达式语言（P0）

- 支持的操作：路径（对象、数组、`.` 当前项、`$` 根、`$.path`）；`sort:key:asc|desc`、`take:N`；`first`、`last`、`nth:N`（1 起）、`at:index`（0 起，支持负数）；`maxby:key`、`minby:key`（返回项）；`get:path`/`pick:path`（别名规范化为一个）；`count`；`if:trueText:falseText`（单分支 false 为空串）；`format:number:<pattern>`、`format:percent`、`format:permille`、`format:date:<pattern>`。
- 格式模式为显式声明的 .NET 格式子集清单，编译期校验；未列入的模式返回 `FORMAT_PATTERN_UNSUPPORTED`。别名（`numeric`、`percentage`、`per-mille`/`per_mille`、`datetime`/`time`）由迁移器规范化为主名称。
- 比率格式化输入为比例值，不做二次乘法。
- 日期格式含冒号时间模式由 AST 直接表达，不依赖分隔符切分。
- 不支持：`sum`/`average`/`groupBy`、任意比较算术、脚本、`eval`、网络函数、自定义函数注册。需要时另行评审。
- 预算：表达式长度、嵌套深度、展开节点数、排序次数均有上限，超限返回 `REPEAT_LIMIT` / `RESOURCE_LIMIT`。
- 单一实现：Binding Core 在浏览器与 Node 运行同一代码；.NET 门面不含第二个求值器。

### 6. 严格语义与兼容语义

- 新模板使用严格规则（`bindingPolicyVersion` = strict-1）：Missing 与 Null 分别表示；作用域显式（当前项/父级/根），不隐式回溯；Repeat 要求数组；truthiness 按声明版本，不用 JS truthiness；排序以输入序号作为稳定 tie-break；locale/timezone/格式显式锁定。
- 旧模板迁移可在节点级附带兼容政策（`bindingPolicyVersion` = legacy-compat-1），覆盖：父级/根回溯、旧 truthiness（空白/0/false/空数组/空对象为假，`"false"`/`"0"` 为真）、truthy 非数组循环一次、`count` 的对象属性数/字符串 UTF-16 长度/标量为 1、路径 `[-1]` 与 `at:-1` 的区分。每处使用兼容政策的节点在 MigrationReport 中标记 `LEGACY_SEMANTIC_CHANGE` 并要求差分确认。
- 不提供全局"100% NDocxTemplater 兼容"开关。
- 插入的字符串始终是数据，不再次扫描为模板标签。

### 7. 动态图片与条码

- 图片输入：单图或列表；data URI / base64 / 宿主授权资源引用。Worker 只消费授权字节；不开放任意文件路径与 URL；相对路径必须绑定显式资源根。
- 尺寸规则顺序：目标尺寸/适配 → 乘 scale → 限制 maxWidth/maxHeight；新模板用物理单位；旧模板固定 `legacyPixelDpi=96` 并验证尺寸。
- 解码器 profile 逐格式声明（PNG/JPEG/GIF/BMP/TIFF），"识别文件头"不等于解码成功；未知尺寸的图片不得进入 IR。
- 图表由宿主生成后作为图片插入；不新增图表引擎。
- 条码：P0 声明 `code128/code39/code93/codabar/ean13/ean8/upca/itf`，每种类型独立通过准入测试后才在 capability profile 中标为可用；未通过的类型不对外可用，也阻止依赖它的首批模板放行。
- BarcodeBinding 保存源值、声明码制、尺寸/quiet-zone 政策、人眼可读标签政策、生成器版本。输出优先为矢量条/路径；位图输出只作为显式 profile。
- 新模板严格校验值/长度/校验位；旧模板的 UPC-A→EAN13、ITF 奇数位补零等规范化必须返回 `inputValue / encodedValue / normalizationPolicy` 与 `BARCODE_NORMALIZED` 诊断，不作为新默认。
- 浏览器预览与服务端使用同一受控媒体资源或同一算法版本的受控实现，不允许本地另一生成器产生不同几何。

### 8. Typography 与确定性

- 所有渲染资源按内容摘要锁定；缺字体或资源时失败（`FONT_MISSING` / `GLYPH_MISSING`），不回退系统字体。
- 整形/度量前等待字体与图片全部就绪；异步到达顺序不影响 IR。
- 真实粗体/斜体与合成样式策略显式；不默认浏览器伪粗体与写入器一致。
- P0 冻结字符范围：中文、拉丁、数字与业务必需符号；超出范围报告。
- 字体候选从思源/Noto 等许可字体中选定精确静态文件、字重与覆盖；不依赖系统字体；字体家族名不是资源身份。
- 可回编辑 OFD 版面字体子集嵌入；编辑源保存完整字体身份与获取约定；子集化不改变上游度量。
- 整形链路与断行的候选组合已在 ADR-0001 定为 harfbuzzjs（整形 + hb-subset 子集化，`retainGids=true`）+ fontkit（表/度量）+ `@cto.af/linebreak`（UAX #14 候选断点）+ Layout Core 内的禁则/段落策略；**待 WP0.4 验证后冻结**。
- 字体子集化在 Render Worker 内执行一次，OFD 与 PDF 嵌入同一子集字节；写入器不再各自子集化。

### 9. Layout IR 契约

- 组成：身份（irVersion、输入摘要、layout profile、语义摘要）；资源（字体原文件摘要 + face/字重/特性、图片摘要/类型/尺寸）；页面（每页纸张、内容区、方向、页序、节来源）；图形状态（绘制顺序、变换、裁剪、颜色/透明度、受支持合成方式）；文字（原始逻辑文本、显示文本、字体实例、字号、语言/方向、基线、glyph ID、位置/advance/offset、cluster 映射）；路径（填充规则、描边、虚线、端点/连接、指令；局部坐标 vs 页面坐标）；图片（资源、变换、边界、裁剪）；语义（nodeId、bindingId、重复实例、控件、表格行列、阅读顺序、来源文本范围、重复表头标记）；标记（不绘制区域、选区命中、控件几何；明确非签名覆盖范围）。
- 坐标：左上原点、毫米语义；规范化单位建议 1/1000 mm 整数，精度/范围/舍入 **待 WP0.5 误差与容量测试冻结**。
- 文本范围索引：公共 JSON 用 UTF-16 offset，禁止切断代理对；整形 cluster 提供显式转换表。
- IR 对象与输出文件对象一对多；写入器返回完整映射。

### 10. 输出后端

- OfdIrWriter 优先 ofdrw.net（Core / Layout 低层 builder / Packaging / Reader）。需补齐或证明：精确文本写入（基线、局部坐标、变换、字符—字形映射、DeltaX/DeltaY 语义）、字形映射结构、字体子集（字形闭包 + glyph ID 重映射）、图形状态支持范围、IR→OFD 对象映射、资源与源附件安全、文件有效性（无悬空引用/重复 ID）。
- 不为本产品开发 C# 段落/表格/分页引擎；即使 ofdrw.net 将来提供流式布局，也只用其固定写出路径。
- PdfIrWriter 为自研 .NET 写入器（ADR-0001 已拍板）：PDF 1.7 对象模型、CIDFont + Identity-H、嵌入 Worker 提供的子集字体、由 IR cluster 映射生成 ToUnicode、JPEG 直通、PNG 经 BigGustave 解码；不经 OFD→PDF。PDFsharp / SkiaSharp / PdfPig 仅作评估参照或测试读取器；Java PDFBox 不进入部署。
- Java ofdrw 后端：只能使用低层 core/pkg/font 或经验证不重排的绝对定位 API；不得使用流式 Paragraph/Div/Cell；`VirtualPage`/`Canvas` 名称不是不重排的证明。
- 首个生产 profile 的后端选择 **待 WP0.6/WP0.7/WP0.10 ADR 冻结**。切换后端必须显式记录，不在作业失败后静默切换。
- 格式基线：GB/T 33190-2016；普通 OFD、档案长期保存 profile、密码应用 profile 分开；每个发布 profile 列出支持的图元、字体类型、颜色/裁剪/变换、附件、标签、签名策略与不支持项。

### 11. OFD 容器源附件协议（WP0/WP1 子集）

- 命名空间 `ofd-compose`。包内源附件包含：manifest（协议、摘要、版本、能力、来源）、最小化 ResolvedDocument、资源清单（图片/完整字体身份及嵌入资源映射）、Semantic Map（源节点、逻辑顺序、页面/图元对应）。单附件包还是多附件 **待 WP0.8 对 ofdrw.net 与目标阅读器的提取验证冻结**。
- JSON MIME 为 `application/json`；自定义复合包 MIME 为内部约定，不宣称已注册。
- 原生可回编辑 profile 必带 ResolvedDocument 与必要资产；分发/脱敏 profile 显式声明为非回编辑派生物。
- 源附件最小化：不含整份输入 JSON、未使用字段、未打印敏感值、调试信息、宏、令牌、凭证。业务值是否重复写入由输出 profile 控制。
- 打开时校验顺序：协议 → 大小 → JSON schema → 摘要 → 资源完整性 → 支持版本 → 签名相关状态（WP1 仅报告"未签/未验证"）。自计算哈希只证明内部一致，不证明来源真实。
- 签章/验签/合并不在本 spec 范围，但 WP1 输出的 manifest 与 Semantic Map 结构必须能被 WP2 的签名保护引用所覆盖，不得在 WP2 重定义。

### 12. 服务契约（拟议，WP0 定语义，WP1 固定 v1）

| 能力 | 接口 |
| --- | --- |
| 能力发现 | `GET /v1/capabilities` |
| 模板校验 | `POST /v1/templates/validate` |
| 预览 | `POST /v1/previews` |
| 模板渲染 | `POST /v1/renders` |
| 文书定稿 | `POST /v1/finalizations` |
| 源提取 | `POST /v1/containers/extract-source`（WP1 提供基础版本：返回源模型、资源、版本、完整性状态；信任状态为"未验证"） |

- P0 有界同步请求；异步作业接口仅在需要排队时启用，须有取消、过期与状态。
- 输入：完整模板 + 内容寻址 ResourcePack；模板引用仅经宿主授权解析接口。
- 输出：结果 manifest + 产物集合；不把多份字节流塞进一个响应。
- 幂等身份：调用方资源作用域 + 输入摘要 + profile + 输出格式。
- 诊断最低字段：`code / severity / phase / nodeId / bindingId / dataPath / pageIndex / message`。
- 错误码（首版）：`FONT_MISSING`、`GLYPH_MISSING`、`BINDING_MISSING`、`EXPRESSION_UNSUPPORTED`、`FORMAT_PATTERN_UNSUPPORTED`、`SCOPE_AMBIGUOUS`、`REPEAT_LIMIT`、`RESOURCE_FORBIDDEN`、`BARCODE_VALUE_INVALID`、`BARCODE_NORMALIZED`、`LEGACY_SEMANTIC_CHANGE`、`UNSUPPORTED_FEATURE`、`LAYOUT_OVERFLOW`、`PAGINATION_NOT_CONVERGED`、`RESOURCE_LIMIT`、`IR_VERSION_UNSUPPORTED`、`SIGNATURE_INVALIDATED`（后者在 WP1 仅保留码位）。

### 13. 模板设计工作台

- 首版为独立 Web 应用（React + Vite，ADR-0001 已拍板），同时可通过框架无关的 Editor SDK 嵌入宿主。
- 基线编辑器为 `@hufe921/canvas-editor` 1.0.2（MIT；提交与锁文件在 WP0.2 固定）；是否 fork、fork 范围由 WP0.10 ADR 决定。fork 时记录依赖隔离、整形注入、IR/source-map 导出等修改域并建立自动化回归。
- 工作台功能：页面/样式/表格设计、字段树、行内 DynamicText、排序/取项/极值/格式配置面板、重复/条件块、图片/条码配置、样例数据、分页预览、节点级诊断、版本化保存、文件打开/保存与宿主存取适配。
- 不含账号、业务模板中心、审批与持久化文书库。

### 14. 迁移工具

- 能力迁移（P0）与文件迁移（试点 P0、通用 P1）分开交付；能力迁移不依赖导入器完成。
- 扫描器最低输出：模板位置、表达式、出现次数、数据路径、所需功能、格式模式、资源引用、风险、迁移状态。静态页眉页脚只用于范围发现，不作为旧引擎已动态渲染的证据。
- 导入器保留文本范围—样式映射；动态节点选择明确样式；冲突报告；不复制旧库"放入第一个 Text、清空其他 Text"的扁平化兜底。
- 首批模板在 WP1 发布前完成扫描与语义/资源迁移或人工重建。

### 15. 安全与运维约束

- 依赖审计证明 Layout/Typography/Binding Core 不引用 DOM。
- 干净镜像运行；浏览器自动化仅用于测试。
- 资源预算、隔离 Worker、超时、取消、幂等、结果 manifest、日志脱敏、无外网字体模式。
- SBOM、锁文件、第三方与字体许可清单；ZIP/XML/图片/字体限制；禁用 XML 外部实体；阻止路径穿越与远程资源读取。

---

## 测试决策（Testing Decisions）

### 什么是好的测试

- 只测外部行为：给定输入（模板/数据/资源/profile）→ 断言输出（ResolvedDocument 文本与结构、规范化 IR、输出文件的抽取结果、诊断），不断言内部函数调用或私有数据结构。
- 断言语义而非像素：文本完整性、逻辑顺序、语义映射、几何量化误差、条码解码值分别验收；视觉比较只作为阅读器互操作的辅助证据，且文字/边框/图片分区域判断。
- 失败必须显式：每个负向用例断言具体诊断 code 与定位字段，不接受"文件非空"或"没抛异常"。
- 确定性以规范化 IR 摘要相等验证，不以整个 ZIP/PDF 字节相等验证。
- 未实际执行的环境（arm64、阅读器、证书、宿主业务）在报告中保留 `Not verified`。

### 测试接缝（Seams）

按"最少接缝、最高接缝"原则，本 spec 使用三个接缝，绝大多数测试落在第一个：

1. **主接缝：Render Worker 入口** —— `render(TemplateSource, Data, ResourcePack, RenderProfile) → { ResolvedDocument, LayoutIR, SemanticMap, Diagnostics }`，在真实 Node 进程内调用（无 DOM、无 Canvas mock）。
   覆盖：Template Compiler、Binding Core、Media Core、Typography Core、Layout Core、Layout IR 规范化。golden corpus、DOCX 兼容验收包、确定性、负向场景、预算与安全（资源引用）测试全部在此接缝执行。同一套用例在浏览器 runner 中复跑以验证双端一致。
2. **写入器一致性接缝：`write(LayoutIR, WriterProfile) → { bytes, objectMap, Diagnostics }`** —— 分别对 OfdIrWriter 与 PdfIrWriter。
   验证方式：用**独立**的读取器/抽取器（非写入库自身）解析输出，比较文本、字形/字体子集映射、对象坐标（量化误差门槛待 WP0 定，PoC 观察线 0.05 mm）、objectMap 完整性、源附件提取；目标阅读器截图作为互操作证据。
3. **HTTP 契约接缝：API 端到端** —— 薄层测试：能力发现、校验、渲染、定稿、源提取的请求/响应 schema、幂等、部分失败、超时/取消、限额、日志脱敏。不在此层重复语义测试。

不建立独立于上述接缝的模块级白盒测试作为验收证据；模块内部可有开发者单测，但不进入门禁矩阵。

### 测试对象与用例族

| 用例族 | 接缝 | 内容 |
| --- | --- | --- |
| golden corpus —— 库级基线 | 1 + 2 | NDocxTemplater 15 个 DOCX 测试方法与示例 01–12 的场景，重建为原生 TemplateSource + 数据 + 预期 ResolvedDocument 文本/结构 |
| golden corpus —— 业务基线 | 1 + 2 | 宿主脱敏真实模板/数据/旧输出；含真实长表格与 50 页文档 |
| DOCX 功能迁移验收包 | 1（+ 扫描器/导入器工具） | 路径与作用域、条件与重复、叙述文本、格式、图片、条码、迁移结构/样式、分发最小化八族（计划 §7.5）；每条记录 legacyCommit / templateId / dataDigest / expectedSemantic / allowedDifferences / nativeProfile / result |
| 表达式语义 | 1 | §3.4.2 每个操作的正向/边界/越界；strict 与 legacy-compat 两种 bindingPolicy 的差异表 |
| 排版确定性 | 1 | 关键固定输入重复渲染、浏览器矩阵、Linux x64/arm64 的规范化 IR 摘要一致 |
| 排版规则 | 1 | 分页、断行与禁则、跨页表头、表头与首行同页、孤行、页数域收敛、固定区域溢出策略、水印 |
| 字体与整形 | 1 | 中文扩展字、英文、数字、符号、组合字符、粗斜体、缺字、同名不同字节字体 |
| 动态媒体 | 1 + 2 | 图片字节/尺寸/顺序/组合规则/伪造 MIME/超限；八类条码逐类型的独立解码值、码制、物理尺寸、规范化政策 |
| 写入器一致性 | 2 | 逐图元映射、字体子集/字形映射、文本抽取、图形状态、无悬空引用/重复 ID、源附件提取 |
| 源回编辑 | 2 + 1 | 重新打开 → 修改 → 插入新字符 → 再导出 → 资源与身份校验 |
| 阅读器互操作 | 2 | 三款目标阅读器固定版本截图与文本复制/搜索，记录对齐/DPI/抗锯齿 |
| 负向与安全 | 1 + 3 | 计划 §7.3 全部场景；错误 ZIP/XML、外部实体、路径穿越、远程 URL、字体/图片预算、取消中的作业、过期预览覆盖 |
| API 契约 | 3 | schema、幂等、全成功/部分失败语义、限额、超时、脱敏 |
| 性能 | 3 | 指定硬件与数据；冷/热、单页、50 页、真实长表格；绑定/整形/布局/子集/写出/排队分项 |

### 先例（Prior Art）

- 本仓库尚无代码，无内部先例。
- 语义预期来源：NDocxTemplater `DocxTemplateEngineTests` 的 15 个 `[Fact]`（固定提交 `9c02f26d`），作为用例来源而非通过证明；其"图像含深色像素"式断言不沿用，替换为解码值断言。
- 写入器验证参照：ofdrw.net 与 Java ofdrw 各自的 Reader 只作为其中一个读取器；必须再加至少一个独立引擎的读取/抽取。
- 旧 C# 引擎作为差分参照只在隔离测试工具中运行。

---

## 范围之外（Out of Scope）

- **WP2**：签章、分层验签、内容合并、已签文档处理、连续签名互操作、脱敏派生物与选页导出的完整政策、外来 PDF/OFD 兼容 profile。本 spec 只要求 WP1 的 manifest 与 Semantic Map 结构不阻碍 WP2。
- **WP3**：表单填写模式、字段级联/计算/显隐规则系统、区域锁定、留痕、批注、目录导航、菜单/快捷键定制、外来 OFD 只读预览、通用 DOCX 一次性导入的版式扩展、稳定 SDK 的销毁/缓存/扩展注册协议。
- **WP4**：正式 Guide、reader matrix 维护流程、上游跟踪与 fork 差异流程、部署手册与回滚约定。
- 任意 DOCX 版式完整兼容；任意外来 OFD 重排编辑；重新实现 Word；在 C# 中另建断行/分页/表格引擎。
- `sum`/`average`/`groupBy`、任意算术、脚本、`eval`、自定义函数、网络函数。
- 二维码 / DataMatrix。
- 文字间嵌图（非独立段落/居中/列表）的通用版式；多节混合纸张（P1）；分栏、浮动环绕、LaTeX/复杂公式（P2）。
- 图表设计器与图表引擎（图表由宿主以图片提供）。
- SVG 导出、浏览器打印认证（P1）。
- 账号、业务模板中心、审批、持久化文书库、业务字典内容、患者/报表/租户等业务模型。
- UniDmrCore 代码改动、存量模板批量迁移、业务上线与回滚（由独立接入计划负责；本 spec 只定义其必须满足的契约与试点证据）。
- 无障碍与国际化验收（P2）。
- 商标、域名、GitHub/npm/NuGet 名称可用性核查。

---

## 补充说明（Further Notes）

### 待 WP0 ADR 冻结的决策清单

以下项在 WP0 对应子项完成前不得在 WP1 中硬编码：

| 决策 | 依赖的 WP0 子项 |
| --- | --- |
| canvas-editor 是否继续、fork 范围（版本基线 1.0.2 已定） | WP0.2、WP0.3、WP0.10 |
| 整形/度量/回退/断行组合（候选见 ADR-0001 §C） | WP0.4 |
| IR 规范化单位、精度、范围、舍入 | WP0.5 |
| 首个 OFD 后端 profile（ofdrw.net 优先；Java 仅测试验证器） | WP0.6、WP0.10 |
| 自研 PdfIrWriter 的字体/文本映射验收 | WP0.7 |
| 字体家族：CFF（Noto Sans CJK SC）vs TrueType 轮廓备选 | WP0.2、WP0.9 |
| 源附件单包/多附件结构 | WP0.8 |
| 首版字符与版式 profile、性能参考值 | WP0.4、WP0.9、WP0.10 |
| IR→输出几何误差正式门槛 | WP0.5、WP0.6、WP0.7 |
| 首批模板的功能交集与业务切换门禁 | WP0.1、WP0.1a |

### 应在 WP0 固化为术语表的词条

TemplateSource、ResolvedDocument、Layout IR、Semantic Map、LayoutIdentity、RenderProfile / capability profile、ResourcePack、DynamicText、InputControl、ConditionalBlock、RepeatBlock、RepeatRowGroup、ImageBinding、BarcodeBinding、OfdIrWriter、PdfIrWriter、golden corpus（库级基线 / 业务基线）、MigrationReport、bindingPolicyVersion（strict / legacy-compat）、expressionLanguageVersion、原生可回编辑 profile / 非回编辑派生物、Not verified。

### 证据级别

本 spec 沿用计划 v0.3 的三级证据：原稿/用户事实、仓库静态核查（2026-09-10）、本版设计决定。本 spec 中所有"支持"均指待实现与待验证的目标，不是已完成状态。上游库的 README 声明或源码存在不构成本平台的验收证据。

### 首批模板的业务切换

平台发布与业务替换是两道门禁。WP1 完成后可交付"报表替代候选版本"；UniDmrCore 的模板重建/迁移、双跑差异确认、样本签字、灰度与回滚由独立接入计划完成，不在本 spec 内声称完成。

### 来源

- 实施计划 v0.3（2026-09-10）及其附录 C 的来源 [A0][S1]–[S12][N1]–[N4]。
- NDocxTemplater 快照 `master@9c02f26d0f81b554019441e348f981b67e11a4e7`。
