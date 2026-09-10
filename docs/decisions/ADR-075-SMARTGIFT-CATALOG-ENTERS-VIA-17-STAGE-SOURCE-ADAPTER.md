---
version: "1.1.0"
created_at: "2026-09-11T04:40:00+07:00,Claude Sonnet 5"
last_update: "2026-09-11T06:05:00+07:00,Claude Fable 5.1"
status: "approved"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "architecture-decision"
  scope: "the single entry path for SmartGift product-catalog data into GenesisBlockDB — a structured-record source adapter before Stage 1 of the 17-stage pipeline, SmartGift's own 5-stage ETL recast as a source producer keyed by its SHA-256 registry, Zero-PII enforcement at Stage 5 classify, SKU/FlowAccount binding through the existing per-Tenant Product column, and edge's transition from a direct file reader to a published-generation reader through MSP"
---

# ADR-075 — SmartGift Catalog Enters GenesisBlockDB Only Through the 17-Stage Source Adapter

**Status:** Approved by the owner on 2026-09-11 (instruction "approve" on PR #321).
The approval covers the direction (D1–D9) and authorizes Phase 1 (Tier 1 adapter code;
no schema, migration or deployment). Phases 2–5 each still require their own explicit
owner approval (D8). Owner questions 2–4 were not answered; the working assumptions
recorded below stand until the owner states otherwise and are re-confirmed at the gate
of the phase that first depends on each.
**Date:** 2026-09-11
**Decided by:** Owner, 2026-09-11, on the draft written the same day to document the
convergence of the three independent SmartGift catalog writers found during the
2026-09-10 architecture review.
**Relates to:** [ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md) (D4),
[ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) (D2.1),
[ADR-073](ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md),
[ADR-074](ADR-074-LOCATED-STOCK-LEDGER-WIP-WORK-ORDERS-AND-LANDED-COST.md) (D5 — `Product.flowAccountSku`),
`docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` (extension map; "ขั้นตอนเพิ่มความสามารถ" §),
`docs/change-requests/CR-002-GKS-MSP-CATALOG-VAULT-RESOLUTION.md` (declined, see Alternatives),
`docs/change-requests/CR-003-ACCEPTED-SHAPE.md` (the shape a proposal is actually accepted in),
`docs/roadmap/PLAN-PENDING-KNOWLEDGE-20260831.md` D7 (CR-002 ruled noncanonical),
FR-174…FR-181, BR-002, SEC-021.

**Originating material (prior art, not a lift):** SmartGift (`TN001B01`, Business 01) —
`business-01-smart-gift/pipeline/master_orchestrator.py` (the 5-stage ETL),
`business-01-smart-gift/pipeline/knowledge_registry/core.py` (the `DENIED` PII regex),
`business-01-smart-gift/docs/ZURI_ECOSYSTEM_BOUNDARIES.md` (SmartGift's own boundary
document, which proposes the `catalogVaultId`/`vlt-catalog-product` binding this ADR
declines — see Alternatives). These live in the SmartGift repository and state one
Business's view; this ADR states what zuri-ai's governed pipeline does, which is not
the same document (AGENTS.md §18 — their ids are never adopted as zuri-ai ids).

## Context

Three independent writers put SmartGift product-catalog data into GenesisBlockDB
today, and none of the three goes through MSP/GKS orchestration:

| # | What runs | Where | What it does today |
|---|---|---|---|
| 1 | SmartGift's own 5-stage ETL | `business-01-smart-gift/pipeline/master_orchestrator.py` — Stage 5, "Dual Publishing (Edge GenesisBlockDB + Static SQLite Sync)", prints `✅ Stage 5 complete: Edge Vault (vlt-catalog-product) synchronized.` | Runs `seed_genesisblock.mjs` as a subprocess, writing directly into `vaults/vlt-catalog-product/genesis-db` through `@freshair129/gks-genesis-block-native ^0.2.5`. Its own ontology, `smartgift://b2b/portfolio/v1`, is registered nowhere GKS reads. |
| 2 | `apps/edge` Genesis RAG v4 | `apps/edge/src/rag/v4/paths.ts:41-54` (`defaultUpstream()`) → `upstream-projection.ts` → `npm run catalog:ingest-v4` | Defaults its upstream to the **sibling checkout's** `business-01-smart-gift/data-pipeline/02_prepared/pricelist_master.json`, projects it, and builds `zuri-edge-device/data/genesis_smartgift_store_v4`, served on `:8888`. This is the store answering LINE customers **today** (index dated 2026-09-02) — see `.brain/reviews/2026-09-10-architecture-review-four-flows.md` Flow 3, ~lines 505-560. |
| 3 | The 17-stage pipeline | `genesisrag17.v1`, [ADR-073](ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md) | The correct path — Tier 1 → MSP → GKS → GenesisBlock worker, receipt-bound atomic publication. But it accepts only text/Markdown, `ontology_v1` freezes just `WORKS_FOR`/`PURCHASED`, there is no structured-record source adapter, and it is not activated in production. |

Flows 1 and 2 both reach GenesisBlockDB (or a private store derived from the same
data) without passing through MSP or GKS at all — flow 1 writes the substrate
directly, flow 2 reads a raw upstream file directly and serves its own private
index. This is the dual-writing, no-single-query-contract pattern
[ADR-042](ADR-042-DECOUPLED-STANDALONE-KNOWLEDGE-AND-GRAPHRAG-SERVICE.md) D4 exists to
forbid, and a Tier-1-equivalent producer talking to the substrate directly is exactly
what [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md) D2.1 says Tier 1 never
does. Flow 3 is the one path the architecture already authorizes, and it is the one
none of today's SmartGift catalog traffic actually uses.

## Decision

### D1 — SmartGift catalog data enters GenesisBlockDB only through the 17-stage pipeline

No script, worker or ETL stage writes `vaults/*/genesis-db` (or any GenesisBlockDB
store) directly for SmartGift product data. The only write path is Stage 13
(`DPS-KI-GRAPH-BUILD`) by the GenesisBlock worker, under a GKS Stage 9–14 decision and
a Stage 17 quality/policy gate, exactly as [ADR-073](ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md)
already requires for every other source. This ADR adds no new authority to that path;
it removes the two paths that bypass it.

### D2 — A structured-record source adapter enters before Stage 1, not a new Stage 18

The extension map in `docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` already names the
seam: *"Text/Markdown form or new source adapter | Before Stage 1 | Authorize target,
freeze bytes/hash/version, enqueue; never synthesize stage results."* A
structured-record adapter is that row's other case — the payload is a JSON/tabular
catalog projection rather than prose, but it is admitted the same way: authorize
scope, freeze the artifact's bytes/hash/version, enqueue Stage 1. It never invents a
Stage 9–17 result on the adapter's own authority (declared as **FR-187**).

### D3 — SmartGift's 5-stage ETL becomes a source producer; its SHA-256 registry is the version identity

SmartGift's pipeline keeps producing its prepared catalog projection and keeps its
own `knowledge_registry` SHA-256 archiving exactly as it does today — that registry
already answers "did this content change since the last run", which is precisely the
question Stage 1's freeze step needs answered. What changes is the last step: Stage 5
("Dual Publishing") stops calling `seed_genesisblock.mjs` against the shared vault and
instead hands its prepared, hashed projection to the new adapter (D2). The registry's
hash becomes the adapter's version identity at Stage 1, and a re-run that produces
byte-identical output is the same idempotent non-event Stage 6 (`DPS-KI-DEDUPE`)
already defines for every other source — no second definition of "changed" is
invented.

### D4 — SKU / FlowAccount codes stay `ExternalRef`-shaped attributes, never a new catalog-vault key

BR-002 already settled this for the operational ledger (ADR-074 D5): a FlowAccount
set code like `TMS06-4(P-16)` is FlowAccount's identifier for our product, not ours
for it, and it binds through **`Product.flowAccountSku`** — one nullable column,
unique per `(tenantId, flowAccountSku)` — never through the installation-scoped
`ExternalRef` table and never through a new catalog-vault mapping. This ADR extends
the same rule to the knowledge side: when the structured adapter's Stage 8 occurrence
extraction sees a FlowAccount code, it carries it as an **attribute of the
occurrence**, never as the occurrence's `resolutionKey` — the distinction
`DPS-KI-ENTITY-EXTRACT`'s contract already draws between `sourceMentionId` and
`resolutionKey`. An agent resolving "TMS06-4(P-16)" at query time uses the same
lookup FR-181's tools already use: try `flowAccountSku`, fall back to `code`. No new
identity table is created for this.

### D5 — Zero-PII is enforced at Stage 5 classify with SmartGift's own deny policy

`DPS-KI-CLASSIFY` already decides, before anything is indexed, whether an object may
be embedded or published (FR-111). For the structured adapter, that check reuses —
ports, not copies — the deny semantics SmartGift already runs in
`pipeline/knowledge_registry/core.py`:

```python
DENIED = re.compile(r"05_crm_customer_data|customer|contact|quotation|ลูกค้า|ใบเสนอราคา", re.I)
```

A record whose source path or content matches this pattern is refused admission as a
"product" occurrence, by construction, at the same boundary FR-111 and SEC-021
already enforce for every other source — this is additive to both, not a third rule.
The adapter's own classify step is the enforcement point named in D2's row
("Before Stage 1" only freezes and enqueues; the deny check runs at the existing
Stage 5, which every enqueued item still passes through).

### D6 — A structured parser profile, typed mentions and `ontology_v2` are a four-repo contract change

Product catalog facts need predicates `WORKS_FOR`/`PURCHASED` do not express
(the proposed vocabulary is `HAS_COMPONENT`, `PRICED_AT`, `IN_CATEGORY`,
`PACKAGED_AS` over entity types `PRODUCT` / `OFFER` / `PACKAGE` / `CATEGORY`, with a
tier-qualified price modelled as a distinct `PriceTier` entity so the fact shape does
not change — see `.brain/proposals/2026-09-11-genesisrag17-structured-record-profile.md`;
the names are frozen only when all four repos sign the contract). Per the flow doc's own change protocol
("ขั้นตอนเพิ่มความสามารถ", §215-225): identify the owning stage and affected next
stages, update spec/profile and the frozen contract *before* implementation, and
**no repo adds a field on its own** — zuri-ai, MSP, GKS and the GenesisBlock worker
agree together, because schema/hash/policy/receipt changes are exactly the four-way
contract the wire schema exists to pin. A parser profile distinct from
`genesisrag17-parser-1` produces Stage 8 occurrences typed as catalog entities
(`PRODUCT` / `OFFER` / `PACKAGE` / `CATEGORY` as proposed above); `ontology_v2`
is the frozen predicate/endpoint-type contract those occurrences resolve against.
Existing `ontology_v1` snapshots are never rewritten — they remain queryable as an
older generation, exactly as the flow doc's correction/replay rule already requires
for every processing-version change (declared as **FR-188**).

### D7 — Edge becomes a reader of the published generation through MSP; v4 is transitional

The flow doc already describes the query path a finished generation is read through:
*"source caller → MSP credential/scope check → worker loopback `/query` → one
published generation → citation → Tier 1 lineage resolver."* Edge's Genesis RAG v4
does none of this today — it re-derives its own store from a sibling checkout's raw
file (`paths.ts:41-54`) and serves it from `:8888` with no MSP/GKS mediation, so an
edge answer today can name no `query-ir.v1` generation and cite no publication
receipt. **FR-189** declares that edge queries the published GenesisRAG17 generation
for the SmartGift corpus through that existing query path instead. v4 is kept, but
only as an explicit, time-boxed fallback during the Phase 4 shadow-then-cutover (D8),
with a sunset date the owner sets — it is never a second production write path into
GenesisBlockDB, and after Phase 5 it stops reading the sibling file at all.

### D8 — Phases, each gated on the previous and on a separate owner approval before code

| Phase | Content | Gate |
|---|---|---|
| 0 | This ADR + FR-187/FR-188/FR-189 declared `proposed`. No code. | Approved 2026-09-11 |
| 1 | The structured-record source adapter itself (D2), Tier 1, before Stage 1. Runs the existing `rule_v1`/`ontology_v1` through Stage 17 unchanged — the catalog record travels as an opaque structured document until Phase 2. | Authorized by the 2026-09-11 approval; runs in its own lane |
| 2 | Structured parser profile + `ontology_v2` four-repo contract change (D6). | Owner approves; zuri-ai/MSP/GKS/worker agree the contract before any repo implements |
| 3 | Deploy topology — **owner decision**, not made here. [ADR-073](ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md) already states no production deployment for the 17-stage pipeline generally; this phase cannot start before that changes. | Owner |
| 4 | Edge shadow-then-cutover: edge queries both v4 and the new published generation, compares, then cuts over; v4 kept as a stated fallback. | Owner sets the fallback window |
| 5 | Sunset: SmartGift Stage 5's direct `vaults/*/genesis-db` write and edge v4's direct sibling-file read are both retired. | Owner confirms Phase 4 evidence |

### D9 — Non-goals

- **Pricing logic stays in SmartGift.** Nothing in this ADR moves SmartGift's Price
  Authority Invariant (ADR-074's originating-spec citation, `ADR-009`) into zuri-ai or
  GKS. The structured adapter carries catalog *facts*, not a pricing engine.
- **No PDF/OCR adapter.** The flow doc's own extension map keeps that a separate row
  ("PDF/OCR/HTML/table parser | 2 | ... v1 ปัจจุบันเป็น exact text จึงเพิ่ม binary
  parser อย่างเดียวไม่พอ") — out of scope here.
- **No Stage 18.** The flow doc says so explicitly for the query-path extension row
  ("ไม่เพิ่ม Stage 18 โดยอัตโนมัติ"), and D2's row is "Before Stage 1", not after 17.
- **No migration is applied, no model is added, no production deployment happens** as
  a consequence of this document. Phase 1 is the first phase that touches code, and
  it needs its own approval.

### Owner questions and working assumptions (question 1 answered 2026-09-11)

1. Approve this direction at all? — **Yes** (owner, 2026-09-11).
2. Where do MSP/GKS/worker run for this profile in production — on the edge device or
   a server host? Today they are external development-machine repositories; ADR-073
   states no production deployment and does not settle this either.
   **Working assumption (not answered):** the edge device, because the native store and
   the LINE answer path already live there. Re-confirm at the Phase 3 gate.
3. How long does Genesis RAG v4 stay as the Phase 4 fallback once cutover begins?
   **Working assumption (not answered):** one campaign cycle after cutover, then sunset
   in Phase 5. Re-confirm at the Phase 4 gate.
4. Does the structured adapter read SmartGift's prepared JSON from the sibling
   checkout's file path (today's convention, the same one `apps/edge/src/rag/v4/paths.ts`
   uses) or does that file become a `FileAsset` uploaded through the existing
   authorized admission surface (ADR-072, FR-173)? **Recommendation: `FileAsset`** —
   it reuses the admission path FR-173 already built (owner/Business/Project scope,
   ACL, revocation, idempotent resubmission) instead of a second sibling-directory
   convention, and it is the only option that survives a checkout not laid out with
   `business-01-smart-gift` as a literal sibling of this repository.
   **Working assumption (not answered):** `FileAsset`, as recommended. Phase 1 is built
   against it; if the owner prefers the sibling-file convention, only the adapter's byte
   source changes.

## Alternatives considered

- **Keep three separate stores (status quo).** Rejected — this is exactly the
  dual-writing, no-single-query-contract pattern ADR-042 D4 forbids, and the three
  stores already disagree: edge's index is dated 2026-09-02, SmartGift's own vault is
  whatever its last Stage 5 run wrote, and the 17-stage pipeline has never seen this
  data at all. Three copies of the same catalog is three places to be wrong.
- **Adopt CR-002** (`Workspace.catalogVaultId` / `vaultNamespace`, a direct MSP →
  vault resolution bypassing GKS's own entity/ontology authority, `D:`-drive path
  aliases). **Rejected** — `PLAN-PENDING-KNOWLEDGE-20260831` D7 already ruled CR-002
  noncanonical: ADR-042…050, FR-057 and the existing charters remain authority, and
  any part of CR-002 that would change that boundary needs its own ADR review, not an
  intake note. This ADR does not add `Workspace.catalogVaultId`, `vaultNamespace`,
  `DataPipelineRun` or any other CR-002/CR-003-shaped model, per that ruling and per
  this ADR's own drafting instructions.
- **Move SmartGift's pricing logic into zuri-ai / GKS as part of this change.**
  Rejected — out of scope for a catalog-*entry* decision, and it would relocate a
  single Business's Price Authority Invariant into a system multiple Tenants read,
  which is a different, larger change needing its own review, not a rider on this one.
- **Fix only the SmartGift direct write, leave edge v4 writing/serving its own store
  indefinitely.** Rejected — it closes one of the two Tier-4-bypassing paths the
  2026-09-10 architecture review found and leaves the other; edge's private index
  still cannot cite a `query-ir.v1` generation or a publication receipt either way.

## Consequences

**Positive.** One class of fact — SmartGift's product catalog — gets one entry path
into GenesisBlockDB instead of three, which is the condition ADR-042 D4 already
requires and today does not hold. SmartGift's existing SHA-256 registry becomes the
recognized version identity for that path instead of an implicit convention two other
repositories separately assume. Zero-PII gets an enforced classify-time check instead
of a rule that lives only in a sibling repository's regex. Edge answers gain a
citable published generation once Phase 4 lands.

**Costs and guards.**

1. **This ADR builds nothing.** Phase 0 is documentation only, and every later phase
   needs its own explicit owner approval before implementation — the same caution
   ADR-073 already states for the 17-stage pipeline's production deployment, and the
   same lesson CR-003 recorded: check what is already built and what a proposal
   actually needs before designing against it.
2. **Approving this ADR alone does not close the violation it describes.** SmartGift
   Stage 5 and edge v4 keep writing/reading exactly as they do today until Phase 5;
   the disagreement between the three stores is not resolved by Phase 0, only by
   reaching Phase 5.
3. **`ontology_v2` (D6 / FR-188) is a four-repo contract, not a zuri-ai decision.**
   GKS, MSP and the GenesisBlock worker must each accept the same version before any
   one of them ships a field. This ADR can declare the zuri-ai side of that agreement;
   it cannot commit the other three repositories.
4. **The FileAsset choice (owner question 4) is a working assumption, not an owner
   decision.** Phase 1 builds against `FileAsset`; the sibling-checkout convention
   `apps/edge/src/rag/v4/paths.ts` uses stays in place for edge v4 until Phase 5.
5. **No production migration, no new model, no deployment.** Phase 1 is the first
   phase that touches code; the 2026-09-11 approval authorizes it and nothing beyond.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.1.0 | 2026-09-11 | approved | Owner approved the direction and Phase 1 on PR #321; questions 2–4 recorded as working assumptions to re-confirm at their phase gates | PR #321 | Claude Fable 5.1 |
| 1.0.0 | 2026-09-11 | proposed | Initial draft: single entry path, adapter before Stage 1, SmartGift as source producer, edge as published-generation reader, phase gates | 4a8b0ab3 | Claude Sonnet 5 |
