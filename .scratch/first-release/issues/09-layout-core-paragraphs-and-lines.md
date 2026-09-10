# 09: Layout Core：段落与行

**What to build:** 自研 Layout Core 把 ResolvedDocument 中的段落（静态文本 + DynamicText 行内序列）排成行：调用 Typography Core 整形，按 UAX #14 候选断点加中文禁则（行首/行尾）决定断行，处理对齐、缩进、段距、行高、Tab 与编号，输出单页 Layout IR 文本对象与 Semantic Map（nodeId/bindingId/来源文本范围）。同一输入在重复运行与双端得到相同 IR 摘要。

**Blocked by:** 05 Binding Core 全部 P0 操作与结构展开, 06 Typography Core, 08 Layout IR 契约与规范化

**Status:** ready-for-agent

- [ ] 段落、标题、列表（编号）的行内序列整形与断行；DynamicText 与静态文本在同一行、同一次断行
- [ ] 中西文混排、标点禁则以字符分类规则实现（行首/行尾各有用例），按词断行，Tab 停靠
- [ ] 对齐（左/中/右/两端）、首行/悬挂缩进、段前后距、行高（倍数/固定）
- [ ] 文本样式：字号、字重、斜体、下划线、删除线、上下标、颜色、高亮、链接，均落入 IR 文字与路径对象
- [ ] 输出 IR 文字对象含原始逻辑文本、显示文本、字体实例、glyph ID、位置/advance、cluster；Semantic Map 含来源范围
- [ ] 整形/度量前等待全部字体就绪；异步到达顺序不影响 IR（测试）
- [ ] 确定性：重复运行、Node 与浏览器模式 IR 摘要一致；corpus 叙述用例的 IR 文本抽取等于 ResolvedDocument 文本
