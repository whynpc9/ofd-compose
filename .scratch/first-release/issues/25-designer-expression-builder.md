# 25: 工作台：表达式构建器

**What to build:** 模板作者对 DynamicText 用可视化面板配置排序、截取、取项（首/尾/第 N/at）、极值项、取字段、count、行内条件短语与数字/比率/日期格式；也可切换到高级表达式输入旧语法；两种方式保存同一 AST 并可互相回显；不支持的格式模式或函数即时报错；模板锁定 locale/时区/舍入。

**Blocked by:** 24 工作台：字段树、DynamicText 插入、实时预览

**Status:** ready-for-agent

- [ ] 管道式构建器 UI：每步操作选择与参数；结果类型随步骤推导并限制下一步可选操作
- [ ] 高级输入：旧语法文本 → AST，AST → 可视化回显；格式别名规范化提示
- [ ] 格式面板：数字模式白名单、百分比/千分比、日期模式（含冒号时间）；预览示例值
- [ ] 模板级 locale/时区/舍入设置
- [ ] 行内诊断：`EXPRESSION_UNSUPPORTED`、`FORMAT_PATTERN_UNSUPPORTED`、`SCOPE_AMBIGUOUS` 即时显示
- [ ] 保存产物只含 AST（不保存待替换的文本模板）；round-trip 测试
