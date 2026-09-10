---
status: PROPOSAL — NOT APPROVED, NO IMPLEMENTATION
title: GenesisRAG17 structured-record ingestion profile (SmartGift catalog)
date: 2026-09-11
author: Claude (session, zuri-ai-adr075 worktree)
pipeline: genesisrag17.v1 (ADR-073)
parent_docs:
  - docs/decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md (zuri-ai)
  - docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md (zuri-ai)
requires_agreement_from: [zuri-ai owner, MSP owner, GKS owner, GenesisBlock worker owner]
---

# GenesisRAG17 structured-record ingestion profile

**This is a proposal, not a plan or a patch.** No code changes accompany it. Per
`docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md` §"ขั้นตอนเพิ่มความสามารถและ acceptance"
(zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:215-223), any schema/hash/policy/
receipt change on the `genesisrag17.v1` wire needs the owners of zuri-ai, MSP, GKS and
the GenesisBlock worker to agree *before* implementation — "ห้ามให้แต่ละ repo เติม field
เอง" (no repo may add a field unilaterally). This document is that agreement draft.

## 0. Problem statement

SmartGift's catalog (products, categories, packages/offers, pricing tiers) is
**structured JSON**, one record per product/offer/category — not prose. The current
`genesisrag17.v1` Stage 2 profile (`genesisrag17-parser-1`) only understands section-
delimited free text/Markdown and Stage 8 only recognizes `Person`/`Organization`/
`Product` mentions found by regex over prose (zuri-ai:apps/server/src/modules/
knowledge/genesisrag17-source.js:20-26). Feeding a JSON catalog through the prose
parser would either fail structurally or silently mis-chunk/mis-extract it. This
proposal adds a **second, coexisting Stage 2 profile** for structured records, and the
minimum Stage 7/8/10/11/12/14/17 changes that profile requires — without altering
`genesisrag17-parser-1`'s behavior for existing prose sources.

## 1. Ownership and call boundary (recap, unchanged by this proposal)

| Repo / Tier | Owns | Contract boundary |
|---|---|---|
| zuri-ai, Tier 1 | Stage 1–8: immutable raw/parsed/chunk lineage, one batch/attempt | Sends the Stage 9 batch over MSP; never writes substrate |
| MSP, Tier 2 | Credential/scope check, opaque relay; no stage logic | Forwards `msp_pipeline_*` payloads verbatim to GKS/worker |
| GKS, Tier 3 | Stage 9–14 decisions, Stage 17 verdict, durable receipts | Passive server; never calls the worker itself |
| GenesisBlock worker, Tier 4 | Physical Stage 13, 15–16, physical Stage 17 publication + query | Separate package; pulls work and pushes receipts through MSP |

Source: zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:109-114 ("เจ้าของและขอบเขตการเรียก" table).

## 2. Current pins (frozen contract, unchanged unless stated)

| Pin | Value | Source |
|---|---|---|
| Wire schema | `genesisrag17.v1` | zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:15; gks-ki17:packages/gks-contracts/src/pipeline.mjs:13 |
| Parser (Stage 2) | `genesisrag17-parser-1` | zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:14; zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:213 |
| Chunker default | 80 whitespace tokens/window | zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:18 (`GENESIS_RAG17_DEFAULT_MAX_TOKENS`) |
| Extraction profile | `rule_v1` — explicit .90, structured .85, inferred ≤.70, write floor .80 | gks-ki17:packages/gks-contracts/src/pipeline.mjs:48-53 (`PIPELINE_CONFIDENCE`) |
| Ontology | `ontology_v1` — predicates `WORKS_FOR`, `PURCHASED`; endpoints `PERSON`/`ORGANIZATION`/`PRODUCT` | gks-ki17:packages/gks-core/src/pipeline.mjs:22-30 (`RELATION_ALIASES`), :35 (`ENDPOINT_TYPES`) |
| Enrichment | `enrich_v1` — per-entity `documentCount`/`chunkCount`/`factCount` | gks-ki17:packages/gks-core/src/pipeline.mjs:421-443 (`derivePipelineSummaries`) |
| Model | `intfloat/multilingual-e5-small` rev `614241f622f53c4eeff9890bdc4f31cfecc418b3`, 384-d, cosine | gks-ki17:packages/gks-contracts/src/pipeline.mjs:54-59; GenesisBlock-ki17:genesisrag17-worker/README.md |
| Quality thresholds | Recall@5 ≥ .80, MRR ≥ .65, citation = 1.00, cross-tenant leaks = 0 | gks-ki17:packages/gks-contracts/src/pipeline.mjs:60-64 (`PIPELINE_QUALITY_THRESHOLDS`) |
| Nine MSP tools | `msp_pipeline_{submit,claim,graph_receipt,write_receipt,stage_failure,gate,publication_receipt,evidence,query}` | msp-ki17:packages/msp-contracts/schemas/GENESISRAG17.tools.json:68,101,132,150,184,224,251,287,320 |

