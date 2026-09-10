# 01: 仓库脚手架与工程门禁

**What to build:** 开发者克隆仓库后，一条命令即可安装依赖并运行 TypeScript 与 .NET 各一个冒烟测试；CI 在 Linux 上跑通同样的流程，并在依赖许可不在白名单、锁文件缺失或 Core 包引用 DOM/`Intl` 时失败。这是后续所有票的地基（prefactor）。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] pnpm workspaces + Turborepo 的 monorepo，按 spec 模块划分预留 `packages/`、`apps/`、`dotnet/`、`tools/`、`schemas/`、`tests/` 顶层目录（空包可只含 README）
- [ ] Node 24 LTS 与 .NET 10 SDK 版本被锁定（`.nvmrc`/`engines`、`global.json`），锁文件入库
- [ ] Biome 配置就位，且有一条 lint 规则禁止 `layout-core`、`binding-core`、`typography-core` 引用 DOM 全局对象与 `Intl`
- [ ] Vitest 配置支持 node 与 browser（Playwright provider）两种模式，各跑通一个冒烟测试
- [ ] xUnit v3 解决方案跑通一个冒烟测试
- [ ] CI 工作流：安装、lint、TS 测试（双模式）、.NET 测试、许可白名单检查（MIT/Apache-2.0/BSD/OFL/Unlicense 之外报错）
- [ ] README 说明本地运行方式；`git init` 完成且初始提交包含现有 docs 与 `.scratch`
