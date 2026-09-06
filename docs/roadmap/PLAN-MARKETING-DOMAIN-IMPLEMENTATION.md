---
version: "0.1.0b"
created_at: "2026-09-06T13:58:59+07:00,RWANG,494a3666"
last_update: "2026-09-06T13:58:59+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: marketing
  doc_type: implementation-tracking-plan
  scope: "Approved Marketing design through four implementation waves"
---

# Marketing — Project Manager implementation tracking plan

**Version:** 0.1.0b
**Status:** Prepared for PM intake; target instance and Workspace remain unresolved. No server records claimed.

**Relates to:** [Design baseline](../change-requests/CR-018-MARKETING-DOMAIN-DESIGN.md), [Navigation](../change-requests/marketing/MARKETING-NAVIGATION-VIEWS.md), [Interface inventory](../change-requests/marketing/MARKETING-INTERFACE-INVENTORY.md), [Team refinement](../change-requests/marketing/MARKETING-TEAM-REFINEMENT.md)

## Approved scope and artifacts

The user approved the design in commit 494a3666 on 2026-09-06 and requested a Project Manager plan.
This record captures that approval while preserving the exact approved documents and their historical
candidate labels. Decomposition below introduces no new Marketing capability.

- [PlanEnvelope](marketing/marketing-implementation.plan.json): one project, five Workstreams, 47 WorkItems, five milestones, five required gates and 158 dependencies.
- [Interface-to-task coverage](marketing/interface-task-coverage.json): all 100 mockup IDs have a development task owner.
- [Tracking/import status](marketing/tracking-status.json): local preparation and actual server persistence evidence remain distinct.

Project code: **PRJ-ZURI-MARKETING-IMPLEMENTATION**. This is product development work. It belongs in the
user-selected development Business/Workspace, rather than the fictional SmartGift Business used by the mockups.
Target instance, login and Workspace require explicit context before intake.

## Progress and initial status

All Workstreams use the published SOFTWARE_SPRINT / TASK_WEIGHT contract, because progress is proven by
software delivery evidence. WorkItem weights are initial relative effort estimates, not hours or ad spend.
Only DONE items earn completed weight. Required open gates cap their stream below completion.
Project roll-up weights sum to 100.

The initial planned roll-up is **5%**, representing completed design only. **Product implementation is 0%.**
The persisted PM percentage must be read from the server after import before it is reported as actual PM progress.
Mockup screenshots and governance-only checks do not complete implementation tasks.

| Wave | Project weight | WorkItems | Initial status | Required exit |
|---|---:|---:|---|---|
| D — Design agreement | 5% | 3 | Design DONE; gate PASSED | Approved design baseline |
| W1 — Planning and team foundation | 30% | 14 | Implementation pending; gate OPEN | W1 verification and owner acceptance |
| W2 — Required source measurement | 25% | 12 | Implementation pending; gate OPEN | W2 verification and owner acceptance |
| W3 — Specialist workflows | 25% | 9 | Implementation pending; gate OPEN | W3 verification and owner acceptance |
| W4 — Controlled execution and confirmed attribution | 15% | 9 | Implementation pending; gate OPEN | W4 verification and owner acceptance |

Each item has acceptance criteria, role responsibility, design references, evidence references and relevant
interface IDs in metadata. These role labels are planning responsibility, not access grants or fabricated Person IDs.
No deadline or target Workspace is invented. Dates can be scheduled once capacity and ownership are known.

## Dependency and completion rules

Each wave's items block its milestone; that milestone blocks its required gate. The previous wave's gate
blocks the next wave's items. Specific contract/persistence/source dependencies connect relevant tasks.
The verification task depends on every delivery item in its wave. This follows the conservative approved
wave order; work within a wave can proceed when its own dependencies are satisfied.

A DONE transition requires acceptance evidence. W1 includes real persistence and MSP/Agent owner acceptance.
W2 requires all five source readers, scoped tests and independent live-read receipts. W3 requires specialist
journeys through measurement and refinement. W4 requires per-action authority, owner contracts, canary and
recovery evidence. Design approval does not authorize a live publishing or spending action.

