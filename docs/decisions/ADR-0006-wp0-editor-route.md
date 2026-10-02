# ADR-0006：WP0 编辑器路线与必要补丁候选

**状态：** Proposed — 方案 (a) 产品取舍、生产 fork 与真实 OS IME 尚未批准/验收。
**日期：** 2026-10-02
**证据基线：** `11e39873fc1bf4ec23cba636d3b535946c59c2ee`；[审计及解锁条件](../audits/2026-10-02-wp0-go-no-go.md)。延续 [ADR-0002](ADR-0002-editor-adapter-isolation-spike.md)，不取代其 Proposed 状态。

## 提请接受的产品行为

建议继续方案 (a)：TemplateSource 是唯一编辑源，canvas-editor 是设计态投影；独立 IR 预览负责最终分页、溢出诊断与输出版面。设计画布的页数、换行、光标/选区几何可能与绑定数据后的预览不同。用户必须在发布前查看 IR 预览，不能把设计画布页码或截图当成输出承诺。预览点击经 Semantic Map 转为逻辑 anchor，再定位源节点/重复实例；不复用两套页面像素坐标。

批准需要明确接受上述用户影响及受控 fork 的维护责任；本 ADR 和技术可行性报告不能代替人类批准。若要求编辑画布本身严格 IR WYSIWYG，应重新比较 ADR-0002 (b) 与独立编辑壳，不能将其记为轻量接入。

**仅在批准且 issue35 关键门禁通过后**，提议将 spec 模块表的“统一内核注入”改为“自有模型投影与源事务/逻辑选区桥接；独立最终预览消费统一 Layout IR”；Go/No-Go 中“排版与交互不可解耦”按设计几何和最终几何明确分工验收。当前 spec 原要求仍保留，旁注本提案，未静默降低门槛。

## 最小实验范围与证据

固定上游 canvas-editor 1.0.2：`83985f729cde373eccdcf25314227827b971bb63`。包 SRI、633 个源码 blob 与七个发布文件摘要见 [baseline.json](../../tools/editor-adapter-spike/baseline.json)；实际补丁/源码身份见 [provenance](../../tests/editor-adapter-spike/evidence/provenance.json)。本项目 [六文件 patch](../../tools/editor-adapter-spike/upstream.patch) SHA-256 为 `aa0870430dbe08afc7ddf260ad9cedb2a6ffcb2fa3f613de9ede97eb65d1b284`，只验证事务接缝，尚未批准为生产 fork。该本地 provenance 的 `sriRecomputedThisRun=false`，不能冒称本轮重新下载验证 archive SRI。

| 修改域 | 实验职责 | 通过证据与界限 |
| --- | --- | --- |
| Draw / HistoryManager | 同步 checkpoint、恢复/丢弃/重置、opaque historyEntryId 与 Adapter association registry；不得把业务源对象藏入上游历史 | 连续 A/B、逐步 undo/redo、同文字绑定变化/文本/wrap 混合历史；缺关联时失败并阻止保存 |
| editor/index / input / composition | 连接事务参与者、修改前完整快照、composition 提交一个事务、取消恢复原文/身份/选区/redo；阻止重入并回滚失败 | 非空选区合成 commit/cancel、输入/粘贴/受支持快捷键；真实 OS IME **Not verified** |
| EventBus | 协调区间暂存同步通知，源/视图/历史一致后发布 | 同步 observer 不见半恢复状态；不是所有生产入口均已覆盖 |

最终 [REPORT](../../tests/editor-adapter-spike/REPORT.md) 与 Chromium/Firefox 原始 JSON 各 16 项：2 项原版负向控制 + 14 项 patched case。原版非空选区取消丢字、异步 contentChange 读到 B 两次，已否定“只靠公开通知的零 fork”假设；不证明任意外部协调方案都不可能。原始失败轮次与修复均保留。

Adapter 自持 session/entry → immutable AST、映射、投影、逻辑选区关联；纯业务修改也进入同一历史域，undo/redo 发布递增 revision。未知节点在测量 fixture 中整文只读并保留。当前是 atom fixture，无真正 IR 预览调度器，不能证明复杂表格/跨页选区/真实领域编辑已完成。

## 解锁与下游

- issue35：按 [人工步骤](../../tools/editor-adapter-spike/README.md) 在 Windows 微软拼音和 macOS 拼音实际执行非空选区 commit/cancel，保存 OS/IME/browser 版本、真实事件、内容/身份/历史状态与候选界面观察。合成事件不能代替。
- issue19：取得方案 (a) 和必要生产补丁范围的明确人类决定；若失败，先修补复验或重开选型。
- issue20：只有前置解锁后才冻结 UTF-16/字素/HarfBuzz cluster 转换、边界方向、nodeId 与实例区分、zone/table context、revision 对应关系；内部 session/history/transaction 标识不得泄漏公共文件/宿主协议。
- issue22–26：替换临时 AST，扩完整事件入口、真实 clipboard、CSP、多实例、跨页/表格与领域事务；历史原子性和失败恢复必须保留。

**结论：** 测量 fixture 有条件可行；编辑器契约与 WP1 设计工作台准入 **No-Go（待证/待批准）**。不要求重做已通过的所有实现，也不批准发布 fork。
