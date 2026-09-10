# 17: 源附件协议与回编辑 round-trip（WP0.8）

**What to build:** 原生可回编辑 profile 的 OFD 携带 `ofd-compose` 命名空间的 manifest、最小化 ResolvedDocument、资源清单与 Semantic Map；平台能从文件中提取并按"协议 → 大小 → schema → 摘要 → 资源完整性 → 版本 → 签名状态"顺序校验；重新打开后修改文字、插入原子集不含的字符、再次导出成功，且新修订身份不同于原文件。

**Blocked by:** 15 OfdIrWriter

**Status:** ready-for-agent

- [ ] manifest 内容：协议版本、各部分摘要、`modelVersion/irVersion/containerProfileVersion`、能力、来源；JSON MIME `application/json`
- [ ] 单附件包 vs 多附件：用 ofdrw.net 与至少一个目标阅读器做提取验证后决定并记录（供 WP0.10）
- [ ] 源最小化：不含整份输入 JSON、未使用字段、调试信息、令牌、凭证；有测试断言
- [ ] 提取与校验顺序实现；伪造附件名、篡改摘要、缺资源分别返回可辨识状态；自计算哈希只报告"内部一致"
- [ ] round-trip：提取 → 加载 ResolvedDocument → 修改文字 → 插入子集外新字符（需完整字体身份可取回）→ render → 新 OFD；新 revisionId 与摘要不同，旧文件字节不变
- [ ] 非回编辑分发 profile 的最小实现：不带编辑源，manifest 声明为派生物
- [ ] 签名状态字段在 WP1 固定为"未签/未验证"，接口边界记录