Product verification covers tests, build, governance, e2e and architecture review. Live source access,
MSP/GKS acceptance, production migrations and action-specific canaries are separate evidence gates.
A missing external dependency remains visible and prevents a false complete result.

## Complete WorkItem registry

### D — Design agreement

| Code | WorkItem | Weight | Responsibility | Initial status | Acceptance evidence |
|---|---|---:|---|---|---|
| MKT-D-DOMAIN | Domain and ownership design | 2 | Architecture | DONE | 11 subdomains and 13 navigation surfaces reviewed against native domain owners. |
| MKT-D-MOCKUPS | 100-interface inventory and mockups | 3 | UX | DONE | All 100 interfaces have screenshots, desktop/mobile checks and prototype evidence. |
| MKT-D-APPROVAL | Human approval of design baseline | 1 | Product owner | DONE | User approval refers to design commit 494a3666 and its recorded document versions. |

### W1 — Planning and team foundation

| Code | WorkItem | Weight | Responsibility | Initial status | Acceptance evidence |
|---|---|---:|---|---|---|
| MKT-W1-SPEC | Native charter, requirements and contracts | 3 | Architecture | READY | Parent/peer contracts, stable requirement IDs and acceptance criteria are declared before code. |
| MKT-W1-PERSISTENCE | Scoped persistence, versioning and audit | 5 | Marketing engineering | PLANNED | Repository interfaces, optimistic version checks and Business/tenant negative tests pass. |
| MKT-W1-SHELL | Navigation and reusable interface states | 3 | Frontend | PLANNED | Authorized Business navigation, Back/reload, mobile and distinct error/unavailable states work. |
| MKT-W1-STRATEGY | Objectives, plans and scenarios | 5 | Marketing engineering | PLANNED | Plan CRUD, objective references, immutable versions and scenario assumptions persist without spending. |
| MKT-W1-CAMPAIGNS | Initiatives and PM-linked campaign execution | 5 | Marketing engineering | PLANNED | Initiative, provider campaign and PM container identities remain distinct; execution uses shared PM records. |
| MKT-W1-CONTENT | Creative brief, production and library | 5 | Creative systems | PLANNED | Versions, rights, review and PM/Files owner references persist and are tested. |
| MKT-W1-OPERATIONS | Intake, calendar, approvals and handoffs | 3 | Marketing operations | PLANNED | PM schedule and owner receipts are projected without duplicate tasks, conversations or stock records. |
| MKT-W1-MSP | MSP and Agent control-port agreement | 5 | MSP and Agent owners | PLANNED | Run/session/lease/cost/recovery authority has owner acceptance and separate integration evidence. |
| MKT-W1-ARTIFACTS | Versioned proposals and independent reviews | 5 | Agent engineering | PLANNED | Evidence snapshots, immutable outputs, independent critique, dissent and diffs persist. |
| MKT-W1-RUNS | Bounded refinement and recovery | 8 | Agent engineering | PLANNED | Finite rounds, parallelism, token/cost/time bounds, pause/cancel and durable recovery receipts are verified. |
| MKT-W1-DECISIONS | Revocable exact-version human decisions | 5 | Identity and Marketing | PLANNED | Target, hash, scope, expiry and revocation are revalidated; changed input invalidates earlier approval. |
| MKT-W1-PM-HANDOFF | PM preview and transactional handoff | 3 | Project Manager | PLANNED | Dry-run, scope conflicts, transactional idempotency and audit use the existing PM importer. |
| MKT-W1-TEAM-UI | Team, runs, reviews and decision views | 5 | Frontend | PLANNED | Actual role/artifact/step receipts are shown; unavailable MSP runtime stays a blocked dependency. |
| MKT-W1-VERIFY | Wave 1 complete verification | 5 | Quality | PLANNED | Tests, build, governance, e2e and architecture review pass; real MSP owner integration has separate evidence. |

### W2 — Required source measurement

