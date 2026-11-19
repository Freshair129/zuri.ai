---
status: implementation-plan
version: "0.1.0"
source_of_truth: false
---

# SmartGift / GoVibe remaining footprint — triage (2026-11-20)

**Authority.** ADR-119 (SmartGift and GoVibe are not part of Zuri) and the owner decisions relayed by
the lead session: keep persisted/operator names (`SMARTGIFT_*` env vars, `mcp__smartgift__*`,
`genesis_smartgift_store_*`, persisted values `SMARTGIFT_CATALOG_V1` / `SMARTGIFT_CATALOG` /
`smartgift-catalog`) and neutralise prose only; data is synthetic; git history is not purged;
re-entry only through the normal import channel; ADR ids and numbers never move (AGENTS.md §18).
This is a **read-only triage**. No file other than this one was changed and no behaviour changed.
It is a plan, not a decision record; the lead gates which category is cleaned next.

**Method.** Content search over tracked files (`git ls-files`, so `node_modules` and `.git` are
excluded by construction), case-insensitive, for `smart[ _-]?gift` and `go[ _-]?vibe`. 468 files
match; 70 of them also mention GoVibe. In the lists, "prose" counts the matching lines that remain
after removing the owner-kept persisted/operator names. A file whose every match is a kept name has
prose 0 and is class A. Classification is path- and pattern-driven plus spot reading of the code
files. B and F were not read line by line, so each cleanup PR must re-read a file before editing it.

## Summary

| Class | Meaning | Files | Action |
|---|---|---:|---|
| A | Must stay: history (ADR, RCA, `.brain`, `.agent`, archive, reports, change-requests, changes), migrations, supabase SQL, files whose only matches are kept names | 213 | none |
| B | Live prose that still describes SmartGift/GoVibe as current (charters, feature notes, requirements, architecture, governance, prompts, Edge top-level docs) | 63 | neutralise in small PRs |
| C | Code, tests, fixtures, config and contracts that still depend on SmartGift | 124 | per-theme decision below |
| D | Generated or pinned-record files | 22 | never hand-edit; regenerate |
| E | `apps/edge/docs` (not generated) | 16 | frozen by ADR-118 D5 |
| F | `docs/plans/*` and `docs/roadmap/*`, flagged by doc governance | 30 | separate PR, lead decision |
| | Total | 468 | |

Two classifications the lead should confirm:

- **Role and binding names are treated as persisted names.** `zuri_line_smartgift_ro`,
  `zuri_line_smartgift_login`, `LINE-SMARTGIFT-OA` and the `TNT-` / `BUS-SMARTGIFT` codes live in
  migrations, migration hashes in `scripts/lib/compact/security.mjs`, probes and tests. They were
  not on the owner's list, but renaming a database role is a data/operator change, not prose.
  Treated as kept.
- **`docs/.id-ledger.json` is class D but `docs:registry` does not regenerate it.** Its only writer is
  `npm run docs:ids` with a named flag and a reason (ADR-039). Its 22 matches are pinned subject
  anchors of ids and must not be reworded without a recorded `--reword`.

## D — generated or pinned (regenerate, never hand-edit)

Regenerate with `npm run docs:registry`, `docs:graph`, `docs:views`, then the full `govern` chain.

| File | Source / generator |
|---|---|
| `docs/PRD-SDD-v1.0.md`, `docs/FEATURES.md` | compatibility exports of the canonical ZAI records (`docs:registry`) |
| `registry/document-registry/{FEATURES.template.md, PRD-SDD-v1.0.template.md, index.json}` | registry source and index; edit through the registry workflow, then `docs:registry` |
| `registry/document-reintegration/{dispositions, documents, identities, mappings, tooling}.json` | reintegration identities and crosswalks; pinned migration records |
| `docs/DATA-PIPELINE-MAP.md`, `docs/DATA-FLOW-ATLAS.html`, `apps/server/runtime/data-pipeline-map.json` | `scripts/data-pipeline-map.mjs` |
| `apps/server/runtime/domain-state.json` | `scripts/domain-state.mjs` |
| `docs/migrations/monorepo/source-manifest.json` | provenance manifest of the monorepo snapshot (ADR-062), 154 matches; a historical inventory |
| `docs/.id-ledger.json` | `docs:ids` only (see above) |
| `apps/edge/docs/{.doc-graph.json, .preflight-report.json}`, `apps/edge/docs/registry/entities/**` | Edge generators; Edge docs are frozen (class E) |

Only the pipeline map, the atlas and the two runtime JSON files can change by editing their inputs.
The registry, reintegration, manifest and ledger records are identity and history records: leave them.

## F — doc-governance flagged roadmap and plan docs (30 files)

AGENTS.md and ADR-118 amendment 3 make *adding* `docs/roadmap/PLAN-*.md` CRITICAL and flag added
documents under `docs/plans/` and `docs/roadmap/`. ADR-117 cancelled the 24-week programme, and
`docs/roadmap/README.md` calls the 24w file a derived projection kept for history, with `ROADMAP.md`
as the live status ledger. Editing these files is allowed, but each is a historical plan, a
projection read by generators (`roadmap-evidence`, `programme-containers`, `roadmap-sot.js`), or the
ledger. They are not safe prose edits and belong in one reviewed PR that the lead decides.

- `docs/roadmap/ROADMAP.md` (53 matches, 50 prose) and `ROADMAP-zuri-ai-24w-program.md` / `.html`
  (54 / 28): task rows carry titles that the generators and `apps/server/src/modules/platform-control/*`
  read. Rewording a title without the matching generator input breaks coverage checks.
- `ROADMAP-business01-smartgift-delivery.md`, `PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.md` and
  `smartgift-project-manager.plan.json` (11 / 29 / 27 matches) are whole-document SmartGift plans, already
  superseded by ADR-119. Candidate: add a superseded notice. Rewriting frontmatter is ADR-118 D5
  territory, so it needs lead sign-off. Deletion is not proposed.
- `docs/plans/SMARTGIFT-BUSINESS-DROP-RUNBOOK-20261120.md` (31 matches) is the current owner runbook.
  Keep unchanged.
- `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md` (26), `GENESISRAG17-CONTRACT.md` and
  `LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md`: live design docs that describe the SmartGift
  catalog as the first structured source. They follow decision C1 below.

## E — `apps/edge/docs` (16 files, frozen)

ADR-118 D5 forbids editing anything under `apps/edge/docs/`. Not touched. The GENESIS-RAG-* docs
(`GENESIS-RAG-ADR`, `-BASELINE`, `-IMPLEMENTATION-PLAN`, `-SPEC`) are among them. Others:
`AGENT-RUNTIME-SPEC`, `ARCHITECTURE`, `COMMAND-AGENT-SPEC`, `DEVLOG-2026-09-06`, `PRD-SDD-v1.0`,
`PRICING-TIMELINE-2026-08`, `ROADMAP-CONVERSATIONAL-AGENT`, `appendices/{B,E,F}`, `model-cards/*`.
`PRD-SDD-v1.0.md`, `appendices/E-risk-matrix.md` and `F-glossary.md` carry the Edge GoVibe mentions.
Any change needs an ADR-118 D5 amendment first.

## C — code, tests, config: themes

