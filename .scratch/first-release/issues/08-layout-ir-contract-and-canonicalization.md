# 08: Layout IR 契约与规范化

**What to build:** 任何组件都可以构造、校验、规范化并对 Layout IR 求摘要：IR 包含身份、资源、页面、图形状态、文字（含 glyph/cluster）、路径、图片、语义与标记九部分；规范化后对象顺序、ID、数值精度与序列化确定；相同 LayoutIdentity 输入在 Node 与浏览器得到相同 SHA-256。写入器与排版器都以此契约为唯一接口。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-agent

- [ ] IR TypeBox schema 覆盖 spec IR 契约一节的全部部分；`irVersion` 独立于 `modelVersion`
- [ ] 坐标左上原点、毫米语义；规范化用 1/1000 mm 整数（精度与舍入规则以测试记录，供 WP0.10 调整）
- [ ] 文本范围用 UTF-16 offset 且禁止切断代理对；提供 cluster ↔ offset 转换表
- [ ] 确定性序列化（键排序、固定数字格式）与 SHA-256 摘要；运行时间/机器标识等放非语义 provenance
- [ ] LayoutIdentity 的规范化输入定义与摘要函数
- [ ] 一组 fixture IR（单页文字、表格边框、图片、条码矩形、跨页重复表头标记），供写入器票提前开工
- [ ] 同一 fixture 在 Node 与浏览器模式下摘要一致；打乱对象输入顺序后规范化结果不变
