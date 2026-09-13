---
version: "1.0.0"
created_at: "2026-09-14T15:00:00+07:00,Claude Opus 5"
last_update: "2026-09-14T15:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "knowledge"
  doc_type: "architecture-decision"
  scope: "LINE answers grounded by the Business's published GKS corpus generation through an in-process knowledge.query reader selected per LINE OA account, with a traced mode-gated fallback and a budget; LINE-derived knowledge entering GKS only as reviewed, locator-only candidates admitted through ADR-072"
---

# ADR-090 — LINE answers are grounded by the published GKS corpus; LINE-derived knowledge enters only as reviewed candidates

**Status:** Accepted on the owner's instruction of 2026-09-14 ("ใช้ค่าที่เสนอทุกข้อ"). Phase 0
(declaration) only: no reader, column, model, route or registry node exists yet.

**Decided by:** the owner, 2026-09-14, accepting decisions 11–16 and 17B of the consolidated decision
table of the LINE OA platform design.

**Amends by pointer** (each amended ADR carries a one-line pointer back here):

- **ADR-061, "Implementation validation and rollout boundary"** — "Server grounded answers still use
  the existing dedicated business-knowledge reader … this change does not widen the SmartGift read
  policy." Still the default. An account whose grounding mode names the corpus reads the published
  corpus instead or first (D1, D2); the default mode keeps today's behaviour exactly.
- **ADR-072 D1** — the admission service's source kinds. Two TEXT source kinds are added:
  `LINE_FAQ_CANDIDATE` (D6) and, in a later phase, `LINE_STUDIO_DESCRIPTION` (D7). Both are text; D1's
  "no binary/OCR parser, no fabricated stage report" is unchanged.

**Relates to:** ADR-042, ADR-043, ADR-050, ADR-061, ADR-063, ADR-068, ADR-070, ADR-072, ADR-073,
ADR-075, ADR-085, ADR-089, ADR-091, FR-049, FR-127, FR-171, FR-173, FR-187, FR-189, FR-235, FR-236,
FR-237, FR-238, FEAT-038, SEC-032, SDD-099,
`docs/plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md`.

## Context

The evidence is in [the LINE → GKS design](../plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md)
§2–4, read against `origin/main` `6630c1df` with each claim marked VERIFIED or ASSUMED.

- **No LINE byte reaches GKS or GenesisBlockDB, and no LINE answer reads from them.** The server path
  (CH-02 in `docs/DATA-PIPELINE-MAP.md`) answers from `zuri_core.business_knowledge` (PUBLIC rows only)
  through `postgres-business-knowledge`; `server-line-answer.js` overrides the shared context
  assembler's knowledge query with an empty reader. The data pipeline map already says so: CH-02's
  knowledge edge starts at `s.business-knowledge`, not `s.knowledge-corpus`.
- **Customers in production are answered by the edge v4 store** (CH-01), a private index on the edge
  device. ADR-075 D7 is the plan that retires it; grounding the server path changes nothing customers
  see until an account runs SERVER execution.
- **The lawful read seam already exists.** `queryKnowledgeCorpus` (FR-173, ADR-072 D9) pins one
  published corpus generation, asks MSP (`msp_pipeline_query`) for each active source's explicit
  snapshot and returns results with a `citationId` bound to corpus generation, source, ingestion and
  chunk (ADR-072 D10). `answerBusinessQuestion` (`grounded-business-answer.js`, FR-049) already consumes
  a `knowledge.query` port and never calls the model without evidence records.
- **FR-171 reserved the trace field and never filled it.** `retrievalRefs` on `EVIDENCE_SELECTED` is
  "opaque GKS retrieval/evidence references"; AC-171.17 is pending.
- **The runtime accepts exactly one knowledge binding** (`knowledge-runtime.js`), so a second Business
  needs a routing decision first.
- **GKS never deletes a row.** Withdrawal is serving denial (ADR-072 D5, D11); correction is a new
  source version through the seventeen stages; GenesisBlockDB supersedes bitemporally.
- **Conversation content has no lawful route into knowledge today.** The knowledge charter: "never
  automatically from conversation"; PHASE-04: "without promoting raw conversations into GKS"; ADR-043 D3
  requires a promotion review; `gks_knowledge_promote` has no zuri-ai caller and requires a
  `provenance_ref` beginning `msp:proof/`.

## Decision

### D1 — A per-account grounding mode selects an in-process corpus reader

`LineOaAccount` gains a publisher-set `knowledgeGrounding` mode:

| Mode | Reads | Fallback |
|---|---|---|
| `BUSINESS_KNOWLEDGE` (**default**, every existing account) | `zuri_core.business_knowledge` — today's behaviour | none |
| `GKS_CORPUS` | the Business's published corpus generation | none — for a Business that retired the curated table |
| `GKS_THEN_BUSINESS_KNOWLEDGE` | the corpus first | business knowledge, on `GKS_UNAVAILABLE` or `NO_EVIDENCE` |

