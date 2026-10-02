# ADR-0010：字体、ResourcePack、源附件与图片政策

**状态：** Proposed — 生产字体与单/多附件选择仍待目标阅读器验收；ADR-0003 的已接受媒体政策不变。
**日期：** 2026-10-02
**证据基线：** `11e39873fc1bf4ec23cba636d3b535946c59c2ee`；[WP0 审计](../audits/2026-10-02-wp0-go-no-go.md)。

## 字体与资源身份

沿用 [五字体 manifest](../../packages/typography-core/fonts/manifest.json) 的精确文件、SHA-256、上游 commit、大小与 OFL 文本，不把家族名当身份：Noto Sans CJK SC Regular400/Bold700（CFF 主候选）、LXGW WenKai Regular400（TTF 中文备选）、Noto Sans Italic400/BoldItalic700（真实拉丁斜体）。仅静态、单 face，禁止可变/集合/WOFF 和合成粗斜体/系统回退。中文斜体不能偷换成拉丁字体。

下列是**实验资源锁**，不是批准新增字重/字体分发产品：

| 字体 | SHA-256 |
| --- | --- |
| NotoSansCJKsc-Regular.otf | `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b` |
| NotoSansCJKsc-Bold.otf | `b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a` |
| LXGWWenKai-Regular.ttf | `39ad71264b588165b469e35e6afb162a378dacd1f95348160240ba9038ac3009` |
| NotoSans-Italic.ttf | `36cff144df01309dab648bea71baff9bb074026914afe63aeacc8bc90b67a28b` |
| NotoSans-BoldItalic.ttf | `6edf4227ef0fa846aca70e86a307804ca4401741830f5b3af0f2554abe2b8466` |

ResourcePack 只传宿主授权字节与内容摘要，不隐式访问 URL/路径。Worker 用 harfbuzzjs1.6.0 的实际 `harfbuzz-subset.wasm`、retainGids，一次子集供双 writer 原样嵌入；字形 closure/映射仍校验。完整字体用于编辑/新增字符，不能拿嵌入 subset 充当 full font；宿主必须显式授权并匹配原文件摘要。静态字体/资源门禁已实现；硬进程内存/超时需 Job Host。

目前没有目标桌面 CFF 失败证据，故不触发自动改用 TTF，不替用户批准家族切换。完成 issue18 同一样本 CFF/TTF 显示/复制/搜索后，再选定首发文件/字重集合；若出现失败，定位 font/reader/profile，比较修复与 TTF 路线并记录明确选择。新文件/字重需新的资源锁和相应回归。

## 源附件：单 JSON 为候选，未冻结容器协议

[ADR-0005](ADR-0005-source-attachment-experiment.md) 继续 Proposed。[当前实现](../../dotnet/src/OFDCompose.Containers/README.md) 为 `experimental@1` 单标准 OFD `application/json` 附件：五个独立 hash 的 JSON-text parts、内容寻址源图片、完整字体身份锁、Semantic Map/对象映射。单附件避免嵌套 ZIP；多附件可供目标工具逐文件提取，但增加关联/闭包校验和工具兼容面。**建议保留单 JSON 候选，必须经目标 reader 实际提取后再决策**，库 Reader 通过不替代单/多选择。

native-source 最小化去掉原始 Data、表达式求值/未打印值/调试凭证；打印内容与编辑关系可保留，不能承诺附件没有业务敏感值。distribution 不带可编辑源。`artifactIrDigest` 是原产物身份，最小化后的 filled replay 用独立 `replayIdentity`；打开时全 page/semantics/resources 校验，并至多一次显式 host 真实 replay。哈希/重放只证明内部一致性，非来源认证、签名或全资源授权；WP1 仍 unsigned/unverified。

[复现与固定字节](../../tests/source-container/README.md) 已有 .NET/Java Reader 提取、真实 Worker 修改并新增“新”后再输出的证据；目标桌面提取 **Not verified**。补证使用 [initial/edited 文件 manifest](../../tests/runtime-matrix/evidence/2026-09-28/readers/source-attachment/manifest.json)，记录实际版本/OS、提取操作、附件 MIME/大小/SHA-256 与 parts 校验。若工具不能提取，先记录功能缺口，再决定不同容器结构或可接受的接收工具，不伪造通过。

## 图片政策

[ADR-0003](ADR-0003-media-core-profile.md) 的 PNG/JPEG-only 与 GIF/BMP/TIFF `UNSUPPORTED_FEATURE` 继续有效；本票不新增纯 JS 规范化解码器，也不把 file-header 识别当成解码成功。APNG、非默认 EXIF、PNG/JPEG 的其他变体以 [writer profile](ADR-0008-wp0-writer-profiles.md) 的更窄交集准入。需要 GIF/BMP/TIFF 的业务模板先列缺口，单独实现/验证规范化的帧选择、色彩/透明度、尺寸和内存预算，再版本化扩展；不能静默取首帧或换格式后宣称无损。

**结论：** 已实现资源/媒体规则可沿用，生产字体、源附件单/多结构与原生可回编辑分发 profile 冻结受阻；不更改 ADR-0005 和 issue17 的未完成状态。
