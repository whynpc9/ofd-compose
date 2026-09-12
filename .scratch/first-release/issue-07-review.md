# Issue 07 / ADR-0002 审核处理记录

日期：2026-09-12。审核与本次处理的仓库基线均为 `0995be278e43a46b58909427ba711b7399fec186`；上游基线为 `83985f729cde373eccdcf25314227827b971bb63` / canvas-editor 1.0.2。

审核来源：[审核ADR草案](chatgpt-conversation://6aa53915-b8cc-83ec-acc8-79bdb6252666)。已读取完整审核正文，按源代码和当前工单独立核实。对话中的附件引用未提供可读文件，本次没有声称执行审核人的脚本，而是另建可复跑探针。

## Findings disposition

| ID / 优先级 | 核实结论与处置 | 落点 | 未完成门禁 |
| --- | --- | --- | --- |
| R1 / P1：非空选区 IME 取消未恢复 | **采纳。** 原始 input 删除选区后只记录临时区间；compositionend 空 data 没有恢复原文。本次独立函数级复验得到 selected-cancel 后“丙”。把取消风险提升为准入阻塞，要求原文/身份/选区/历史原子恢复，并将取消恢复纳入条件性补丁，区别于通知钩子 | [ADR §5(a)/§6](../../docs/decisions/ADR-0002-editor-adapter-isolation-spike.md)、[35](issues/35-editor-adapter-runtime-feasibility.md)、[22](issues/22-designer-shell-and-editor-adapter.md) | 未修复上游；无真实 OS IME 复现或修复证明。35 验证原子取消恢复，22 扩充全矩阵 |
| R2 / P1：源快照与上游历史无准确关联 | **采纳。** HistoryManager 为闭包栈；submitHistory 无业务快照 ID；contentChange 经 setTimeout 延后，无事务标识。同轮 A/B 通知无法分别重建 A/B。补充同步 historyEntryId 与源事务关联、commit/undo/redo/reset/discard、失败回滚、单调 revision、业务无文字变化检查点的候选协议。外部协调可证明等价则零 fork，否则最小历史钩子进入候选维护域 | ADR §5(a)、35、[20](issues/20-v1-contract-freeze.md)、22、[24](issues/24-designer-field-tree-dynamictext-live-preview.md)/[25](issues/25-designer-expression-builder.md)/[26](issues/26-designer-structure-blocks.md) | 未实现历史钩子或验证外部协调；35 必须测同轮 A/B、同文字绑定变化、混合文本/结构操作及新编辑清 redo |
| R3 / P1：冻结与证据先后不一致 | **采纳。** 原工单图无环，但 19 要求的运行证据原本放在 22，而 22 经 20 依赖 19。新增工单 35（审核建议的 07b），使用暂定 fixture，只依赖 07；19 新增依赖 35，保留 20→19、22→20。35 不等待 v1/工作台/完整 IR | ADR §7、[35](issues/35-editor-adapter-runtime-feasibility.md)、[19](issues/19-wp0-adr-set-and-go-no-go.md) | 35 尚未执行。19 不能在关键证据缺失时写已冻结零 fork/无条件 Go |
| R4 / P2：矩阵未落实后续工单 | **采纳。** 将 anchor/revision/节点及实例身份写入 20，选区取消/真机/历史/几何写入 22，DynamicText/表达式/结构的统一历史写入 24–26，旧预览竞争和定位写入 24 | ADR §7 与对应工单的未勾选验收项 | 所有新增验收项仍待实现/验证；文档补齐不等于这些功能完成 |

方案 (a) 的产品取舍不是新遗漏：原 ADR 已明确设计态与 IR 分页不同。本次在 19 增加正式确认及 spec 模块表/Go-No-Go 同步修订要求。保持 ADR **Proposed**，本次没有替代产品决策或把 spec 改为已接受方案。

## Validation

- [探针](issue-07-review/probe-ime.mjs)从固定上游缓存加载原始 input/composition 源码，核对基线 JSON 的两个 SHA-256 后由仓库 TypeScript 5.9.3 转译执行；没有改写函数体。复跑：`node .scratch/first-release/issue-07-review/probe-ime.mjs`。需先按 ADR §1 下载固定提交到忽略入库的 reference 目录。
- [结果](issue-07-review/ime-probe-result.json)：折叠取消 → 甲乙丙；非空选区取消 → 丙；非空选区提交 → 你丙。断言用于记录已存在缺失恢复路径，**并非修复通过测试**。探针限制包括无真实 DOM/Canvas、stub Draw/Range/渲染、无控件/留痕/样式复制/规范化、BMP 分段和显式非 Firefox 事件序列；不验证 nodeId/历史。
- 源码复核：历史与异步通知依据 Draw.render/submitHistory、HistoryManager、utils.nextTick，均对应固定源摘要。R2 未声称完成运行验证。
- 文档相对链接、固定源链接与行号、验收责任工单、全体本地工单依赖引用/无环检查；`git diff --check`。探针语法和确定性复跑结果已核对。

## Closure boundary

本次关闭的是四项**草案/验收编排缺口**，没有修复或关闭上游运行时问题。07 保持 `ready-for-human`（静态调研交付待评审）；35 为 `ready-for-agent`，19–26 新增项未勾选；ADR 保持 Proposed。没有生产代码、公开 schema、包依赖或 fork 的修改，没有提交或推送。
