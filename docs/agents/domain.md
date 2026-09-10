# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (domain glossary). This repo is single-context; there is no `CONTEXT-MAP.md`.
- **`docs/decisions/`**: architecture decision records. This repo uses `docs/decisions/` (per the implementation plan's Appendix B) instead of the skills' default `docs/adr/`. Read ADRs that touch the area you're about to work in.
- Specs live in the issue tracker (`.scratch/<feature>/spec.md`, see `issue-tracker.md`), e.g. `.scratch/first-release/spec.md`.

If `CONTEXT.md` doesn't exist yet, **proceed silently**. Don't flag its absence; don't suggest creating it upfront. The `/domain-modeling` skill (reached via `/grill-with-docs`) creates it lazily when terms actually get resolved. Until then, the vocabulary list in the spec's "补充说明 → 应在 WP0 固化为术语表的词条" is the working glossary.

## File structure

```
/
├── AGENTS.md
├── CONTEXT.md                    ← glossary (created lazily)
├── docs/
│   ├── agents/                   ← this folder: skill configuration
│   └── decisions/                ← ADRs, e.g. ADR-0001-technology-baseline.md
└── .scratch/                     ← local-markdown issue tracker (specs + issues)
```

ADR file naming: `ADR-NNNN-<slug>.md`, four-digit sequence, status line near the top (`Proposed` / `Accepted` / `Superseded by ADR-NNNN`).

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids. Core terms already fixed by the plan and spec: TemplateSource, ResolvedDocument, Layout IR, Semantic Map, LayoutIdentity, RenderProfile / capability profile, ResourcePack, DynamicText, InputControl, ConditionalBlock, RepeatBlock, RepeatRowGroup, ImageBinding, BarcodeBinding, OfdIrWriter, PdfIrWriter, golden corpus, MigrationReport.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (technology baseline), but worth reopening because…_
