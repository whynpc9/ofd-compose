# 01: 仓库脚手架与工程门禁

**What to build:** 开发者克隆仓库后，一条命令即可安装依赖并运行 TypeScript 与 .NET 各一个冒烟测试；CI 在 Linux 上跑通同样的流程，并在依赖许可不在白名单、锁文件缺失或 Core 包引用 DOM/`Intl` 时失败。这是后续所有票的地基（prefactor）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [x] pnpm workspaces + Turborepo 的 monorepo，按 spec 模块划分预留 `packages/`、`apps/`、`dotnet/`、`tools/`、`schemas/`、`tests/` 顶层目录（空包可只含 README）
- [x] Node 24 LTS 与 .NET 10 SDK 版本被锁定（`.nvmrc`/`engines`、`global.json`），锁文件入库
- [x] Biome 配置就位，且有一条 lint 规则禁止 `layout-core`、`binding-core`、`typography-core` 引用 DOM 全局对象与 `Intl`
- [x] Vitest 配置支持 node 与 browser（Playwright provider）两种模式，各跑通一个冒烟测试
- [x] xUnit v3 解决方案跑通一个冒烟测试
- [x] CI 工作流：安装、lint、TS 测试（双模式）、.NET 测试、许可白名单检查（MIT/Apache-2.0/BSD/OFL/Unlicense 之外报错）
- [x] README 说明本地运行方式；`git init` 完成且初始提交包含现有 docs 与 `.scratch`

## Comments

**2026-09-10 (agent) 实现说明：**

- 布局：`packages/`（binding-core / layout-core / typography-core 为真实最小包，其余 README 占位）、`apps/designer`、`dotnet/{src,tools,tests}`、`tools/license-check`、`schemas/`、`tests/{smoke,gates}`。
- 版本锁定：Node `>=24 <25`（`.nvmrc` + `engines` + `.npmrc engine-strict`）、pnpm 11.20.0（`packageManager`）、.NET SDK 10.0.302 latestPatch（`global.json`）；`pnpm-lock.yaml` 与各项目 `packages.lock.json` 入库；NuGet 版本经 CPM（`dotnet/Directory.Packages.props`）固定。
- DOM/`Intl` 禁令：Biome `style/noRestrictedGlobals`（Biome 2.5 中该规则在 style 组、选项为 `deniedGlobals` 映射）按路径 override 作用于三个 Core 包；`tests/gates/` 有门禁测试在临时目录实测四个场景（Intl 命中三包 / DOM 命中 / 干净代码通过 / 非 Core 路径不命中）。
- Vitest 5：browser provider 已改为工厂函数形式（`@vitest/browser-playwright` 的 `playwright()`），本地以真实 chromium headless shell 跑通。
- xUnit：v3 包 4.0.0 + .NET 10 MTP runner（`global.json` 的 `test.runner`），`dotnet test` 通过。
- **许可白名单的落地解释（需评审确认）**：严格按字面执行时 vitest 树中的 ISC（picocolors/flatted/siginfo）与 tsdown 树中的 MPL-2.0（lightningcss）必然失败。落地为：生产依赖零例外严格白名单；开发工具链允许 `tools/license-check/dev-exceptions.json` 中逐包具名例外（当前 4 条，均不进入发布产物）。
- **偏离 ADR-0001 的点（需评审）**：ADR 指定 NuGet 侧用 `dotnet-project-licenses`；实测 2.7.1 稳定版与 3.0.0-alpha.9 均无法在 net10.0 + CPM + slnx 下枚举项目，NuGet 侧改由 `check-licenses.mjs` 直接解析 `project.assets.json` + nuspec 元数据，语义等价。详见 `tools/license-check/README.md`。
- `Date.toLocale*` 禁令（ADR-0001 §B）：Biome 2.5 无成员级内置规则，以 GritQL 插件 `tools/biome-plugins/no-date-tolocale.grit` 实现（按路径限定三个 Core 包；`tests/gates/` 有正/负向门禁测试）。【2026-09-10 code-review 后补齐】
