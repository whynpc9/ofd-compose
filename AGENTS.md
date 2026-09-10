# OFD Compose（元版）

原生文档排版平台：结构化模板 → 绑定数据 → 确定性排版 → 直接输出矢量 OFD/PDF。详见 `.scratch/first-release/spec.md` 与 `docs/decisions/`。

## Agent skills

### Issue tracker

Issues and specs live as local markdown under `.scratch/<feature-slug>/` (no git remote yet). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root plus ADRs in `docs/decisions/`. See `docs/agents/domain.md`.
