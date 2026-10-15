# ADR-0009：IR 单位、舍入、容量与几何门槛

**状态：** Proposed — 版本0工程基线可复验；正式输出/设备误差门槛尚未冻结。
**日期：** 2026-10-02
**证据基线：** `11e39873fc1bf4ec23cba636d3b535946c59c2ee`；[审计](../audits/2026-10-02-wp0-go-no-go.md)。

## 保留的版本0工程基线

[schema](../../packages/layout-ir/src/schema.ts)、[quantizeMm/序列化](../../packages/layout-ir/src/serialize.ts)、[canonicalize](../../packages/layout-ir/src/canonicalize.ts) 和 [README](../../packages/layout-ir/README.md) 已实现：构建格式为左上原点 mm，范围 ±1,000,000mm；writer transport 为整数 µm（1/1000mm），范围 ±1,000,000,000µm。最短十进制表示 half-away-from-zero：±1.2345mm → ±1235µm；负零归零，正尺寸舍入后仍须为正。

只量化 schema 标记的长度；矩阵 a/b/c/d、颜色、透明度、glyph ID、像素尺寸不是长度。图片 a/b/c/d 保留 mm/pixel，canonical 局部坐标为 `1000*(a*pixelX+c*pixelY)+e`；translation e/f 才为 µm。有限数字/安全整数约束、UTF-16 键排序、非 Unicode 归一字符串、确定性引用/ID/顺序和独立 semanticDigest 保留。写入器校验和 hash 原始 canonical 字节，不在 .NET 重序列化、重量化或重新布局。

这固定的是当前实验实现与证据引用，不在本票发布 v1。issue20 的版本递增、公共 JSON/anchor 兼容与联合 schema gate 仍待 WP0 解锁。

## 四类不同误差不能混用

| 度量 | 已有证据/上界 | 可以作何结论 |
| --- | --- | --- |
| mm→µm 单标量 | 量化误差≤0.0005mm；边界/负数/大范围测试见 layout-ir tests | 当前量化算法的标量界；不是组合变换、整页或累计字距界 |
| OFD Reader 对象坐标 | [reader-evidence](../../tests/ofd-writer/reader-evidence.json)，固定 Java Reader 样本及 clip/path/mapping mutations | 所测图元/变换正确；不等于桌面栅格/打印精度 |
| PDF 抽取几何 | [独立 gate](../../tests/pdf-writer/README.md)：baseline/image corners 0.001pt，extent endpoint 0.01pt；后者实测最大0.00144567pt | 各自 reader 指标门槛，不能替代 mm 生产容差；`W` 另以1e-8字体单位核查 |
| 正式 IR→输出/打印/阅读器 | **Not verified**；0.05mm 仅原 PoC 观察线 | 不将其升级为全球/全部图元正式门槛；需固定目标设备和测量方法 |

正式门槛的补证：沿用 issue15/16 的坐标与可见 mutation fixture、issue18 的文字/边框/图片分区步骤，在固定 OS/reader/DPI/scale 下记录每类误差分布、测量单位、抗锯齿对齐及打印是否包含，区分量化误差、矩阵放大、抽取器误差、raster/设备误差。由产品验收者批准该 profile 的容差和例外；若超界，修复相应层并复验。不能由现有近零抽取误差推定尚未测的设备阈值。

## 容量是多层交集

Layout 当前每轮最多1000页、最多4轮/4000页分配；表格最多10000行/表、1024列、100000网格槽，另有共享字符/对象/整形工作预算。Writer 另有32MiB wire、1000页/200k对象/1M glyph/1M命令（含重复clip）与256MiB输出等上限；PDF 页尺寸≤5,080,000µm，比 IR 数值范围小。详细值分别以 [Layout](../../packages/layout-core/README.md)、[OFD](../../dotnet/src/OFDCompose.OfdIrWriter/README.md)、[PDF](../../dotnet/src/OFDCompose.PdfIrWriter/README.md) 为准，不能将某一个数字宣传为端到端吞吐或 RSS 保证。

[issue18 固定证据](../audits/2026-09-28-runtime-reader-performance.md)：6000行/预期500页输入在真实 Worker 的 bind 被 `JSON properties exceed budget` 拒绝，未到 shape/layout/subset/write；layout-only 6000行/500页测试仍保留。1000行/84页成功样本是补充的合成端到端容量证据。旧50/1000页、LRU、100k source-range 等压力断言不降低；Job Host 的硬 CPU/RSS/超时隔离不由这些逻辑限额替代。

**结论：** 沿用 canonical v0 µm/舍入工程候选供 PoC；正式误差阈值、真实业务容量与 v1 冻结仍 **No-Go（待证/待批准）**。
