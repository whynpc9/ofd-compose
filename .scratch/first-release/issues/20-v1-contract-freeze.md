# 20: v1 契约冻结

**What to build:** Document Model、bindingPolicy、Layout IR、源附件 manifest 与诊断结构的 v1 JSON Schema 发布到共享 `schemas/`，TypeScript 类型由其派生，.NET 侧用 JsonSchema.Net 对同一 schema 校验；兼容矩阵文档说明 `modelVersion / irVersion / containerProfileVersion / expressionLanguageVersion / bindingPolicyVersion` 之间的关系。此后变更需版本号递增。

**Blocked by:** 19 WP0.10 ADR 集与 Go/No-Go

**Status:** ready-for-agent

- [ ] TypeBox 定义生成 JSON Schema 2020-12 文件并入库；生成脚本在 CI 中校验"已生成文件与源一致"
- [ ] .NET 用 JsonSchema.Net 加载同一 schema 校验请求/产物；TS 与 .NET 对同一组正/负样例结论一致
- [ ] 诊断结构 v1（`code / severity / phase / nodeId / bindingId / dataPath / pageIndex / message`）与错误码枚举
- [ ] 兼容矩阵文档 + 版本递增规则；schema 变更测试要求版本号变化
- [ ] 旧 v0 fixture 迁移到 v1 或标记废弃
- [ ] 冻结逻辑 anchor：文本偏移单位、边界方向、nodeId/重复展开实例身份的区分、table/zone 上下文及 documentRevision 与 Layout/Semantic Map 对应关系；明确编辑器字素索引、UTF-16 与 HarfBuzz cluster 的转换，不能按元素索引恒等映射
- [ ] 依据 35 的验证结果固化源历史关联所需的内部契约与公共边界：historyEntryId/transactionId/sessionId、源快照和映射恢复、undo/redo 后 revision 单调递增；内部编辑器标识不泄漏到宿主/文件公共契约。临时 fixture 迁移有对照测试
