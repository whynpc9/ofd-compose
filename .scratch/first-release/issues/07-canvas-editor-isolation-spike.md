# 07: canvas-editor 隔离 spike（决定 Editor Adapter 接法）

**What to build:** 团队得到 `@hufe921/canvas-editor` 1.0.2 的依赖图与接口清单，明确哪些命令、选区、事件与绘制能力可以经 Editor Adapter 复用，哪些必须绕开或 fork；Layout Core 已决定自研，因此本票不再验证其布局能否在 Node 运行，而是给出"编辑器 UI 如何消费自研 Layout IR"的可行路径与 fork 范围建议，作为 WP0.10 ADR 的输入。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-human

- [x] 依赖图：`Editor`/`Draw` 初始化链中的 DOM、光标、事件、观察器、Worker 依赖逐项列出
- [x] 接口清单：可复用的命令 API、选区/光标模型、事件、插件扩展点；不可替换的私有布局与绘制路径
- [x] 两条候选接法评估：(a) 自有模型 → canvas-editor 私有模型做设计态编辑，预览用自研 IR 绘制；(b) 用 canvas-editor 仅作命令/选区壳，绘制完全由自研 IR 驱动。给出各自需要的 fork 面
- [x] 中文输入法、跨页选区、撤销/重做在两条接法下的风险评估
- [x] 输出 spike 报告（docs/decisions 草案），列出建议接法、fork 范围与回归策略

## Comments

**2026-09-12 (agent) 调研交付：**

- 报告：[ADR-0002 草案](../../../docs/decisions/ADR-0002-editor-adapter-isolation-spike.md)；可复核基线：[证据 JSON](../../../docs/decisions/evidence/canvas-editor-1.0.2-isolation.json)。ADR 保持 Proposed，作为 issue 19 / WP0.10 输入。
- 基线：npm 1.0.2，registry gitHead `83985f729cde373eccdcf25314227827b971bb63`；下载发布包并复核 SHA-512 SRI，交叉检查固定提交源码、发布声明与 ESM bundle。157 个命令代理成员均存在于发布声明中，另记录 setInterceptor、26 个事件与 34 个关键源码文件摘要。
- 建议 (a)：设计态投影编辑 + 独立自研 IR 预览，初始零 fork 仍需实测。列明组合输入通知、身份/事务钩子、历史和 Worker 工厂的条件性补丁范围。(b) 需要同时改造布局、几何命中、光标、输入处理和历史，暂不建议。
- 关键边界：设计态不承诺与 IR 分页相同；不得逐次用 executeSetValue 回写（会清撤销栈）；不得把私有坐标/元素索引直接作为 Semantic Map；未支持节点必须保留或只读。
- 验证：发布包 SRI、命令声明覆盖、证据摘要复核、相对链接与固定源码链接定位检查、Biome 及 `git diff --check`。本票为静态 spike，没有执行上游构建、真实浏览器/输入法或 Adapter round-trip 测试；完整回归矩阵列入报告，交由后续票验收。

**2026-09-12 (agent) 审核处理：**

- 已核实并采纳外部审核的 3 项 P1、1 项 P2，逐项处置与未完成门禁见[审核处理记录](../issue-07-review.md)。独立函数探针复核非空选区取消后原文不恢复；不是系统输入法验收，也未修复上游。
- ADR 补充输入取消原子恢复、historyEntryId/源快照事务协议；新增 [35（07b）](35-editor-adapter-runtime-feasibility.md) 作为 19 冻结前的最小运行验证，依赖方向为 07→35→19→20→22。
- 20/22/24–26 已加入各自负责的 anchor、真机输入法和领域统一历史验收项，全部保持未勾选。07 维持静态调研范围与 ready-for-human，ADR 仍为 Proposed。