Spot reading of `apps/server/src`, `apps/edge/src` and `scripts` puts the remaining code in these
themes.

| # | Theme | Where | Nature | Verdict |
|---|---|---|---|---|
| C1 | Structured catalog adapter and policy (FR-187/188) | `src/modules/knowledge/{structured-catalog-adapter, genesisrag17-structured-record, structured-record-policy, knowledge-admission-service, genesisrag17-source, knowledge-candidate-zero-pii}.js`, `ui/KnowledgeDocumentsView.jsx`, `app/api/knowledge/ingestions/route.js`; tests `structured-catalog-adapter`, `structured-catalog-admission`, `genesisrag17-parser-2`, `knowledge-*zero-pii*`; fixtures `tests/fixtures/genesisrag17/structured-catalog/*` | Live behaviour. FR-187 is withdrawn by ADR-119, yet the adapter still ships. The provider, format, source-prefix and `smartgift-zero-pii-1` policy values are persisted. Error strings and comments say "SmartGift". | **Owner decision:** remove the adapter (behaviour change) or keep it and neutralise only error strings and comments. The prose-only variant is safe. |
| C2 | `@spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913` annotations | `src/app/api/procurement/cost-sheets/*`, `modules/procurement/*`, `modules/inventory/*`, `lib/module-tabs.js`, `prisma/schema*.prisma` | The string is an immutable document id in comments. | **Keep.** Effectively class A. |
| C3 | Platform-control roadmap data | `modules/platform-control/{program-roadmap-containers, program-roadmap-data, program-roadmap-telemetry, roadmap-sot}.js` (about 85 prose matches); tests `domain-state`, `platform-control-route-contract`, `platform/cloud-sot-agent` | Task titles and evidence embedded in code; much is already tagged "historical, superseded by ADR-119". | Belongs with F. Change only together with `ROADMAP.md` and the generator inputs. |
| C4 | Phase-1 runtime role and LINE binding | `modules/agent/{phase1-runtime, line-activation-contract, line-binding-status}.js`, `modules/knowledge/{runtime-isolation-probe, runtime-postgres-config}.js`, `scripts/{probe, provision, run-with}-phase1-runtime-login.*`, `scripts/readonly-supabase-preflight.mjs`, `contracts/phase1-activation/*`, about 25 tests | Persisted DB role names, `LINE-SMARTGIFT-OA` binding code, `TNT-` / `BUS-SMARTGIFT` codes. | **Keep.** The readonly preflight query for `BUS-SMARTGIFT` is the one item for the lead to look at, since that Business is being dropped. |
| C5 | Golden evaluation corpus | `scripts/evaluate-phase1-golden.mjs` reads `contracts/phase1-activation/smartgift-golden-questions.json`; `tests/unit/golden-evaluation.test.js` | The file name carries the product name. | Removable with its test if the pilot is gone (TASK-ZAI-095 is marked superseded). Owner call; behaviour change. |
| C6 | Dev seed | `scripts/seed_real_work_items.mjs` (17 prose matches) | Creates `WS-SMARTGIFT` and `PRJ-SMARTGIFT-CORE` work items in a dev database. | **Removable** candidate (synthetic dev seed). Confirm no test or script imports it first. |
| C7 | Edge source | `apps/edge/src/cards/types.ts` allowlists `smartgift.co.th` hosts; `config/index.ts` reads `SMARTGIFT_*`; comments in `rag/genesis-rag.ts` and `rag/genesisrag17/published-rag.ts` | Env names are kept. The two allowlisted URLs are behaviour; the comments are prose. | URLs: behaviour change, owner call. Comments: prose only. |
| C8 | Single mentions in comments | `modules/project-manager/mcp/transport.js` (6), `backup-service.js`, `views/execution/mode-bodies.jsx`, `platform/integrations/core/*`, `modules/business/application/business-knowledge-candidates-service.js` | Mostly comments naming SmartGift as an example. `mcp__smartgift__*` names are persisted. | Prose-only candidates after reading each. |
| C9 | Tests and fixtures | `tests/unit/fr076-product-owner-business-assignment.test.js` (23), `line-oa-account-domain`, `grounded-business-answer`, `line-channel-binding`, `line-binding-resolver`, `pipeline-tracking-service`, `document-intake-contract`, about 50 more; `tests/postgres/smartgift-drop-migration.test.js` proves the drop | Fixture strings and sample codes. | Renaming fixtures is optional churn; do it only with the code under test. Keep the drop-migration test. |

Other C items: `apps/server/contracts/{line-oa-platform-plan, zuri-v2-dev-plan, zuri-v2-self-plan}.json`
and `phase1-activation/*.schema.json` (plan contracts that name SmartGift as scope; treat as fixtures),
`vitest.ki17.config.js` and `vitest.postgres.config.js` (comment lines), `.env.knowledge.example`,
a `services/scm` inventory comment, and `apps/edge/tests/unit/*` (8 files, persona and fixture strings).

## B — live prose to neutralise (63 files)

Grouped for small PRs. Canonical record sources must go through the canonical workflow and a
`docs:registry` regeneration, because their text feeds class D.

| PR theme | Files |
|---|---|
| B1 feature notes and requirement records (canonical sources) | `docs/features/FEAT-*/{design, feature}.md` and `requirements/FR-*.md` (15), `docs/requirements/*` (8) |
| B2 domain charters and notes | `docs/domains/**` (18); main ones: `knowledge/CHARTER.md`, `knowledge/features/FR-187*`, `FR-188*`, `FR-071*`, `crm/features/FR-078*`, `commerce/features/FR-253*` |
| B3 architecture, governance, product, operations, prompts, runbooks | `docs/architecture/*` (5), `docs/governance/*` (3), `docs/product/README.md`, `docs/operations/README.md`, `docs/prompts/{EXTRACT-MSP.codex, README}.md` (22 prose matches in the first, including the GoVibe prior-art description of MSP), `docs/runbooks/TASK-ZAI-095-LINE-GROUNDING-SWITCH.md` |
| B4 knowledge, DB and appendix docs | `docs/KNOWLEDGE-INGESTION-*` (2), `docs/DB-MIGRATION-NOTES.md`, `docs/appendices/A-api-spec.md`, `apps/server/deploy/ki17/README.md` |
| B5 Edge top-level, outside `docs/` | `apps/edge/{AGENTS, CLAUDE, README}.md`, `apps/edge/skills/zuri-calendar-meeting/SKILL.md` |

**GoVibe.** 70 files. Live mentions: `apps/edge/{AGENTS,README}.md`, `docs/architecture/README.md`,
`docs/change-requests/README.md`, `docs/prompts/*`, `docs/governance/{DOCUMENTATION-REQUIREMENTS-SPEC,
ROOT-FILE-REGISTER}.md`, `docs/domains/agent/features/FR-057*`, `docs/requirements/FR-057.md`,
`docs/features/FEAT-026/design.md`. The rest are history (A), Edge docs (E), platform-control data and
`domain-state.json` (C3, D). ADR-119 describes GoVibe as external prior art whose only live relation
is the MSP protocol, which Zuri uses under its own name.

## Recommended order (the lead decides)

