---
domain: project-manager
doc_type: domain-document-spine
version: "0.1.0b"
created_at: "2026-09-18T20:42:13+07:00,RWANG"
last_update: "2026-09-18T20:42:13+07:00,RWANG"
superseded_by: null
source: gpt-site-design-review
status: candidate
source_of_truth: github
attributes:
  doc_type: domain-document-spine
  domain: project-manager
---

# Project Manager document spine

This is the repository entry point for the Project Manager design.

The public GPT design Site supplies the information architecture and reading order. GitHub stores the canonical Markdown, contracts, registries and evidence. The Site is rebuilt/exported from this tree and is never edited as a second source.

## Source-of-truth rules

- GitHub repository files are the authoritative source for requirements, architecture, contracts, FR notes and evidence.
- The Site-derived 01–22 sequence is the core design spine. Existing files under architecture/project-manager-system are the canonical repository copies of that spine.
- Repository supplements use the 23+ layer: implementation baselines, Phase B decisions, G14, TaskUsageLedger and current evidence.
- Registered FR behavior lives once in a feature note under features/. Proposal-local PMR behavior lives once under requirements/. Architecture documents link to those files instead of owning another copy of the requirement body.
- Generated views such as FEATURE-MAP.md, DOMAIN-MAP.md and TRACE.md remain governed outputs; do not hand-edit them.

## Read the core Site spine

| Spine | Topic | Canonical GitHub document |
|---|---|---|
|01|Requirements and UX|[open](../../architecture/project-manager-system/01-REQUIREMENTS-AND-UX.md)|
|02|Decisions and diagrams|[open](../../architecture/project-manager-system/02-DECISIONS-AND-DIAGRAMS.md)|
|03|Data and events|[open](../../architecture/project-manager-system/03-DATA-AND-EVENTS.md)|
|04|Agents and fleets|[open](../../architecture/project-manager-system/04-AGENTS-AND-FLEETS.md)|
|05|Providers and MCP|[open](../../architecture/project-manager-system/05-PROVIDERS-AND-MCP.md)|
|06|API and contracts|[open](../../architecture/project-manager-system/06-API-AND-CONTRACTS.md)|
|07|Delivery and verification|[open](../../architecture/project-manager-system/07-DELIVERY-AND-VERIFICATION.md)|
|08|Evidence and review|[open](../../architecture/project-manager-system/08-EVIDENCE-AND-REVIEW.md)|
|09|Navigation refinement|[open](../../architecture/project-manager-system/09-NAVIGATION-REFINEMENT.md)|
|10|UX strategy and journeys|[open](../../architecture/project-manager-system/10-UX-STRATEGY-AND-JOURNEYS.md)|
|11|UI system and interactions|[open](../../architecture/project-manager-system/11-UI-SYSTEM-AND-INTERACTIONS.md)|
|12|Wireframes and screen specs|[open](../../architecture/project-manager-system/12-WIREFRAMES-AND-SCREEN-SPECS.md)|
|13|Domain taxonomy and navigation boundaries|[open](../../architecture/project-manager-system/13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md)|
|14|Existing Project tab semantics|[open](../../architecture/project-manager-system/14-EXISTING-PROJECT-TAB-SEMANTICS.md)|
|15|Workforce capacity, schedule and performance|[open](../../architecture/project-manager-system/15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md)|
|16|Spec readiness and API reference|[open](../../architecture/project-manager-system/16-SPEC-READINESS-AND-API-REFERENCE.md)|
|17|SRS|[open](../../architecture/project-manager-system/17-SRS.md)|
|18|Database tables and ERD|[open](../../architecture/project-manager-system/18-DATABASE-TABLES-AND-ERD.md)|
|19|System blueprint|[open](../../architecture/project-manager-system/19-SYSTEM-BLUEPRINT.md)|
|20|Multi-agent delivery plan|[open](../../architecture/project-manager-system/20-MULTI-AGENT-DELIVERY-PLAN.md)|
|21|Contract foundation|[open](../../architecture/project-manager-system/21-CONTRACT-FOUNDATION.md)|
|22|Navigation implementation baseline|[open](../../architecture/project-manager-system/22-NAVIGATION-IMPLEMENTATION-BASELINE.md)|

The Site-only current implementation page is represented in the repository as [28 current implementation and delivery status](../../architecture/project-manager-system/28-CURRENT-IMPLEMENTATION-AND-DELIVERY-STATUS.md). The number 28 avoids colliding with the repository's existing 23–27 supplements.

## Repository supplements

| Layer | Purpose | Canonical location |
|---|---|---|
| REPO-23 | Project, Domain and Feature implementation baseline | [23 baseline](../../architecture/project-manager-system/23-PROJECT-DOMAIN-FEATURE-IMPLEMENTATION-BASELINE.md) |
| REPO-24 | Phase B Feature authority implementation plan | [24 Phase B plan](../../architecture/project-manager-system/24-PHASE-B-FEATURE-IMPLEMENTATION-PLAN.md) |
| REPO-25 | Persistence security policy | [25 persistence](../../architecture/project-manager-system/25-PHASE-B-PERSISTENCE-SECURITY-POLICY.md) |
| REPO-26 | Recovery and erasure decision | [26 recovery](../../architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md) |
| REPO-25-G14 / REPO-26-G14 | Workforce registry candidate and implementation packet | [G14 candidate](../../architecture/project-manager-system/25-G14-REGISTRY-CANDIDATE.md), [packet](../../architecture/project-manager-system/26-G14-REGISTRY-IMPLEMENTATION-PACKET.md) |
| REPO-27 | Commit provenance and TaskUsageLedger implementation packets | [TaskUsageLedger packet](../../architecture/project-manager-system/27-TASK-USAGE-LEDGER-IMPLEMENTATION-PACKET.md) |
| SITE-23 | Current implementation/release evidence from the Site export | [28 current status](../../architecture/project-manager-system/28-CURRENT-IMPLEMENTATION-AND-DELIVERY-STATUS.md) |

## Requirement and FR extraction

- [FR-INDEX.md](FR-INDEX.md) links every existing canonical Project Manager FR note without copying its body.
- [requirements/README.md](requirements/README.md) links one extracted file for each of the 33 proposal-local PMR requirements.
- [Machine-readable PMR index](../../architecture/project-manager-system/contracts/pm-requirement-index.json) connects PMR → capability → owner → acceptance → existing FR context.
- A PMR with an existing FR context remains a proposal requirement until canonical registration; an existing FR is never silently repurposed.

## Domain boundaries

- Domain is the owner boundary; Feature is a user capability that can cross Domains.
- Workstream is the execution lane inside a Project; Agent/Fleet is an executor, not a permission boundary.
- Business Home provides cross-Domain shortcuts. It does not create a second Project Manager writer.
- Workforce planning is a Project Manager capability with People and Identity/CRM read contracts; G14 and TaskUsageLedger remain explicit candidate/implementation evidence slices.

## Verification path

After changing this spine or any source document, run npm run govern, inspect the generated graph/preflight, then run the relevant tests/build. A static Site page is review evidence, not proof of runtime activation.
