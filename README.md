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
- [Document link metadata](docs/GOVERNANCE-LINK-METADATA.md) — stable IDs, relations and wikilinks
- [ADR / FR / phase templates](docs/templates/) — copy a `.md.template`, replace placeholders, then run `npm run govern`
- [Document crosslinks and backlinks](docs/DOCUMENT-LINKS.md) — generated navigation

## GenesisRAG17 documentation

The isolated 17-stage ingestion pipeline has its own [specification](docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md),
[execution flow and extension map](docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md),
[wire contract](docs/plans/GENESISRAG17-CONTRACT.md) and
[acceptance evidence](.brain/reports/GENESISRAG17-ACCEPTANCE.md).
Start with the extension map to choose the stage and owning repo for a new feature.
It distinguishes the implemented synthetic test profile from the broader product target;
production deployment remains a separate task.

## Planning import contracts

Project Manager keeps one canonical per-Project intake contract:
[`PlanEnvelope`](apps/server/contracts/plan-envelope.schema.json). Human form, Excel,
Agent/API/MCP and pasted JSON all converge on the same validation → dry-run →
confirm → commit path.

For a self-contained programme artifact containing Business Roadmap/Horizons,
Goals and multiple Projects, use
[`ExecutionPlanBundle`](apps/server/contracts/execution-plan-bundle.schema.json). The bundle
is an orchestration package above PlanEnvelope, not a replacement writer and not
an alias for `WorkContainer`; see
[ADR-049](docs/decisions/ADR-049-EXECUTION-PLAN-BUNDLE-IMPORT-ORCHESTRATION.md)
and the
[ExecutionPlanBundle design contract](docs/domains/project-manager/EXECUTION-PLAN-BUNDLE.md).

## Monorepo layout and installation

`apps/server` contains the web/API application; `apps/edge` contains the optional
device runtime. Root `docs/` remains canonical. Both apps retain independent
lockfiles, installation, build and release boundaries. See
[snapshot execution](docs/migrations/monorepo/EXECUTION.md).

```bash
npm --prefix apps/server ci   # Node 22
npm --prefix apps/edge ci     # Node 24; also needed for cross-app contract tests
npm run edge:test
npm run edge:typecheck
npm run edge:build
npm run govern
```

## Toolchain

```bash
npm run dev            # dev server
npm run build          # production build — must stay clean
npm test               # Vitest (each run gets its own SQLite database)
npm run test:e2e       # Playwright on :3100
npm run docs:graph     # rebuild the doc graph — run after any doc/route/model change
npm run docs:preflight # doc health checks
npm run docs:check     # CI guard: fails if the committed graph is stale
npm run docs:llms      # rebuild llms-full.txt — run after editing README/CLAUDE/AGENTS/PRODUCT or a charter
```

A change is not done until tests pass, the build is clean, and
`docs:graph` + `docs:preflight` are green — see CLAUDE.md.

## Deployment (Docker Compose + ngrok)

```bash
cd apps/server
cp .env.example .env   # fill DATABASE_URL, ZURI_SESSION_SECRET, NGROK_AUTHTOKEN, NGROK_DOMAIN
docker compose up -d --build
docker compose ps      # web healthy, ngrok running
```

Public URL: `https://<NGROK_DOMAIN>`; LINE webhook seam:
`https://<NGROK_DOMAIN>/api/agent/line-webhook`. Full guide, verification steps
and the VPS migration path: [docs/deployment/docker-ngrok.md](docs/deployment/docker-ngrok.md)
([ADR-058](docs/decisions/ADR-058-DOCKER-COMPOSE-AND-NGROK-REPLACE-VERCEL.md)).
Vercel is no longer a deployment dependency.
