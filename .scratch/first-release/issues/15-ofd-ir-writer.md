# 15: OfdIrWriter（WP0.6）

**What to build:** .NET 写入器把 Layout IR 与子集字体资源写成 OFD 文件：文字以字形映射与精确定位写出，边框为路径，图片为多媒体资源，字体为嵌入子集；返回 IR objectId → OFD objectId 映射；文件通过 ofdrw.net Reader 与 Java ofdrw Reader（测试容器）双读取，抽取文本等于 IR 逻辑文本。写入器不换行、不分页、不缩字、不选字体。

**Blocked by:** 08 Layout IR 契约与规范化, 14 Render Worker + 字体子集 + 端到端 PoC

**Status:** ready-for-human

- [x] 基于 ofdrw.net（Core / Packaging / Layout 低层 builder / Reader）锁定提交；不引用任何 Converter 包
- [x] 文本写入：基线、局部坐标、变换、字符—字形映射结构、DeltaX/DeltaY 语义与 IR 定义一致；不假设一字符一字形
- [x] 嵌入 Worker 提供的子集字体（CFF 与 TrueType 均测）；不在 .NET 侧重新子集
- [x] 路径、边框、裁剪、变换、透明度、绘制顺序按 IR 图形状态输出；不支持项返回 `UNSUPPORTED_FEATURE`
- [x] 图片 PNG/JPEG 作为多媒体资源；资源摘要一致、无外部引用、包内路径安全
- [x] 返回完整对象映射（一对多）；文件无悬空引用与重复 ID
- [x] 测试：fixture IR 与 PoC 样本 → OFD → ofdrw.net Reader 与 Java ofdrw Reader 抽取文本/坐标比对；几何偏差记录（PoC 观察线 0.05 mm）
- [x] 同一 IR 重复写出得到相同规范化对象集合（忽略时间戳字段）

## Comments

2026-09-15: 已实现固定图元 OfdIrWriter；边界与复现方式见
`dotnet/src/OFDCompose.OfdIrWriter/README.md`、`tests/ofd-writer/README.md`。
真实 Worker 样本与明确派生的契约样本均进入最终 archive → .NET Reader +
Java ofdrw Reader 测试容器；本地证据在 `tests/ofd-writer/reader-evidence.json`。
0.05 mm 仅为 PoC 观察线；设备渲染、打印、selection 与生产门禁仍在18/19，
不是本票 ready-for-human 或绿灯测试能够替代的验收。

依赖14采用 `847df1bb4a16ad5092b94d6479dba4f99dabed1e` /
[PR #11](https://github.com/whynpc9/ofd-compose/pull/11)，其README已记录技术闭环
（28项 corpus 中23合法、4坏CRC PNG及1 UPC-A/ITF明确负向）。源14issue的
ready-for-agent旧状态未用于否定这些实际证据，本分支未改动14依赖分支。
本票组合样本IR摘要仍匹配14的提交基线；并未把负向媒体修成无诊断成功。

实现阶段两轴独立审查发现共享clip展开计费和字体结构验证缺口，已修正并加入
回归（含CID FDSelect越界且重新计算摘要的坏字体）。公开包不带许可元数据的
图片候选已移除，未放宽许可白名单。最终PR审核/CI状态由PR当前head核验，
此记录不宣称未完成的review或允许合并。