## A. Stage 2 — new parser profile `genesisrag17-parser-2`

| | Current (`-parser-1`) | Proposed (`-parser-2`) |
|---|---|---|
| Input | Free text/Markdown | One JSON array of structured records (SmartGift catalog export) |
| Behavior | Section-splits on headings, then windows each section at `maxTokens` (default 80) via `splitRange` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:59-71,85-114 | Each array element is one section (no heading detection); `content` remains the exact serialized JSON substring for that record so offsets stay literal |
| Version stamp evidence | `parserVersion` field on the parsed artifact, derived by `genesisRag17ParserIdentity()` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:142-146 | New constant `GENESIS_RAG17_PARSER_VERSION_2 = 'genesisrag17-parser-2'`; `genesisRag17ParserIdentity()` gains a `profile` argument so identity is `genesisrag17-parser-2` (or `;chunker=...` suffixed if windowed) |

**Coexistence — already mechanically supported, no new conflict logic needed.**
`ensureParsedArtifact` looks up an existing parsed artifact by
`repository.findParsedByRawAndParser(rawArtifactId, parserVersion)` — zuri-ai:
apps/server/src/platform/integrations/core/genesisrag17-executor.js:570-571. Because
the lookup key already includes `parserVersion`, a `genesisrag17-parser-2` parse of
the same `rawArtifactId` creates a **separate** parsed-artifact row; it cannot collide
with, overwrite, or be confused with a `-parser-1` row of the same raw content. The
409 "reused with different immutable content" guard (executor.js:580) only fires
within one parser version. **Backward reader**: every existing consumer keys off
`parsedArtifactId`, not off the parser version string, so no reader needs to change
to keep reading `-parser-1` artifacts once `-parser-2` exists.

**One document per run, one batch per Stage 9 attempt is unaffected.** ADR-073 D2
(zuri-ai:docs/decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md:43)
says one document per run — a SmartGift catalog export is *one document* (the JSON
array), chunked into N per-record chunks inside *one* Stage 9 batch. No wire change
needed for multiple records; `zGenesisRag17Batch.chunks` is already `z.array(...).min(1)`
(zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:117).

## B. Stage 7 — one chunk per record

| Current | Proposed |
|---|---|
| `splitRange()` windows a section at `maxTokens` (default 80 whitespace tokens), splitting long sections into multiple chunks — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:59-71 | For `-parser-2`, chunk boundaries are the record boundaries the parser already emitted as sections (§A). `splitRange`'s token-window logic is bypassed for this profile: one section → one chunk, regardless of token count. If a single record's serialized JSON exceeds a sane size, that is a data-quality warning to raise at the SmartGift export boundary, not a Stage 7 window split (splitting a JSON record loses the "exact record" invariant this whole profile exists for) |
| Offsets/hash contract | `zGenesisRag17Chunk.contentHash`/`startOffset`/`endOffset` unchanged — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:83-91; `assertGenesisRag17BatchIntegrity` still requires `content.slice(startOffset, endOffset) === chunk.text` (contract.js:323) | **No change.** The chunk is still an exact substring of the parsed document's `content`; it is just guaranteed (by construction, not by a new rule) to equal exactly one record's JSON text |

## C. Stage 8 — new mention types `OFFER`, `PACKAGE`, `CATEGORY`

