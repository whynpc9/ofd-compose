# 03: 旧 DOCX 扫描器原型（WP0.1a）

**What to build:** 迁移工程师对一批旧 DOCX 模板运行离线扫描器，得到每个模板位置的表达式、出现次数、数据路径、所需函数、格式模式（含 `numeric`、`percentage`、`per-mille`/`per_mille`、`datetime`/`time` 等别名）、资源引用、控制块配对情况、风险等级与迁移状态（可自动 / 需确认 / 不支持）的清单，以及 MigrationReport 骨架。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-agent

- [ ] .NET 离线工具读取 DOCX（OpenXML），识别 NDocxTemplater 全部标签形态，包括被 Word 拆分到多个 Run/Text 的标签
- [ ] 输出清单与 MigrationReport 为 JSON，字段与 spec 迁移工具一节一致
- [ ] 诊断未闭合、错配、孤立结束、跨容器配对与同层嵌套的控制块
- [ ] 识别图片 `%`/`%%` 段落、尺寸参数、`path/src` 来源，以及条码类型与参数
- [ ] 静态页眉页脚内容只作范围发现，报告中明确标注"非旧引擎动态渲染证据"
- [ ] 对 corpus 中可获得的 DOCX（含测试程序生成的样例）运行并产出报告；报告纳入 corpus 目录
- [ ] 不执行任何表达式、不读取任何图片路径
