# OFD Compose（元版）

原生文档排版平台：结构化模板 → 绑定数据 → 确定性排版 → 直接输出矢量 OFD/PDF。
领域与设计见 `.scratch/first-release/spec.md`、`docs/decisions/ADR-0001-technology-baseline.md`。

## 仓库布局

| 目录 | 内容 |
| --- | --- |
| `packages/` | 共享 TypeScript 包（浏览器与 Node 双端内核；见 spec §2 模块表） |
| `apps/` | 宿主可见应用（模板设计工作台等） |
| `dotnet/` | .NET 10 解决方案：API/Job Host、OfdIrWriter、PdfIrWriter、Containers、Client SDK、离线工具 |
| `tools/` | 仓库级脚本（许可白名单门禁等） |
| `schemas/` | 跨语言 JSON Schema 2020-12 契约产物 |
| `tests/` | 冒烟与门禁测试、golden corpus（issue 02 起） |

## 本地运行

前置条件：

- Node 24 LTS（`.nvmrc` 锁定；用 `nvm use` 或自行安装）
- pnpm（`corepack enable` 后由 `packageManager` 字段锁定版本）
- .NET 10 SDK（`global.json` 锁定版本带）

一条命令安装并跑冒烟测试（含一次性 Playwright chromium 安装，浏览器测试的前置条件）：

```bash
pnpm install && pnpm exec playwright install chromium && pnpm smoke
```

`pnpm smoke` = TS node 模式测试 + TS browser 模式测试 + .NET xUnit v3 测试。
分项命令：

```bash
pnpm lint            # Biome（含 Core 包禁用 DOM/Intl 的规则）
pnpm typecheck       # tsc --noEmit（所有 TS 包）
pnpm build           # tsdown 构建
pnpm test            # Vitest node 模式
pnpm test:browser    # Vitest browser 模式（Playwright provider, chromium）
pnpm test:dotnet     # dotnet test（xUnit v3）
pnpm check:licenses  # 许可白名单（pnpm 与 NuGet 两侧，见 tools/license-check/README.md）
```

## 工程门禁

CI（`.github/workflows/ci.yml`，Linux）依次执行：锁文件存在性检查、依赖安装（frozen/locked）、Biome lint、TS typecheck、构建、Vitest 双模式、`dotnet test`、pnpm 与 NuGet 许可白名单。
许可白名单为 MIT / Apache-2.0 / BSD / OFL / Unlicense，见 `tools/license-check/`。

## 工程约定速查

- Node 版本：`.nvmrc` + 根 `package.json` 的 `engines`；pnpm 版本：`packageManager`。
- .NET SDK：`global.json`；包版本：`dotnet/Directory.Packages.props`（CPM）；NuGet 锁文件 `packages.lock.json` 入库。
- `binding-core` / `layout-core` / `typography-core` 禁止引用 DOM 全局对象与 `Intl`（Biome `noRestrictedGlobals`，见 `biome.json` overrides；门禁测试在 `tests/gates/`）。
- TS 包 ESM only、strict（`tsconfig.base.json`）；锁文件 `pnpm-lock.yaml` 入库。
