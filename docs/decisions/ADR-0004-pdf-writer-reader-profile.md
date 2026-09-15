# ADR-0004：PDF 固定写出与独立 reader 文本边界

**状态：** Proposed（普通连续 ASCII 空白的严格高层验收仍待用户决定）
**日期：** 2026-09-16
**关联：** 本地 issue 16 / PR #13；ADR-0001；后续 18/19 业务、设备、打印 profile

## 已验证实现

同一 canonical Layout IR 与 Worker subset bytes 直接写出 PDF 1.7。字体字典为 CIDFontType2（TTF）或 CIDFontType0（CFF）；完整 OTF 使用 FontFile3/OpenType，不能将容器标为原始 CIDFontType0C。TrueType 显式 CID→GID；CID CFF 读取 charset/ROS。字形、Unicode cluster 与物理坐标不重新生成。

按已有语义容器和连续绘制序列组织 Form XObject，同一段落的多字体 runs 保持在一起，不同表格单元格分离。无语义容器、无空白的合成文本可按连续 cluster 分组。BBox 等于页域（既有 µm 坐标），Matrix 为默认 identity；不设透明度 Group，不重排跨组图元、不加隐藏文字层。Form 资源不引用 Form，调用深度固定。对象映射指向最终 page/Form stream 的解压字节位置。

14 个固定正常正向 PDF 的 PdfPig、pdf.js `showText` Unicode 与 `getTextContent` 全页文本直接相等；后者不再使用列分隔 allowlist。固定 Poppler 的 20 页渲染与分组前逐像素相同。参见 `tests/pdf-writer/reader-evidence.json`、`pdfjs-high-level-evidence.json`、`form-pixel-evidence.json`。

## reader 受限映射

PDF ToUnicode 可表达 NBSP、LF 等 Unicode；限制来自固定 pdf.js 5.4.149 的高层抽取，而非 PDF 格式。公开 API 只有 includeMarkedContent / disableNormalization，没有 keepWhiteSpace。后者仅为内部 evaluator 参数；公开 API 明确说明空白会转换为 U+0020。已验证的空白前缀+可打印内容、invisible-format、NBSP/LF glyph 映射返回定位到 objectId 的 UNSUPPORTED_FEATURE。源 metadata 含这些字符、结构性段落/分页换行，不因此被拒绝。

## 尚未通过的正常连续 ASCII 空格

真实 public Render Worker 的普通段落 `o  f`：IR logical/display 均为 `o  f`，四个 glyph，原字体空格字形和 advance 连续；PDF 的 ToUnicode/PdfPig 保留双空格，但 stock `getTextContent({disableNormalization:true})` 返回 `o f`。原输入、subset 和 PDF 位于 `tests/pdf-writer/fixtures/whitespace-reader/worker-double/`。这是正常输入，不通过改原文、改 fixture 期望、移挪 cluster Unicode、隐藏文字或扩大 UNSUPPORTED 来关闭。

待用户选择：

1. 允许仅已验证的 stock 高层空白归一差异，保留原文、字形、显示与独立底层 exact；明确该 API 的非 literal-copy 边界。
2. 坚持 stock 高层逐字符一致：本项继续未完成，等待可保真的读取策略或能力变化。

这份 Proposed ADR 不代表用户已接受第一项，也不代表 issue 16 或生产 profile 已验收。

## 一手依据

- [PDF Reference 1.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf)：§4.9 / Table 4.45（Form、BBox、Matrix、Resources、graphics state）；§5.6、§5.8、§5.9（CID、嵌入字体、ToUnicode）。
- [固定 pdf.js public API](https://github.com/mozilla/pdf.js/blob/v5.4.149/src/display/api.js) 与 [evaluator](https://github.com/mozilla/pdf.js/blob/v5.4.149/src/core/evaluator.js)：默认 keepWhiteSpace=false，空白 glyph 与 addFakeSpaces 的行为。
- [官方 public API 文档](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)：getTextContent/streamTextContent 的空白说明。当前 6.3.289 源码仍有相同默认值与单空格分支；未以未运行的新 reader 替代固定版本证据。
