# 19: WP0.10 ADR 集与 Go/No-Go

**What to build:** 评审人拿到一组 Accepted 状态的 ADR，冻结 WP1 所需的全部待定决策：编辑器接法与 fork 范围、首版字符与版式 profile、OFD/PDF 后端 profile、IR 精度与舍入、字体家族（CFF vs TrueType）、源附件包结构、GIF/BMP/TIFF 政策、性能参考值与未解风险；并给出明确的 Go/No-Go 结论及依据链接。

**Blocked by:** 03 旧 DOCX 扫描器原型, 05 Binding Core 全部 P0 操作与结构展开, 18 跨运行时、阅读器矩阵与性能, 35 Editor Adapter 最小运行时可行性验证（07b）

**Status:** ready-for-agent

- [ ] ADR：Editor Adapter 接法与 canvas-editor fork 范围（基于 07 静态调研 + 35 冻结前运行验证）；逐项列来源 SHA、必要补丁与回归证据。35 的关键门禁未通过时记 Not verified/No-Go，不无条件冻结零 fork
- [ ] ADR：首版字符范围与版式 profile（基于扫描器实际字符统计与 06/09–13）
- [ ] ADR：首个 OFD 后端 profile（ofdrw.net 能力矩阵：上游声明 / 源码存在 / 本平台测试通过）与 PDF 写入器验收结论
- [ ] ADR：IR 规范化单位/精度/舍入与几何误差正式门槛
- [ ] ADR：字体家族与字重、源附件包结构、图片格式政策
- [ ] ADR：性能参考值（含是否含资源加载/子集/双格式写出）
- [ ] Go/No-Go 结论对照 spec 的 Go/No-Go 条件逐条给出证据链接；未验证项列 `Not verified`
- [ ] 正式确认方案 (a) 的设计画布/IR 预览差异；接受后同步修订 spec 模块表“统一内核注入”及 Go/No-Go 口径，明确最终分页/溢出/输出版面以 IR 为准；未批准前保留 Proposed
- [ ] spec 中"待 WP0 ADR 冻结"表更新为已冻结或改期
