# 04: Document Model v0 + Template Compiler + Binding Core 首条叙述句

**What to build:** 给定一个含 DynamicText 的段落模板与 JSON 数据，共享 TypeScript 内核编译并绑定出 ResolvedDocument，其中"营收最高的是 X，收入为 Y 元。"这类叙述句以行内片段形式出现、不产生多余换段；旧管道语法与结构化配置得到同一 AST；Missing 与 Null 分别表示；strict 与 legacy-compat 两种 truthiness 可切换；错误以节点级诊断返回。corpus 中叙述类用例的预期文本通过。

**Blocked by:** 01 仓库脚手架与工程门禁, 02 Golden corpus 骨架与库级基线转录

**Status:** ready-for-agent

- [ ] Document Model v0 的 TypeBox schema：信封（schemaVersion/documentId/revisionId）、样式表、正文树、段落行内序列（静态文本、DynamicText、InputControl）、`nodeId` 与 `bindingId`/`path` 分离、扩展命名空间；未知必需扩展被拒绝而非丢弃
- [ ] Template Compiler 将旧管道语法（路径、`maxby/minby`、`get/pick`、`format:number`）与结构化配置编译为同一版本化 AST，并保留模板位置 ↔ 旧表达式 ↔ AST 节点映射
- [ ] Binding Core 输出 ResolvedDocument：DynamicText 结果成为带来源映射的文本片段；`expressionLanguageVersion` 与 `bindingPolicyVersion` 写入产物
- [ ] strict 策略：Missing/Null 分离、显式作用域；legacy-compat 策略：父级/根回溯、旧 truthiness（`"false"`/`"0"` 为真），且使用时产生 `LEGACY_SEMANTIC_CHANGE`
- [ ] 数字格式化自实现声明的 .NET 模式子集，不用 `Intl`；金额走 decimal.js
- [ ] 诊断包含 `code / severity / phase / nodeId / bindingId / dataPath / message`；`BINDING_MISSING`、`EXPRESSION_UNSUPPORTED`、`FORMAT_PATTERN_UNSUPPORTED` 有用例
- [ ] corpus 叙述类用例在 ResolvedDocument 级通过；同一测试在 Node 与浏览器模式下通过
