---
doc_type: filesystem-index
status: active
version: "0.2.0"
checked_at: "2026-10-23"
checked_base_revision: "e3474ef3c16b5cc5b6e797c63e69d6dc202c191f"
---

# Plans location and retained sources

The 2026-10-23 cleanup removes eleven execution plans, candidate proposals and
retired DDC plans from this directory. No replacement development plan is created.
Their original text remains in the
[Git snapshot before cleanup](https://github.com/Freshair129/zuri.ai/tree/e3474ef3c16b5cc5b6e797c63e69d6dc202c191f/docs/plans).

The nine documents below remain because they contain approved specifications,
accepted designs, deployment contracts or historical evidence. Their legacy
location does not make them disposable plans, current delivery state, or proof
of production acceptance. In particular, canonical NFR-020 and FR-254 link to
the GenesisRAG17 and Knowledge Console specifications. This cleanup does not
rewrite those pinned rows or move their consumed paths.

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
