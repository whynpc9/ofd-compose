# 28: 工作台：媒体配置

**What to build:** 模板作者插入 ImageBinding（单图/列表、data URI / base64 / 宿主授权资源引用），设置宽高、最大边界、缩放、保持比例与版式（独立/居中/列表）；插入 BarcodeBinding，从已验收码制中选择类型，设置物理尺寸、静区、pure、人眼标签政策；预览使用同一 Media Core 生成的几何，不本地另生成。

**Blocked by:** 25 工作台：表达式构建器, 27 其余六种条码 capability profile

**Status:** ready-for-agent

- [ ] ImageBinding 面板：数据源表达式、尺寸规则、版式、授权资源引用输入（不接受任意路径/URL）
- [ ] BarcodeBinding 面板：码制下拉只列 capability profile 中已通过类型；尺寸/静区/pure/标签政策
- [ ] 预览：图片与条码几何来自共享 Media Core；条码值无效时节点高亮 `BARCODE_VALUE_INVALID`
- [ ] 循环内媒体（列表图片、行组内条码）预览正确
- [ ] round-trip 无损；Editor Adapter 支持清单扩展
