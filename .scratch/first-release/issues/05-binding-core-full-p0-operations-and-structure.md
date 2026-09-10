# 05: Binding Core 全部 P0 操作与结构展开

**What to build:** 模板可以使用 spec 中全部 P0 显示表达式与结构节点——ConditionalBlock、RepeatBlock、RepeatRowGroup、嵌套作用域、`sort/take/first/last/nth/at/count/if`、日期/百分比/千分比格式——绑定后得到语义正确的 ResolvedDocument；空数据、缺失、`null/0/false`、空数组、重复键都有明确结果；超预算返回诊断。corpus 全部文本/结构级用例通过，strict 与 legacy-compat 的差异表以测试形式落地。

**Blocked by:** 04 Document Model v0 + Template Compiler + Binding Core 首条叙述句

**Status:** ready-for-agent

- [ ] 结构节点：ConditionalBlock 在绑定阶段展开；RepeatBlock/RepeatRowGroup 实例身份 = 模板 nodeId + 重复键，键重复报错，序号退化键带标注；嵌套作用域支持当前项/父级/根
- [ ] 操作：`sort:key:asc|desc`（以输入序号稳定 tie-break）、`take:N`、`first/last`、`nth:N`（1 起）、`at:index`（0 起、负数）、`count`、`if:t:f`（单分支 false 为空串）
- [ ] 格式：`format:percent`、`format:permille`、`format:date:<pattern>`（含冒号时间模式）；locale/timezone 来自模板锁定配置，用 temporal-polyfill；tzdata 版本写入 provenance
- [ ] legacy-compat：truthy 非数组循环一次、`count` 的旧对象/字符串/标量行为、路径 `[-1]` 与 `at:-1` 区分，全部有对照测试并产生 `LEGACY_SEMANTIC_CHANGE`
- [ ] 预算：表达式长度、嵌套深度、展开节点数、排序次数上限，超限返回 `REPEAT_LIMIT`/`RESOURCE_LIMIT`
- [ ] 不支持的 `sum/average/groupBy`、算术、脚本返回 `EXPRESSION_UNSUPPORTED`
- [ ] 插入的字符串不再被扫描为模板标签（有用例）
- [ ] corpus 库级基线中全部文本/结构用例在 ResolvedDocument 级通过，Node 与浏览器双模式
