# Zuri v2 Project Manager — Agent Build Pack

A ready-to-run specification pack for a coding agent.

## One-line command to the agent

> Read `00-START-HERE.md` and execute the project autonomously through Phase 07. Do not modify the current Zuri repo. Build `zuri-v2-lab` as an offline-first standalone app and stop only when `docs/ACCEPTANCE-CRITERIA.md` passes or a genuine blocker is documented.

## Important files

- `AGENTS.md` — hard rules
- `MASTER-PROMPT.md` — implementation mandate
- `docs/ADR-001-STANDALONE-ZURI-V2.md` — why new repo
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN-MODEL.md`
- `docs/EXECUTION-MODES.md`
- `docs/schema.local.prisma`
- `contracts/plan-envelope.schema.json`
- `contracts/sample-plan.json`
- `docs/ACCEPTANCE-CRITERIA.md`
- `agent/phases/*`
- `reference/prototype/index.html`

## Offline MVP

Runtime:
- local Next.js
- local SQLite
- no cloud dependency

## Future

After dogfooding, decide:
- integrate as Zuri Project module, or
- promote to Zuri v2 foundation.
