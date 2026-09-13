---
version: "1.0.0"
created_at: "2026-09-13T08:30:00+07:00,Claude Fable 5.1,2b7ad27d7cc420c8461290ab93252f26f93a51f4"
last_update: "2026-09-13T08:30:00+07:00,Claude Fable 5.1"
status: approved
superseded_by: null
attributes:
  domain: platform-control
  doc_type: change-request
  scope: "Widen the submitted 24-week programme (ROADMAP-ZURI-AI-24W-PROGRAM) with an eleventh deliverable, ERP business modules, and a ninth acceptance gate; re-baseline the plan to 2b7ad27d"
---

# CR-019 — 24-week programme: deliverable 11, ERP business modules

**Applies to:** [ROADMAP-zuri-ai-24w-program.md](../roadmap/ROADMAP-zuri-ai-24w-program.md) (the submitted programme, projected at `/control/roadmap` by FR-105)
**Does not apply to:** [ROADMAP.md](../roadmap/ROADMAP.md) — the live delivery state already records every lane named below and needs no change

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Status** | Approved — the owner chose this option on 2026-09-13 over (1) keeping the programme proposal-scoped with an "outside the programme" appendix and (3) collapsing the two roadmaps into one |
| Complexity / risk | C-2 / LOW for the document; the code impact is one static projection (`program-roadmap-data.js`) and its contract test |
| Baseline | `2b7ad27d7cc420c8461290ab93252f26f93a51f4`, main at 2026-09-13 06:46 +07 |
| Change | Programme v0.3.0 (10 deliverables, 8 gates, 30 tasks, baseline `7d8c9d0`) → v0.4.0 (11 deliverables, 9 gates, 44 tasks, baseline `2b7ad27d`) |

## 1. Why a Change Request and not an edit

The programme's own section 2 locks its commercial scope: *"The signed proposal: 10
deliverables, 8 acceptance criteria — this roadmap may not widen scope without a Change
Request."* Between the programme's baseline (`7d8c9d0`, 23 Aug) and today the repository
merged about 270 first-parent commits, declared 107 further functional requirements
(FR-094 to FR-200), pinned 39 further decisions (ADR-044 to ADR-082) and grew from 9
chartered domains to 14. Most of that work is **ERP business modules** — Inventory,
SmartGift SCM, Commerce, Procurement, Sales Tasks, Marketing, Asset Management, LINE OA
Studio — which no proposal deliverable names. Under the scope lock they cannot be counted
by the programme at all, so `/control/roadmap` shows a 27 % Phase 1 while the live roadmap
records fourteen delivery phases, nine of them done.

Two roadmaps answering different questions is by design (FR-105, ADR-048 D3). Two
roadmaps that *disagree about what was bought* is not. This CR widens the proposal so the
programme can account for the work without pretending the proposal always said so.

## 2. The change

### 2.1 Deliverable 11 — ERP business modules

> **11. ERP business modules.** Business-scoped operating records for one Business's
> supply chain, sales and marketing, delivered as chartered domains with governed writes,
> audit, and the same isolation the other deliverables promise: Inventory and Warehouse
> (catalogue, located stock ledger, work orders, ATP, stocktake), Procurement (suppliers,
> purchase orders, goods receipts), Commerce (sales orders, payments, documents, POS),
> Sales Tasks, Marketing (strategy, campaigns, content, operations, broadcast planning),
> Asset Management (register, evidence intake, edge extraction) and LINE OA Studio
> (multi-account, rich menu, LIFF, server-owned transport). Delivered for Business one
> (SmartGift) first; deliverable 6 carries them to Business two.

Feature ids that fall under it today: FEAT-015, FEAT-016, FEAT-017, FEAT-018, FEAT-019,
FEAT-020, FEAT-021, FEAT-022, FEAT-023, FEAT-024, FEAT-025, FEAT-026 and FR-167 to FR-172
(navigation, capabilities, tabs). Identity lifecycle (FEAT-027 to FEAT-030) is **not**
deliverable 11; it lands under deliverables 9 and 10, where the programme already had a
task (TASK-ZAI-001) and now has a second (TASK-ZAI-041).

### 2.2 GATE-ZAI-09

| Gate | Definition | Evidence that closes it |
|---|---|---|
| GATE-ZAI-09 | The ERP modules run on production for Business one with every declared migration applied, and an agent reaches them only through the declared tools | Production migration ledger matches `supabase/migrations/`; `npm test` green on the module suites; FR-181's negative test proves an undeclared tool path is refused |

### 2.3 Re-baseline

The programme is re-baselined to `2b7ad27d` (v0.4.0). Section 3 of the programme is
re-measured; sections 5.1 to 5.5 stay as the record of the 13-day history they describe
and a section 5.6 records W1 to W3 of the programme itself. Tasks 002, 003 and 004 close
on evidence that already exists; tasks 001, 006, 017, 024 and 025 are re-stated against
the decisions and code that landed after the baseline; tasks 031 to 044 are added for
deliverable 11 and for the identity and knowledge work that fell into existing
deliverables. Phase, sprint and calendar structure is unchanged: the proposal's six
bands still line up.

### 2.4 What this CR does not do

- It does not change ROADMAP.md, PRD ids, FEAT ids or any charter. Every id it cites
  already exists.
- It does not re-price the proposal. Deliverable 11's commercial terms are the owner's
  conversation, not this document's.
- It does not claim production for anything the PRD marks "implemented locally". The new
  task rows carry the same wording, and GATE-ZAI-09 stays unmet until the migration
  ledger says otherwise.

## 3. Files touched by the accepted change

| File | Change |
|---|---|
| `docs/roadmap/ROADMAP-zuri-ai-24w-program.md` | v0.4.0: frontmatter, sections 1, 2.2, 3, 3.1, 3.2, 4, 5.6, Phases, Sprints, Backlog Items, Assignments, fourteen new Task Containers, changelog |
| `docs/roadmap/ROADMAP-zuri-ai-24w-program.html` | board data re-projected to v0.4.0 |
| `apps/server/src/modules/platform-control/program-roadmap-data.js` | FR-105 static projection re-projected to v0.4.0 |
| `apps/server/tests/unit/platform-control-route-contract.test.js` | shape assertions follow the projection |
| `docs/PRD-SDD-v1.0.md` | FR-105 statement re-worded to name the current projection (subject anchor unchanged) |

## 4. Ratification

Owner instruction, 2026-09-13, in session: option 2 chosen from the three offered. The
programme's frontmatter `status` moves from `draft` to `approved` on that instruction;
the programme's Live Status Protocol §3 says ratification is never self-applied, and it
is not — the working tree of the primary checkout already carried the owner's own
`status: Approve` edit, unstaged, when this CR was written.