1. **PR-B, prose only:** B3 + B4, then B2, then B1 via the canonical workflow with `docs:registry`,
   `docs:graph`, `docs:views` and the full `govern`. Lowest risk.
2. **PR-C-prose:** error strings and comments in C1, C7 and C8; leave C2 and C4. Targeted tests:
   structured-catalog, genesisrag17-parser-2, knowledge zero-PII, and Edge `headless`, `identity`,
   `conversation`.
3. **Needs a decision before anything else:** (a) C1 remove or keep the adapter; (b) C5 golden corpus
   and C6 seed script removal; (c) C7 allowlisted `smartgift.co.th` hosts; (d) F leave as history, add
   superseded notices, or reword with the generators; (e) E needs an ADR-118 D5 amendment.

## Complete file lists

Numbers in parentheses are total matches; "prose" is the count after removing kept names; "GoVibe"
marks files that also match GoVibe. Class D and E are listed here too.

#### A list (213 files)

- `.agent/reports/PARALLEL-WAVE1-20260831.md` (1, GoVibe)
- `.agent/reports/PARALLEL-WAVE2-REVIEW-20260831.md` (1, GoVibe)
- `.agent/reports/PHASE-1-ACTIVATION-READINESS.md` (1)
- `.agent/reports/PHASE-1-SUPABASE-TENANT-BOOTSTRAP.md` (2)
- `.brain/audits/2026-09-10-line-oa/server-full-tests.log` (4)
- `.brain/plans/task-readiness/DOC-STRUCTURE-RECONCILIATION-20261022.json` (4, GoVibe)
- `.brain/proposals/2026-09-11-genesisrag17-structured-record-profile.md` (17, prose 13)
- `.brain/rca/2026-08-14-business-knowledge-export-hash-newline.md` (1)
- `.brain/rca/2026-08-14-supabase-pooler-runtime-connection-contract-drift.md` (4, prose 1)
- `.brain/rca/2026-08-18-customer-review-runtime-set-role-permission.md` (1)
- `.brain/rca/2026-08-18-smartgift-backfill-apply-timeout.md` (2)
- `.brain/rca/2026-08-18-smartgift-backfill-provenance-indexerror.md` (3, prose 1)
- `.brain/rca/2026-08-28-false-claims-passed-every-green-check.md` (1, GoVibe)
- `.brain/rca/2026-09-08-line-webhook-funnel-502-edge-receiver-not-restarted.md` (1)
- `.brain/rca/2026-09-10-line-oa-branch-audit.md` (2)
- `.brain/rca/2026-09-11-line-server-overlay-dropped-on-redeploy.md` (2)
- `.brain/rca/2026-09-17-console-release-test-fixture-blockers.md` (2)
- `.brain/rca/2026-09-17-knowledge-console-gap.md` (1)
- `.brain/rca/2026-09-17-pricing-catalog-test-queue-isolation.md` (1)
- `.brain/rca/2026-09-17-pricing-ledger-cost-boundary.md` (1)
- `.brain/rca/2026-09-18-task-zai-050-per-record-quality-gate.md` (2)
- `.brain/rca/2026-09-20-ki17-runtime-roots-deleted.md` (1)
- `.brain/rca/2026-09-20-task-zai-053-cost-sheet-doc-drift.md` (1)
- `.brain/rca/2026-09-22-line-runtime-credential-drift.md` (3, prose 1)
- `.brain/rca/2026-09-24-catalog-file-upload-outcome-conflates-knowledge-runtime.md` (2, prose 0)
- `.brain/rca/2026-09-28-zuri-line-oa-silent-since-0914.md` (1)
- `.brain/rca/2026-09-29-watchdog-crash-loop-and-ki17-volume-loss.md` (4)
- `.brain/rca/2026-09-30-second-loss-docker-data-view-changed.md` (1)
- `.brain/rca/RCA-2026-08-14-supabase-pooler-ca-trust.md` (1, prose 0)
- `.brain/rca/evidence/2026-10-05-pm-spec-handoff/dashboard/pm-execution-progress-r8.html` (1, GoVibe)
- `.brain/rca/evidence/2026-10-05-pm-spec-handoff/source/FEATURE-MAP.generated.md` (13, prose 10, GoVibe)
- `.brain/rca/evidence/2026-10-05-pm-spec-handoff/source/FEATURES.md` (7)
- `.brain/rca/evidence/2026-10-05-pm-spec-handoff/source/PRD-SDD-v1.0.md` (33, prose 27, GoVibe)
- `.brain/rca/evidence/2026-10-05-pm-spec-handoff/source/id-ledger.json` (8, prose 7)
- `.brain/reports/2026-09-20-task-zai-001-closeout.md` (5, prose 3)
- `.brain/reports/2026-09-24-genesisrag17-b2-fixture-rehearsal.md` (12, prose 11)
- `.brain/reports/2026-09-24-genesisrag17-production-probe.md` (1)
- `.brain/reports/2026-09-25-genesisrag17-b4-four-process-acceptance-rerun.md` (7)
- `.brain/reports/2026-11-08-astra-d1-decision-ledger.md` (7)
- `.brain/reports/2026-11-08-ki17-native-acceptance.md` (4)
- `.brain/reports/fr252-phase-b/phase-b-local-verification.json` (64, prose 34)
- `.brain/reports/fr252/full-before-fixture-cleanup.log` (10, prose 8)
- `.brain/reports/fr252/full-verified.log` (9, prose 7)
- `.brain/reports/fr252/native-36-passed.log` (9)
- `.brain/reports/fr252/native-computed-final.log` (3)
- `.brain/reports/fr252/native-smartgift-four-process.json` (6, prose 1)
- `.brain/reports/fr252/queue-after.log` (4, prose 3)
- `.brain/reports/fr252/queue-before.log` (3, prose 2)
- `.brain/reports/genesisrag17-pr-full-vitest.json` (1)
- `.brain/reports/genesisrag17-smartgift-four-process.json` (6, prose 1)
- `.brain/reports/zuri-full-vitest.json` (1)
- `.brain/reviews/2026-09-10-architecture-review-four-flows.md` (4, prose 1)
- `.brain/reviews/2026-11-12-architecture-review-domains-and-core-systems.md` (3)
- `apps/edge/.brain/rca/2026-08-22-catalog-db-and-line-direct-message-failures.md` (2, prose 0)
- `apps/edge/.brain/rca/2026-08-24-rca-price-data-loss.md` (1)
- `apps/edge/.brain/rca/2026-09-06-codex-stateless-mcp-isolation.md` (2)
- `apps/edge/.env.example` (1, prose 0)
- `apps/edge/.gitignore` (1, prose 0)
- `apps/edge/src/config/index.ts` (3, prose 0)
- `apps/server/.env.example` (2, prose 0)
- `apps/server/prisma/migrations/20260820221704_add_pipeline_tracking/migration.sql` (1)
- `apps/server/prisma/migrations/20260919090000_supplier_cost_sheet/migration.sql` (1)
- `apps/server/scripts/lib/compact/security.mjs` (6, prose 0)
- `apps/server/scripts/probe-phase1-runtime-login.mjs` (3, prose 0)
- `apps/server/scripts/provision-phase1-runtime-login.mjs` (1, prose 0)
- `apps/server/scripts/provision-phase1-runtime-login.ps1` (1, prose 0)
- `apps/server/scripts/run-with-supabase-runtime.ps1` (1, prose 0)
- `apps/server/src/modules/agent/line-binding-status.js` (1, prose 0)
- `apps/server/src/modules/agent/phase1-runtime.js` (3, prose 0)
- `apps/server/src/modules/knowledge/runtime-isolation-probe.js` (1, prose 0)
- `apps/server/src/modules/knowledge/runtime-postgres-config.js` (1, prose 0)
- `apps/server/src/modules/knowledge/ui/KnowledgeDocumentsView.jsx` (2, prose 0)
- `apps/server/supabase/migrations/20260813213654_production_tenant_bootstrap.sql` (29, prose 9)
- `apps/server/supabase/migrations/20260814023027_controlled_line_activation.sql` (15, prose 3)
- `apps/server/supabase/migrations/20260818040000_phase1_line_runtime_connections.sql` (15, prose 0)
- `apps/server/supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql` (3, prose 0)
- `apps/server/supabase/migrations/20260818060000_customer_wannapa_identity_and_smartgift_cutover.sql` (16, prose 10)
- `apps/server/supabase/migrations/20260818070000_customer_profile_backfill_schema.sql` (2)
- `apps/server/supabase/migrations/20260818071000_platform_approver_profile.sql` (1)
- `apps/server/supabase/migrations/20260818073000_customer_import_review_queue.sql` (3, prose 1)
- `apps/server/supabase/migrations/20260818084047_application_smartgift_identity.sql` (3)
- `apps/server/supabase/migrations/20260820212547_smartgift_document_intake_connection.sql` (15, prose 8)
- `apps/server/supabase/migrations/20260820221703_smartgift_pipeline_tracking.sql` (2)
- `apps/server/supabase/migrations/20260914150550_knowledge_candidates_business_toggle.sql` (3)
- `apps/server/supabase/migrations/20260919090000_supplier_cost_sheet.sql` (1)
- `apps/server/supabase/migrations/20261120000000_drop_smartgift_business_data.sql` (20, prose 5)
- `apps/server/supabase/tests/business_knowledge_import_verification.sql` (3, prose 0)
- `apps/server/supabase/tests/production_import_post_apply_inventory.sql` (1)
- `apps/server/supabase/tests/production_post_apply_inventory.sql` (9, prose 1)
- `apps/server/supabase/tests/production_tenant_isolation.sql` (6, prose 3)
- `apps/server/tests/acceptance/genesisrag17-e2e.test.js` (1, prose 0)
- `apps/server/tests/fixtures/genesisrag17/structured-catalog/README.md` (2, prose 0)
- `apps/server/tests/fixtures/genesisrag17/structured-catalog/manifest.json` (2, prose 0)
- `apps/server/tests/helpers/fr054-postgres-target-guard.js` (1, prose 0)
- `apps/server/tests/helpers/fr055-postgres-target-guard.js` (7, prose 0)
- `apps/server/tests/integration/genesisrag17-tier1-knowledge-admission-zero-pii.test.js` (1, prose 0)
- `apps/server/tests/integration/runtime-isolation-probe.postgres.test.js` (3, prose 0)
- `apps/server/tests/unit/application-identity-bootstrap-migration.test.js` (1, prose 0)
- `apps/server/tests/unit/business-model-credential-resolution.test.js` (1, prose 0)
- `apps/server/tests/unit/fr079-runtime-cutover.test.js` (3, prose 0)
- `apps/server/tests/unit/fr079-supabase-migration.test.js` (2, prose 0)
- `apps/server/tests/unit/fr080-runtime-wiring.test.js` (2, prose 0)
- `apps/server/tests/unit/fr080-supabase-vault.test.js` (2, prose 0)
- `apps/server/tests/unit/fr253-pricing-catalog-storage.test.js` (1, prose 0)
- `apps/server/tests/unit/knowledge-replay-service.test.js` (1, prose 0)
- `apps/server/tests/unit/line-binding-activation-cli.test.js` (1, prose 0)
- `apps/server/tests/unit/phase1-runtime-login-probe.test.js` (3, prose 0)
- `apps/server/tests/unit/platform/pipeline-tracking-migration.test.js` (1, prose 0)
- `apps/server/tests/unit/runtime-isolation-probe.test.js` (5, prose 0)
- `apps/server/tests/unit/runtime-postgres-config.test.js` (5, prose 0)
- `apps/server/tests/unit/server-line-answer.test.js` (1, prose 0)
- `docs/appendices/B-db-schema.md` (2, prose 0)
- `docs/archive/HANDOFF-SHELL-V2-CODEX.md` (1, GoVibe)
- `docs/archive/PARALLEL-EXECUTION-PLAN.md` (3, GoVibe)
- `docs/archive/README-zuri-v2-lab.md` (1)
- `docs/archive/hardware-performance-audit.md` (2)
- `docs/archive/rwang-tasks/fr053-w1-brief.md` (1)
- `docs/archive/rwang-tasks/fr055-w1a-contracts-brief.md` (1)
- `docs/archive/rwang-tasks/fr055-w1a-contracts-report.md` (2)
- `docs/archive/rwang-tasks/fr055-w1b-migration-brief.md` (1)
- `docs/archive/rwang-tasks/fr055-w1b-migration-report.md` (2)
- `docs/archive/rwang-tasks/fr057-api010-report.md` (2, GoVibe)
- `docs/archive/rwang-tasks/parity-audit.md` (1)
- `docs/archive/rwang-tasks/parity-gaps.md` (2)
- `docs/archive/rwang-tasks/phase1-a1-golden-brief.md` (1)
- `docs/archive/rwang-tasks/phase1-a1-golden-report.md` (2)
- `docs/archive/rwang-tasks/phase1-a2-isolation-report.md` (2, prose 0)
- `docs/archive/rwang-tasks/phase1-a3-canary-report.md` (6)
- `docs/change-requests/CR-002-GKS-MSP-CATALOG-VAULT-RESOLUTION.md` (7, prose 6)
- `docs/change-requests/CR-003-ACCEPTED-SHAPE.md` (1, prose 0)
- `docs/change-requests/CR-003-DATA-PIPELINE-GOVERNANCE-AND-APPROVAL-GATES.md` (2)
- `docs/change-requests/CR-004-ACCEPTED-SHAPE.md` (1)
- `docs/change-requests/CR-004-GITHUB-INTEGRATION-AND-FILES-TAB-EXPLORER.md` (3)
- `docs/change-requests/CR-005-ACCEPTED-SHAPE.md` (3, prose 1)
- `docs/change-requests/CR-005-SHIPPING-RATE-MATRIX-AND-OMNICHANNEL-AGENT-CONNECTORS.md` (3, prose 2)
- `docs/change-requests/CR-019-24W-PROGRAMME-DELIVERABLE-11-ERP-BUSINESS-MODULES.md` (2)
- `docs/change-requests/README.md` (3, GoVibe)
- `docs/change-requests/ZAI-PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913.md` (15, prose 14)
- `docs/change-requests/integration/line-customer-product-disclosure-20261024.md` (1)
- `docs/change-requests/integration/line-customer-product-metadata-disclosure-20261024.md` (7, prose 1)
- `docs/change-requests/knowledge/genesisrag17-implementation-20261023.md` (1)
- `docs/change-requests/knowledge/genesisrag17-ownership-reliability-20261023.md` (2)
- `docs/change-requests/knowledge/ki17-status-reconciliation-20261108.md` (8)
- `docs/change-requests/knowledge/smartgift-fr187-withdrawal-20261115.md` (6, GoVibe)
- `docs/change-requests/marketing/MARKETING-NAVIGATION-VIEWS.md` (1)
- `docs/change-requests/marketing/mockups/app.js` (9)
- `docs/change-requests/marketing/mockups/index.html` (1)
- `docs/changes/ZV2-CR-003-LINE-BUSINESS-KNOWLEDGE-PILOT.md` (3)
- `docs/changes/ZV2-CR-004-SUPABASE-PRODUCTION-TENANT-BOOTSTRAP.md` (3)
- `docs/changes/ZV2-CR-008-AGENT-VAULT-EPISTEMIC-MEMORY.md` (1, GoVibe)
- `docs/changes/artifacts/ZV2-CR-001-w0-filesystem-inventory.json` (36)
- `docs/decisions/ADR-007-LINE-AI-STACK-SEQUENCING.md` (11, GoVibe)
- `docs/decisions/ADR-009-SELF-GOVERNANCE-LINEAGE-AND-IR-BOUNDARY.md` (12, GoVibe)
- `docs/decisions/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md` (15, prose 10)
- `docs/decisions/ADR-022-MULTI-TENANT-MSP-VAULTS.md` (1, GoVibe)
- `docs/decisions/ADR-023-AGENT-VAULT-AND-EPISTEMIC-MEMORY.md` (5, GoVibe)
- `docs/decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md` (1, GoVibe)
- `docs/decisions/ADR-028-HUMAN-VISIBLE-EXECUTION-ROADMAP.md` (3, GoVibe)
- `docs/decisions/ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md` (1)
- `docs/decisions/ADR-032-INTEGRATION-SECRET-MANAGEMENT-UI.md` (2, prose 0)
- `docs/decisions/ADR-033-CUSTOMER-SCOPE-AND-PRODUCT-OWNER-AUTHORITY.md` (15)
- `docs/decisions/ADR-040-CODEX-MEDIATED-SMARTGIFT-PIPELINE-BRIDGE.md` (7, GoVibe)
- `docs/decisions/ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md` (1)
- `docs/decisions/ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md` (2, GoVibe)
- `docs/decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md` (1, GoVibe)
- `docs/decisions/ADR-044-UNIFIED-THREAD-ID-AND-OMNI-CHANNEL-CONSOLE.md` (1)
- `docs/decisions/ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md` (1)
- `docs/decisions/ADR-047-SOT-DATA-PLANE-SERVICE-ACCOUNT-KEY.md` (2)
- `docs/decisions/ADR-053-FLOWACCOUNT-READ-ONLY-PULL-PIPELINE-AND-CREDENTIAL-PROVISIONING.md` (3)
- `docs/decisions/ADR-060-LINE-OA-STUDIO-DOMAIN-AND-MULTI-ACCOUNT-BOUNDARY.md` (1)
- `docs/decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md` (1)
- `docs/decisions/ADR-063-RETIRE-TIER1-GENESISBLOCKDB-DIRECT-CLIENTS.md` (9, GoVibe)
- `docs/decisions/ADR-068-KNOWLEDGE-EVIDENCE-PULL-THROUGH-MSP.md` (1, GoVibe)
- `docs/decisions/ADR-072-KNOWLEDGE-ADMISSION-AND-CORPUS-PUBLICATION.md` (9, prose 1)
- `docs/decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md` (11, prose 9)
- `docs/decisions/ADR-074-LOCATED-STOCK-LEDGER-WIP-WORK-ORDERS-AND-LANDED-COST.md` (12, prose 10)
- `docs/decisions/ADR-075-SMARTGIFT-CATALOG-ENTERS-VIA-17-STAGE-SOURCE-ADAPTER.md` (40, GoVibe)
- `docs/decisions/ADR-076-ERP-CANONICAL-ORGANIZATIONAL-HIERARCHY-AND-SCOPE-VOCABULARY-ALIGNMENT.md` (3)
- `docs/decisions/ADR-078-ORG-EMPLOYMENT-LEGAL-ENTITY.md` (1)
- `docs/decisions/ADR-090-LINE-ANSWERS-GROUNDED-BY-THE-PUBLISHED-GKS-CORPUS-AND-REVIEWED-KNOWLEDGE-CANDIDATES.md` (11, prose 8)
- `docs/decisions/ADR-098-COMMERCE-PRICING-RULES-AND-KNOWLEDGE-PUBLICATION.md` (3)
- `docs/decisions/ADR-100-LINE-OA-RUNS-SERVER-EXECUTED-ON-BROWSER-PROVISIONED-API-KEYS.md` (1)
- `docs/decisions/ADR-107-FILE-MANAGEMENT-SERVICE-AND-EXACT-VERSION-PORT.md` (1)
- `docs/decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md` (1, GoVibe)
- `docs/decisions/ADR-119-REMOVE-SMARTGIFT-AND-GOVIBE-FROM-ZURI.md` (22, GoVibe)
- `docs/domains/agent/features/FR-052-server-owned-line-scope-binding.md` (1, prose 0)
- `docs/domains/integration/features/FR-129-catalog-publication-approval-gate.md` (1, prose 0)
- `docs/domains/inventory/CHARTER.md` (1, prose 0)
- `docs/domains/inventory/features/FR-175-moving-average-valuation.md` (1, prose 0)
- `docs/features/FEAT-004/design.md` (1, prose 0)
- `docs/features/FEAT-004/requirements/FR-079.md` (1, prose 0)
- `docs/features/FEAT-025/requirements/FR-174.md` (1, prose 0)
- `docs/migrations/service-extraction/SCM-HANDOFF.md` (1)
- `docs/requirements/FR-052.md` (1, prose 0)
- `docs/requirements/FR-131.md` (1, prose 0)
- `docs/requirements/SDD-075.md` (1, prose 0)
- `docs/roadmap/PLAN-MSP-MEMORY-OS-LINE-AGENT.md` (1, prose 0)
- `reference/prototype/index.html` (1, GoVibe)
- `reports/2026-11-08-task-zai-050-activation-record.md` (2, GoVibe)
- `reports/compact-selfhost-2026-10-27/README.md` (1)
- `reports/compact-selfhost-2026-10-27/operator-restore-rebind-assessment-20261029.md` (1, prose 0)
- `reports/compact-selfhost-2026-10-27/task6-requalification-20261028.md` (1)
- `reports/compact-selfhost-2026-10-27/task6-requalification-observation-20261028.json` (1)
- `reports/compact-selfhost-2026-10-27/task6-scoped-text-journey-20261029.md` (1)
- `reports/gap-analysis-2026-09-02/01-layer-journey-gap.md` (3, GoVibe)
- `reports/gap-analysis-2026-09-02/02-domain-driven-gap.md` (11, prose 9, GoVibe)
- `reports/gap-analysis-2026-09-02/03-data-pipeline-gap.md` (5, prose 3, GoVibe)
- `reports/gap-analysis-2026-09-02/04-integration-connectors-gap.md` (25, prose 14, GoVibe)
- `reports/gap-analysis-2026-10-23/README.md` (1)
- `reports/gap-analysis-2026-10-23/application-fixes.md` (3)
- `reports/gap-analysis-2026-10-23/requirements-matrix.json` (59, prose 25)
- `reports/gap-analysis-2026-10-23/stock-price-implementation.md` (3)
- `reports/source-of-truth-declarations-audit-20261115.md` (8, GoVibe)

