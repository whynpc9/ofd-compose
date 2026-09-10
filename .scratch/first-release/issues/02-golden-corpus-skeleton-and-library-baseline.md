# 02: Golden corpus 骨架与库级基线转录

**What to build:** 评审人能在仓库中看到一个结构固定的 golden corpus：每个用例有输入数据、预期语义（最终文本、行组、顺序、极值项、格式、媒体）与元数据；NDocxTemplater 的 15 个 DOCX 测试方法与示例 01–12 的场景已逐条转录为库级基线用例，并与业务基线分层标记。用例暂不可执行，但格式已冻结，后续票以它们为验收输入。

**Blocked by:** 01 仓库脚手架与工程门禁

**Status:** ready-for-agent

- [ ] 用例 manifest schema 包含 `legacyCommit / templateId / dataDigest / expectedSemantic / allowedDifferences / nativeProfile / result / tier(library|business)` 字段，并有 schema 校验测试
- [ ] 15 个测试方法各对应至少一个用例；示例 01–12 的场景全部覆盖；每个用例注明来源（测试方法名或示例编号）与固定提交 `9c02f26d`
- [ ] 预期语义以文本/结构文件表达（叙述句最终文本、表格行组内容与顺序、条件块显隐、图片尺寸与顺序、条码值与码制），不以 Word 分页或像素为预期
- [ ] 旧测试中"含深色像素"类断言被替换为解码值断言并标注"本版补建"
- [ ] 业务基线目录存在但为空，README 说明需宿主提供脱敏模板/数据/旧输出，且禁止真实个人信息
- [ ] 一个 corpus 加载器测试能枚举全部用例并校验 manifest
