# 26: 工作台：结构块

**What to build:** 模板作者把一组段落/表格/图片包进 ConditionalBlock，把表格行组设为 RepeatRowGroup、把段落组或复合块设为 RepeatBlock，选择数据源（可来自排序/截取结果）、作用域（当前项/父级/根）、稳定重复键，并为字段缺失、`null`、空字符串、`0`、`false`、空数组分别配置显示与显隐策略；嵌套结构在编辑器中可见且可预览。

**Blocked by:** 25 工作台：表达式构建器

**Status:** ready-for-agent

- [ ] 选区包裹为 ConditionalBlock / RepeatBlock；表格行组标记为 RepeatRowGroup
- [ ] 数据源选择支持表达式（如 `sort` + `take` 结果）；作用域与重复键配置；序号退化键显示警告
- [ ] 空值策略配置面板（Missing / Null / 空串 / 0 / false / 空数组）
- [ ] 嵌套重复与条件在编辑器中有结构标识，预览按样例数据展开
- [ ] 结构块 round-trip 无损；Editor Adapter 支持清单扩展
- [ ] 诊断：`REPEAT_LIMIT`、重复键冲突、非数组数据源即时显示
