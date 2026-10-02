# ADR-0008：OFD 后端三级证据与 PDF 验收边界

**状态：** Proposed — 工程候选已验证，目标桌面/生产 profile 未验收。ADR-0004 的明确接受继续有效。
**日期：** 2026-10-02
**平台证据基线：** `11e39873fc1bf4ec23cba636d3b535946c59c2ee`；[审计](../audits/2026-10-02-wp0-go-no-go.md)。

## OFD 候选：低层 ofdrw.net + 本平台适配

固定 [ofdrw.net 来源](../../third_party/ofdrw.net/README.md)：`b0df084060b2b7cd619c865e014cec90bec609c3`、0.1.0-preview.5、MIT。上游声明取该 SHA 的 [feature-parity](https://github.com/whynpc9/ofdrw.net/blob/b0df084060b2b7cd619c865e014cec90bec609c3/docs/feature-parity.md)，不是浮动 main 或标准合规认证。源码存在列只证明可找到实现；本平台通过列才是所测范围。

| 能力 | 上游声明（固定 SHA） | 源码存在（vendored pin / 平台基线） | 本平台测试通过及缺口 |
| --- | --- | --- | --- |
| 容器/固定对象 | 容器支持，核心模型/生成部分支持 | `third_party/ofdrw.net/src/Ofdrw.Net.Core/Models/`、`Ofdrw.Net.Packaging/OfdPackageWriter.cs`；[OfdIrWriter.cs](../../dotnet/src/OFDCompose.OfdIrWriter/OfdIrWriter.cs) | [双 Reader gate](../../tests/ofd-writer/README.md)：最终 ZIP 的对象/引用/资源/映射；不调用流式 Layout、Converter，不重排 |
| 精确文字/字形映射 | 字体部分支持，完整映射/子集仍列缺口 | Core `OfdElement.cs` SourceXml；平台写 CGTransform/DeltaX/DeltaY | CFF/TTF、n:m cluster、代理对/组合字、独立 Java2.3.7 读取；本 OFD profile 拒绝 reordered/overlap/gap cluster，不代表全 bidi |
| 字体子集 | 嵌入读写存在，上游未提供本平台所需完整子集链 | Core `OfdFontResource.cs`；平台 [subset.ts](../../packages/render-worker/src/subset.ts) 用 HB retainGids | Worker 单次子集、字体字节与 ID/closure 校验，OFD/PDF 共享；三款桌面 retain-GID 显示/复制/搜索 **Not verified** |
| 路径/图片/clip/state | 常用图元存在，完整标准对象模型未覆盖 | Core `OfdClipGeometry.cs`；writer 的路径/图片/state/clip XML | 高精度/负矩阵、local/page、组合clip、命令/填充规则及 mutation gate；normal blend/sRGB，不推断渐变/Pattern 全支持 |
| 封装修正 | 上游能力声明不是本平台精度保证 | [PackageFinalizer.cs](../../dotnet/src/OFDCompose.OfdIrWriter/PackageFinalizer.cs) | 补确定性 DocID，恢复被三位小数截精度的 CTM、被 XML 归一的 CRLF TextCode；两 Reader 均读取修正后最终包 |
| 源附件 | 容器附件存在，管理工具部分支持 | Core `OfdAttachment.cs`、Packaging，平台 Containers | issue17 .NET/Java 提取和真实 Worker 编辑重导出；目标桌面提取 **Not verified**，见 ADR-0010 |
| 签章/密码/归档 | provider 扩展点；GM/T0099 未支持 | 本平台仅报告 unsigned/unverified | 未运行相应认证/签章/长期保存门禁；不属于首版生产 profile 宣称 |

固定 writer 只消费 canonical µm IR 和授权 subset/image 字节。OFD origin=`position+offset`，不重复加 baseline；颜色量化误差与坐标误差分开。PNG 当前为8位、非隔行、非动画；JPEG SOF0/1/2 Huffman、8位灰度/三分量、EXIF 无或1，其他合法变体显式拒绝。完整预算/限制见 [writer README](../../dotnet/src/OFDCompose.OfdIrWriter/README.md)，不得因文件非空就宣称平台支持。

## PDF：自研路线已定，受限 reader profile 已验收

[ADR-0001](ADR-0001-technology-baseline.md) 的自研选择与 [ADR-0004](ADR-0004-pdf-writer-reader-profile.md) 保持 Accepted。直接 PDF1.7、TTF CIDFontType2 + CIDToGIDMap、CFF CIDFontType0 + FontFile3/OpenType；不是 OFD 转换、全文轮廓或隐藏文字替代。通过 [PdfPig/pdf.js/qpdf/Poppler 独立 gates](../../tests/pdf-writer/README.md) 的精确范围可继续用于 PoC。

必须保留 [writer 限制](../../dotnet/src/OFDCompose.PdfIrWriter/README.md)：logical cluster 必须无重叠且完整分区；非空 glyphless、过多 glyph、不可保持的空白/format 映射、单 glyph 映射多个 ASCII 空格等显式 `UNSUPPORTED_FEATURE`；untagged profile 的非空文字 semantic readingOrder 与 page/paint 相对次序一致；页长宽≤5,080,000µm，未实现 UserUnit。RTL 单 text 的 logical 遍历不批准跨对象换序；已有5像素/15通道/delta≤1 overlap 容差只属于固定 raster case。

唯一用户接受的抽取例外：固定 pdf.js5.4.149 对真实 Worker `o  f` 高层返回 `o f`；原文/ToUnicode/PdfPig/四 glyph/字体和几何保持。不得扩大为空白通用归一、其他字符丢失或新 reader 的免验条款。

## 解锁

保留 ofdrw.net 固定写出候选及 .NET 自研 PDF；Java 仅测试验证器，未启用生产 Java 后端。按 issue18 固定 CFF/TTF 样本在数科/福昕/WPS 记录版本、OS、授权可用性、文字/边框/图片显示截图、复制的原始 Unicode 与搜索命中；按 issue17 提取附件校对字节摘要。未通过前不冻结首个生产 OFD/font/container profile，不能以 PDF 已验收替代 OFD 桌面证据。正文矢量和语义 PoC 可用，生产互操作仍 **No-Go（待证）**。
