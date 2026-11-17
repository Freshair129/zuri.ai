---
doc_type: filesystem-index
status: active
version: "0.2.0"
checked_at: "2026-10-22"
checked_base_revision: "1f1e5a0a7591f4e42646ebc33e78654a4e3477be"
---

# Roadmap and delivery-plan index

## Authority

[ROADMAP.md](ROADMAP.md) is the only source of current delivery status. Its canonical delivery ledger owns task state, evidence scope, and delivery status.

[ROADMAP-zuri-ai-24w-program.md](ROADMAP-zuri-ai-24w-program.md) is a derived projection of the **cancelled** 24-week programme. By [ADR-117](../decisions/ADR-117-CANCEL-24-WEEK-PROGRAMME-AS-DELIVERY-PLAN.md), recorded on an owner instruction given in chat on 2026-11-13 and relayed by the lead session, its schedule, phase and sprint dates and `GATE-ZAI-*` targets are not the delivery plan. Its metadata still sets source_of_truth to false and identifies ROADMAP.md as its status source. It is kept for history, and for the board and generated projections that still read its task containers; its status cells do not override the canonical ledger, and nothing in it is progress against a schedule.

The current plan is the architecture-review gap-closure work ([review](../../.brain/reviews/2026-11-12-architecture-review-domains-and-core-systems.md)), tracked by ROADMAP.md delivery rows and pull requests, not by sprint dates. The cancellation declares no work done, rewrites no task count or percentage, and states no production effect.

[ROADMAP-zuri-ai-24w-program.html](ROADMAP-zuri-ai-24w-program.html) is a static historical snapshot measured at commit 7d8c9d0 on 2026-08-23 of the now-cancelled programme. It is not a current board. Its task values and percentages are retained as historical evidence.

Other PLAN, phase, JSON, or project-specific files remain at their present paths until each is individually classified. Do not create new roadmap plans here; put new bounded plans in [docs/plans](../plans/README.md). Do not delete or relocate an existing plan based on its filename or age alone.

## Files directly in this working tree on 2026-10-22

| File |
|---|
| [README.md](README.md) |
| [PLAN-ASSET-EVIDENCE-INTAKE-4-PHASES.md](PLAN-ASSET-EVIDENCE-INTAKE-4-PHASES.md) |
| [PLAN-ASSET-MANAGEMENT-4-PHASES.md](PLAN-ASSET-MANAGEMENT-4-PHASES.md) |
| [PLAN-BRANCH-COMPLETION-2026-09-10.md](PLAN-BRANCH-COMPLETION-2026-09-10.md) |
| [PLAN-FEAT-019-DOMAIN-PHASES.md](PLAN-FEAT-019-DOMAIN-PHASES.md) |
| [PLAN-FEAT-019-STATELESS-APPLICATION-TIER.md](PLAN-FEAT-019-STATELESS-APPLICATION-TIER.md) |
| [PLAN-FEAT-043-DOMAIN-PHASES.md](PLAN-FEAT-043-DOMAIN-PHASES.md) |
| [PLAN-FR-040-PROJECT-WORK-VIEWS.md](PLAN-FR-040-PROJECT-WORK-VIEWS.md) |
| [PLAN-FR-041-BUSINESS-FIRST-STRATEGY-AND-HR.md](PLAN-FR-041-BUSINESS-FIRST-STRATEGY-AND-HR.md) |
| [PLAN-FR-043-PROJECT-BUSINESS-OWNERSHIP.md](PLAN-FR-043-PROJECT-BUSINESS-OWNERSHIP.md) |
| [PLAN-FR-044-ENTRY-LANDING-LOGIN-BUSINESS-ROUTING.md](PLAN-FR-044-ENTRY-LANDING-LOGIN-BUSINESS-ROUTING.md) |
| [PLAN-FR-045-MANAGED-LOCAL-FILE-WORKSPACE.md](PLAN-FR-045-MANAGED-LOCAL-FILE-WORKSPACE.md) |
| [PLAN-FR-046-PRODUCTION-VIEWER-ENTRY-CONTRACT.md](PLAN-FR-046-PRODUCTION-VIEWER-ENTRY-CONTRACT.md) |
| [PLAN-FR-053-054-PHASE1-ACTIVATION-READINESS.md](PLAN-FR-053-054-PHASE1-ACTIVATION-READINESS.md) |
| [PLAN-FR-055-CONTROLLED-LINE-ACTIVATION.md](PLAN-FR-055-CONTROLLED-LINE-ACTIVATION.md) |
| [PLAN-FR-057-AUTHORIZED-AGENT-CONTEXT.md](PLAN-FR-057-AUTHORIZED-AGENT-CONTEXT.md) |
| [PLAN-FR-077-PROJECT-INVENTORY-MVP.md](PLAN-FR-077-PROJECT-INVENTORY-MVP.md) |
| [PLAN-FR-079-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md](PLAN-FR-079-PHASE1-LINE-RUNTIME-CONNECTION-CUTOVER.md) |
| [PLAN-FR-080-INTEGRATION-SECRET-MANAGEMENT-UI.md](PLAN-FR-080-INTEGRATION-SECRET-MANAGEMENT-UI.md) |
| [PLAN-FR-094-PRODUCTION-IAM.md](PLAN-FR-094-PRODUCTION-IAM.md) |
| [PLAN-FR-097-VERIFIED-CHANNEL-ONBOARDING.md](PLAN-FR-097-VERIFIED-CHANNEL-ONBOARDING.md) |
| [PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md](PLAN-MARKETING-DOMAIN-IMPLEMENTATION.md) |
| [PLAN-MSP-MEMORY-OS-LINE-AGENT.md](PLAN-MSP-MEMORY-OS-LINE-AGENT.md) |
| [PLAN-NEXT-BUSINESS-NAVIGATION-AND-VIEWER-CONTRACT.md](PLAN-NEXT-BUSINESS-NAVIGATION-AND-VIEWER-CONTRACT.md) |
| [PLAN-PARALLEL-WAVE2-20260831.md](PLAN-PARALLEL-WAVE2-20260831.md) |
| [PLAN-PENDING-BUSINESS-20260831.md](PLAN-PENDING-BUSINESS-20260831.md) |
| [PLAN-PENDING-IDENTITY-20260831.md](PLAN-PENDING-IDENTITY-20260831.md) |
| [PLAN-PENDING-KNOWLEDGE-20260831.md](PLAN-PENDING-KNOWLEDGE-20260831.md) |
| [PLAN-PENDING-PARALLEL-20260831.md](PLAN-PENDING-PARALLEL-20260831.md) |
| [PLAN-PHASE1-EXTERNAL-ACTIVATION.md](PLAN-PHASE1-EXTERNAL-ACTIVATION.md) |
| [PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.md](PLAN-SMARTGIFT-DATA-BACKFILL-AND-CUSTOMER-IMPORT.md) |
| [PLAN-ZURI-MONOREPO-MIGRATION.md](PLAN-ZURI-MONOREPO-MIGRATION.md) |
| [ROADMAP-business01-smartgift-delivery.md](ROADMAP-business01-smartgift-delivery.md) |
| [ROADMAP-zuri-ai-24w-program.md](ROADMAP-zuri-ai-24w-program.md) |
| [ROADMAP-zuri-ai-24w-program.html](ROADMAP-zuri-ai-24w-program.html) |
| [ROADMAP.md](ROADMAP.md) |
| [smartgift-project-manager.plan.json](smartgift-project-manager.plan.json) |

