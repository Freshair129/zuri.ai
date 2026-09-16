---
version: "1.3.0"
created_at: "2026-09-11T04:40:00+07:00,Claude Sonnet 5"
last_update: "2026-09-11T19:15:00+07:00,Claude Opus 5"
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
owner approval (D8). Owner questions 2–4 were answered on 2026-09-11 (edge device;
a 120-day Phase 4 fallback window; `FileAsset`). The same day the owner opened the
Phase 2 gate: Option A for tier-qualified prices, Option B deferred as a future option,
and contract revision 2 of the structured-record profile. Phase 2 implementation starts
only when all four repositories have merged an acceptance note (D8). Later the same day
the owner approved Phases 3–5. That approval is conditional and stepwise. Phase 3 deploys
only after the Phase 2 acceptance run passes, and only when the owner triggers the operator
step. Phase 5 executes only when Phase 4 evidence meets the owner's exit condition. See
"Phases 3–5 approval" under D8.
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

**Revision 2 of the contract (owner-approved 2026-09-11, four-repo acceptance pending).**
A four-repo review on 2026-09-11 corrected the first draft. It is recorded in
`.brain/proposals/2026-09-11-genesisrag17-structured-record-profile.md` (revision 2):

- **Option A is chosen.** A tier-qualified price is a `PRICE_TIER` entity, so the fact
  shape does not change. **Option B**, an optional `qualifiers` field on facts and edges,
  is deferred as a future option rather than rejected. Adopting it later needs a new
  contract revision and its own four-repo gate, because it changes the frozen decision
  shape (`docs/plans/GENESISRAG17-CONTRACT.md`).
- **The vocabulary is final for `ontology_v2`.** It is a superset of `ontology_v1` and adds
  `HAS_COMPONENT` (package to product), `PRICED_AT` (product or package to price tier) and
  `IN_CATEGORY` (product or package to category). `PACKAGED_AS` is dropped because it only
  reverses `HAS_COMPONENT`. `OFFER` is dropped because no predicate uses it, so SmartGift
  bundle offers map to `PACKAGE`.
- **The GenesisBlock worker changes too.** GKS hands the worker the whole stored decision,
  and the worker hard-codes `ontology_v1` and the two v1 predicates. The first draft said
  the worker needed no change, which was wrong.
- **Rollout is accept-before-produce.** The worker and GKS both accept the fixed set
  `{ontology_v1, ontology_v2}`. The worker ships that first, GKS then starts producing v2,
  and zuri-ai sends parser-2 batches last. In-flight v1 runs finish under v1 rules.
- **Chunking keeps `rule_v1` unchanged.** Each catalog record becomes one descriptive chunk
  with exactly one mention, plus one claim chunk per relation whose whole text is the JSON
  triple. The reason is that Stage 10 reads at most one structured claim per chunk.
- **MSP needs no code change.** It relays the batch without inspecting it.

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
with a sunset window the owner set on 2026-09-11 (question 3) — it is never a second production write path into
GenesisBlockDB, and after Phase 5 it stops reading the sibling file at all.

### D8 — Phases, each gated on the previous and on a separate owner approval before code

| Phase | Content | Gate |
|---|---|---|
| 0 | This ADR + FR-187/FR-188/FR-189 declared `proposed`. No code. | Approved 2026-09-11 |
| 1 | The structured-record source adapter itself (D2), Tier 1, before Stage 1. Runs the existing `rule_v1`/`ontology_v1` through Stage 17 unchanged — the catalog record travels as an opaque structured document until Phase 2. | Authorized by the 2026-09-11 approval; runs in its own lane |
| 2 | Structured parser profile + `ontology_v2` four-repo contract change (D6). | Owner approved 2026-09-11 (Option A, contract revision 2). The gate passes when an acceptance note is merged in zuri-ai, MSP, GKS and the GenesisBlock worker; no repo implements before that |
| 3 | Deploy MSP, GKS and the GenesisBlock worker on the edge device for the SmartGift structured-record profile (question 2). [ADR-073](ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md) states no production deployment for the 17-stage pipeline generally; its 2026-09-11 Amendment lifts that for this profile only. The topology is designed in [`GENESISRAG17-EDGE-DEPLOYMENT.md`](../plans/GENESISRAG17-EDGE-DEPLOYMENT.md). | **Owner approved 2026-09-11.** Deploys only after the Phase 2 acceptance run passes. The deployment itself is a separate operator step that the owner triggers |
| 4 | FR-189 edge shadow-then-cutover: edge queries both v4 and the new published generation, compares, then cuts over; v4 kept as a stated fallback. | **Owner approved 2026-09-11.** Fallback window: 120 days after cutover or the end of the New Year 2027 season, whichever is later (question 3). Starts only after Phase 3 is deployed and healthy |
| 5 | Sunset: SmartGift Stage 5's direct `vaults/*/genesis-db` write and edge v4's direct sibling-file read are both retired. | **Owner approved 2026-09-11, conditionally.** Executes only when Phase 4 evidence shows two things: the fallback window has elapsed, and there were zero shadow mismatches across both the Christmas 2026 and New Year 2027 campaign windows |

