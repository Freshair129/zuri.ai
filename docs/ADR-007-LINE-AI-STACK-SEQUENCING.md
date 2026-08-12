# ADR-007 — LINE/AI Stack: Dependency Sequencing and Production Gates

**Status:** Accepted
**Date:** 2026-08-12
**Decided by:** Owen (owner)
**Relates to:** [ADR-003](ADR-003-V2-REPLACES-V1-BY-REUSE.md) (V2 replaces V1), [ADR-005](ADR-005-V1-DOCUMENTATION-CORPUS.md), `ai-system/intent-pipeline.md`, `replacement/IMPLEMENTATION-PLAN-V2-REPLACE.md`, `replacement/DEMO-RUNBOOK-SMARTGIFT.md`

## Context

The SmartGift executive demo is a **demo** — a deliberately short-cut vertical slice
(LINE transport + DuckDB brain + MSP memory keyed by channel, on a branch, read-only).
It must not be mistaken for the production architecture. The owner set out the
production sequencing, which this ADR records as binding.

The controlling insight: **these layers have a strict dependency order, and building
them out of order forces expensive rework.** In particular, memory must be keyed by
*who the customer is* (a Zuri principal), not by *which channel they arrived on* (a
LINE user id) — so **Identity precedes Memory precedes Knowledge precedes Agent.**

## Authority model (who owns what)

| Layer | Role | Authority over |
|---|---|---|
| **LINE** | Channel / UX | nothing — chat, Flex, Rich Menu, LIFF; a shell |
| **Identity** | LINE ↔ Zuri Principal | account linking, login/OIDC, step-up auth |
| **Zuri** | ERP + CRM + System of Record | tenant, customer, order, course, invoice, permission |
| **MSP** | Agent memory + context authority | vaults, memory entities, context, lineage, decay |
| **GKS / KG** | Knowledge + relation authority | entities and relations for reasoning |
| **Agent** | Reasoning + persona + behaviour + tools | none of the above — it *consumes* their contracts |

A person arriving from LINE, web portal, Facebook or mobile is **one principal** and
must recall **one memory**. That is only possible if memory is keyed by principal,
which is only possible after Identity exists. Hence the order below.

## Decision — the seven phases, gated