#### B list (63 files)

- `apps/edge/AGENTS.md` (3, GoVibe)
- `apps/edge/CLAUDE.md` (2)
- `apps/edge/README.md` (1, GoVibe)
- `apps/edge/skills/zuri-calendar-meeting/SKILL.md` (1)
- `apps/server/deploy/ki17/README.md` (1)
- `docs/DB-MIGRATION-NOTES.md` (6, prose 4)
- `docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` (6, prose 2)
- `docs/KNOWLEDGE-INGESTION-SURFACES-AND-USER-FLOWS.md` (4, prose 1)
- `docs/appendices/A-api-spec.md` (7, prose 6)
- `docs/architecture/DATA-PIPELINE-ARCHITECTURE.md` (11, prose 9)
- `docs/architecture/ERP-ORGANIZATIONAL-HIERARCHY.md` (5)
- `docs/architecture/IDENTIFIER-AND-CODE-SYSTEM.md` (1)
- `docs/architecture/README.md` (3, GoVibe)
- `docs/architecture/project-manager-system/13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md` (2)
- `docs/domains/agent/features/FR-051-production-supabase-tenant-isolation.md` (2)
- `docs/domains/agent/features/FR-057-authorized-agent-context-and-vault-resolution.md` (3, GoVibe)
- `docs/domains/agent/features/FR-132-line-ladder-quotation-tool.md` (3, prose 1)
- `docs/domains/agent/features/FR-141-edge-device-heartbeat-registry.md` (1)
- `docs/domains/commerce/features/FR-253-pricing-rules-and-engine.md` (8, prose 6)
- `docs/domains/crm/features/FR-078-customer-data-backfill-contract.md` (25, prose 21)
- `docs/domains/identity/features/FR-076-product-owner-business-assignment.md` (4)
- `docs/domains/integration/features/FR-130-github-repository-projection.md` (1)
- `docs/domains/knowledge/CHARTER.md` (12, prose 6)
- `docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md` (13, prose 12)
- `docs/domains/knowledge/features/FR-115-document-parsing.md` (2)
- `docs/domains/knowledge/features/FR-131-shipping-rate-card-as-business-knowledge.md` (2, prose 1)
- `docs/domains/knowledge/features/FR-187-smartgift-catalog-adapter.md` (10, prose 5)
- `docs/domains/knowledge/features/FR-188-genesisrag17-parser-2.md` (9, prose 7)
- `docs/domains/line-oa-studio/CHARTER.md` (2)
- `docs/domains/line-oa-studio/features/FR-146-line-oa-account.md` (2, prose 1)
- `docs/domains/line-oa-studio/features/REVIEW-LINE-OA-RELIABILITY-2026-09-10.md` (1)
- `docs/domains/marketing/features/FR-162-operations-coordination.md` (1)
- `docs/features/FEAT-006/design.md` (1)
- `docs/features/FEAT-006/requirements/FR-078.md` (1)
- `docs/features/FEAT-013/design.md` (1)
- `docs/features/FEAT-018/design.md` (2, prose 1)
- `docs/features/FEAT-018/requirements/FR-147.md` (1)
- `docs/features/FEAT-025/design.md` (4, prose 2)
- `docs/features/FEAT-025/feature.md` (2)
- `docs/features/FEAT-025/requirements/FR-181.md` (1)
- `docs/features/FEAT-026/design.md` (9, GoVibe)
- `docs/features/FEAT-026/feature.md` (2)
- `docs/features/FEAT-026/requirements/FR-187.md` (2)
- `docs/features/FEAT-026/requirements/FR-188.md` (1)
- `docs/features/FEAT-026/requirements/FR-189.md` (2)
- `docs/features/FEAT-038/design.md` (2)
- `docs/features/FEAT-038/requirements/FR-235.md` (1)
- `docs/governance/DOCUMENTATION-REQUIREMENTS-SPEC.md` (2, GoVibe)
- `docs/governance/README.md` (2)
- `docs/governance/ROOT-FILE-REGISTER.md` (4, GoVibe)
- `docs/operations/README.md` (2)
- `docs/product/README.md` (3)
- `docs/prompts/EXTRACT-MSP.codex.md` (22, GoVibe)
- `docs/prompts/README.md` (1, GoVibe)
- `docs/requirements/FR-047.md` (1)
- `docs/requirements/FR-051.md` (1)
- `docs/requirements/FR-057.md` (1, GoVibe)
- `docs/requirements/FR-071.md` (1)
- `docs/requirements/FR-277.md` (1)
- `docs/requirements/SDD-042.md` (2)
- `docs/requirements/SDD-063.md` (1)
- `docs/requirements/SDD-091.md` (1)
- `docs/runbooks/TASK-ZAI-095-LINE-GROUNDING-SWITCH.md` (7)

