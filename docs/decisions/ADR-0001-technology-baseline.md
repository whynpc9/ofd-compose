# ADR-0001：OFD Compose 首版技术基线

**状态：** Accepted（2026-09-10 用户拍板四项待定项；标注"WP0 验证"的候选仍需证据后冻结）
**日期：** 2026-09-10
**关联：** `.scratch/first-release/spec.md`（首版闭环 spec）、实施计划 v0.3 §2.3 / §3.2 / §3.6
**证据级别：** 以下版本、许可与能力均来自 2026-09-10 的公开文档/包注册表静态核查，未执行构建或测试。凡标注"WP0 验证"的项，在对应 WP0 子项通过前只是候选。

## 选型原则

1. 同一排版与文字链路只在 TypeScript 中实现一次，浏览器与 Node 运行同一份代码和同一份 WASM。.NET 只做契约、隔离、固定写出。
2. 生产运行时不含 Word / LibreOffice / Chromium / JVM（Java 适配器为休眠 profile）。
3. 只用许可可满足部署要求的开源组件：MIT / Apache-2.0 / BSD / OFL / Unlicense 直接可用；LGPL 仅限动态链接的测试工具；AGPL、Split/商业双许可（iText、QuestPDF、ImageSharp）排除。
4. 所有依赖固定到精确版本或提交；锁文件入库；能力矩阵区分"上游声明 / 源码存在 / 本平台测试通过"。
5. 确定性优先：Layout / Binding / Typography Core 禁止依赖运行时 `Intl`、系统字体、系统时区与机器默认 locale。

## 决策总表

### A. 运行时与语言

| 项 | 决策 | 版本锁定 | 许可 | 理由 | 备选/排除 |
| --- | --- | --- | --- | --- | --- |
| 共享内核语言 | TypeScript（strict、ESM only） | 5.9.x | Apache-2.0 | 浏览器/Node 双端唯一实现 | — |
| 服务端 JS 运行时 | Node.js 24 LTS | 24.x（`.nvmrc` + `engines`） | MIT | 当前 Active LTS（至 2028-04-30）；26 于 2026-10 进入 LTS 后再以 ADR 升级 | Node 26（尚为 Current）、Bun/Deno（生态与 WASM 行为验证成本） |
| 服务门面与写入器 | .NET 10 LTS，ASP.NET Core Minimal API | 10.0.x（`global.json` 锁 SDK） | MIT | LTS 至 2028-11-14；ofdrw.net CLI 同为 net10.0 | .NET 8/9（2026-11 EOL） |
| 浏览器矩阵（P0） | Chromium 系最近两个稳定版 + Firefox 最近稳定版 | WP0.9 记录实际版本 | — | WASM、`Intl.Segmenter` 均已普遍可用 | Safari 作为 P1 验证 |
| Java（测试验证器） | Java 21 LTS + ofdrw Reader，仅作为测试容器中的独立 OFD 读取/抽取器（已拍板） | 锁定 ofdrw 版本 | Apache-2.0 | 提供非本仓库引擎的 OFD 验证；不进入生产镜像 | 生成适配器 `adapters/ofdrw-java/` 等 WP0.10 ADR 再决定 |

### B. 仓库与工程工具

| 项 | 决策 | 理由 |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | 多包 TS + 一个 .NET solution；任务缓存 |
| TS 构建 | tsdown（或 tsup）产出 ESM + d.ts | 库包打包简单、无框架耦合 |
| TS 测试 | Vitest；`browser` 模式（Playwright provider）复跑同一套内核用例 | 双端一致性验证不需要另一套 runner |
| Lint/Format | Biome | 单工具；用 lint 规则禁止 Core 包引用 DOM、`Intl`、`Date.toLocale*` |
| .NET 测试 | xUnit v3 | 通用；与 NDocxTemplater 现有测试风格一致 |
| 契约 schema | TypeBox 定义 → 生成 JSON Schema 2020-12 存入 `schemas/`；.NET 用 JsonSchema.Net 校验 | JSON Schema 是跨语言共享产物，TS 类型由其派生 |
| .NET JSON | System.Text.Json + source generator | AOT 友好、无反射惊喜 |
| OpenAPI | Microsoft.AspNetCore.OpenApi | 生成 SDK 与文档 |
| 版本发布 | Changesets（TS 包）、Nerdbank.GitVersioning 或 MinVer（.NET） | 包版本与兼容矩阵可追溯 |
| SBOM | CycloneDX（`@cyclonedx/cyclonedx-npm` + `CycloneDX.NET`） | 发布门禁要求 |
| 许可审计 | `pnpm licenses` + `dotnet-project-licenses`；CI 阻止非白名单许可 | 原则 3 |