| Phase | What | Definition of done / gate |
|---|---|---|
| **P1 Extract MSP** | Move MSP out of GoVibe into its own repo `Freshair129/msp` (a *monorepo* is fine: `apps/msp-server`, `packages/{msp-core,msp-contracts,msp-client-js,msp-retrieval,msp-storage}`, `migrations`, `tests/{contract,security,integration}`). GoVibe becomes a **consumer** via the client. This is packaging/dependency cleanup, not a rewrite — `govibe-core` already has `MspClient`, stdio transport, context lineage, bounded graph query separated. | **Gate A — MSP Production Ready:** server boots standalone · client connects from outside · memory CRUD · search · vault isolation · context resolve · decay · replay/context lineage · contract tests · **and GoVibe still uses the new MSP unchanged (compatibility gate)** |
| **P2 Zuri Backend Slice** | Harden **only** the vertical slice the copilot needs — Tenant · Customer · Identity · Conversation · LINE Gateway · Permission · Business API. Do **not** touch marketing/kitchen/POS/accounting/campaign/procurement unless the dependency graph reaches them. Not a Zuri rewrite; a hardening of an existing slice (Prisma already has Tenant/Customer/Conversation + multi-tenant; the LINE webhook already resolves tenant → customer → conversation → message). | **Gate B — Zuri Core Backend Ready** |
| **P2.5 Impact Scan (before touching Zuri)** | Seed from `prisma/schema.prisma`, `api/webhooks/line/`, `conversationRepo`, `tenantRepo`, `db.ts`, `auth*`; walk imports/calls/DB relations/API consumers/tests/middleware/env/tenant-deps/authorization. Classify **MUST UPDATE / REVIEW / TEST ONLY / NO IMPACT**. (This is GoVibe's `workspace.impact` observed-backlink walk; AGENTS contract already requires impact analysis for schema/API/authority/runtime changes.) | Every Zuri change carries an impact classification before it merges |
| **P3 Identity** | Add `Principal`, `ExternalIdentity`, `AccountLink` (or minimal `ExternalIdentity` first: tenantId, principalType CUSTOMER\|EMPLOYEE, principalId, provider LINE\|FACEBOOK\|GOOGLE, providerSubject, verifiedAt/linkedAt/revokedAt). **`lineUserId` stops being the customer's primary identity.** Keep **Staff auth (Employee) and Customer auth separate** — an Identity Service with two sides; customers link via LINE Account Linking / LIFF / magic link / OTP, staff keep the existing Zuri login. Then LINE Account Linking: unlinked LINE user → "เชื่อมบัญชี" → verified → LINE ↔ ExternalIdentity ↔ Customer; thereafter every webhook resolves lineUserId → principalId → customerId. | **Gate C — LINE Identity Ready** |
| **P4 Persistence** | Zuri → PostgreSQL/Supabase (natural — Prisma datasource is already `postgresql`, `db.ts` has the tenant-injection layer). MSP → its own persistent store. **DB boundary: Zuri DB ≠ MSP DB.** MVP may share one Postgres instance but with separate schema / DB role / migration ownership; production leans to separate project/database boundaries, because MSP and ERP have different lifecycles and an MSP migration failure must never drag POS/CRM/Invoice down. **DuckDB is not killed** — it stays as agent local cache / analytics / offline eval / test fixture (cloud canonical in Postgres/MSP → synced/cached locally in DuckDB); it is not the shared transactional memory backend for multiple agent instances. | **Gate D — MSP + Zuri integration Ready** |
| **P5 Knowledge** | Zuri → GKS/KG projection, but **selectively**: entities whose *relations* help reasoning (Customer, Course, Product, Campaign, Branch, Instructor, Policy, Promotion, Enrollment). Live/transactional facts (current price, credits, invoice, payment, stock, schedule) stay a Zuri query, not KG. | GKS holds relations; Zuri holds live facts |
| **P6 Agent Integration** | Persona / behaviour / tone / prompts / skills / templates / policies can be prepared earlier, but runtime wiring is **last**, so the agent binds to a settled contract: Identity Context + MSP Context + GKS Knowledge + Zuri Tools — instead of writing the agent and forcing the backend to chase the prompt. | **Gate E — Agent Read-only Ready** (search / read / recommend / answer only) |
| **P7 E2E** | LINE → Identity → MSP → GKS → Agent → Zuri Tool → LINE response. | **Gate F — Agent Write/Action Ready** — only after Authorization + Audit + Step-up auth are complete. Until Gate F the agent may NOT refund / cancel / update customer / create payment / modify order. |

**Gate E → F is the most important boundary:** a read-only agent is safe to ship
early; a writing agent is not, until authorization, audit and step-up auth are proven.

## Consequences

- **This refines, does not replace, `IMPLEMENTATION-PLAN-V2-REPLACE.md`.** That plan's
  W3 (identity), W4 (Postgres), W6 (LINE/AI), W7 (PDPA) are the same work; this ADR
  fixes their **order and gating** and inserts **P1 (extract MSP)** ahead of them as a
  precondition, plus the impact-scan discipline (P2.5) before any Zuri change. The
  per-tenant V1 cutover (ADR-003) and this LINE/AI stack share the **Zuri Backend
  Slice** (P2) as their common foundation.
- **Correction to work already in flight (demo branch `demo/smartgift-seam`):** the MSP
  memory just wired into `zuri-command-agent` is keyed by **channel** (workspace
  `business-01-smartgift`, resolved from the local identity gate). That is acceptable
  **for the demo only**. It is the exact anti-pattern P3/P7 forbid for production
  (`vault: line:Uxxxx`). The production key is `tenant:TVS / principal:customer:CUST-…`
  after Identity (P3). The demo wiring must not harden into the product.
- **Do not connect MSP to Zuri before Identity (P3).** Memory must know whose it is.
- DuckDB survives as a cache/analytics tier; the DuckDB→Supabase "mirror" in the demo
  is an aggregates snapshot for the dashboard, not the persistence architecture (P4).

## Program structure — two parallel tracks (owner-confirmed 2026-08-12)

The LINE/AI stack and the V1→V2 cutover are **parallel programs**, not one sequence.
They share a foundation built **once**; everything after diverges.

```text
        SHARED FOUNDATION  (build once, both tracks consume)
        ─────────────────────────────────────────────────
        P2  Zuri Backend Slice   (Gate B)   ← P2.5 impact-scan before any Zuri change
              Tenant · Customer · Conversation · LINE Gateway · Permission
        P3  Identity             (Gate C)   ← Principal / ExternalIdentity / AccountLink
        P4  Persistence (Zuri)   (Gate D)   ← Zuri → Postgres/Supabase
                              │
              ┌───────────────┴────────────────┐
   TRACK 1    │                                 │   TRACK 2
   V1 → V2 cutover (ADR-003)                    │   SmartGift LINE/AI copilot (ADR-007)
   culinary-school tenant                       │   P1 Extract MSP  (Gate A) — independent,
   per-tenant module lifts,                     │      can start NOW, in parallel
   shell lift (ADR-006),                        │   P5 Knowledge → P6 Agent (Gate E read-only)
   nine-owner switch (§7),                      │      → P7 E2E → Gate F (write/action)
   cutover runbook                              │   MSP DB (separate from Zuri DB)
```

- **Shared (do once):** P2 Zuri Backend Slice, P3 Identity, P4 Zuri persistence. Both
  tracks stand on these; neither duplicates them.
- **Track 2 only:** P1 MSP extraction (independent of Zuri — startable immediately), the
  MSP persistent store, P5 Knowledge, P6 Agent, P7 E2E, gates A/E/F.
- **Track 1 only:** the per-tenant cutover machinery in `IMPLEMENTATION-PLAN-V2-REPLACE`
  — module lifts, shell lift (ADR-006), the nine-owner single-writer switch (ADR-003 §7),
  the cutover runbook.
- **The SmartGift executive demo (`DEMO-RUNBOOK-SMARTGIFT.md`) is a spike *ahead of*
  Track 2** — deliberate shortcuts (channel-keyed memory, DuckDB brain, aggregates
  mirror) to prove the copilot's value to executives before Track 2 is built on the
  hardened foundation. Its shortcuts are recorded as demo-only and must not harden.

Consequence for the roadmap: two Mission Control tabs already exist
(`ROADMAP-zuri-v2-lab` = Track 1's home, `ROADMAP-business01-smartgift-delivery` =
Track 2's home); the shared foundation (P2/P3/P4) appears in both as a common
dependency, owned once.

## Review

Revisit if any gate's compatibility clause fails — especially Gate A (GoVibe must keep
working on the extracted MSP) and the Zuri DB ≠ MSP DB boundary at P4.