#### C list (124 files)

- `apps/edge/src/cards/types.ts` (2)
- `apps/edge/src/rag/genesis-rag.ts` (1)
- `apps/edge/src/rag/genesisrag17/published-rag.ts` (1)
- `apps/edge/tests/fixtures/fr052-binding-request-v1.json` (1)
- `apps/edge/tests/unit/answer.test.ts` (1)
- `apps/edge/tests/unit/conversation.test.ts` (7, prose 5)
- `apps/edge/tests/unit/genesis-rag.test.ts` (2, prose 1)
- `apps/edge/tests/unit/headless.test.ts` (11, prose 6, GoVibe)
- `apps/edge/tests/unit/identity.test.ts` (3)
- `apps/edge/tests/unit/persona-selection.test.ts` (1)
- `apps/edge/tests/unit/queries.test.ts` (4, prose 1)
- `apps/server/.env.knowledge.example` (1)
- `apps/server/contracts/line-oa-platform-plan.json` (2)
- `apps/server/contracts/phase1-activation/line-activation-input.schema.json` (1)
- `apps/server/contracts/phase1-activation/line-rollback-input.schema.json` (1)
- `apps/server/contracts/zuri-v2-dev-plan.json` (4, GoVibe)
- `apps/server/contracts/zuri-v2-self-plan.json` (7, prose 6, GoVibe)
- `apps/server/prisma/schema.postgres.prisma` (2)
- `apps/server/prisma/schema.prisma` (2)
- `apps/server/scripts/evaluate-phase1-golden.mjs` (1)
- `apps/server/scripts/ki17-line-grounding-inspect-lib.mjs` (1)
- `apps/server/scripts/ki17-line-grounding-inspect.mjs` (1)
- `apps/server/scripts/readonly-supabase-preflight.mjs` (2)
- `apps/server/scripts/seed_real_work_items.mjs` (17)
- `apps/server/src/app/(pm)/procurement/cost-sheets/page.jsx` (1)
- `apps/server/src/app/api/knowledge/ingestions/route.js` (1)
- `apps/server/src/app/api/procurement/cost-sheets/[id]/route.js` (1)
- `apps/server/src/app/api/procurement/cost-sheets/commit/route.js` (1)
- `apps/server/src/app/api/procurement/cost-sheets/preview/route.js` (1)
- `apps/server/src/app/api/procurement/cost-sheets/route.js` (1)
- `apps/server/src/app/api/procurement/cost-sheets/template/route.js` (1)
- `apps/server/src/app/api/procurement/cost-sheets/xlsx/route.js` (1)
- `apps/server/src/lib/module-tabs.js` (1)
- `apps/server/src/modules/agent/line-activation-contract.js` (2)
- `apps/server/src/modules/business/application/business-knowledge-candidates-service.js` (2)
- `apps/server/src/modules/inventory/domain/inventory.js` (1)
- `apps/server/src/modules/inventory/index.js` (1)
- `apps/server/src/modules/knowledge/genesisrag17-source.js` (3, prose 2)
- `apps/server/src/modules/knowledge/genesisrag17-structured-record.js` (24, prose 22)
- `apps/server/src/modules/knowledge/knowledge-admission-service.js` (3)
- `apps/server/src/modules/knowledge/knowledge-candidate-zero-pii.js` (3, prose 2)
- `apps/server/src/modules/knowledge/structured-catalog-adapter.js` (9, prose 6)
- `apps/server/src/modules/knowledge/structured-record-policy.js` (8, prose 6)
- `apps/server/src/modules/line-oa-studio/domain/line-oa-account.js` (1)
- `apps/server/src/modules/platform-control/program-roadmap-containers.js` (29, prose 26, GoVibe)
- `apps/server/src/modules/platform-control/program-roadmap-data.js` (7)
- `apps/server/src/modules/platform-control/program-roadmap-telemetry.js` (1)
- `apps/server/src/modules/platform-control/roadmap-sot.js` (17, prose 15)
- `apps/server/src/modules/procurement/application/procurement-authority.js` (1)
- `apps/server/src/modules/procurement/application/supplier-cost-sheet-service.js` (1)
- `apps/server/src/modules/procurement/components/cost-sheet-ui.js` (1)
- `apps/server/src/modules/procurement/import/supplier-cost-workbook.js` (1)
- `apps/server/src/modules/project-manager/application/backup-service.js` (1)
- `apps/server/src/modules/project-manager/mcp/transport.js` (6, prose 4)
- `apps/server/src/modules/project-manager/views/execution/mode-bodies.jsx` (1)
- `apps/server/src/platform/integrations/core/document-intake-contract.js` (2, prose 1)
- `apps/server/src/platform/integrations/core/genesisrag17-executor.js` (5, prose 1)
- `apps/server/src/platform/integrations/core/pipeline-tracking-service.js` (1)
- `apps/server/tests/e2e/fr164-supplier-cost-sheet-import.spec.js` (1)
- `apps/server/tests/fixtures/fr052-binding-request-v1.json` (1)
- `apps/server/tests/fixtures/knowledge-candidate-prose-fixtures.js` (1)
- `apps/server/tests/integration/code-allocation-retry.test.js` (1)
- `apps/server/tests/integration/controlled-line-activation.postgres.test.js` (6, prose 2)
- `apps/server/tests/integration/fr110-knowledge-evidence-chain.test.js` (2, GoVibe)
- `apps/server/tests/integration/fr174-warehouse-locations.test.js` (1)
- `apps/server/tests/integration/fr179-shelf-life-guard.test.js` (1)
- `apps/server/tests/integration/fr236-stage5-zero-pii-agreement.test.js` (7, prose 3)
- `apps/server/tests/integration/fr253-pricing-rules.test.js` (1)
- `apps/server/tests/integration/genesisrag17-parser-2.test.js` (8, prose 4)
- `apps/server/tests/integration/line-binding-activation.postgres.test.js` (1)
- `apps/server/tests/integration/structured-catalog-admission.test.js` (21, prose 10)
- `apps/server/tests/integration/task-zai-053-supplier-cost-sheet.test.js` (1)
- `apps/server/tests/postgres/smartgift-drop-migration.test.js` (18, prose 9)
- `apps/server/tests/python/test_build_business_knowledge_import.py` (3)
- `apps/server/tests/unit/business-knowledge-contract.test.js` (4)
- `apps/server/tests/unit/controlled-line-activation-migration.test.js` (6, prose 2)
- `apps/server/tests/unit/customer-profile-contract-receipt.test.js` (1)
- `apps/server/tests/unit/doc-added-files.test.js` (2, GoVibe)
- `apps/server/tests/unit/domain-state.test.js` (6)
- `apps/server/tests/unit/fr076-product-owner-business-assignment.test.js` (23)
- `apps/server/tests/unit/genesisrag17-parser-2.test.js` (6, prose 3)
- `apps/server/tests/unit/genesisrag17-thai-safe-chunker.test.js` (1)
- `apps/server/tests/unit/golden-evaluation.test.js` (1)
- `apps/server/tests/unit/grounded-business-answer.test.js` (11)
- `apps/server/tests/unit/id-anchor-stability.test.js` (1)
- `apps/server/tests/unit/ki17-acceptance-harness.test.js` (1)
- `apps/server/tests/unit/ki17-line-grounding-inspect-lib.test.js` (3)
- `apps/server/tests/unit/knowledge-candidate-zero-pii.test.js` (4, prose 1)
- `apps/server/tests/unit/knowledge-catalog-storage-contract.test.js` (2)
- `apps/server/tests/unit/knowledge-document-zero-pii.test.js` (2)
- `apps/server/tests/unit/knowledge-documents-ui.test.js` (4, prose 3)
- `apps/server/tests/unit/knowledge-runtime.test.js` (1)
- `apps/server/tests/unit/knowledge-zero-pii-policy.test.js` (8, prose 3)
- `apps/server/tests/unit/line-activation-contract.test.js` (2)
- `apps/server/tests/unit/line-answer-policy.test.js` (1)
- `apps/server/tests/unit/line-binding-activation.test.js` (2)
- `apps/server/tests/unit/line-binding-resolver.test.js` (4)
- `apps/server/tests/unit/line-channel-binding.test.js` (4)
- `apps/server/tests/unit/line-oa-account-domain.test.js` (9)
- `apps/server/tests/unit/line-oa-settings-consolidation.test.js` (1)
- `apps/server/tests/unit/line-webhook-scope-fail-closed.test.js` (2)
- `apps/server/tests/unit/mint-sot-data-plane-key-cli.test.js` (4)
- `apps/server/tests/unit/phase1-business-agent-runtime.test.js` (8, prose 1)
- `apps/server/tests/unit/pipeline-mcp-transport.test.js` (3)
- `apps/server/tests/unit/platform-approver-profile-migration.test.js` (1)
- `apps/server/tests/unit/platform-control-route-contract.test.js` (1)
- `apps/server/tests/unit/platform/cloud-sot-agent.test.js` (11, prose 10)
- `apps/server/tests/unit/platform/document-intake-contract.test.js` (4)
- `apps/server/tests/unit/platform/pipeline-tracking-service.test.js` (5)
- `apps/server/tests/unit/programme-usage-meter.test.js` (1)
- `apps/server/tests/unit/scm-cost-sheet-parity.test.js` (1)
- `apps/server/tests/unit/smartgift-document-intake-migration.test.js` (8, prose 4)
- `apps/server/tests/unit/sot-data-plane-auth.test.js` (2)
- `apps/server/tests/unit/sot-decision-service.test.js` (1)
- `apps/server/tests/unit/sot-plan-service.test.js` (1)
- `apps/server/tests/unit/structured-catalog-adapter.test.js` (11, prose 8)
- `apps/server/tests/unit/supabase-business-knowledge.test.js` (4)
- `apps/server/tests/unit/supabase-production-isolation.test.js` (7, prose 2)
- `apps/server/tests/unit/supplier-cost-sheet-routes.test.js` (2)
- `apps/server/tests/unit/supplier-cost-sheet-ui.test.js` (1)
- `apps/server/tests/unit/supplier-cost-workbook.test.js` (1)
- `apps/server/vitest.ki17.config.js` (1)
- `apps/server/vitest.postgres.config.js` (1)
- `services/scm/src/kernel/inventory/inventory.js` (1)