| | Current | Proposed |
|---|---|---|
| Recognized types | `Organization` (legal-form regex, entity-extraction.js:102-110), plus `Person`/`Product` added directly in `addHit()` calls inside `genesisrag17-source.js:198-203` | Add `OFFER`, `PACKAGE`, `CATEGORY` (SmartGift's `Product` already exists as a type per zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:201,203) |
| Recognizer extensibility | `extractGenesisRag17Mentions` **hard-rejects any recognizer other than `defaultRecognizer`**: `if (recognizer !== defaultRecognizer) throw ... 'GENESISRAG17_CUSTOM_RECOGNIZER_UNSUPPORTED'` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:183-187 | This guard must be relaxed for a **versioned** structured-record recognizer (e.g. `structuredRecognizerV1`), not opened generally — keep the doc's own caution: "recognizer option" is the Stage 8 extension point (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:155) but changing it is explicitly a versioned-extension decision, not a free parameter |
| `resolutionKey` derivation | `addHit()` **always** calls `resolutionKey: normalizeOrganizationName(value)` regardless of semantic type — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:174 | For structured-record mentions, `resolutionKey` must be the SmartGift canonical code (e.g. `SG-TM-500`, `cat:drinkware`) **verbatim**, not re-derived through `normalizeOrganizationName` (an organization-legal-affix stripper that is semantically wrong for a product/offer/category code, even though it happens to be a no-op on codes with no legal-form suffix today — relying on that coincidence is not a contract). The structured path must bypass `normalizeOrganizationName` entirely and pass the caller-supplied code straight through |
| `sourceMentionId` vs `resolutionKey` separation | Already required and tested: `sourceMentionId` is `${chunkId}:mention:${index}`, distinct from `resolutionKey` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:207-208; ADR-073 D2 ("Occurrence sourceMentionId differs from the semantic resolution key" — zuri-ai:docs/decisions/ADR-073-...md:42) | **No change.** The existing separation already satisfies the structured-record case — one occurrence id per record-field, one stable resolution key per SmartGift code |
| Downstream requirement | — | Doc's own extension-map row for Stage 8 says explicitly: "ส่งทุก occurrence พร้อม type; 9 resolution และ 11 endpoint schema ต้องรองรับด้วย" (send every occurrence with its type; Stage 9 resolution and Stage 11 endpoint schema must support it too) — zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:155. Sections D below is that required Stage 11 work |

## D. Stage 10/11 — GKS `ontology_v2`

### D.1 New predicates and their required endpoint types

| Predicate | Subject type | Object type | Notes |
|---|---|---|---|
| `HAS_COMPONENT` | `PACKAGE` | `PRODUCT` | A package/gift-set contains a product |
| `PRICED_AT` | `PRODUCT` or `PACKAGE` | new endpoint (§D.2) | Needs a tier qualifier — see below |
| `IN_CATEGORY` | `PRODUCT` or `PACKAGE` | `CATEGORY` | |
| `PACKAGED_AS` | `PRODUCT` | `PACKAGE` | Inverse of `HAS_COMPONENT`; keep both only if both directions are queried — otherwise drop one to avoid a redundant edge per pair |

**Endpoint-type validation is currently hardcoded, not table-driven — this is the real
architectural work item.** `validEndpoint` in `buildPipelineDecision` is a two-branch
ternary keyed on predicate name:

```
// gks-ki17:packages/gks-core/src/pipeline.mjs:289-291
const validEndpoint = predicate === "WORKS_FOR"
  ? subjectType === ENDPOINT_TYPES.PERSON && objectType === ENDPOINT_TYPES.ORGANIZATION
  : (subjectType === ENDPOINT_TYPES.PERSON || subjectType === ENDPOINT_TYPES.ORGANIZATION) && objectType === ENDPOINT_TYPES.PRODUCT;
```

Adding four more predicates by extending this ternary is how the bug that produced
`ADR-073`'s own caution would be reintroduced. **Proposal: replace the ternary with a
predicate→endpoint-type-pair table** (`ONTOLOGY_V2_ENDPOINTS: Map<predicate, {subject:
Set<type>, object: Set<type>}>`), covering both `ontology_v1`'s two existing predicates
(unchanged behavior) and the four new ones. `RELATION_ALIASES` (gks-ki17:packages/
gks-core/src/pipeline.mjs:22-30) also needs entries mapping SmartGift's raw-predicate
vocabulary (however Stage 10 emits it — see §D.3) to these canonical predicate names.
`ENDPOINT_TYPES` (line 35) becomes `{PERSON, ORGANIZATION, PRODUCT, OFFER, PACKAGE,
CATEGORY}`.

### D.2 Representing a tier-qualified `PRICED_AT` fact without breaking the fact shape

The internal `facts` object shape (`{id, subjectId, predicate, objectId, confidence,
temporal, sourceReferences, basis, pipelineVersion}` — gks-ki17:packages/gks-core/src/
pipeline.mjs:314-323) has **no qualifier field today**, and — important scope finding
— **this object never crosses the wire to zuri-ai or MSP.** There is no
`validateFact`/`validatePipelineFact` export in gks-contracts (confirmed: no match for
a fact-shape validator in packages/gks-contracts/src/pipeline.mjs). Only `decision.graph
.edges` (built from `facts` at gks-ki17:packages/gks-core/src/pipeline.mjs:336, `edges:
facts.map(fact => ({id, from, predicate, to, confidence, temporal, sourceReferences}))`)
crosses to the GenesisBlock worker at Stage 13 claim; MSP relays it as an opaque payload
(msp-ki17:apps/msp-server/src/transport/handlers/pipeline-handlers.mjs forwards
`{...payload}` verbatim — it does not inspect fact/edge shape). So this is a **two-repo**
decision (GKS producer, worker consumer), not a four-repo wire-contract change — MSP and
zuri-ai are unaffected by the fact shape itself.

Two options, in order of preference:

| Option | Shape | Trade-off |
|---|---|---|
| **A — qualifier as a distinct entity (recommended)** | Model `PRICED_AT` as `PRODUCT --PRICED_AT--> PriceTier`, where `PriceTier` is a new entity whose `resolutionKey`/`name` canonically encodes `{productCode}:{tier}:{price}` (e.g. `SG-TM-500:MOQ50:150THB`). The fact shape is **unchanged** — no new field | Multiplies entity count (one `PriceTier` node per tier per product); `enrich_v1`'s per-entity counts (§F) then count price tiers as entities too, which may or may not be desired and should be an explicit product decision, not an accident |
| **B — additive optional field on the internal fact/edge object** | Add `qualifiers: Record<string, string> \| undefined` next to `predicate` on both `facts[]` (gks-core/pipeline.mjs:314-323) and `graph.edges[]` (gks-core/pipeline.mjs:336) | Since it never crosses to zuri-ai/MSP, this is safe to add as GKS-internal + worker-consumed only; but the worker's `expectedGraphReadback` node/edge counting (gks-core/pipeline.mjs:339-341) and its own graph projection must both learn to carry/ignore the field, and Stage 17's `knownSourceReference`/readback-count checks (pipeline.mjs:452-457, 480-509) must not treat it as changing edge identity |

**Recommendation for the agreement:** Option A, because it requires no schema change
anywhere and the existing Stage 17 data/graph dimension checks (§F) already validate
arbitrary entity/edge counts without modification. Option B is listed because "no new
field silently added by one repo" cuts both ways — if the four owners prefer B, GKS and
the worker are the only two repos that need to agree, and MSP/zuri-ai should still be
informed since the change is happening under the same `genesisrag17.v1` version label.

### D.3 How `rule_v1` "structured .85" already applies

`parseStructuredClaim()` already recognizes a chunk whose text is exactly a JSON object
with `subject`/`predicate`/`object` (or `value`) string fields, and assigns it
`confidence: PIPELINE_CONFIDENCE.structured` (0.85) with `basis: "structured"` — gks-ki17:
packages/gks-core/src/pipeline.mjs:86-101,242. **This is a strong existing fit**: if
Stage 7's per-record chunk text (§B) is (or contains) a JSON object shaped
`{"subject": "<product code>", "predicate": "IN_CATEGORY", "object": "<category code>"}`,
Stage 10 already classifies it as a structured claim at 0.85 confidence with zero GKS
code change to *that* function — only the `RELATION_ALIASES`/endpoint-type work in
§D.1 is required for the new predicate names to survive `normalizePredicate()` and
`validEndpoint`. If SmartGift's raw JSON record shape does not naturally read as
`{subject, predicate, object}` triples (it is a catalog record, not a triple), Stage 7's
`-parser-2` chunk emission (§B) should synthesize one or more such triple-shaped strings
per record (e.g., derived from the product's `categoryId` field) rather than relying on
`parseExplicitClaims`' prose-relation regex, which will not match structured JSON at all.

### D.4 HELD for unknown/invalid predicates

Unchanged mechanism, must be tested against the new predicates before/after §D.1 lands:

| Condition | HELD reason | Source |
|---|---|---|
| `normalizePredicate()` returns null (predicate not in `RELATION_ALIASES`) and confidence ≥ write floor | `"unknown_predicate"` | gks-ki17:packages/gks-core/src/pipeline.mjs:279-282 |
| Predicate known but subject/object types don't match its endpoint rule | `"invalid_endpoint"` | gks-ki17:packages/gks-core/src/pipeline.mjs:289-294 |

**Critical interaction with Stage 17 (see §F):** `evaluatePipelineQuality`'s knowledge
dimension treats **any** non-empty `decision.held` as WARN
(`` `${decision.held.length} fact(s) remain held for review.` `` — gks-ki17:packages/
gks-core/src/pipeline.mjs:536), and per the flow doc, "Stage17 รับ PASS เท่านั้น; WARN
เป็น terminal failure ที่ไม่ publish" (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:199 — a step in the audit-remediation notes). **This means every SmartGift record
whose relation Stage 10 cannot map to a known predicate/endpoint pair blocks publication
of the whole run**, not just that one fact. §D.1's endpoint table must be complete for
every relation SmartGift's fixtures actually emit before acceptance (§I), or the fixture
set must intentionally include at least one record that is *expected* to HELD and prove
the run still terminates as a documented failure rather than a false PASS.

## E. Stage 12 — catalog version validity (temporal)

`temporalClaim()` (gks-ki17:packages/gks-core/src/pipeline.mjs:151-176) reads dates
**only from the chunk's raw text** via regex (`\b\d{4}-\d{2}-\d{2}...`), independent of
whether the claim was structured or explicit — there is no structured temporal input
path today. Two outcomes already exist and require **no GKS code change**:

| SmartGift emits | `temporalClaim` outcome | Status |
|---|---|---|
| An ISO 8601 date (`YYYY-MM-DD`) literally present in the chunk text (e.g. the catalog's source-version date embedded in the record's JSON, such as `"catalogVersionDate": "2026-09-01"`) | `dates.length` ≥ 1 → `validFrom`/`validTo` set from the matched date(s), `status: "mapped"` | Explicit, `mapped` |
| No date-shaped text and no human/relative/temporal-language match in the chunk | Falls through to the default: `validFrom: "not_applicable"`, `validTo: "not_applicable"`, `status` stays `"not_applicable"` (the function's initial value, gks-ki17:packages/gks-core/src/pipeline.mjs:165-167) | Explicit `not_applicable` |

**Proposal:** Stage 2's `-parser-2` profile should always place the source catalog's
version date as a literal ISO-8601 substring inside the JSON text that becomes the
chunk, so it round-trips as `mapped`. If a given record legitimately has no version
date, emit nothing date-shaped — the existing default already produces the explicit
`not_applicable` this item asks for. **No Stage 12 code change is proposed.**

## F. Stage 14 enrich_v1 / Stage 15-16 / Stage 17

| Stage | Expected change | Why |
|---|---|---|
| 14 (`enrich_v1`) | **None.** `derivePipelineSummaries()` iterates `decision.entities` generically and counts `documentCount`/`chunkCount`/`factCount` per entity regardless of `semanticType` — gks-ki17:packages/gks-core/src/pipeline.mjs:421-443. New entity types (`OFFER`/`PACKAGE`/`CATEGORY`, and any `PriceTier` per §D.2 Option A) are counted the same way automatically | Function has no type-conditional logic |
| 15 (embed) | **None.** Embedding operates on chunk text uniformly — GenesisBlock-ki17:genesisrag17-worker/src/worker.mjs; no entity/predicate-aware branch found in the embedding path | Model/pin/dimension unaffected |
| 16 (index) | **None.** `laneManifest()` computes all six lanes from generic counts (`readback.edgeCount`, `readback.nodeCount`, `this.lexical.count(...)`, etc.) — GenesisBlock-ki17:genesisrag17-worker/src/worker.mjs:1533-1565. No lane is keyed by entity/predicate type | Six lanes: vector, lexical, graph, sqlite, bitemporal, provenance (all generic) |
| 17 (gate) | **Two of five dimensions are affected; three are not.** | See below |

**Stage 17's five dimensions** (`dimensions = { data, graph, knowledge, security,
retrieval }` — gks-ki17:packages/gks-core/src/pipeline.mjs:556):

| Dimension | Affected? | Why |
|---|---|---|
| `data` | No | Checks source-reference/derived-summary integrity generically (pipeline.mjs:466-497) |
| `graph` | No (indirectly exercised, not logic-changed) | Compares actual vs. `expectedGraphReadback` counts, computed generically from entity/fact/held counts (pipeline.mjs:339-341); new types just change the numbers, not the check |
| `knowledge` | **Yes** | `decision.ontologyVersion !== PIPELINE_ONTOLOGY_VERSION` is checked against the literal string `"ontology_v1"` (pipeline.mjs:534). **If §D bumps the ontology to `ontology_v2`, this line must be updated in the same change or every run using the new predicates will FAIL the knowledge dimension outright** ("ontology version is not ontology_v1" is a *critical* reason — pipeline.mjs:537). Also: any HELD fact (§D.4) sets this dimension to WARN, which is a terminal failure per the flow doc |
| `security` | No | Scope-completeness and cross-tenant-leak checks are unrelated to entity/predicate vocabulary (pipeline.mjs:540-542) |
| `retrieval` | No (benchmark-driven) | Recall@5/MRR/citation/cross-tenant-leak thresholds are fixture-driven (§I), not type-driven |

## G. Wire/envelope — every proposed field, by owner

Per the change protocol, no repo may add a field unilaterally
(zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:218). This table is the actual
agreement surface:

| Field / change | Owner repo | Crosses to | MSP relay awareness needed? |
|---|---|---|---|
| `GENESIS_RAG17_PARSER_VERSION_2 = 'genesisrag17-parser-2'` (§A) | zuri-ai | Internal (parsed-artifact metadata only; never leaves Tier 1) | No |
| New Stage 8 `semanticType` values `OFFER`/`PACKAGE`/`CATEGORY` | zuri-ai (producer) | `zGenesisRag17Mention.semanticType` is already an unconstrained `zNonEmptyString` (zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:96) and GKS's wire validator only requires a non-empty string too (`requirePipelineString` — gks-ki17:packages/gks-contracts/src/pipeline.mjs:326). **No wire schema change needed** — only the GKS-internal `ENDPOINT_TYPES` set (§D.1) needs the new values | No |
| `RELATION_ALIASES` + endpoint-type table entries for `HAS_COMPONENT`/`PRICED_AT`/`IN_CATEGORY`/`PACKAGED_AS` (§D.1) | GKS | Internal to Stage 10/11 | No |
| `PIPELINE_ONTOLOGY_VERSION = 'ontology_v2'` (§F) | GKS | Appears in the immutable `decision.ontologyVersion` and — via `zGenesisRag17WriteReceipt`/evidence rows — is visible to zuri-ai as opaque `details`, but zuri-ai does not validate its value | Not for routing (MSP relays opaquely); GKS/zuri-ai should still record the version bump in the shared changelog so an evidence reader knows which ontology a run used |
| `qualifiers` on `facts[]`/`graph.edges[]` (§D.2 Option B, if chosen over Option A) | GKS (producer) | GenesisBlock worker (consumer, Stage 13 claim payload) | No — MSP forwards the claim payload as an opaque object (msp-ki17:apps/msp-server/src/transport/handlers/pipeline-handlers.mjs, generic `{...payload}` spread) |
| Source catalog version date embedded in chunk text (§E) | zuri-ai (Stage 2 producer) | Consumed by GKS Stage 12 as ordinary chunk text — no schema field | No |

**`credential`/`relayCredential` mapping — noted as a risk, kept out of scope.** MSP
strips any inbound `credential` field and substitutes its own configured
`MSP_GKS_PIPELINE_CREDENTIAL` as `relayCredential` before calling GKS
(msp-ki17:apps/msp-server/src/transport/handlers/pipeline-handlers.mjs:13,26-28). This
proposal introduces no new credential field and does not touch that mapping.

**"Nine tools" vs. eight `gks_pipeline_*` — noted as a risk, kept out of scope.** MSP
exposes nine `msp_pipeline_*` tools (msp-ki17:packages/msp-contracts/schemas/
GENESISRAG17.tools.json — 9 `"name"` entries) while GKS's own tool list
(gks-ki17:packages/gks-contracts/src/pipeline-tools.mjs:20-59) defines eight
`gks_pipeline_*` tools (no `query` — query goes to the worker's loopback endpoint
instead, per msp-ki17:apps/msp-server/src/transport/handlers/pipeline-handlers.mjs's
`suffix === "query"` branch). This is a pre-existing discrepancy unrelated to
structured records; this proposal neither depends on nor changes it.

## H. Versioning / replay

| Rule | Application here |
|---|---|
| A semantic change creates a new processing version/attempt/generation; earlier snapshots stay queryable | `-parser-2` is a distinct `parserVersion` (§A) → distinct parsed-artifact row, distinct chunk set, distinct Stage 9 batch/attempt. `ontology_v2` is a distinct `PIPELINE_ONTOLOGY_VERSION` string recorded on `decision.ontologyVersion`. Neither rewrites a `-parser-1`/`ontology_v1` snapshot; both are additive, coexisting versions exactly like ADR-073's own D2/D3 intent |
| Old evidence stays readable but cannot complete newer attempts | Unaffected — this proposal adds no new evidence-cursor semantics; Stage 9-17 evidence rows already carry `pipelineStageId`/`executionStepId`/`attemptId`, independent of parser/ontology version (zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:139-153) |
| No repo silently reuses a snapshot | The `findParsedByRawAndParser` dedupe key (§A) already enforces this at the zuri-ai layer for parsed artifacts; GKS's `decisionId` is a hash of `{scope, batchId, batchHash}` (gks-ki17:packages/gks-core/src/pipeline.mjs:343), so a batch built under `ontology_v2` from different chunks naturally produces a different `decisionId` |

## I. Fixtures / tests required per boundary

Follow the existing pattern in zuri-ai:apps/server/tests/acceptance/genesisrag17-e2e.test.js
(`describe('GenesisRAG17 actual four-process acceptance (no skips)', ...)`, lines 71+),
which already covers: raw→publish citation resolution (91), restart-after-correction
(160), wrong scope/forged reporter (188), malformed-evidence cursor safety (194),
FR-071 replay with new attempts (272), reply-loss resend (294), crash recovery at each
stage (244), and negated/ambiguous temporal text (411). This profile needs the same
shape of coverage, scoped to the new boundary:

| Boundary | Positive | Negative | Duplicate | Reply loss | Restart | Wrong scope |
|---|---|---|---|---|---|---|
| Stage 2 `-parser-2` | Valid JSON array parses to N sections/chunks with exact offsets | Malformed JSON record → parser error, no chunks emitted | Same raw content + `-parser-2` twice → same `parsedArtifactId`, no duplicate row (409 guard already exists, executor.js:580) | Resubmitted `submit` with identical batch → idempotency key reused, no double-write | Executor restarts mid Stage-2/7 → resumes from durable intent (ADR-073 mechanism, unchanged) | Batch scope mismatch → rejected before Stage 9 (existing `assertGenesisRag17ScopeEqual`) |
| Stage 8 new types | Each of `OFFER`/`PACKAGE`/`CATEGORY` extracted with correct `resolutionKey`=SmartGift code (not organization-normalized) | A record whose code is missing/blank → no mention emitted, not a crash | Two records with the same category code → same `resolutionKey`, two distinct `sourceMentionId`s | n/a (Stage 8 is Tier 1 local) | n/a | n/a |
| Stage 10/11 `ontology_v2` | `HAS_COMPONENT`/`PRICED_AT`/`IN_CATEGORY`/`PACKAGED_AS` each produce a `facts[]` entry with the correct endpoint types at 0.85 (`structured`) confidence | An unrecognized predicate string → `"unknown_predicate"` HELD, verified the run still terminates (as WARN/no-publish, not a crash or false PASS) | n/a | n/a | n/a | n/a |
| Stage 12 temporal | Chunk with embedded ISO date → `status: "mapped"` | Chunk with no date-shaped text → explicit `"not_applicable"` (not `"unmapped"`) | n/a | n/a | n/a | n/a |
| Stage 17 gate | A full SmartGift fixture run reaches PASS with `allowPublication: true` | A fixture with ≥1 deliberately-unmappable record reaches WARN/no-publish and the run's evidence explains why (§D.4) | n/a | n/a | n/a | Cross-tenant SmartGift catalogs isolate identically to the existing two-tenant test (genesisrag17-e2e.test.js:455) |

**Acceptance metrics (unchanged thresholds, new fixture):** a new fixed corpus (parallel
to `apps/server/tests/fixtures/genesisrag17-corpus-v1.json`) built from a SmartGift-
shaped catalog, run through the real four-process chain, must reach Recall@5 ≥ .80,
MRR ≥ .65, citation correctness = 1.00, cross-tenant leaks = 0
(gks-ki17:packages/gks-contracts/src/pipeline.mjs:60-64) before this profile is
considered accepted — per the existing rule, this is a benchmark of the fixture set,
not a claim about production quality (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:222).

## Open items requiring explicit four-repo agreement before any code

1. §D.1 — accept the proposed predicate/endpoint table, or a different vocabulary for
   `HAS_COMPONENT`/`PRICED_AT`/`IN_CATEGORY`/`PACKAGED_AS`.
2. §D.2 — Option A (qualifier-as-entity, no schema change) vs. Option B (`qualifiers`
   field on facts/edges, GKS+worker only).
3. §D.1 — confirm `ontology_v2` as the version label, and that bumping
   `PIPELINE_ONTOLOGY_VERSION` plus the Stage 17 `knowledge` dimension check (§F) land
   in the *same* GKS change (they must not be split across two PRs, or every run in
   between fails the knowledge dimension for a reason unrelated to its own content).
4. §C — confirm relaxing the `defaultRecognizer`-only guard in
   `extractGenesisRag17Mentions` for a named, versioned structured recognizer is
   acceptable, and that its identity is itself pinned/frozen like the parser version.
5. §I — confirm the new SmartGift fixture corpus location/ownership (likely zuri-ai,
   mirroring `genesisrag17-corpus-v1.json`) and that all four repos test against the
   same fixture commit, per the doc's own requirement to "ระบุ fixture/commit/model/
   schema versions ทุกครั้ง" (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:222).

## Explicitly out of scope

- The `credential`/`relayCredential` mapping in MSP (§G) — pre-existing, unrelated.
- The nine `msp_pipeline_*` vs. eight `gks_pipeline_*` tool-count discrepancy (§G) —
  pre-existing, unrelated.
- `apps/server/src/modules/knowledge/smartgift-knowledge-catalog.js` — this is an
  **existing, unrelated** curated fixture (FR-024) that once fed a GenesisBlockDB
  seeder retired by ADR-063; it is a static data file for a different (non-
  GenesisRAG17) test fixture path, not a structured-record intake surface. This
  proposal does not touch it and does not reuse its content as the new corpus, though
  its product/category/policy records are a reasonable model for what the new fixture
  corpus (§I) should look like.
- The parallel, already-`structuredRecords`-aware `knowledge-ingestion-executor.js` /
  `stage-runner.js` / `entity-extraction.js` pipeline (FR-109/FR-110/FR-118, zuri-ai:
  apps/server/src/platform/integrations/core/knowledge-ingestion-executor.js) is a
  **different, receiver-based** Tier 1 implementation of the same 17-stage catalog,
  not the isolated forward pipeline this proposal targets (`genesisrag17-executor.js`,
  ADR-073). It already accepts `structuredFields`/`structuredRecords` inputs
  (zuri-ai:apps/server/src/modules/knowledge/stage-runner.js:29-30) and its
  `extractEntityCandidates` already reads a caller-named `mention` field from records
  at confidence 1.0 (zuri-ai:apps/server/src/modules/knowledge/entity-extraction.js:
  48-93) — worth reading as design precedent for §C's structured recognizer, but it is
  **not wired to MSP/GKS/worker today** and this proposal does not merge the two
  pipelines. Flagging this split is itself a finding: zuri-ai currently has two
  non-identical "17-stage" Tier 1 implementations, and reconciling them is a separate,
  larger decision outside this proposal's scope.
