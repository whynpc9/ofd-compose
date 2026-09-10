# 24: 工作台：字段树、DynamicText 插入、实时预览

**What to build:** 模板作者导入数据 schema，在字段树中浏览嵌套对象与数组，把字段拖入段落生成行内 DynamicText；加载样例数据后，预览面板用浏览器内运行的共享内核（同一 Render Worker 编排代码）实时排版并绘制分页结果，Canvas 只消费 IR 中已定位的字形，不重新整形。预览与服务端渲染规则相同。

**Blocked by:** 22 工作台壳 + Editor Adapter, 14 Render Worker + 字体子集 + 端到端 PoC

**Status:** ready-for-agent

- [ ] JSON Schema 导入 → 字段树（对象、数组、类型）
- [ ] 拖入/点击字段生成 DynamicText，样式继承明确，与静态文本同行
- [ ] 样例数据编辑与加载
- [ ] 浏览器内运行共享内核得到 IR；Canvas 绘制器消费 IR 字形/路径/图片，分页显示
- [ ] 预览 IR 摘要与 Node 渲染同一输入的摘要一致（测试）
- [ ] 旧异步预览不覆盖较新修订（版本竞争测试）
- [ ] 预览中的诊断（缺字、未绑定）以节点高亮显示