#### Phases 3–5 approval (owner, 2026-09-11)

The owner's instruction, verbatim: "approve phases 3–5 of ADR-075 and fix issues pararell".
It came after the owner answered questions 2–4 (below). The approval covers the following,
and nothing beyond it.

- **Phase 3 authorizes three things.** First, the deployment design in
  [`GENESISRAG17-EDGE-DEPLOYMENT.md`](../plans/GENESISRAG17-EDGE-DEPLOYMENT.md). Second,
  the build, Compose and configuration changes that design names, each landing in its own
  reviewed PR. Third, a production deployment of MSP, GKS and the GenesisBlock worker on
  the edge device, for the SmartGift structured-record profile only. The deployment happens
  only after the Phase 2 acceptance passes. That acceptance is the four-process run of
  zuri-ai, MSP, GKS and the GenesisBlock worker, from the raw entrypoint, with no skips.
  **Deploying to the live `zuri-ai` stack is a separate operator step that the owner
  triggers.** Neither this ADR nor any merged PR performs it.
- **Phase 3 does not authorize** any of the following:
  - a deployment for any other source, profile or Business;
  - a server-host topology or a network transport between the tiers (none exists);
  - applying a migration, which stays an owner-instructed operator step under ADR-057;
  - any change to edge query traffic, which belongs to Phase 4.
- **Phase 4 authorizes FR-189.** Edge shadow-queries both v4 and the published generation,
  compares the two, and then cuts over. v4 stays as the fallback for 120 days after cutover
  or until the end of the New Year 2027 season, whichever is later. The cutover date is
  recorded when it happens, because it starts that clock. Shadow comparison continues after
  cutover for the rest of the fallback window, because the Phase 5 condition is measured on
  it.
- **Phase 5 is approved conditionally.** It executes only when Phase 4 evidence meets the
  owner's exit condition. The condition has two parts: the fallback window has elapsed, and
  there were zero shadow mismatches across both the Christmas 2026 and New Year 2027
  campaign windows. Only then are SmartGift Stage 5's direct vault write and edge v4's
  sibling-file read retired. If shadow comparison does not cover the whole of either
  campaign window, the condition cannot be met as written. The decision then returns to
  the owner; it does not pass by default.
- **Still open: the New Year 2027 season needs dates.** The owner has not yet confirmed the
  season's ship and cut-off dates. Both campaign windows need written start and end dates
  before the Christmas 2026 window opens, because a zero-mismatch claim over an undated
  window cannot be checked.

### D9 — Non-goals

