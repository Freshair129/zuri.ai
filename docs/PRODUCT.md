# Zuri V2 — Product Definition

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Draft |
| **Author** | Owen + Claude |
| **Created** | 2026-08-12 |
| **Last Updated** | 2026-08-14 |
| **Layer** | 0 — product (above the per-module PRD/SDD) |

Layer 0: what Zuri V2 *is*. Module-level requirements live one layer down
(`docs/PRD-SDD-v1.0.md` for Project Manager); the live index of every
feature is `docs/FEATURE-MAP.md` (generated).

## 1. What V2 is

**V2 replaces V1** ([ADR-003](decisions/ADR-003-V2-REPLACES-V1-BY-REUSE.md)) — not a second
product running alongside it. V1 retires, tenant by tenant.

```text
V2  =  everything V1 does  +  what V1 never had
                              (workspace · business group · project · B2B)
```

Two surfaces, deliberately unequal:

| Surface | Role | Why |
|---|---|---|
| **LINE** | **primary** — AI-native intake and interaction | Where the user already is; conversation is the fastest input for a shop owner |
| **Web** | back-office console — detail, complex edits, audit | Some work cannot be a chat thread: POS cashier, the `/runner` kitchen display (hard-wired as the boot page for iOS tablets), class attendance, reconciliation, reports |

Consequence: web screens are **reused from V1, not redesigned** — a back-office
console earns its keep through completeness at low cost. Auth/identity is the one
thing rebuilt, because V1's model (one login per shop) cannot express an owner with
several businesses.

### 1.1 What V1 is — corrected 2026-08-12

V1 is a **culinary-school SaaS**: recipes tied to courses, QR class attendance, and
credential ladders (`BASIC_30H` / `PRO_111H` / `MASTER_201H`), with POS, CRM and a LINE
inbox around it. An earlier draft of this document called it "SMB shops (restaurants
etc)" — that was wrong, and it matters: courses, enrollment and certificates are core
domain, so they are must-have at cutover, not peripheral. Established by the
`TASK-V2-PARITY` scan; see `replacement/PARITY-INVENTORY.md` §1.

## 2. Scope hierarchy (the thing V1 could not express)

```text
Portfolio ─┬─ Tenant ─┬─ Business ─┬─ Workspace ─┬─ Project ─── Workstream
           │          │            │             └─ (work lives here)
           │          │            └─ Branch
           │          └─ (isolation boundary — never a branch, never in the UI)
           └─ (a group of businesses under one owner)
```

In V1 a "tenant" *is* one shop, so an owner with two shops has two logins, two
customer sets and no way to see across them. V2 keeps the full chain in the schema
and shows only the levels that offer a real choice (FR-020).

This chain is the **schema truth**. How it is *presented* — Business-centric root, the
dual **ERP ⇄ PM** lens over the same entities, and the `Landing → Login stub → Business
Routing → Business Overview` entry flow — is defined by draft [ADR-015](decisions/ADR-015-ENTRY-LANDING-LOGIN-AND-BUSINESS-ROUTING.md),
which amends the earlier [ADR-008](decisions/ADR-008-BUSINESS-CENTRIC-SHELL-AND-SCOPE-LENS.md) journey for this slice.
Project and Campaign are two **domains** (Projects · Growth), never the app root.

## 3. Non-negotiables

| Rule | Source |
|---|---|
| External ids are never primary keys — internal UUID + human code + `ExternalRef` | BR-002 |
| Every intake surface ends at one pipeline: validate → dry run → preview → single transaction → audit | BR-009, SDD-009 |
| AI never writes directly — every AI-derived change is previewed and confirmed by a human | BR-007, ADR-003 §D7 |
| One tenant is owned by exactly one system at any instant (LINE OA + workers + writes flip together) | ADR-003 §D8 |
| Migrated rows keep V1's UUIDs | ADR-003 §D4 |
| `G:\zuri` is never modified — reuse is one-directional | AGENTS.md §1 |
| Local-first relations and file metadata have one authority: SQLite. Physical files may live in a mounted Business workspace; cache is disposable and rebuildable | ADR-016, BR-010 |

### 3.1 Local-first data and file boundary (implemented beta)

V2 does not encode its relationship graph as folders. SQLite owns identities,
ownership, links, status, audit and versions. A user-visible Business workspace may
hold real Business/Project working files, while `.zuri/cache` contains only derived
artifacts that can be deleted and rebuilt. Business File Manager is an aggregate
view over SQLite links, not a second copy of every Project file. See accepted
[ADR-016](decisions/ADR-016-SQLITE-AUTHORITY-AND-MANAGED-LOCAL-FILE-WORKSPACE.md).

## 4. Where the pieces are

### Two parallel programs, one shared foundation (ADR-007)

V2 work runs as **two parallel tracks** that share a foundation built once:

- **Shared** — Zuri Backend Slice (Tenant · Customer · Conversation · LINE · Permission) → Identity → Zuri persistence.
- **Track 1** — V1→V2 per-tenant cutover of the culinary-school tenant ([ADR-003](decisions/ADR-003-V2-REPLACES-V1-BY-REUSE.md), `replacement/IMPLEMENTATION-PLAN-V2-REPLACE.md`).
- **Track 2** — SmartGift LINE/AI copilot: extract MSP → Knowledge → Agent → E2E ([ADR-007](decisions/ADR-007-LINE-AI-STACK-SEQUENCING.md)), behind gates A–F, read-only agent before writing agent.

The SmartGift executive demo is a **spike ahead of Track 2**, on demo-only shortcuts
(`replacement/DEMO-RUNBOOK-SMARTGIFT.md`).

| Concern | Document |
|---|---|
| Feature index + cutover state | `docs/FEATURE-MAP.md` (generated) |
| Project Manager module | `docs/PRD-SDD-v1.0.md` + `docs/features/` |
| Shell · scope lens · entry flow | `docs/decisions/ADR-015-ENTRY-LANDING-LOGIN-AND-BUSINESS-ROUTING.md` + `docs/decisions/ADR-008-BUSINESS-CENTRIC-SHELL-AND-SCOPE-LENS.md` + `docs/SITEMAP-DOMAIN-NAV.md` |
| AI + LINE surface | `docs/domains/agent/` |
| Replacing V1 | `docs/replacement/` |
| Decisions | `docs/decisions/ADR-00*.md` |
| Delivery state | `docs/roadmap/ROADMAP.md` |

## 5. Delivery state (2026-08-12)

Project Manager module: FR-001…FR-020 shipped, 129 Vitest + 28 Playwright green,
four intake surfaces live (UI wizard, Excel, agent JSON, enterprise API).
Everything else — identity, LINE/AI, the lifted V1 modules — is `PHASE-V2-REPLACE`,
not started. Nothing in V1 has been cut over yet.
