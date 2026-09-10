# 34: 全量 corpus 运行与首版证据包

**What to build:** 评审人得到"报表替代候选版本"的完整证据：golden corpus（库级 + 业务基线）全部经 API 渲染，DOCX 功能迁移验收包八族用例（路径与作用域、条件与重复、叙述文本、格式、图片、条码、迁移结构/样式、分发）逐条有结果；IR diff、阅读器截图、性能数据、能力矩阵与 `Not verified` 清单汇总在 dated Audit 中；未通过能力的模板被明确阻止切换。

**Blocked by:** 27 其余六种条码 capability profile, 29 工作台：校验面板、版本化发布、Editor SDK, 30 受限 DOCX 导入器 + 差分参照工具, 31 容器源提取 API 与分发 profile, 32 安全加固与负向语料, 33 .NET 调用 SDK 与部署镜像

**Status:** ready-for-agent

- [ ] corpus 全部用例经 `POST /v1/renders` 产出 OFD + PDF；文本抽取、IR 摘要、Semantic Map 与预期语义比对通过；不少于 30 个基础/边界用例且完整映射 15 个旧测试方法
- [ ] §7.5 八族验收包每条记录 `legacyCommit / templateId / dataDigest / expectedSemantic / allowedDifferences / nativeProfile / result`
- [ ] 零容忍项检查：丢字、漏行、重复业务记录、缺字静默替代、无告警位图降级均为零
- [ ] 阅读器矩阵与性能数据更新为发布版本；`Not verified` 项列出
- [ ] 能力矩阵（图元、字体类型、码制、图片格式、后端、profile）随能力发现接口一致
- [ ] 至少一份用工作台从零重建的首批目标模板经 API 渲染通过
- [ ] Audit 文档链接全部证据；spec 状态更新为"WP1 完成待业务试点"
