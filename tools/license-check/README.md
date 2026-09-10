# license-check

许可白名单门禁（issue 01 / ADR-0001 原则 3）。一条命令覆盖两个生态：

```bash
pnpm check:licenses
```

- `allowed-licenses.json`：白名单（SPDX 许可 ID 数组）。当前集合：MIT / Apache-2.0 / BSD（含 0BSD 与各 Clause 变体）/ OFL / Unlicense。修改此文件等同于修改供应链政策，需在 PR 中显式评审。
- `dev-exceptions.json`：仅限开发工具链的逐包例外（不进入任何发布产物）。**生产依赖不允许例外。**
- `check-licenses.mjs` 三层检查：
  1. pnpm 生产依赖（`pnpm licenses list --prod`）：严格白名单，无例外；
  2. pnpm 开发依赖（`--dev`）：白名单 + `dev-exceptions.json` 具名例外；例外失效会告警；
  3. NuGet 依赖：读取 `dotnet/**/obj/project.assets.json` + 本地 nuspec 元数据（需先 `dotnet restore`），严格白名单；仅声明 license 文件而无表达式的包需人工核查。

  复合 SPDX 表达式按运算符优先级解析（括号分组、AND 优先于 OR；`X WITH exception` 视为整体），无法解析的表达式一律判为不允许（fail closed）。

> ADR-0001 备注：ADR 提到 NuGet 侧用 `dotnet-project-licenses`；该工具（2.7.1 稳定版与 3.0.0-alpha.9）在本仓库的 net10.0 + CPM + slnx 环境下无法枚举项目（已实测），故 NuGet 侧由本脚本以 `project.assets.json` 实现同等语义。若将来该工具可用，可在 ADR 修订中换回。
