# 21: .NET API + Job Host

**What to build:** 宿主开发者通过 HTTP 调用 `GET /v1/capabilities`、`POST /v1/templates/validate`、`POST /v1/previews`、`POST /v1/renders`、`POST /v1/finalizations`，提交模板 + 数据 + 内容寻址资源包 + profile，得到结果 manifest 与 OFD/PDF 产物、IR 摘要、Semantic Map 与诊断。Job Host 管理 Node Worker 子进程池，实现超时、取消、资源预算、幂等与日志脱敏。这是 seam 3。

**Blocked by:** 15 OfdIrWriter, 16 PdfIrWriter, 20 v1 契约冻结

**Status:** ready-for-agent

- [ ] 五个接口的 OpenAPI 描述与 schema 校验；有界同步请求
- [ ] Worker 子进程池：JSON-RPC 2.0 over stdio（NDJSON），大对象经内容寻址 spool；超时 kill；池大小与堆上限可配
- [ ] 渲染请求要求的格式全部成功才整体成功；部分产物作为诊断返回
- [ ] 幂等身份 = 调用方资源作用域 + 输入摘要 + profile + 输出格式；重复请求返回同一结果
- [ ] 定稿接口输入 ResolvedDocument，不重新绑定（测试断言表达式未被再次求值）
- [ ] 预览返回分页摘要、IR 摘要与缩略图，与渲染同规则
- [ ] 能力发现返回引擎/字体包/后端/profile 版本与兼容矩阵
- [ ] 结构化日志脱敏：日志中不出现完整业务数据、ResolvedDocument 或凭证（测试）
- [ ] 契约测试覆盖成功、部分失败、超时/取消、限额、schema 错误
