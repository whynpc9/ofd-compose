# 15: OfdIrWriter（WP0.6）

**What to build:** .NET 写入器把 Layout IR 与子集字体资源写成 OFD 文件：文字以字形映射与精确定位写出，边框为路径，图片为多媒体资源，字体为嵌入子集；返回 IR objectId → OFD objectId 映射；文件通过 ofdrw.net Reader 与 Java ofdrw Reader（测试容器）双读取，抽取文本等于 IR 逻辑文本。写入器不换行、不分页、不缩字、不选字体。

**Blocked by:** 08 Layout IR 契约与规范化, 14 Render Worker + 字体子集 + 端到端 PoC

**Status:** ready-for-agent

- [ ] 基于 ofdrw.net（Core / Packaging / Layout 低层 builder / Reader）锁定提交；不引用任何 Converter 包
- [ ] 文本写入：基线、局部坐标、变换、字符—字形映射结构、DeltaX/DeltaY 语义与 IR 定义一致；不假设一字符一字形
- [ ] 嵌入 Worker 提供的子集字体（CFF 与 TrueType 均测）；不在 .NET 侧重新子集
- [ ] 路径、边框、裁剪、变换、透明度、绘制顺序按 IR 图形状态输出；不支持项返回 `UNSUPPORTED_FEATURE`
- [ ] 图片 PNG/JPEG 作为多媒体资源；资源摘要一致、无外部引用、包内路径安全
- [ ] 返回完整对象映射（一对多）；文件无悬空引用与重复 ID
- [ ] 测试：fixture IR 与 PoC 样本 → OFD → ofdrw.net Reader 与 Java ofdrw Reader 抽取文本/坐标比对；几何偏差记录（PoC 观察线 0.05 mm）
- [ ] 同一 IR 重复写出得到相同规范化对象集合（忽略时间戳字段）
