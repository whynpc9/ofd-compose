# OFD Compose（元版）

原生文档排版平台：结构化模板 → 绑定数据 → 确定性排版 → 直接输出矢量 OFD/PDF。详见 `.scratch/first-release/spec.md` 与 `docs/decisions/`。

## 仓库布局与命令

Monorepo：pnpm workspaces + Turborepo。顶层：`packages/`（TS 双端内核）、`apps/`、`dotnet/`（.NET 10 解决方案 `OFDCompose.slnx`）、`tools/`、`schemas/`（JSON Schema 契约产物）、`tests/`（冒烟/门禁测试、golden corpus）。

常用命令：`pnpm lint`（Biome，含 Core 包禁 DOM/`Intl` 规则）、`pnpm typecheck`、`pnpm build`、`pnpm test`（Vitest node）、`pnpm test:browser`（Playwright provider）、`pnpm test:dotnet`（xUnit v3）、`pnpm check:licenses`（pnpm+NuGet 许可白名单）。版本锁定：`.nvmrc`/`engines`、`global.json`、`Directory.Packages.props`、`pnpm-lock.yaml` 与 `packages.lock.json` 入库。

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature-slug>/` (no git remote yet). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus ADRs in `docs/decisions/`. See `docs/agents/domain.md`.
