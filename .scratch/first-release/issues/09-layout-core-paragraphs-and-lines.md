# 09: Layout Core：段落与行

**What to build:** 自研 Layout Core 把 ResolvedDocument 中的段落（静态文本 + DynamicText 行内序列）排成行：调用 Typography Core 整形，按 UAX #14 候选断点加中文禁则（行首/行尾）决定断行，处理对齐、缩进、段距、行高、Tab 与编号，输出单页 Layout IR 文本对象与 Semantic Map（nodeId/bindingId/来源文本范围）。同一输入在重复运行与双端得到相同 IR 摘要。

**Blocked by:** 05 Binding Core 全部 P0 操作与结构展开, 06 Typography Core, 08 Layout IR 契约与规范化

**Status:** ready-for-human

- [x] 段落、标题、列表（编号）的行内序列整形与断行；DynamicText 与静态文本在同一行、同一次断行
- [x] 中西文混排、标点禁则以字符分类规则实现（行首/行尾各有用例），按词断行，Tab 停靠
- [x] 对齐（左/中/右/两端）、首行/悬挂缩进、段前后距、行高（倍数/固定）
- [x] 文本样式：字号、字重、斜体、下划线、删除线、上下标、颜色、高亮、链接，均落入 IR 文字与路径对象
- [x] 输出 IR 文字对象含原始逻辑文本、显示文本、字体实例、glyph ID、位置/advance、cluster；Semantic Map 含来源范围
- [x] 整形/度量前等待全部字体就绪；异步到达顺序不影响 IR（测试）
- [x] 确定性：重复运行、Node 与浏览器模式 IR 摘要一致；corpus 叙述用例的 IR 文本抽取等于 ResolvedDocument 文本

## Comments

### 2026-09-13 — Paragraph layout implementation

- Branch `codex/issue-09-layout-core-paragraphs` is based on reviewed issue 08 SHA `630bf9927c32971525e14f68cc170f171e0b9a0b`; the PR targets `codex/issue-08-layout-ir` and depends on PR #5. No merge or v0 freeze is implied.
- Added optional paragraph layout and text verticalAlign/link fields; Binding Core preserves layout and explicit DynamicText style inheritance. Shared Layout Core now shapes same-style/script fragments together, applies whole-paragraph UAX #14 plus Chinese opening/closing classes, reshapes candidate lines, and emits one-page text/path IR with exact static font identities.
- Heading/list numbering, left/center/right/justify, first/hanging indent, paragraph spacing, multiple/fixed line heights, left tab stops, real bold/italic, underline/strikeout/highlight/link and script baselines are exercised with locked real fonts. Controls/newlines keep logical text; terminal breaks produce a following empty line.
- Cross-origin `of` + DynamicText `fice` forms a real ligature. Optional ordered `semantic.sourceRanges` maps one cluster to both source identities. Source and object logical ranges are independently UTF-16 checked, repeat chains survive, array order contributes to semanticDigest. Both exported JSON schemas and independent Ajv/validator tests are updated; all existing issue 08 fixture bytes remain unchanged.
- Verification: full uncached repository TypeScript build/typecheck/Node tests passed; latest focused totals Layout Core **14/14**, Layout IR **93/93** (repository aggregate **346**). Full real Chromium run passed, with latest Layout Core **13/13**, IR **82/82** (aggregate **142**). Corpus 08's two committed narrative paragraphs bind and extract exactly; Node `crypto` independently verifies the shared canonical-byte hash. Lint/diff hygiene and license gate passed (23 production pnpm, 85 dev pnpm with four existing exceptions, 20 NuGet).
- Scope remains LTR horizontal P0 paragraphs. Tables/InputControl layout fail explicitly; oversized words, too-small line heights and page overflow fail without truncation or pagination. Full browser/OS matrix, writers/readers, subsetting and page layout remain later issues. See `packages/layout-core/README.md` for defaults and compatibility.
- .NET: locked restore with SDK 10.0.302, single-node build (0 warnings/errors), then MTP `--no-build --no-restore`: **46 passed, 0 failed, 0 skipped** on macOS arm64. The MTP named pipe needed execution outside the filesystem/network sandbox; no product failure was suppressed.
- PR bot review at the final pushed head and CI are still required and will be tracked on the PR; `ready-for-human` records local implementation evidence, not final acceptance.
