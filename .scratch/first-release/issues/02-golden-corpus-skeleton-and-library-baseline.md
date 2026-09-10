# 02: Golden corpus 骨架与库级基线转录

**What to build:** 评审人能在仓库中看到一个结构固定的 golden corpus：每个用例有输入数据、预期语义（最终文本、行组、顺序、极值项、格式、媒体）与元数据；NDocxTemplater 的 15 个 DOCX 测试方法与示例 01–12 的场景已逐条转录为库级基线用例，并与业务基线分层标记。用例暂不可执行，但格式已冻结，后续票以它们为验收输入。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-human

- [x] 用例 manifest schema 包含 `legacyCommit / templateId / dataDigest / expectedSemantic / allowedDifferences / nativeProfile / result / tier(library|business)` 字段，并有 schema 校验测试
- [x] 15 个测试方法各对应至少一个用例；示例 01–12 的场景全部覆盖；每个用例注明来源（测试方法名或示例编号）与固定提交 `9c02f26d`
- [x] 预期语义以文本/结构文件表达（叙述句最终文本、表格行组内容与顺序、条件块显隐、图片尺寸与顺序、条码值与码制），不以 Word 分页或像素为预期
- [x] 旧测试中"含深色像素"类断言被替换为解码值断言并标注"本版补建"
- [x] 业务基线目录存在但为空，README 说明需宿主提供脱敏模板/数据/旧输出，且禁止真实个人信息
- [x] 一个 corpus 加载器测试能枚举全部用例并校验 manifest

## Comments

**2026-09-10 (agent) 实现说明：**

- 位置：`tests/golden-corpus/`（pnpm 包 `@ofd-compose/golden-corpus`）。schema 在 `schemas/golden-corpus/`：`case-manifest.schema.json`（additionalProperties:false，格式冻结）与 `case-semantics.schema.json`。
- 规模：28 个用例 = 16 个测试方法用例（`library/docx-tests/`；`Render_EvaluatesConditionalBlocks` 拆为 shown/hidden 两个数据变体，共享 templateId）+ 12 个示例用例（`library/examples/`，各含字节级复制的旧 `template.docx`）。
- 保真：全部预期文本/表格/尺寸/条码值与参考实现（`DocxTemplateEngineTests.cs` 及各 `output.docx` 的 document.xml）逐条核对；示例 11 的 110,990 字符 data URI 程序化重建并验证解码后与 `chart.png` 字节一致。
- 像素断言替换：3 个条码用例（tests 13/14 + example 12）的语义以 `symbology + value + assertion:"decode-value"` 表达，manifest `notes` 标注「本版补建」，UPC-A→EAN13 规范化记录 `encodedValue`/`normalizationPolicy`；`allowedDifferences` 使用 README 词汇表（如 `pixel-assertion-rebuilt`、`split-run-flattening`、`cwd-relative-path`）。
- `dataDigest` = data.json 字节 SHA-256，加载器逐用例复算校验（含临时语料的漂移负向测试）。
- 业务基线 `business/` 仅有 README；加载器测试断言其为空。
- 转录中对旧行为的两处忠实记录：图片尺寸为 legacy px @96dpi（`nativeProfile.legacyPixelDpi=96`）；旧路径解析为 CWD 相对（用例内改为 `assets/` 相对路径并记 `cwd-relative-path`）。
