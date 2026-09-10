# 07: canvas-editor 隔离 spike（决定 Editor Adapter 接法）

**What to build:** 团队得到 `@hufe921/canvas-editor` 1.0.2 的依赖图与接口清单，明确哪些命令、选区、事件与绘制能力可以经 Editor Adapter 复用，哪些必须绕开或 fork；Layout Core 已决定自研，因此本票不再验证其布局能否在 Node 运行，而是给出"编辑器 UI 如何消费自研 Layout IR"的可行路径与 fork 范围建议，作为 WP0.10 ADR 的输入。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-agent

- [ ] 依赖图：`Editor`/`Draw` 初始化链中的 DOM、光标、事件、观察器、Worker 依赖逐项列出
- [ ] 接口清单：可复用的命令 API、选区/光标模型、事件、插件扩展点；不可替换的私有布局与绘制路径
- [ ] 两条候选接法评估：(a) 自有模型 → canvas-editor 私有模型做设计态编辑，预览用自研 IR 绘制；(b) 用 canvas-editor 仅作命令/选区壳，绘制完全由自研 IR 驱动。给出各自需要的 fork 面
- [ ] 中文输入法、跨页选区、撤销/重做在两条接法下的风险评估
- [ ] 输出 spike 报告（docs/decisions 草案），列出建议接法、fork 范围与回归策略
