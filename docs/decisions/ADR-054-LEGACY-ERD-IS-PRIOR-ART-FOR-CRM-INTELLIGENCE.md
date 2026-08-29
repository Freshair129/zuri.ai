---
version: "1.0.0"
created_at: "2026-08-30T00:00:00+07:00,Claude Fable 5"
last_update: "2026-08-30T00:00:00+07:00,Claude Fable 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "crm"
  doc_type: "architecture-decision"
  scope: "borrowing table shapes from the legacy zuri ERD as prior art for the CRM conversation-intelligence bundle, and the rebinding rules that make the borrowed shapes native"
---

# ADR-054 — The Legacy ERD Is Prior Art for CRM Conversation Intelligence

**Status:** Accepted for the documentation/declaration boundary. No schema
migration or runtime slice is authorized by this ADR.
**Date:** 2026-08-30
**Decided by:** Boss
**Relates to:** [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) (D7),
[ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md), FR-023, FR-091, FR-093,
FR-094, FR-103, FR-126, FR-127, FR-128, FEAT-014, BR-001, BR-002, BR-011,
SEC-005, `docs/domains/crm/CHARTER.md`, `docs/domains/agent/CHARTER.md`.

## Context

Boss asked to reuse the feature tables of the legacy product's ERD
(`G:\zuri\docs\architecture\database-erd\full-schema.md`, v2.0.0, 17 models)
so the CRM feature set does not have to be designed from a blank page — "ตัดส่วน
Tenant ของมันออกแล้วใช้ของเราผูก" (cut its Tenant out, bind to ours).

ADR-024 D7 already draws the line this request sits on: reading `G:\zuri` as
prior art is fine; nothing in zuri-ai descends from it, nothing migrates from
it, and nothing is ever written to it. So the question this ADR answers is not
*whether* the legacy repo may inform us — it may — but **which shapes are worth
borrowing, what must change on the way in, and what is refused**. Recording the
refusals matters as much as the adoptions: the legacy ERD encodes several
patterns this repository has standing rules against, and a future reader who
finds the borrowed tables without this record would reasonably copy the next
table straight.

What zuri-ai already has, and this ADR does not touch: the crm domain owns
`Customer`, `Conversation`, `Message` with the FR-023 LINE ingest seam, the
FR-093 outbound writer, the FR-091 inbox reader and the FR-103 consent writer.
The legacy Customer-vs-identity question is already answered here — global
`Person` (identity's), tenant-scoped `Customer` (crm's) — so no identity
decision is reopened.

## Decision

### D1 — The legacy ERD is prior art, never a source

The file above is read for its table shapes and field vocabularies only.
No git history is fetched from `G:\zuri`, no document is copied into this
tree, and no legacy id, ADR number or gotcha id is treated as binding here.
This is ADR-024 D7 applied, not extended.

### D2 — This bundle adopts three derived-intelligence shapes, under crm

FEAT-014 (CRM Conversation Intelligence) borrows exactly three table shapes,
declared as FR-126, FR-127 and FR-128:

| Legacy shape | Becomes | FR |
|---|---|---|
| `CustomerProfile` (AI-inferred 1:1 profile) | `CustomerProfile` on our `Customer` | FR-126 |
| `ConversationAnalysis` (per-conversation AI classification) | `ConversationAnalysis` on our `Conversation` | FR-127 |
| `DailyBrief` (daily aggregate, pushed over LINE) | `DailyBrief` per Business per day | FR-128 |

All three land under the crm charter when their schema lands. The agent
domain **produces** analyses at runtime but owns no models by design (its
charter); crm owns the rows and their single writers, exactly as it does for
the ingest seam today.

### D3 — Rebinding rule: borrowed shapes anchor to existing scope, never add scope

The legacy schema hangs everything off one flat `tenantId`. Here the borrowed
tables inherit scope from the aggregate they describe instead of carrying
their own: `CustomerProfile` hangs off `Customer` (already tenant-scoped,
FR-023), `ConversationAnalysis` hangs off `Conversation` (already scoped
`(tenantId, channel, externalThreadId)`), and `DailyBrief` is keyed
`(businessId, briefDate)` with `tenantId` carried the same way `Branch`
carries it. No borrowed table introduces a new scope column or a second copy
of a scope another row already states — the same reasoning `Message` records
for omitting a tenant column.

### D4 — BR-002 is applied at the border: external ids never become keys

Three legacy patterns are explicitly corrected on the way in:

1. Legacy `AdDailyMetric.adId` foreign-keys the **Meta ad id** — an external
   id as a join key. Any future Ad model here keys on internal UUID with the
   provider id in `ExternalRef`.
2. Legacy code needed a written gotcha (G-DB-02) to stop FKs landing on
   `Conversation.conversationId` (`t_xxx` / LINE userId). Here that mistake is
   structural rather than disciplinary: FR-127 keys on `Conversation.id`, and
   the external thread id already lives in a tenant-partitioned unique, not a
   key.
3. Legacy identity merges customers **by phone number** across channels.
   Refused entirely: identity resolution belongs to the identity domain
   (`Person`, `ChannelIdentity`, FR-094), and crm stores its results. No
   borrowed table performs or implies channel merging.

### D5 — What is refused, and where the rest of the blueprint goes

Not taken, with the native replacement that makes taking them pointless:
`Employee` (→ `Person`/`Membership`/`Session`), `AuditLog` (→ audit events on
every service write), `Task` (→ project-manager's `Project`/`Workstream`),
phone-based identity merge (D4.3), and `Customer` wallet/tier fields.

Deferred, not refused — the remaining legacy bundles stay available as prior
art for future FEATs, in this order of likely value: Catalog + Orders
(`Product`, `Order`, `Transaction`, slip-OCR flow), Marketing
(`Ad`, `AdDailyMetric`, bottom-up aggregation), Enrollment/Kitchen
(`Enrollment`, `CourseSchedule`, `Ingredient`, `IngredientLot`, FEFO).
Because Marketing is deferred, FR-127 carries **no ad-attribution field**:
the legacy `sourceAdId` column is dropped from the borrowed shape rather than
stored as a dangling string, and attribution arrives only when an Ad model
exists to anchor it.

### D6 — Borrowed tables hold derived, recomputable, advisory data

All three tables mirror the repository's progress rule (`progressCache` is
advisory; progress is always recomputed): the truth is `Conversation` and
`Message`; every FR-126/127/128 row must be regenerable from retained
conversations, and no surface may present a number these rows disagree with
the recomputation on. Consequences that follow and are part of this decision:
deleting analysis rows is always safe; PDPA erasure of a Customer (SEC-005,
FR-103 consent scope) takes its `CustomerProfile` and its conversations'
analyses with it, since derived personal data is still personal data; and
`DailyBrief` aggregates are recomputed from FR-127 rows, never incremented in
place.

## Consequences

- Declaration order holds: this ADR + registry rows land first (this lane,
  docs-only); schema, enums (`src/lib/validation/enums.js`), services and
  tests follow in an implementation lane under the crm charter, which adds
  the three models to `owns_models` when they exist in
  `prisma/schema.prisma`.
- A reader comparing zuri-ai to the legacy ERD can now tell borrowed-and-
  rebound from independently-designed, and knows the refusals were chosen,
  not overlooked.
- The deferred bundles in D5 have a recorded starting point; each still
  requires its own FEAT/FR declarations and its own pass through D3/D4 —
  this ADR authorizes shapes for FEAT-014 only.
