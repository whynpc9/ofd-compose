# 35: Editor Adapter 最小运行时可行性验证（07b，WP0 前置）

**What to build:** 用固定 canvas-editor 1.0.2、暂定源模型/逻辑 anchor 与小型脱敏 fixture，验证设计态投影方案的输入取消、身份往返与单一历史关联机制，为 issue 19 提供可以冻结的路线及必要补丁证据。对应 ADR-0002 审核建议的“07b”；按本仓库两位数字工单约定追加为 35，编号不代表执行顺序。

**Blocked by:** 07 canvas-editor 隔离 spike

**Status:** ready-for-agent

- [ ] 锁定上游 SHA、发布包 SRI、探针/补丁基线；真实浏览器装载 Editor。使用小型暂定 fixture，不依赖 19/20/22，不实现完整 React 工作台、IR 预览或 v1 schema
- [ ] 身份往返：中文、分裂样式、复制/删除、未知节点保留或只读；源 AST、nodeId/映射、投影一致；说明临时契约如何迁移到 20
- [ ] 非空选区 IME 提交/取消：开始前完整快照；取消后原文、nodeId/映射、选区/上下文及历史游标/redo 分支共同恢复；提交只产生一项逻辑事务，临时内容不持久化
- [ ] 区分函数级诊断、合成浏览器事件和真实 OS 输入法证据。记录 Chromium/Firefox 实际版本；Windows 微软拼音与 macOS 拼音的非空选区提交/取消事件序列、结果、OS/输入法版本。缺少任一层写 `Not verified`，不能以合成事件替代真机
- [ ] 实现并验证 ADR-0002 §5(a) 候选历史协议：同步检查点关联 historyEntryId 与不可变源 AST/映射/投影/选区，区分 commit/undo/redo/reset/discard；重入抑制、失败回滚、初始条目与裁剪清理明确
- [ ] 在同一同步调用轮连续执行命令 A/B，等待异步 contentChange 后逐步 undo/redo；每个中间历史状态对应正确源快照，不能仅检查最终文本；覆盖直接输入/粘贴/快捷键入口，不只公开命令包装
- [ ] 用小型代表性业务元数据 fixture 修改绑定但保持显示文字不变，再混合文本编辑与一次结构包裹；验证它们同属一个历史域，undo 后新编辑清 redo；源、映射、投影、逻辑选区与新 revision 一致
- [ ] 比较无 fork 外部协调与最小事务/取消恢复钩子：若外部方案不能完整捕获检查点或原子恢复，则提交最小 patch、来源 SHA/补丁摘要、失败前与修复后证据；不将未验证的零 fork 当结论
- [ ] 输出可复跑命令、fixture、原始结果和失败矩阵；给 issue 19 的结论区分路线可行性、必要补丁范围、真机门禁与留给 22–26 的全功能回归。失败未修复或关键层缺证据时不得无条件 Go

## Scope and handoff

依据：[ADR-0002](../../../docs/decisions/ADR-0002-editor-adapter-isolation-spike.md)、[审核处理记录](../issue-07-review.md)。已有[函数级取消探针](../issue-07-review/probe-ime.mjs)只证明固定处理函数的缺失恢复路径，不满足本票的真实运行验收。

本票验证临时协议，不提前冻结公共 API，不批准生产 fork。19 根据本票证据作出接受/拒绝/待证决策，20 才冻结 anchor 与身份契约；22–26 扩展为正式支持清单并复跑完整矩阵。
