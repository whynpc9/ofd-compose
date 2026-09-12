# 06: Typography Core（WP0.4）

**What to build:** 排版内核可以按内容摘要加载锁定的字体文件，对中文、拉丁、数字、符号、组合字符与粗斜体文本做整形与度量，得到 glyph ID、advance、offset、cluster 映射与 UAX #14 断行机会；缺字返回 `GLYPH_MISSING` 而不回退系统字体；同一套测试在 Node 与浏览器中给出相同结果。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-agent

- [x] 字体资源按 SHA-256 锁定并随 OFL 许可文本入库：Noto Sans CJK SC 静态字重（主候选）与一个 TrueType 轮廓备选；家族名不是身份
- [x] harfbuzzjs 整形：输出 glyph ID、位置/advance/offset、cluster；记录 `-DHB_TINY` 精简构建缺失的 API（若有）及应对方案
- [x] fontkit 提供 OS/2、hhea、head、name 度量；字形选择只由 HarfBuzz 决定
- [x] `@cto.af/linebreak` 提供候选断点；接口暴露 Unicode/HarfBuzz/linebreak 版本组成 `shapingAndLineBreakVersions`
- [x] 真实粗体/斜体与合成样式策略显式声明
- [x] 测试覆盖：中文扩展字、英文、数字、符号、组合字符、粗斜体、缺字、同名不同字节字体
- [x] 同一测试集在 Vitest node 与 browser 模式下结果逐字节一致

## Comments

### 2026-09-12 — 实现与验证

- `packages/typography-core` 已实现按完整 SHA-256 加载静态 CFF/TTF、fontkit 四表度量、HarfBuzz glyph/advance/offset/UTF-16 cluster、Unicode 17 UAX #14 候选断点；样式必须匹配真实字体，禁合成与隐式回退。
- 5 份完整字体和 OFL 文本入库，记录固定上游提交、文件及许可摘要；WASM 字节摘要也有独立校验。
- 新增 Node 21 项、Chromium 19 项测试通过；11 组完整整形输出逐字节对照同一基准，另有四表度量、独立 cluster/断点/缺字/身份/样式验证。全仓绕过 Turbo 缓存的 typecheck、Node 235 项、browser 44 项通过。
- HB_TINY 核查、资源生命周期、浏览器打包说明和剩余 WP0.9 互操作范围见 [Typography Core README](../../../packages/typography-core/README.md)。
- 当前是实现完成待 PR review 收尾，尚未合并。
