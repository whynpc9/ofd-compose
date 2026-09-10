# 16: PdfIrWriter（WP0.7）

**What to build:** 自研 .NET PDF 写入器从同一 Layout IR 直接生成矢量 PDF：CIDFont + Identity-H 按 glyph ID 定位文字，嵌入 Worker 提供的子集字体，ToUnicode CMap 来自 IR cluster 映射使正文可复制/搜索，路径、透明度、裁剪、JPEG 直通与 PNG 解码嵌入；返回对象映射。用 PdfPig、pdf.js 与 qpdf 独立验证，不经 OFD→PDF。

**Blocked by:** 08 Layout IR 契约与规范化, 14 Render Worker + 字体子集 + 端到端 PoC

**Status:** ready-for-agent

- [ ] PDF 1.7 对象模型：页树、资源、内容流、Flate 压缩、xref；无第三方 PDF 生成库
- [ ] 字体：`CIDFontType2`（TrueType）与 `CIDFontType0C`（CFF）+ Identity-H；W 数组来自 IR advance；FontDescriptor 度量来自字体表
- [ ] ToUnicode 由 IR cluster 映射生成（含多字符 cluster）；pdf.js 与 PdfPig 抽取文本等于 IR 逻辑文本
- [ ] 路径、填充规则、描边、虚线、裁剪、ExtGState 透明度、变换
- [ ] 图片：JPEG DCTDecode 直通；PNG 用 BigGustave 解码为 Flate 原始像素，alpha → SMask
- [ ] 返回 IR objectId → PDF 对象/内容流位置映射
- [ ] qpdf `--check` 通过；几何比对（PdfPig 字形位置 vs IR）偏差记录
- [ ] 同一 IR 重复写出字节相同（固定 ID/日期字段）