| Code | WorkItem | Weight | Responsibility | Initial status | Acceptance evidence |
|---|---|---:|---|---|---|
| MKT-W2-CONTRACTS | Source definitions and scoped mapping | 3 | Data architecture | PLANNED | Grain, timezone, currency and per-source outcome definitions are explicit. |
| MKT-W2-SYNC | Acquisition replay, correction and quality | 5 | Integration | PLANNED | Paging, quotas, cursors, corrections, freshness and replay are tested; credentials remain Integration-owned. |
| MKT-W2-META | Meta Ads hierarchy and insights | 5 | Integration | PLANNED | Scoped campaign/ad set/ad reader passes contract tests and independent live-read evidence. |
| MKT-W2-TIKTOK | TikTok Ads reporting and hierarchy | 5 | Integration | PLANNED | Advertiser/campaign/ad group/ad permissions and definitions pass scoped tests and live-read evidence. |
| MKT-W2-INSTAGRAM | Instagram owned-media measurement | 5 | Integration | PLANNED | Organic media grants and boosted associations are tested; paid and organic reach are not added. |
| MKT-W2-GA4 | GA4 reporting and quality metadata | 5 | Analytics | PLANNED | Property scope, compatible dimensions/metrics and restriction metadata are retained; no fabricated user stitching. |
| MKT-W2-GSC | Search Console performance evidence | 5 | SEO and Integration | PLANNED | Property scope, query/page grains and coverage limitations pass contract and live-read checks. |
| MKT-W2-PAID-UI | Paid filters and campaign-to-ad drilldown | 5 | Frontend | PLANNED | Provider/account/date/placement selection preserves metric grain and supports addressable object detail. |
| MKT-W2-SOCIAL-UI | Instagram organic insights view | 3 | Frontend | PLANNED | Organic interactions and non-additive reach remain separate from Meta paid reporting. |
| MKT-W2-ANALYTICS-UI | Analytics, attribution and source health | 5 | Frontend | PLANNED | Source lenses stay separate, unavailable revenue is not zero, funnels require sequence-capable evidence. |
| MKT-W2-SEO-UI | SEO performance and opportunity views | 3 | Frontend | PLANNED | Opportunity and report evidence preserve coverage/time and target page intent. |
| MKT-W2-VERIFY | Five-source readiness and Wave 2 verification | 5 | Quality | PLANNED | Meta, TikTok, Instagram, GA4 and GSC each have scoped tests and separate live-read receipts; missing readiness keeps this gate open. |

### W3 — Specialist workflows

| Code | WorkItem | Weight | Responsibility | Initial status | Acceptance evidence |
|---|---|---:|---|---|---|
| MKT-W3-PARTNERS | Affiliate and influencer programs | 5 | Partnerships | PLANNED | Programs, deliverables, rights and performance share a partner core; CRM/Finance retain contact and settlement. |
| MKT-W3-LIVE | Live brief, rundown, readiness and results | 5 | Live operations | PLANNED | Host/crew/offer evidence and execution receipts persist; missing Commerce availability blocks readiness. |
| MKT-W3-WEBSITE | Page inventory, journeys and owner handoff | 5 | Website and CRO | PLANNED | Page intent, versions, GA4/GSC mappings and website-owner delivery receipts are tested. |
| MKT-W3-EXPERIMENTS | Shared paid and CRO experiments | 5 | Experimentation | PLANNED | Control/treatment, metric, window and guardrail precede launch; insufficient evidence cannot declare a winner. |
| MKT-W3-SEO-WORK | Technical SEO and remediation workplan | 5 | SEO | PLANNED | Observation method/time, PM remediation ownership and later verification evidence remain traceable. |
| MKT-W3-SOCIAL | Social planning, calendar and CRM handoff | 5 | Social operations | PLANNED | Approved content version and publishing intent persist; manual publication evidence is explicit before external writes. |
| MKT-W3-CREATIVE-ANALYSIS | Creative and partner outcome analysis | 3 | Analytics | PLANNED | Version-specific usage rights, source windows and comparable measurement definitions are retained. |
| MKT-W3-DEBRIEF | Measured outcomes and learning candidates | 5 | Marketing and GKS owners | PLANNED | Receipts, observation window, uncertainty, scope and expiry connect to reviewed learning without automatic promotion. |
| MKT-W3-VERIFY | Specialist journeys and Wave 3 acceptance | 5 | Quality | PLANNED | Each capability covers planning, approved work, execution evidence, measurement and refinement with meaningful tests. |