#### D list (22 files)

- `apps/edge/docs/.doc-graph.json` (6, prose 0)
- `apps/edge/docs/.preflight-report.json` (6, prose 2)
- `apps/edge/docs/registry/entities/documents/docs_superpowers_plans_2026-08-23-smartgift-catalog-graph-v4.md.yaml` (2, prose 0)
- `apps/edge/docs/registry/entities/documents/docs_superpowers_specs_2026-08-23-smartgift-catalog-graph-v4-design.md.yaml` (2, prose 0)
- `apps/edge/docs/registry/entities/requirements/ADR-003.yaml` (1, prose 0)
- `apps/edge/docs/registry/entities/requirements/ADR-006.yaml` (1, prose 0)
- `apps/server/runtime/data-pipeline-map.json` (31, prose 29)
- `apps/server/runtime/domain-state.json` (17, prose 14, GoVibe)
- `docs/.id-ledger.json` (22, prose 21, GoVibe)
- `docs/DATA-FLOW-ATLAS.html` (1)
- `docs/DATA-PIPELINE-MAP.md` (22, prose 21)
- `docs/FEATURES.md` (7)
- `docs/PRD-SDD-v1.0.md` (37, prose 30, GoVibe)
- `docs/migrations/monorepo/source-manifest.json` (154, prose 124, GoVibe)
- `registry/document-registry/FEATURES.template.md` (5)
- `registry/document-registry/PRD-SDD-v1.0.template.md` (17, prose 15, GoVibe)
- `registry/document-registry/index.json` (1)
- `registry/document-reintegration/dispositions.json` (2, prose 0)
- `registry/document-reintegration/documents.json` (52, prose 39, GoVibe)
- `registry/document-reintegration/identities.json` (206, prose 153)
- `registry/document-reintegration/mappings.json` (2, prose 1)
- `registry/document-reintegration/tooling.json` (2, prose 0)