- **Pricing logic stays in SmartGift.** Nothing in this ADR moves SmartGift's Price
  Authority Invariant (ADR-074's originating-spec citation, `ADR-009`) into zuri-ai or
  GKS. The structured adapter carries catalog *facts*, not a pricing engine.
- **No PDF/OCR adapter.** The flow doc's own extension map keeps that a separate row
  ("PDF/OCR/HTML/table parser | 2 | ... v1 ปัจจุบันเป็น exact text จึงเพิ่ม binary
  parser อย่างเดียวไม่พอ") — out of scope here.
- **No Stage 18.** The flow doc says so explicitly for the query-path extension row
  ("ไม่เพิ่ม Stage 18 โดยอัตโนมัติ"), and D2's row is "Before Stage 1", not after 17.
- **No migration is applied, no model is added, and no production deployment happens** as
  a consequence of this document alone. Phase 1 is the first phase that touches code.
  The Phase 3 deployment is an operator step that the owner triggers after the Phase 2
  acceptance passes (D8).

### Owner questions (all answered 2026-09-11)

1. Approve this direction at all? — **Yes** (owner, 2026-09-11).
2. Where do MSP/GKS/worker run for this profile in production — on the edge device or
   a server host? Today they are external development-machine repositories; ADR-073
   states no production deployment and does not settle this either.
   **Decision (owner, 2026-09-11): the edge device.** Today that device also runs the
   zuri-ai Tier 1 server, and the current transport requires exactly that co-location.
   zuri-ai starts MSP as a child process (`ZURI_MSP_COMMAND`,
   `apps/server/src/modules/agent/msp-stdio-transport.js`), MSP starts GKS as a child
   process, and MSP accepts only a loopback worker URL (`MSP_PIPELINE_WORKER_URL`, MSP
   `docs/ADR-MSP-GENESISRAG17-RELAY.md`). The decision reopens if the Tier 1 server ever
   leaves the edge device, because no network transport exists yet. Phase 3 still needs
   ADR-073's "no production deployment" lifted, and it must decide how the containerised
   Tier 1 server reaches an MSP process on the same host. Both were addressed on
   2026-09-11. ADR-073's Amendment lifts the statement for this profile only, and
   [`GENESISRAG17-EDGE-DEPLOYMENT.md`](../plans/GENESISRAG17-EDGE-DEPLOYMENT.md) designs
   the container topology.
3. How long does Genesis RAG v4 stay as the Phase 4 fallback once cutover begins?
   **Decision (owner, 2026-09-11): 120 days.** v4 stays as the fallback for 120 days after
   the Phase 4 cutover or until the end of the New Year 2027 season, whichever is later.
   The season's end is set once the owner confirms its ship and cut-off dates. Phase 5 sunset
   additionally requires zero shadow mismatches across both the Christmas 2026 and New Year
   2027 campaign windows. Neither repository defines a campaign cadence, so the figure was
   chosen rather than derived. It is anchored on the 30–120-day campaign timing in
   SmartGift's go-to-market plan (`business-01-smart-gift`,
   `docs/business/SMARTGIFT-GO-TO-MARKET-PLAN-2026-08.md`).
4. Does the structured adapter read SmartGift's prepared JSON from the sibling
   checkout's file path (today's convention, the same one `apps/edge/src/rag/v4/paths.ts`
   uses) or does that file become a `FileAsset` uploaded through the existing
   authorized admission surface (ADR-072, FR-173)? **Recommendation: `FileAsset`** —
   it reuses the admission path FR-173 already built (owner/Business/Project scope,
   ACL, revocation, idempotent resubmission) instead of a second sibling-directory
   convention, and it is the only option that survives a checkout not laid out with
   `business-01-smart-gift` as a literal sibling of this repository.
   **Decision (owner, 2026-09-11): `FileAsset`.** Phase 1 (FR-187) is already built on it.

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
4. **`FileAsset` is the owner's decision (question 4, 2026-09-11).** Phase 1 is built
   on it; the sibling-checkout convention
   `apps/edge/src/rag/v4/paths.ts` uses stays in place for edge v4 until Phase 5.
5. **No production migration or new model follows from this ADR, and nothing deploys
   without the operator step.** Phase 1 was the first phase to touch code. The Phases 3–5
   approval (D8) allows a deployment only after the Phase 2 acceptance passes and the
   owner triggers it. It allows a sunset only when the owner's exit condition is met.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.3.0 | 2026-09-11 | approved | Owner approved Phases 3–5. Phase 3 (edge-device deployment for the SmartGift structured-record profile) deploys only after Phase 2 acceptance passes, as a separate owner-triggered operator step. Phase 4 is FR-189 shadow-then-cutover with the 120-day fallback window. Phase 5 is conditional on the window elapsing and zero shadow mismatches over Christmas 2026 and New Year 2027. The New Year 2027 dates still need owner confirmation. ADR-073 amended; deployment design added | — | Claude Opus 5 |
| 1.2.0 | 2026-09-11 | approved | Owner answered questions 2–4 (edge device, 120-day v4 fallback window, `FileAsset`) and opened the Phase 2 gate: Option A chosen, Option B deferred as a future option, contract revision 2 recorded (worker changes too, `ontology_v2` superset with accept-before-produce rollout, one claim chunk per relation) | — | Claude Opus 5 |
| 1.1.0 | 2026-09-11 | approved | Owner approved the direction and Phase 1 on PR #321; questions 2–4 recorded as working assumptions to re-confirm at their phase gates | PR #321 | Claude Fable 5.1 |
| 1.0.0 | 2026-09-11 | proposed | Initial draft: single entry path, adapter before Stage 1, SmartGift as source producer, edge as published-generation reader, phase gates | 4a8b0ab3 | Claude Sonnet 5 |