### W4 — Controlled execution and confirmed attribution

| Code | WorkItem | Weight | Responsibility | Initial status | Acceptance evidence |
|---|---|---:|---|---|---|
| MKT-W4-POLICY | Exact-action capability and readiness policy | 5 | Identity and Integration | PLANNED | Supported action/account/target/version/ceiling/expiry and writer authority are checked before enabling execution. |
| MKT-W4-PUBLISH | Approved publication and outcome receipts | 5 | Integration | PLANNED | Declared publishing adapters revalidate scope and rights; receipts, retry and reconciliation are tested. |
| MKT-W4-SPEND | Approved ad and budget actions | 8 | Paid Media and Integration | PLANNED | Exact account, amount ceiling, expiry and authority are required; plan approval alone cannot authorize spend. |
| MKT-W4-UNKNOWN | Ambiguous outcomes and controlled recovery | 5 | Integration | PLANNED | Unknown outcomes fence retries until reconciliation; duplicate effects, revoked grants and stale inputs are tested. |
| MKT-W4-REVENUE | CRM and Commerce attribution contract | 5 | CRM and Commerce owners | PLANNED | Identity, consent, corrections/refunds and confirmed outcome definitions have owner acceptance. |
| MKT-W4-RECONCILE | Confirmed revenue and discrepancy review | 5 | Analytics | PLANNED | Provider, GA4 and owner-confirmed perspectives remain separate and explainable without duplicate revenue. |
| MKT-W4-GKS | Governed learning promotion | 5 | GKS and MSP owners | PLANNED | Evidence, limitations, expiry, scoped policy and canonical-owner acceptance produce promotion receipts. |
| MKT-W4-CANARY | Action-specific live canary and recovery | 5 | Release owner | PLANNED | Each enabled action has separately authorized canary and recovery receipts; no blanket live spend authority is implied. |
| MKT-W4-VERIFY | Final product verification and acceptance | 5 | Quality and Product owner | PLANNED | All wave gates, interface coverage, product verification and live owner evidence reconcile before closure. |

## Intake and ongoing updates

The existing connection skill requires an identified instance, authenticated session and explicit target
Workspace. The plan intentionally carries empty scope until the target is identified; a verified Workspace
argument can supply it. A default localhost, demo login or direct database write cannot substitute for that context.

Local validation covers mode vocabulary, fields, stable unique codes, graph acyclicity and complete interface
coverage. Server dry-run remains authoritative. Before commit, its insert/update/conflict preview must match
the intended new project and scope. Unexpected existing-code updates require reconciliation; conflicting
scope is not a reason to try another target.

Transport retries keep the same correlation/idempotency key. A successful commit requires a receipt and
server read-back of project identity, Workspace, counts and progress. The initial envelope is a baseline,
not a file to replay later over changed statuses. Subsequent updates read current server state and use owner
services to record evidence and status at meaningful delivery/verification checkpoints.

## Verification status

- Local structural/vocabulary pre-check: PASS.
- Every mockup ID maps to a declared implementation task: 100/100.
- Dependencies: unique referenced nodes, acyclic graph.
- Strict published JSON Schema and local vocabulary validation: PASS; governance: PASS with 0 critical, 0 warning and 26 baseline INFO notices.
- Instance/session/Workspace verification, server dry-run, transactional import and read-back: **pending target clarification**.
- No application source, database, route, permission or provider account was modified during plan preparation.

## Version diff

Approved domain design remains 1.1.0b / commit 494a3666.
New tracking plan and JSON artifacts: **0.1.0b**. This records approval and delivery tracking
without changing the approved 11-subdomain design.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-06 | candidate | Decompose approved design into five weighted waves with 47 tasks, complete interface coverage and explicit import evidence boundaries | See git history | RWANG |