The corpus reader lives in the knowledge lane and implements the **existing `knowledge.query` port**
over `queryKnowledgeCorpus`, **in process** — no HTTP self-call, no machine API grant, never a Tier 4
read (ADR-042 D4, ADR-043 D2.1). It runs under the unforgeable scoped runtime knowledge capability of
ADR-072 D5 with the job's server-derived Tenant and Business, never a session or a request-supplied
actor. The agent lane composes it; `answerBusinessQuestion` and `withLineCatalogCommand` do not change.

### D2 — Fallback is mode-gated and traced; no evidence means no model call

Each knowledge hop writes one `EVIDENCE_SELECTED` trace event with `source`, `reason` and budget.
Fallback happens only when the mode names it. When no allowed source returns evidence the answer is the
existing deterministic reply and the model is not called — the invariant `answerBusinessQuestion`
already enforces, now applied across sources.

### D3 — The GKS hop has a budget, and over budget is unavailable

2 500 ms wall clock for the hop (MSP spawn plus worker loopback), top-K 5, evidence packet at most
8 KiB — all configuration, not constants (SDD-099). A hop over budget is `GKS_UNAVAILABLE`, handled by
D2, never a slower answer. The MSP-spawn cost inside a four-wide worker tick is measured in the
isolated acceptance before any production switch; if spawn dominates, the fix is an MSP daemon
transport — a four-repository contract change, not a zuri-ai shortcut.

### D4 — Retrieval references go on the trace, not into the reply

`EVIDENCE_SELECTED` carries `retrievalRefs: [{citationId, sourceId, snapshotId, generation,
corpusGeneration, manifestHash}]`, closing FR-171 AC-171.17 for GKS. The customer-visible reply
carries no citation ids; the console trace shows them. When ADR-091's Context Composer lands, the same
references move into its `ContextReceipt`.

### D5 — SmartGift goes first, after ADR-075 Phase 3

The first account switched to a GKS mode is a SmartGift account, and only after ADR-075 Phase 3 has
deployed MSP, GKS and the GenesisBlock worker beside the web container. Switching is an owner-triggered
operator step; rollback is flipping the mode back. A second Business waits for the single-binding
routing decision.

### D6 — Chat becomes knowledge only as a reviewed, locator-only Q/A candidate

The only LINE-derived content that may enter GKS is a **`KnowledgeCandidate`**: a canonical question
and answer written with product locators (`Product.code`, FlowAccount SKU), policy names and amounts —
no names, no LINE ids, no quoted customer wording — drawn from consent-GRANTED conversations. Zero-PII
is enforced **twice**: at candidate creation (the FR-187 deny policy) and again at Stage 5 classify
(ADR-075 D5). A Business **OWNER or `LINE_OA_PUBLISHER`** edits it and approves or rejects it, audited.
An approved candidate is admitted as one immutable **TEXT source of kind `LINE_FAQ_CANDIDATE`** through
the ADR-072 admission service **before Stage 1**, and travels all seventeen stages.

