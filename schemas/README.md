# schemas

跨语言契约产物：JSON Schema 2020-12 文件存放于此目录（ADR-0001 §B：TypeBox 定义 → 生成 JSON Schema 存入 `schemas/`；.NET 侧用 JsonSchema.Net 校验）。

- `golden-corpus/`：golden corpus 用例 manifest schema 与预期语义 schema（issue 02 起）。

> 规则：本目录只放冻结/版本化的 schema 产物与其生成来源说明，不放业务数据。
>
> 来源说明：ADR-0001 §B 的目标管线是「TypeBox 定义 → 生成 JSON Schema」。当前 `golden-corpus/` 两个 schema 为**手写**（issue 02 阶段尚无 TypeBox 管线，schema 本身即冻结契约）；引入 TypeBox 后应以其为源重新生成本目录产物，并在 ADR 修订中记录切换点。