### C. 共享内核依赖（浏览器 + Node）

| 能力 | 决策 | 版本 | 许可 | 理由 | WP0 验证 |
| --- | --- | --- | --- | --- | --- |
| 文字整形 | harfbuzzjs（HarfBuzz WASM） | 1.6.x | MIT | 两端同一 wasm 字节；glyph/cluster/advance 由 HarfBuzz 唯一决定 | WP0.4：`-DHB_TINY` 精简构建是否缺少所需 API；若缺则自建 wasm |
| 字体表解析与度量 | fontkit | 最新 2.x | MIT | OS/2、hhea、head、name、cmap 读取；CFF/TTF 均支持。字形选择不走 fontkit，只走 HarfBuzz | WP0.4 |
| 字体子集化 | hb-subset（harfbuzzjs 附带的 `hb-subset.wasm`），在 Render Worker 内执行；`retainGids=true` | 同上 | MIT | 子集只做一次，OFD 与 PDF 嵌入同一字节；retain-gids 使 IR glyph ID 与子集 glyph ID 一致，映射为恒等但仍记录 | WP0.6/0.9：目标阅读器对 retain-gids 子集（含空字形）的 CFF 与 TTF 支持 |
| 断行机会 | `@cto.af/linebreak`（UAX #14，Unicode 17，通过全部官方测试） | 4.0.x | MIT | 候选断点；中文禁则与段落策略在 Layout Core 内实现，版本随 `shapingAndLineBreakVersions` 记录 | WP0.4 |
| 字素/光标移动 | 编辑器层可用 `Intl.Segmenter`；Layout Core 只用 HarfBuzz cluster | — | — | Layout 不依赖 ICU | — |
| 十进制 | decimal.js | 10.x | MIT | 金额/比率不走浮点 | WP0.1b |
| 数字格式化 | 自实现：声明的 .NET 格式模式子集（`0.00`、`#,##0`、`%`、`‰` 等） | — | — | 不用 `Intl.NumberFormat`，避免 ICU 版本差异；与旧 InvariantCulture 输出对照 | WP0.1b |
| 日期时间 | temporal-polyfill（始终用 polyfill，不用运行时 Temporal）；模板必须显式 IANA 时区；格式化自实现 | 0.3.x | MIT | 两端一致行为；tzdata 版本写入 provenance | WP0.1b：不同 Node/浏览器 ICU 的 tz 偏移一致性 |
| 规范化 JSON 与摘要 | 自实现确定性序列化（键排序、1/1000 mm 整数、固定数字格式）；SHA-256 对字节 | — | — | 摘要在 TS 生成一次；.NET 只对字节做 SHA-256，不做跨语言重规范化 | WP0.5 |
| 图片尺寸探测 | image-size | 2.x | MIT | 不解码像素；PNG/JPEG/GIF/BMP/TIFF 尺寸 | WP0.5 |
| 图片格式 profile | 写入器输入只接受 PNG 与 JPEG；GIF/BMP/TIFF 在 Media Core 规范化为 PNG 或返回 `UNSUPPORTED_FEATURE` | — | — | 缩小写入器解码面 | WP0.5 决定规范化用纯 JS 解码器还是 P0 拒绝 |
| 条码生成 | bwip-js，使用其自定义 drawing-context 接口直接得到矩形 → IR 路径（不经 SVG/位图） | 4.11.x | MIT | 八种码制全部覆盖：`code128 / code39 / code93 / rationalizedCodabar / ean13 / ean8 / upca / interleaved2of5`；两端同一实现 | WP0.5a：逐码制解码验收 |
| 条码验证（测试） | zxing-wasm（Node 测试）+ ZXing.Net（.NET 测试） | 3.1.x / 最新 | MIT+Apache-2.0 / Apache-2.0 | 两个独立解码实现，避免生成器自证 | — |

### D. 编辑器与设计工作台

| 项 | 决策 | 理由 | 待定 |
| --- | --- | --- | --- |
| 编辑器基线 | `@hufe921/canvas-editor` 1.0.2（MIT），经 Editor Adapter 接入，不直接暴露给宿主 | 计划既定基线；1.0 已发布 | WP0.3 依赖图 → WP0.10 决定是否 fork |
| 工作台框架 | React + Vite（已拍板） | canvas-editor 本身框架无关；Editor SDK 以框架无关的 Web 组件/命令式 API 暴露，React 只用于 designer 应用壳 | — |
| 预览/缩略图 | 浏览器 Canvas 绘制 IR（消费已定位字形）；服务端缩略图由 IR 光栅化器（后续）而非浏览器截图 | 原则 2 | — |

