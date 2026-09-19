# 16: PdfIrWriter（WP0.7）

**What to build:** 自研 .NET PDF 写入器从同一 Layout IR 直接生成矢量 PDF：CIDFont + Identity-H 按 glyph ID 定位文字，嵌入 Worker 提供的子集字体，ToUnicode CMap 来自 IR cluster 映射使正文可复制/搜索，路径、透明度、裁剪、JPEG 直通与 PNG 解码嵌入；返回对象映射。用 PdfPig、pdf.js 与 qpdf 独立验证，不经 OFD→PDF。

**Blocked by:** 08 Layout IR 契约与规范化, 14 Render Worker + 字体子集 + 端到端 PoC

**Status:** ready-for-human

**Acceptance:** 用户于 2026-09-19 接受 ADR-0004 的明确 reader 差异；实现验收完成，PR 保持未合并。

- [x] PDF 1.7 对象模型：页树、资源、内容流、Flate 压缩、xref；无第三方 PDF 生成库
- [x] 字体：`CIDFontType2`（TrueType）与 `CIDFontType0`（CFF，完整 Worker OTF → `FontFile3 /Subtype /OpenType`）+ Identity-H；W 数组来自 IR advance；FontDescriptor 度量来自字体表
- [x] ToUnicode 由 IR cluster 映射生成（含多字符 cluster）；PdfPig 与 pdf.js 底层 Unicode exact，25 个正向高层 literal-exact；仅真实 Worker `o  f` 在固定 pdf.js 5.4.149 高层为 `o f`，按 2026-09-19 用户接受及独立回归验收
- [x] 路径、填充规则、描边、虚线、裁剪、ExtGState 透明度、变换
- [x] 图片：JPEG DCTDecode 直通；PNG 用 BigGustave 解码为 Flate 原始像素，alpha → SMask
- [x] 返回 IR objectId → PDF 对象/内容流位置映射
- [x] qpdf `--check` 通过；几何比对（PdfPig 字形位置 vs IR）偏差记录
- [x] 同一 IR 重复写出字节相同（固定 ID/日期字段）

实现与当前 profile 边界见 `dotnet/src/OFDCompose.PdfIrWriter/README.md`；独立读取、几何与变异门禁见 `tests/pdf-writer/README.md`。PR/review 进度见 PR #13；普通双 ASCII 空格的明确高层差异已按 ADR-0004 接受；不推广到其他未验证差异。

## Comments

2026-09-16：语义 Form XObject 已使原正常正向样本（含表格、真实空格、多字体段落、宽间距合成例）stock pdf.js 高层直接相等；没有修改逻辑文本/fixture 或使用 allowlist。单独映射的 NBSP/LF 被 reader 归一的能力限制单独诊断；正常双 ASCII 空格 `A  B` 的 stock 高层结果为 `A B`，严格保留这一真实验收缺口，等待用户决定，不以格式不支持来解释。

2026-09-19：用户直接回复“接受”上述已验证高层差异。保留原始 fixture/字体、源文本、显示、ToUnicode/PdfPig exact 与几何；新增独立 expected/version/hash 门禁。其余25个高层literal-exact门禁不变；不合并PR，不扩大到任意空白或非空白差异。
