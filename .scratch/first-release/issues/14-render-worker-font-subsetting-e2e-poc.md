# 14: Render Worker + 字体子集 + 端到端 PoC（WP0.5a）

**What to build:** 在真实 Node 进程中调用 `render(TemplateSource, Data, ResourcePack, RenderProfile)` 得到 `{ResolvedDocument, LayoutIR, SemanticMap, Diagnostics}` 与写入器所需的子集字体资源；这是 seam 1。用"叙述排名与比率 + 动态长表格 + 图片 + code128/ean13"的组合样本跑通全链路；依赖审计证明内核不引用 DOM；浏览器 runner 复跑同一样本得到同一 IR 摘要。

**Blocked by:** 12 Layout Core：图片、路径与区域, 13 Layout Core：表格

**Status:** ready-for-agent

- [ ] Render Worker 编排：compile → bind → media → shape/layout → canonical IR，返回全部身份摘要（模板版本、表达式语义版本、数据输入摘要、编译产物摘要、ResolvedDocument 摘要、媒体版本、排版配置、IR 摘要）
- [ ] hb-subset（harfbuzzjs）按 IR 用到的 glyph 集生成子集，`retainGids=true`，输出子集字节、摘要与（恒等）glyph 映射表；不改变上游度量（测试：子集后 advance 一致）
- [ ] 依赖审计：Core 包在 Node 中执行无 DOM/Canvas mock；lint 与运行时双重证明
- [ ] 组合样本端到端通过，IR 文本抽取等于预期语义；corpus 库级基线中可排版用例全部跑通到 IR 级
- [ ] 同一样本在 Vitest browser 模式得到相同 IR 摘要
- [ ] 资源全部就绪前不开始排版；缺字体/缺图片返回 `FONT_MISSING`/`RESOURCE_FORBIDDEN` 并整体失败，不静默回退
- [ ] 记录冷/热运行时间作为 WP0.9 的初步数据