Refused, explicitly: raw transcripts; MSP episodes or summaries admitted as sources; automatic
promotion of anything; a Tier 1 call to `gks_knowledge_promote` (that verb stays MSP's, ADR-068 D4).
When MSP thread memory is live, an MSP summary may seed a candidate's draft text; the candidate is
still a Tier 1 row and still needs the human decision. SEC-032 states the rule.

This is the built instantiation of ADR-043 D3's "Promotion Review" for LINE: Tier 1 review plus
ADR-072 admission, not a new promotion transport.

### D7 — Studio descriptions become sources later; the gap report never enters GKS

- **Studio descriptions** (rich menu labels and action descriptions, LIFF app purpose, bot profile
  copy) are admitted as TEXT sources of kind `LINE_STUDIO_DESCRIPTION` on a publisher action, in a
  later phase — never the Flex or rich menu JSON itself (FR-238).
- **Knowledge gaps** — questions answered `NO_EVIDENCE` — become a Business-scoped report of counts,
  product locators and last-seen times only. The question text stays in CRM and nothing from the
  report is admitted (FR-237).

### D8 — Erasure: nothing personal enters, and what was admitted is withdrawn

A candidate carries `sourceRef = {conversationId, messageIds}` only. A principal erasure tombstones every
candidate whose source names an erased conversation in the same local transaction, and for a candidate
already admitted withdraws the knowledge source (membership removed atomically, late citations denied)
and starts a correction run. Old generations keep the withdrawn chunks readable only to authorized
historical citations (ADR-072 D10). ADR-091 D6 and FR-232 own the erasure fan-out as a whole.

### D9 — Registry rows land with their surfaces

`docs/DATA-PIPELINE-MAP.md` gains, in Phase 0, only the undeclared (`"wired": false`) edges between
nodes that already exist: the published corpus into the agent turn, the CRM record into knowledge
admission (the reviewed candidate), and the agent turn into MSP (ADR-091's session-tier projection),
plus chains CH-21 and CH-22. The new process and store nodes of the design §7 — the grounding reader,
the candidate extractor, the candidate store, the gap report — **land with their surfaces** (ADR-085
Consequence 2), because the generator refuses a surface that does not exist on disk.

## Requirement map

| Design placeholder | Id | Subject |
|---|---|---|
| GKS FR-NEW-1 | FR-235 | LINE answer grounding from the published knowledge corpus |
| GKS FR-NEW-2 | FR-236 | LINE FAQ knowledge candidates |
| GKS FR-NEW-3 | FR-237 | Knowledge gap report for LINE |
| GKS FR-NEW-4 | FR-238 | LINE Studio descriptions as knowledge sources |
| GKS FR-NEW-5 | merged into FR-232 (ADR-091) | erasure propagation, one requirement for all tiers |
| (decision 15) | SEC-032 | Customer conversation content never becomes GKS knowledge except as a reviewed candidate |
| (decisions 11–13) | SDD-099 | The LINE grounding reader |
| GKS FEAT-NEW-1 | FEAT-038 | LINE grounding and knowledge candidates |

## Consequences

- **Nothing changes for any account until a publisher switches its mode.** The default is today's reader.
- **The knowledge lane gains its first consumer-facing read port for LINE** and, when D6 lands, one
  model (`KnowledgeCandidate`) and review surfaces in the Knowledge (GKS) slot. Charter prose now;
  `owns_models` when the model exists.
- **The agent lane composes, and owns no new model for this ADR.** line-oa-studio owns the mode column
  and its writer. crm exposes a consent-gated read projection for the candidate extractor and gains no writer.
- **GKS cannot delete.** A wrongly admitted candidate lives on in old generations behind citation
  authorization; withdrawal plus correction is the only mechanism, which is why D6 enforces Zero-PII before
  admission rather than relying on erasure after it.
- **Risk carried forward:** the server path is not the production customer path (CH-01) until FR-189 or
  SERVER execution; evidence for a production switch must name which accounts run SERVER.

## Required proof

1. Mode `BUSINESS_KNOWLEDGE` produces byte-identical traces and answers to today's path.
2. Mode `GKS_CORPUS` answers from a published generation in the four-process isolated harness, with
   `retrievalRefs` visible on `GET /api/line-oa/jobs/{id}/trace`.
3. Budget timeout yields `GKS_UNAVAILABLE`; in `GKS_THEN_BUSINESS_KNOWLEDGE` the fallback is traced with
   its reason; in `GKS_CORPUS` there is no fallback.
4. No evidence from any allowed source: deterministic reply, zero model calls.
5. A job of Business A can never read Business B's corpus, through scope, capability or binding.
6. With the worker stopped, the answer is the deterministic reply, not an error or a model-only answer.
7. Candidates: Thai PII fixtures are refused at creation and again at Stage 5; no candidate is admitted
   without an OWNER or `LINE_OA_PUBLISHER` decision; approval and rejection are audited.
8. Erasure of a person tombstones their candidates, withdraws an admitted source and denies a late citation.

## Delivery phases (shared numbering with ADR-089 and ADR-091)

| Phase | Content | Gate |
|---|---|---|
| 0 | This ADR, FR-235..FR-238, SEC-032, SDD-099, FEAT-038, registry edges and chains CH-21/CH-22 | `govern` green; owner approval 2026-09-14 |
| 4 | Corpus reader, `knowledgeGrounding`, `retrievalRefs`; may run in parallel with phases 1–3 | proof 1–6 in the isolated harness; production for SmartGift only after ADR-075 Phase 3 (and its Phase 4 shadow evidence for the edge side) |
| 5 | Candidate extractor, review surface, admission hook, knowledge gap report | proof 7–8 |
| later | Studio descriptions as sources (FR-238) | publisher action and withdrawal on unpublish tested |

## Alternatives rejected

**HTTP self-call to `POST /api/knowledge/queries`.** Rejected for the server path: a machine grant for
the container to call itself, an extra hop and a viewer resolution per turn. Kept for the edge (FR-189).

**Replace business knowledge with GKS now.** Rejected: production answers depend on it and GKS has no
production SmartGift generation before ADR-075 Phase 3. May become the default after evidence.

**Read the edge v4 store from the server.** Rejected: a Tier 1 → Tier 4 read (ADR-042 D4, ADR-043 D2.1).

**Candidates through `msp_knowledge_promote` → `gks_knowledge_promote`.** Deferred, not adopted: design
only on MSP's side and dependent on MSP thread memory; admission is on main today.

**Index raw conversations or MSP episodes in GKS.** Rejected: the knowledge charter, PHASE-04 and ADR-043
D3 all forbid it, and GKS cannot erase.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-14 | accepted | Per-account knowledge grounding over the published corpus through an in-process `knowledge.query` reader with a 2 500 ms / top-5 / 8 KiB budget and a traced, mode-gated fallback; SmartGift first after ADR-075 Phase 3; LINE-derived knowledge only as locator-only candidates approved by OWNER or LINE_OA_PUBLISHER and admitted as `LINE_FAQ_CANDIDATE` TEXT sources; Studio descriptions later; gap report never enters GKS; amends ADR-061's implementation-validation note and ADR-072 D1 by pointer; Phase 0 declaration only | working-tree | Claude Opus 5 |
