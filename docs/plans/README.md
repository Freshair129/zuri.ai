---
doc_type: filesystem-index
status: active
version: "0.3.3"
checked_at: "2026-10-23"
checked_base_revision: "fa10e309ac1e2833ad518f5432e921a5822d5d4d"
---

# Plans location and retained sources

The 2026-10-23 cleanup removes eleven execution plans, candidate proposals and
retired DDC plans from this directory. That cleanup created no replacement plan.
Their original text remains in the
[Git snapshot before cleanup](https://github.com/Freshair129/zuri.ai/tree/e3474ef3c16b5cc5b6e797c63e69d6dc202c191f/docs/plans).

The nine documents below remain because they contain approved specifications,
accepted designs, deployment contracts or historical evidence. Their legacy
location does not make them disposable plans, current delivery state, or proof
of production acceptance. In particular, canonical NFR-020 and FR-254 link to
the GenesisRAG17 and Knowledge Console specifications. This cleanup does not
rewrite those pinned rows or move their consumed paths.

## Current implementation plans

The owner approved the linked PM SRS and explicitly requested the following
plans on 2026-10-23, then approved the package at `c291afcd` and authorized A1
with tests and independent review first. Tracks B/C remain unstarted; Pipeline
contract adoption remains separate. These are ordinary implementation documents,
separate from retired DDC procedures.

| Plan | Scope |
|---|---|
| [Project Manager plan index](PROJECT-MANAGER-IMPLEMENTATION-20261023.md) | Approved SRS baseline, remaining-work disposition, dependencies and execution/release limits. |
| [PM approval verification](PM-APPROVAL-VERIFICATION-20261023.md) | FR-272 real PostgreSQL concurrency and audit-rollback evidence. |
| [Existing PM delivery qualification](PM-EXISTING-DELIVERY-QUALIFICATION-20261023.md) | Source reconciliation, Feature role/recovery proof, strategy/bootstrap qualification and selected release. |
| [Pipeline Builder](PM-PIPELINE-BUILDER-20261023.md) | Contract adoption before the four design-gated FR-082–085 implementation slices. |

The selected base contained fourteen tracked direct files and no child
directories. This approved plan adds one document on disk; the current patch
therefore contains fifteen direct files and no child directories.

## Approved implementation plans

The plan below is approved for bounded main-dev implementation. The roadmap
remains the only source of current delivery status; approval does not claim that
implementation or runtime acceptance has occurred.

| Plan | Scope |
|---|---|
| [Main-dev LINE local Ollama](LINE-LOCAL-OLLAMA-MAIN-DEV-20261023.md) | Approved default-off, allowlisted keyless Ollama selection for the isolated main-dev LINE test, with production provider denials preserved; implementation and runtime acceptance remain pending. |
| [MSP retention scheduler](MSP-RETENTION-SCHEDULER-20261024.md) | Owner-requested nightly API-011 maintenance and qualification; production memory activation waits for retention acceptance and real LINE UAT. |

## Retained files

| File | Classification |
|---|---|
| [GENESISRAG17-CONTRACT.md](GENESISRAG17-CONTRACT.md) | Approved wire/implementation contract; current requirement and code readers. |
| [GENESISRAG17-EDGE-DEPLOYMENT.md](GENESISRAG17-EDGE-DEPLOYMENT.md) | Deployment design and dated external-service evidence; apply ADR-110 to retired device/worker clauses. |
| [KNOWLEDGE-ADMISSION-CONTRACT.md](KNOWLEDGE-ADMISSION-CONTRACT.md) | Approved admission integration contract. |
| [LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md](LINE-OA-CREDENTIAL-VAULT-ONBOARDING-AND-CHAT-HISTORY-DESIGN.md) | Accepted design behind ADR-089/091. |
| [LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md](LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md) | Accepted design behind ADR-090. |
| [TASK-ZAI-047-KNOWLEDGE-CONSOLE.md](TASK-ZAI-047-KNOWLEDGE-CONSOLE.md) | Approved detailed specification referenced by canonical FR-254; delivery order and receipts are dated history. |
| [TASK-ZAI-049-DURABLE-KNOWLEDGE-STORAGE.md](TASK-ZAI-049-DURABLE-KNOWLEDGE-STORAGE.md) | Approved storage specification with separately bounded production acceptance. |
| [LINE-OA-P3-MEMORYOS-CIN-EVIDENCE.md](LINE-OA-P3-MEMORYOS-CIN-EVIDENCE.md) | Historical local evidence, not current runtime acceptance. |
| [LINE-OA-P5-DURABLE-CONSOLE-EVIDENCE.md](LINE-OA-P5-DURABLE-CONSOLE-EVIDENCE.md) | Historical Desktop console evidence, subject to ADR-110 retirement. |

## Removed plans

- LINE-OA-LOCAL-LLM-CIN-EXECUTION.md and LINE-OA-LOCAL-LLM-CIN-P2-RETRIEVAL.md
- LOCAL-POSTGRES-IDENTITY-TEST-PLAN.md
- PLAN-MISSION-CONTROL-DAG-OBSERVABILITY.md and its IMPLEMENTATION companion
- PLAN-ROADMAP-W2-NEXT-WAVE.md
- PLAN-VISUAL-OFFICE-2-5D.md
- RELEASE-SAFETY-RESTORE-ROLLUP-ARCHIVE.md
- TASK-ZAI-009-AGENT-FACTORY-CONTRACT-PROPOSAL.md
- TASK-ZAI-026-NODE-VIEW-CONTRACT.md
- TASK-ZAI-048-BINARY-PARSING-CONTRACT.md

The current [code/requirements assessment](../../reports/gap-analysis-2026-10-23/README.md)
records confirmed gaps and evidence limits. [ROADMAP.md](../roadmap/ROADMAP.md)
continues to own delivery state; neither this inventory nor the assessment
rewrites it. New contracts/designs/evidence belong in their registered owning
family. Relocating these retained legacy sources still needs all reader and
pinned-reference changes in one reviewed patch.

## Version diff

0.1.0 → 0.2.0 (2026-10-23): removes eleven plans/proposals, enumerates the nine
retained non-plan sources, preserves approval history by exact Git revision and
links the dated gap assessment. No requirement, ID, ownership or task status changes.

0.2.0 → 0.3.0 (2026-10-23): add the explicitly requested proposed PM plan package
after owner approval of the linked SRS. Preserve cleanup history and retained
contracts; no application work or production activation is recorded as done.

0.3.1 (2026-10-23): record owner approval of the package and selection of A1; preserve the separate Pipeline and release gates.
0.3.2 (2026-10-23): refresh this inventory at `fa10e309` and index the pending main-dev local Ollama plan without changing delivery state.