#### E list (16 files)

- `apps/edge/docs/AGENT-RUNTIME-SPEC.md` (3, GoVibe)
- `apps/edge/docs/ARCHITECTURE.md` (4, prose 2)
- `apps/edge/docs/COMMAND-AGENT-SPEC.md` (3, prose 2, GoVibe)
- `apps/edge/docs/DEVLOG-2026-09-06.md` (1, prose 0)
- `apps/edge/docs/GENESIS-RAG-ADR.md` (2, prose 0)
- `apps/edge/docs/GENESIS-RAG-BASELINE.md` (2, prose 1)
- `apps/edge/docs/GENESIS-RAG-IMPLEMENTATION-PLAN.md` (5, prose 2)
- `apps/edge/docs/GENESIS-RAG-SPEC.md` (4, prose 2)
- `apps/edge/docs/PRD-SDD-v1.0.md` (5, GoVibe)
- `apps/edge/docs/PRICING-TIMELINE-2026-08.md` (3)
- `apps/edge/docs/ROADMAP-CONVERSATIONAL-AGENT.md` (1)
- `apps/edge/docs/appendices/B-db-schema.md` (1, prose 0)
- `apps/edge/docs/appendices/E-risk-matrix.md` (4, GoVibe)
- `apps/edge/docs/appendices/F-glossary.md` (2, GoVibe)
- `apps/edge/docs/model-cards/gpt-5.6-luna-codex.md` (1, prose 0)
- `apps/edge/docs/model-cards/qwen3.5-9b.md` (1)

