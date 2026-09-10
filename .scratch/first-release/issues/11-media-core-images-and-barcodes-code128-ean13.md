# 11: Media Core：图片 + 条码（code128 / ean13）

**What to build:** ImageBinding 的图片（data URI / base64 / 宿主授权资源，单图或列表）被解析出尺寸并按"目标尺寸/适配 → scale → 最大边界"规则得到物理尺寸；旧模板以 `legacyPixelDpi=96` 换算。BarcodeBinding 的 code128 与 ean13 由 bwip-js 通过 drawing-context 直接生成 IR 矩形路径（不经 SVG/位图），并冻结几何与生成器版本；独立解码器读回的值等于源值。

**Blocked by:** 08 Layout IR 契约与规范化

**Status:** ready-for-agent

- [ ] 图片尺寸探测（image-size）；PNG/JPEG 为写入器输入格式；GIF/BMP/TIFF 返回 `UNSUPPORTED_FEATURE` 或规范化为 PNG（决定并记录，供 WP0.10）
- [ ] 尺寸规则：`width/height`、`maxWidth/maxHeight`、`scale`、`preserveAspectRatio` 的组合顺序与别名规范化；新模板物理单位、旧模板 `legacyPixelDpi=96`
- [ ] 资源只接受授权字节；任意文件路径/URL 返回 `RESOURCE_FORBIDDEN`；相对路径需显式资源根
- [ ] bwip-js code128 与 ean13：类型、物理尺寸、静区、pure、人眼标签政策；输出 IR 路径矩形与冻结几何、生成器版本
- [ ] `BARCODE_VALUE_INVALID` 对非法值；ean13 校验位校验
- [ ] zxing-wasm 解码测试：从 IR 矩形光栅化后解码值与码制等于声明；物理尺寸断言
- [ ] 同一测试在 Node 与浏览器模式通过