## Nested directories

### Marketing

| File |
|---|
| [PHASE-TASK-ZAI-040-RECONCILIATION-2026-09-20.md](marketing/PHASE-TASK-ZAI-040-RECONCILIATION-2026-09-20.md) |
| [PHASE-STRATEGY-2026-09-06.md](marketing/PHASE-STRATEGY-2026-09-06.md) |
| [PHASE-OPERATIONS-2026-09-07.md](marketing/PHASE-OPERATIONS-2026-09-07.md) |
| [PHASE-MONOREPO-2026-09-06.md](marketing/PHASE-MONOREPO-2026-09-06.md) |
| [PHASE-CONTENT-2026-09-06.md](marketing/PHASE-CONTENT-2026-09-06.md) |
| [PHASE-CAMPAIGNS-2026-09-06.md](marketing/PHASE-CAMPAIGNS-2026-09-06.md) |
| [PARALLEL-REVIEW-2026-09-06.md](marketing/PARALLEL-REVIEW-2026-09-06.md) |
| [tracking-status.json](marketing/tracking-status.json) |
| [marketing-implementation.plan.json](marketing/marketing-implementation.plan.json) |
| [interface-task-coverage.json](marketing/interface-task-coverage.json) |

### LINE OA Business Agent

An existing project-plan index and phase files remain under this directory:

- [Project-plan README](line-oa-business-agent/README.md)
- [Phase 01](line-oa-business-agent/PHASE-01-MINIMUM-LINE-KNOWLEDGE.md)
- [Phase 02](line-oa-business-agent/PHASE-02-CLOUD-RUNTIME-OPERATIONS.md)
- [Phase 03](line-oa-business-agent/PHASE-03-IDENTITY-PERMISSION.md)
- [Phase 04](line-oa-business-agent/PHASE-04-MSP-EPISODIC-MEMORY.md)
- [Phase 05](line-oa-business-agent/PHASE-05-GKS-GENESIS-SEMANTIC-MEMORY.md)
- [Phase 06](line-oa-business-agent/PHASE-06-GROUP-ASSISTANT-ACTIONS.md)
- [Phase 07](line-oa-business-agent/PHASE-07-OMICHAT-UNIFIED-INBOX.md)

## Version diff

0.0 → 0.1.0 (2026-10-22): Separates the delivery ledger, schedule projection,
and historical HTML snapshot; enumerates existing roadmap and nested phase
artifacts without changing their task states.

0.1.0 → 0.2.0 (2026-11-13): Records that the 24-week programme is cancelled as the
delivery plan (ADR-117, owner chat instruction relayed by the lead session).
Task states, counts, percentages and file inventory are unchanged.