#### F list (30 files)

- `docs/plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md` (4)
- `docs/plans/DOCS-ARCHITECTURE-REDESIGN-PROPOSAL-20261113.md` (1, GoVibe)
- `docs/plans/GENESISRAG17-CONTRACT.md` (5, prose 2)
- `docs/plans/GENESISRAG17-EDGE-DEPLOYMENT.md` (26, prose 25)
- `docs/plans/LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md` (1)
- `docs/plans/LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md` (3, prose 2)
- `docs/plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md` (10, prose 9, GoVibe)
- `docs/plans/README.md` (2, prose 1)
- `docs/plans/SMARTGIFT-BUSINESS-DROP-RUNBOOK-20261120.md` (31, prose 14)
- `docs/plans/TASK-ZAI-047-KNOWLEDGE-CONSOLE.md` (2)
- `docs/roadmap/PLAN-FR-057-AUTHORIZED-AGENT-CONTEXT.md` (1, GoVibe)
- `docs/roadmap/PLAN-FR-094-PRODUCTION-IAM.md` (3, prose 2)
- `docs/roadmap/PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md` (6)
- `docs/roadmap/PLAN-PARALLEL-WAVE2-20260831.md` (1, GoVibe)
- `docs/roadmap/PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.md` (29, prose 25)
- `docs/roadmap/README.md` (3)
- `docs/roadmap/ROADMAP-business01-smartgift-delivery.md` (11, prose 10, GoVibe)
- `docs/roadmap/ROADMAP-zuri-ai-24w-program.html` (28, prose 27, GoVibe)
- `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` (54, prose 51, GoVibe)
- `docs/roadmap/ROADMAP.md` (53, prose 50, GoVibe)
- `docs/roadmap/line-oa-business-agent/PHASE-01-MINIMUM-LINE-KNOWLEDGE.md` (6)
- `docs/roadmap/line-oa-business-agent/README.md` (6, GoVibe)
- `docs/roadmap/marketing/PHASE-CAMPAIGNS-2026-09-06.md` (2)
- `docs/roadmap/marketing/PHASE-CONTENT-2026-09-06.md` (2)
- `docs/roadmap/marketing/PHASE-MONOREPO-2026-09-06.md` (1)
- `docs/roadmap/marketing/PHASE-OPERATIONS-2026-09-07.md` (1)
- `docs/roadmap/marketing/PHASE-TASK-ZAI-040-RECONCILIATION-2026-09-20.md` (1)
- `docs/roadmap/marketing/marketing-implementation.plan.json` (1)
- `docs/roadmap/marketing/tracking-status.json` (3)
- `docs/roadmap/smartgift-project-manager.plan.json` (27)