### E. .NET 侧

| 项 | 决策 | 版本/许可 | 理由 | 备选/排除 |
| --- | --- | --- | --- | --- |
| Worker 进程模型 | .NET Job Host 拉起 Node Worker 子进程池；控制通道 JSON-RPC 2.0 over stdio（NDJSON）；字体/图片/IR 等大对象经内容寻址的作业 spool 目录传递；超时直接 kill 子进程 | — | 隔离与强制取消最直接；无网络端口 | Node sidecar HTTP 服务（取消/隔离弱，P1 可选） |
| OFD 写入 | ofdrw.net：`Ofdrw.Net.Core`、`Ofdrw.Net.Packaging`、`Ofdrw.Net.Layout` 低层 builder、`Ofdrw.Net.Reader`（用于自检） | 0.1.0-preview.x，锁提交；netstandard2.0/2.1 | 计划优先后端；需补齐字形映射/子集嵌入/对象映射 | Java ofdrw（休眠 profile） |
| ofdrw.net 许可 | MIT（已拍板）；需在 ofdrw.net 仓库落实 LICENSE 并发布带许可元数据的 NuGet 包后，本项目才引用公开包；此前以锁定提交引用 | MIT | feature-parity 原注明"许可证决定前禁止公开发布"，本决定解除该阻塞 | — |
| PDF 写入 | 自研 `PdfIrWriter`（已拍板）（PDF 1.7 对象模型：页树、内容流、`CIDFontType2`/`CIDFontType0C` + Identity-H、嵌入 Worker 提供的子集字体、由 IR cluster 映射生成 ToUnicode CMap、W 数组来自 IR advance、ExtGState 透明度、裁剪、Flate 压缩） | — | IR 已完全定位，写入器只需忠实落盘；对文本映射与确定性有完全控制；无库的字符串排版 API 干扰 | PDFsharp 6.2（MIT，但 API 以字符串绘制为中心，无逐字形定位）；SkiaSharp PDF（MIT，逐字形可定位，但官方构建关闭字体子集且 ToUnicode 不可控，另需原生库）；PdfPig builder（Apache-2.0，无子集、字符串 API → 仅作读取器）；iText/QuestPDF（许可排除） |
| PDF 图片编码 | JPEG 直通 DCTDecode；PNG 用 BigGustave 解码为原始像素 + FlateDecode（alpha → SMask） | BigGustave 1.0.x，Unlicense | 纯托管、无原生依赖 | ImageSharp（Split 许可，排除）、SkiaSharp（原生依赖，非必要） |
| PDF 验证（测试） | PdfPig（.NET）+ pdf.js（Node）文本/几何抽取；qpdf `--check` 结构检查 | Apache-2.0 ×3 | 独立于写入器；两条阅读实现 | veraPDF 留给 PDF/A（P1+） |
| OFD 验证（测试） | ofdrw.net Reader + Java ofdrw Reader（仅测试容器）+ 目标阅读器矩阵（数科 / 福昕 / WPS，人工，记录版本） | Apache-2.0 | 至少一个非本仓库引擎 | — |
| XML 安全 | `XmlReaderSettings.DtdProcessing = Prohibit`、`XmlResolver = null`；ZIP 条目数/大小/路径白名单 | — | 计划 §4.7 | — |
| 日志脱敏 | Microsoft.Extensions.Logging + `Microsoft.Extensions.Compliance.Redaction` | MIT | 结构化脱敏而非字符串过滤 | Serilog（可选 sink） |

### F. 字体资源

| 项 | 决策 | 许可 | WP0 验证 |
| --- | --- | --- | --- |
| 主候选（黑体） | Noto Sans CJK SC 静态字重（OTF/CFF 轮廓；同族含拉丁与数字，P0 可避免回退） | OFL 1.1 | WP0.9：三款目标阅读器对 CFF OTF 及其 retain-gids 子集的显示/复制/搜索 |
| 备选（TrueType 轮廓） | Noto Sans SC（Google Fonts 构建，TTF）静态实例；楷体候选 LXGW WenKai（TTF） | OFL 1.1 | 若任一目标阅读器对 CFF 失败则切换为 TrueType 轮廓家族 |
| 宋体候选 | Noto Serif CJK SC 静态字重 | OFL 1.1 | 同上 |
| 资源身份 | 字体按文件 SHA-256 锁定并随许可文本入库；家族名不是身份 | — | WP0.2 |
| 字符范围 | P0：GB 2312 全集 + 常用 GBK 扩展 + 拉丁/数字 + 业务符号清单；扫描首批模板实际字符后确认 | — | WP0.4 |

