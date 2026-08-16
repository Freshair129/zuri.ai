# zuri-ai

An AI-native business operating system. LINE is the primary intake surface;
the web app is the back-office console for detail, complex edits and audit.

Scope chain: **Portfolio → Tenant (isolation) → Business → Workspace → Project.**

zuri-ai is a standalone product
([ADR-024](docs/decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)) — it is
not a version of, and shares nothing with, the legacy zuri project.

## Start here

- [CLAUDE.md](CLAUDE.md) — the working guide: layout, toolchain, hard rules
- [AGENTS.md](AGENTS.md) — the full rules for anyone (human or agent) changing this repo
- [docs/PRODUCT.md](docs/PRODUCT.md) — what the product is
- [docs/PRD-SDD-v1.0.md](docs/PRD-SDD-v1.0.md) — the requirement registry (FR/NFR/BR/SEC/SDD)
- [docs/decisions/](docs/decisions/) — ADRs; ADR-024 is the current direction
- [docs/roadmap/](docs/roadmap/) — live delivery state

## Toolchain

```bash
npm run dev            # dev server
npm run build          # production build — must stay clean
npm test               # Vitest (each run gets its own SQLite database)
npm run test:e2e       # Playwright on :3100
npm run docs:graph     # rebuild the doc graph — run after any doc/route/model change
npm run docs:preflight # doc health checks
npm run docs:check     # CI guard: fails if the committed graph is stale
```

A change is not done until tests pass, the build is clean, and
`docs:graph` + `docs:preflight` are green — see CLAUDE.md.
