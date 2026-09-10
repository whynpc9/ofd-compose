# 06: Typography Core（WP0.4）

**What to build:** 排版内核可以按内容摘要加载锁定的字体文件，对中文、拉丁、数字、符号、组合字符与粗斜体文本做整形与度量，得到 glyph ID、advance、offset、cluster 映射与 UAX #14 断行机会；缺字返回 `GLYPH_MISSING` 而不回退系统字体；同一套测试在 Node 与浏览器中给出相同结果。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-agent

- [ ] 字体资源按 SHA-256 锁定并随 OFL 许可文本入库：Noto Sans CJK SC 静态字重（主候选）与一个 TrueType 轮廓备选；家族名不是身份
- [ ] harfbuzzjs 整形：输出 glyph ID、位置/advance/offset、cluster；记录 `-DHB_TINY` 精简构建缺失的 API（若有）及应对方案
- [ ] fontkit 提供 OS/2、hhea、head、name 度量；字形选择只由 HarfBuzz 决定
- [ ] `@cto.af/linebreak` 提供候选断点；接口暴露 Unicode/HarfBuzz/linebreak 版本组成 `shapingAndLineBreakVersions`
- [ ] 真实粗体/斜体与合成样式策略显式声明
- [ ] 测试覆盖：中文扩展字、英文、数字、符号、组合字符、粗斜体、缺字、同名不同字节字体
- [ ] 同一测试集在 Vitest node 与 browser 模式下结果逐字节一致