### G. 部署

| 项 | 决策 |
| --- | --- |
| 容器 | `mcr.microsoft.com/dotnet/aspnet:10.0` 基础镜像 + 官方 Node 24 二进制；多架构 linux/amd64 与 linux/arm64 分别构建与验证 |
| 无外网 | 字体包、wasm、tzdata 版本随镜像/离线包分发；Worker 无出网权限 |
| 资源预算 | 每作业：CPU 时间、堆上限（`--max-old-space-size`）、展开节点数、字体/图片字节数、页数上限；由 Job Host 配置 |

## 明确排除

- Chromium/Playwright/Puppeteer 作为生产渲染依赖（仅测试）。
- 任何 DOCX 渲染/转换器进入生产链路（`Ofdrw.Net.Converter.Docx` 不引用）。
- OFD→PDF 或 PDF→OFD 转换器作为主输出路线。
- iText、QuestPDF、ImageSharp、Aspose 等许可不满足的库。
- 在 .NET 内维护第二套表达式求值器或断行/分页引擎。
- `Intl.NumberFormat` / `Intl.DateTimeFormat` / 系统字体作为排版或格式化输入。

## 后果

- TS 侧承担全部"语义"复杂度（整形、断行、子集、格式化、条码几何），.NET 侧代码量小但需要精确实现 PDF 与 OFD 的固定写出协议。
- 自研 PDF 写入器意味着首版不追求 PDF/A 或标签 PDF；这些能力如需，在 P1 以独立 profile 加入。
- 字体若最终选 CFF 轮廓，PDF 用 `CIDFontType0C`，OFD 侧需在 WP0.9 确认阅读器支持；若切 TrueType 轮廓则两端都是最常见路径。
- Node 24 → 26 升级需重新跑确定性矩阵（V8/ICU 变化），以 ADR 记录。

## 已拍板项（2026-09-10）

| 项 | 决定 | 后续动作 |
| --- | --- | --- |
| 设计工作台前端框架 | React + Vite | Editor SDK 保持框架无关；React 只在 `apps/designer` |
| PDF 写入器 | 自研 `PdfIrWriter` | WP0.7 以同一批 IR 直接生成 PDF，用 PdfPig / pdf.js / qpdf 独立验证 |
| ofdrw.net 许可 | MIT | 在 ofdrw.net 仓库添加 LICENSE、包元数据；本项目 WP0.2 锁定提交 |
| Java 组件 | 仅测试容器中的 ofdrw Reader 作为独立验证器 | 生成适配器留待 WP0.10 ADR |

## 来源（2026-09-10 静态核查）

- harfbuzzjs 1.6.0（MIT，2026-08 更新；`-DHB_TINY` 精简构建说明）：https://www.npmjs.com/package/harfbuzzjs
- hb-subset flags（`HB_SUBSET_FLAGS_RETAIN_GIDS`）：https://harfbuzz.github.io/harfbuzz-hb-subset.html
- @cto.af/linebreak 4.0.3（MIT，UAX #14 Unicode 17，全部官方测试通过）：https://registry.npmjs.org/%40cto.af%2Flinebreak
- bwip-js 4.11.x（MIT，支持码制清单）：https://www.npmjs.com/package/bwip-js
- zxing-wasm 3.1.3（MIT + Apache-2.0 组件）：https://www.npmjs.com/package/zxing-wasm
- PDFsharp 6.2 文档（MIT；字体解析、嵌入、glyph mapping）：https://docs.pdfsharp.net/
- SkiaSharp PDF 子集化未启用：https://github.com/mono/SkiaSharp/issues/2180
- PdfPig（Apache-2.0；TrueType 整体嵌入、无子集）：https://github.com/UglyToad/PdfPig
- BigGustave（Unlicense）：https://github.com/EliotJones/BigGustave
- ofdrw.net 包结构与"许可证决定前禁止公开发布"：https://github.com/whynpc9/ofdrw.net/blob/main/docs/feature-parity.md
- @hufe921/canvas-editor 1.0.2（MIT，2026-08-28）：https://www.npmjs.com/package/@hufe921/canvas-editor
- .NET 10 LTS 支持至 2028-11-14：https://dotnet.microsoft.com/en-us/platform/support/policy
- Node.js 发布计划（24 Active LTS，26 于 2026-10 进入 LTS）：https://github.com/nodejs/release
- Noto CJK 许可与静态/可变说明：https://notofonts.github.io/noto-docs/website/use/
