---
status: PROPOSAL rev 2 — owner approved Option A on 2026-09-11; four-repo acceptance pending; NO IMPLEMENTATION
revision: 2
title: GenesisRAG17 structured-record ingestion profile (SmartGift catalog)
date: 2026-09-11
last_update: "2026-09-11T03:33:48+07:00,Claude Opus 5"
author: Claude (session, zuri-ai-adr075 worktree)
pipeline: genesisrag17.v1 (ADR-073)
pinned_commits:
  zuri-ai: feat/fr-187-smartgift-catalog-adapter@f5261cf8  # Phase 1
  GKS: origin/main@2b205f0
  MSP: origin/main@15b4565
  GenesisBlock: origin/main@5dc75ff
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

Code citations use these prefixes: `zuri-ai:` (this worktree, unless `zuri-ai@f5261cf8:`),
`GKS@2b205f0:`, `MSP@15b4565:`, `GenesisBlock@5dc75ff:`. The earlier `*-ki17` branches
are merged into those `origin/main` commits.

## Revision 2 — four-repo review outcome and owner decisions (2026-09-11)

Four reviewers (zuri-ai Tier 1, MSP Tier 2, GKS Tier 3, GenesisBlock worker Tier 4) read
revision 1 against each repo's `origin/main` on 2026-09-11. Several of its statements were
wrong. This revision corrects them in place. The binding decision list, which every repo's
acceptance note cites, is summarised here.

**Owner decisions**

| Id | Decision |
|---|---|
| O-1 | **Option A is chosen**: a tier-qualified price is a distinct `PRICE_TIER` entity, so the fact shape is unchanged. |
| O-2 | **Option B** (an optional `qualifiers` field on facts/edges) is **deferred as a future option, not rejected**. Adopting it later needs a new contract revision and its own four-repo gate, because it changes the frozen decision shape (zuri-ai:docs/plans/GENESISRAG17-CONTRACT.md:44) and every `decisionHash` input. |
| O-3 | The GenesisBlock worker changes too. Revision 1 said it did not, which was wrong. |

**Contract decisions (revision 2)**

| Id | Topic | Decision |
|---|---|---|
| C-1 | Scope | GKS `pipelineClaim` hands the worker the whole stored decision (`entities[]`, `facts[]`, `held[]`, `derived[]`, `graph`, `ontologyVersion`) — GKS@2b205f0:packages/gks-core/src/index.mjs:367-372. The fact shape crosses Tier 3 → Tier 4, and zuri-ai's frozen contract doc pins the version literal. So this is a **four-repo** contract change. MSP relays opaquely and needs no code change. |
| C-2 | Vocabulary | `ontology_v2` is a superset of `ontology_v1`: `WORKS_FOR` and `PURCHASED` are unchanged; `HAS_COMPONENT`, `PRICED_AT` and `IN_CATEGORY` are new (§D.1). `PACKAGED_AS` is dropped. There is no `OFFER` type; BundleOffer records map to `PACKAGE`. The type is spelled `PRICE_TIER`. GKS and the worker carry the same predicate→endpoint table. |
| C-3 | Versions/rollout | GKS's Stage 17 gate and the worker's Stage 13 check both accept the fixed set {`ontology_v1`, `ontology_v2`}. Each decision is validated against its own version's table. New decisions are produced as v2, and in-flight v1 decisions complete under v1 rules (no drain). Rollout is accept-before-produce: (1) worker accepts both; (2) GKS accepts both and produces v2; (3) zuri-ai sends parser-2 batches. Doc pins change at step 2. |
| C-4 | Chunking | parser-2 emits one DESCRIPTIVE chunk per record, carrying exactly one mention, plus one CLAIM chunk per relation whose whole text is the canonical JSON triple (§B, §D.3). `rule_v1` is unchanged. |
| C-5 | Temporal | Every claim chunk carries exactly one ISO-8601 date, the catalog version date; if the manifest has none, no claim chunk carries a date, so a batch is never mixed (C-10). It never carries `updatedAt`. Descriptive chunks carry no date, and rendered text avoids temporal-language phrases (§E). |
| C-6 | Stage 8 recognizer | A pinned `genesisrag17-structured-recognizer-1` is the only exception to the `defaultRecognizer`-only guard. Its `resolutionKey` is the SmartGift code verbatim (§C). |
| C-7 | Unknown relations | Every relation the fixture emits maps to a v2 predicate with valid endpoints, or else it is HELD. One record in the fixture is deliberately held, to prove a documented WARN/no-publish result (§D.4). |
| C-8 | Fixtures/tests | The shared corpus lives at zuri-ai:apps/server/tests/fixtures/genesisrag17/smartgift-catalog/ (commit 87184a97, re-pinned at implementation). Each repo also keeps local cases (§I). Metrics are unchanged. |
| C-9 | Changes per repo | zuri-ai: source/parser/recognizer, acceptance tests and doc pins. MSP: none. GKS: contracts, core table, gate and docs. Worker: version check, predicate table and `entityKind()`, plus tests (§F, §G). |
| C-10 | Mixed-temporal lane count (pre-existing) | GKS expects `facts.length` bitemporal objects unless every fact is `not_applicable`; the worker counts only `mapped` rows. A mixed generation fails the Stage 17 graph dimension. C-5 keeps catalog batches uniform, so Phase 2 does not depend on it; the fix is GKS-side, tracked separately. |

## 0. Problem statement

SmartGift's catalog (products, categories, bundle offers, pricing tiers) is
**structured JSON**, one record per product, bundle or category — not prose. The current
`genesisrag17.v1` Stage 2 profile (`genesisrag17-parser-1`) only understands section-
delimited free text/Markdown. Stage 8 only recognizes `Person`/`Organization`/`Product`
mentions found by regex over prose (zuri-ai:apps/server/src/modules/knowledge/
genesisrag17-source.js:20-26). Feeding a JSON catalog through the prose parser would
either fail structurally or silently mis-chunk/mis-extract it. This proposal adds a
**second, coexisting Stage 2 profile** for structured records, plus the Stage 7/8/10/11/
12/13/17 changes that profile requires in all four repos. `genesisrag17-parser-1`'s
behavior for existing prose sources does not change.

## 1. Ownership and call boundary (recap, unchanged by this proposal)

| Repo / Tier | Owns | Contract boundary |
|---|---|---|
| zuri-ai, Tier 1 | Stage 1–8: immutable raw/parsed/chunk lineage, one batch/attempt | Sends the Stage 9 batch over MSP; never writes substrate |
| MSP, Tier 2 | Credential/scope check, opaque relay; no stage logic | Forwards `msp_pipeline_*` payloads verbatim to GKS/worker |
| GKS, Tier 3 | Stage 9–14 decisions, Stage 17 verdict, durable receipts | Passive server; never calls the worker itself |
| GenesisBlock worker, Tier 4 | Physical Stage 13, 15–16, physical Stage 17 publication + query | Separate package; pulls work (the full decision, C-1) and pushes receipts through MSP |

Source: zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:58-65 ("เจ้าของและขอบเขตการเรียก" table).

## 2. Current pins (frozen contract, unchanged unless stated)

| Pin | Value | Source |
|---|---|---|
| Wire schema | `genesisrag17.v1` | zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:15; GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:14 |
| Parser (Stage 2) | `genesisrag17-parser-1` | zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:14; zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:213 |
| Chunker default | 80 whitespace tokens/window | zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:18 (`GENESIS_RAG17_DEFAULT_MAX_TOKENS`) |
| Extraction profile | `rule_v1` — explicit .90, structured .85, inferred ≤.70, write floor .80 | GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:48-53 (`PIPELINE_CONFIDENCE`) |
| Ontology | `ontology_v1` — predicates `WORKS_FOR`, `PURCHASED`; endpoints `PERSON`/`ORGANIZATION`/`PRODUCT` | GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:15 (`PIPELINE_ONTOLOGY_VERSION`); GKS@2b205f0:packages/gks-core/src/pipeline.mjs:22-30 (`RELATION_ALIASES`), :35 (`ENDPOINT_TYPES`); GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs:280 (version literal); zuri-ai:docs/plans/GENESISRAG17-CONTRACT.md:44 |
| Enrichment | `enrich_v1` — per-entity `documentCount`/`chunkCount`/`factCount` | GKS@2b205f0:packages/gks-core/src/pipeline.mjs:421-442 (`derivePipelineSummaries`) |
| Model | `intfloat/multilingual-e5-small` rev `614241f622f53c4eeff9890bdc4f31cfecc418b3`, 384-d, cosine | GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:54-59; GenesisBlock@5dc75ff:genesisrag17-worker/README.md |
| Quality thresholds | Recall@5 ≥ .80, MRR ≥ .65, citation = 1.00, cross-tenant leaks = 0 | GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:60-65 (`PIPELINE_QUALITY_THRESHOLDS`) |
| Nine MSP tools | `msp_pipeline_{submit,claim,graph_receipt,write_receipt,stage_failure,gate,publication_receipt,evidence,query}` | MSP@15b4565:packages/msp-contracts/schemas/GENESISRAG17.tools.json:68,101,132,150,184,224,251,287,320 |

## A. Stage 2 — new parser profile `genesisrag17-parser-2`

| | Current (`-parser-1`) | Proposed (`-parser-2`) |
|---|---|---|
| Input | Free text/Markdown | One JSON array of structured records (SmartGift catalog export) |
| Behavior | Section-splits on headings, then windows each section at `maxTokens` (default 80) via `splitRange` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:59-71,85-114 | Renders each record into one descriptive section and one claim section per relation (C-4, §B); no heading detection. Parsed `content` is the rendered text, so chunk offsets stay literal substrings of it |
| Version stamp evidence | `parserVersion` field on the parsed artifact, derived by `genesisRag17ParserIdentity()` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:142-146 | New constant `GENESIS_RAG17_PARSER_VERSION_2 = 'genesisrag17-parser-2'`; `genesisRag17ParserIdentity()` gains a `profile` argument so identity is `genesisrag17-parser-2` (or `;chunker=...` suffixed if windowed) |

**Coexistence — already mechanically supported, no new conflict logic needed.**
`ensureParsedArtifact` looks up an existing parsed artifact by
`repository.findParsedByRawAndParser(rawArtifactId, parserVersion)` — zuri-ai@f5261cf8:
apps/server/src/platform/integrations/core/genesisrag17-executor.js:583. Because
the lookup key already includes `parserVersion`, a `genesisrag17-parser-2` parse of
the same `rawArtifactId` creates a **separate** parsed-artifact row. It cannot collide
with, overwrite, or be confused with a `-parser-1` row of the same raw content. The
409 "reused with different immutable content" guard (zuri-ai@f5261cf8:…/genesisrag17-executor.js:594)
only fires within one parser version. **Backward reader**: every existing consumer keys off
`parsedArtifactId`, not the parser version string, so no reader needs to change
to keep reading `-parser-1` artifacts once `-parser-2` exists.

**One document per run, one batch per Stage 9 attempt is unaffected.** ADR-073 D2
(zuri-ai:docs/decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md:49)
says one document per run. A SmartGift catalog export is *one document* (the JSON
array), chunked into descriptive + claim chunks inside *one* Stage 9 batch. No batch wire
change is needed for multiple records: `zGenesisRag17Batch.chunks` is already
`z.array(...).min(1)` (zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:117).

## B. Stage 7 — one descriptive chunk plus one claim chunk per relation (C-4)

Revision 1 proposed "one chunk per record". That conflicts with `rule_v1`, which extracts
**at most one structured claim per chunk**, and is replaced by:

- **one DESCRIPTIVE chunk per record**, for retrieval, carrying **exactly one mention** (the
  record's own entity);
- **one CLAIM chunk per relation**, whose **entire text** is exactly the canonical JSON object
  `{"subject": <code>, "predicate": <PREDICATE>, "object": <code>}`, where subject and object
  equal mention names that occur as exact substrings of that chunk.

Why:

| Constraint in GKS | Consequence |
|---|---|
| `parseStructuredClaim()` returns one `{subject, predicate, object}` or null, and Stage 10 takes it as the chunk's only claim — GKS@2b205f0:packages/gks-core/src/pipeline.mjs:86-104, 240-243 | A record with a category, components and price tiers needs one chunk per relation |
| It parses `JSON.parse(text.trim())` — the **whole** chunk must be the JSON object; prose around it falls to the `subject: … predicate: …` line regex or to nothing (pipeline.mjs:88-99) | A claim chunk contains nothing but the triple |
| Subject/object resolve only through `occurrenceMatches`, which requires a mention in that chunk whose name equals the value and whose offsets slice to it (pipeline.mjs:75-78, 101-102) | Each claim chunk carries the subject and object mentions at their exact offsets |
| Text containing `?`, `never`, `does not` (and similar negations) returns null (pipeline.mjs:100) | Claim-chunk text must contain none of them |
| A chunk with ≥2 mentions and no parsed claim becomes an INFERRED .70 candidate, held below the write floor (pipeline.mjs:244-245, 265) | A descriptive chunk carries at most one mention (§D.4) |

The alternative — a multi-triple Stage 10 rule — would need a new extraction profile
version and is not chosen.

| | Current | Proposed |
|---|---|---|
| Boundaries | `splitRange()` windows a section at `maxTokens` (default 80 whitespace tokens) — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:59-71 | For `-parser-2`, chunk boundaries are the rendered descriptive/claim sections (§A); the token window is bypassed. An oversize descriptive record is a data-quality warning at the SmartGift export boundary, not a window split |
| Offsets/hash contract | `zGenesisRag17Chunk.contentHash`/`startOffset`/`endOffset` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:83-91; `assertGenesisRag17BatchIntegrity` requires `content.slice(startOffset, endOffset) === chunk.text` (contract.js:323) | **No change.** Every chunk is still an exact substring of the parsed document's `content` |

## C. Stage 8 — new mention types `PACKAGE`, `CATEGORY`, `PRICE_TIER`

| | Current | Proposed |
|---|---|---|
| Recognized types | `Organization` (legal-form regex, entity-extraction.js:102-110), plus `Person`/`Product` added directly in `addHit()` calls inside `genesisrag17-source.js:198-203` | Add `PACKAGE`, `CATEGORY`, `PRICE_TIER` (C-2). `Product` already exists (zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:201,203). SmartGift BundleOffer records map to `PACKAGE`; there is no `OFFER` type |
| Recognizer extensibility | `extractGenesisRag17Mentions` **hard-rejects any recognizer other than `defaultRecognizer`** (`GENESISRAG17_CUSTOM_RECOGNIZER_UNSUPPORTED`) — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:183-187 | One named, versioned exception: `genesisrag17-structured-recognizer-1` (C-6), pinned like the parser version. The guard is not opened generally — "recognizer option" is the Stage 8 extension point (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:155), but changing it is a versioned-extension decision |
| `resolutionKey` derivation | `addHit()` **always** sets `resolutionKey: normalizeOrganizationName(value)` regardless of semantic type — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:174 | Structured mentions use the SmartGift code **verbatim** (e.g. `PM-BOTTLE-LED`, `cat:drinkware`) and bypass `normalizeOrganizationName`. That function is a legal-affix stripper, and its being a no-op on today's codes is a coincidence, not a contract. The Phase 1 `externalId` already equals the SmartGift code. A `PRICE_TIER` key is `{productCode}:{tier}:{price}`, e.g. `PM-BOTTLE-LED:qty100:<satang>` |
| `sourceMentionId` vs `resolutionKey` separation | Already required and tested: `sourceMentionId` is `${chunkId}:mention:${index}` — zuri-ai:apps/server/src/modules/knowledge/genesisrag17-source.js:207; ADR-073 D2 ("Occurrence sourceMentionId differs from the semantic resolution key" — zuri-ai:docs/decisions/ADR-073-GENESISRAG17-ISOLATED-EXECUTION-AND-PUBLICATION.md:49) | **No change.** One occurrence id per chunk occurrence; one stable resolution key per SmartGift code |
| Downstream requirement | — | The flow doc's Stage 8 row says "ส่งทุก occurrence พร้อม type; 9 resolution และ 11 endpoint schema ต้องรองรับด้วย" (send every occurrence with its type; Stage 9 resolution and Stage 11 endpoint schema must support it too) — zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:155. §D is that Stage 11 work, and §F covers the worker's matching Stage 13 work |

## D. Stage 10/11 — `ontology_v2` (GKS and worker)

### D.1 Vocabulary (C-2)

`ontology_v2` is a **superset** of `ontology_v1`:

| Predicate | Subject type | Object type | Status |
|---|---|---|---|
| `WORKS_FOR` | `PERSON` | `ORGANIZATION` | unchanged from v1 |
| `PURCHASED` | `PERSON` or `ORGANIZATION` | `PRODUCT` | unchanged from v1 |
| `HAS_COMPONENT` | `PACKAGE` | `PRODUCT` | new |
| `PRICED_AT` | `PRODUCT` or `PACKAGE` | `PRICE_TIER` | new (Option A, O-1) |
| `IN_CATEGORY` | `PRODUCT` or `PACKAGE` | `CATEGORY` | new |

Endpoint types in v2: `PERSON`, `ORGANIZATION`, `PRODUCT`, `PACKAGE`, `CATEGORY`, `PRICE_TIER`.

- `PACKAGED_AS` is dropped: it is only the reverse of `HAS_COMPONENT` and would add one
  redundant edge per pair.
- `OFFER` is not in v2 because no predicate uses it. It can be added in a later revision when a
  predicate needs it.
- The type is spelled `PRICE_TIER`: GKS `normalizeType` lower-cases, folds `[\s_-]` to a
  space and upper-cases with `_` (GKS@2b205f0:packages/gks-core/src/pipeline.mjs:37-43),
  so `"PriceTier"` would become `PRICETIER`.

**Endpoint validation becomes one predicate → {subject types, object types} table, and GKS
and the worker carry the same table content.** Today both sides hard-code v1:

```
// GKS@2b205f0:packages/gks-core/src/pipeline.mjs:289-291
const validEndpoint = predicate === "WORKS_FOR"
  ? subjectType === ENDPOINT_TYPES.PERSON && objectType === ENDPOINT_TYPES.ORGANIZATION
  : (subjectType === ENDPOINT_TYPES.PERSON || subjectType === ENDPOINT_TYPES.ORGANIZATION) && objectType === ENDPOINT_TYPES.PRODUCT;
```

- The worker has two copies of the same rule: `validateFact` (GenesisBlock@5dc75ff:
  genesisrag17-worker/src/worker.mjs:303-305) and the graph-build loop (:1156-1160).
  `validateFact` also carries a predicate allowlist, `['WORKS_FOR', 'PURCHASED']` (:296).
- The worker's `entityKind()` (:758-763) maps only person/organization/company/product.

GKS extends `RELATION_ALIASES` (pipeline.mjs:22-30) and `ENDPOINT_TYPES` (:35) and replaces
the ternary with the table. The worker replaces its copies with the same table and extends
`entityKind()` with package/category/price_tier. Each side selects the table by the
decision's `ontologyVersion` (C-3).

### D.2 Representing a tier-qualified `PRICED_AT` fact — Option A chosen (O-1)

The fact object shape (`{id, subjectId, predicate, objectId, confidence, temporal,
sourceReferences, basis, pipelineVersion}` — GKS@2b205f0:packages/gks-core/src/
pipeline.mjs:313-323) has no qualifier field. **This object crosses the wire (C-1).**
GKS `pipelineClaim` returns each stored decision whole — `entities[]`, `facts[]`, `held[]`,
`derived[]`, `graph`, `ontologyVersion` — to the worker (GKS@2b205f0:packages/gks-core/src/
index.mjs:367-372), and MSP relays that payload verbatim (MSP@15b4565:apps/msp-server/src/
transport/handlers/pipeline-handlers.mjs:13, 28). The worker then validates it:

- the version literal (GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs:280);
- the predicate allowlist and endpoint ternaries (:296, :303-305, :1156-1160);
- `entityKind` (:758-763).

zuri-ai's frozen contract doc pins the decision shape and `ontologyVersion:"ontology_v1"`
(zuri-ai:docs/plans/GENESISRAG17-CONTRACT.md:44). The fact shape and ontology version are
therefore a **four-repo** contract, not a GKS-plus-worker matter. MSP needs no code change
because it does not inspect them.

| Option | Shape | Status |
|---|---|---|
| **A — qualifier as a distinct entity** | `PRODUCT\|PACKAGE --PRICED_AT--> PRICE_TIER`, where the `PRICE_TIER` entity's `resolutionKey` is `{productCode}:{tier}:{price}` (e.g. `PM-BOTTLE-LED:qty100:<satang>`). The fact shape is **unchanged** | **Chosen by the owner, 2026-09-11 (O-1).** Consequence: one `PRICE_TIER` node per tier per product, and `enrich_v1` counts them as entities (§F) |
| **B — optional `qualifiers` field on facts/edges** | `qualifiers: Record<string,string> \| undefined` on `facts[]` and `graph.edges[]` | **Deferred future option (O-2), not rejected.** It changes the frozen decision shape (GENESISRAG17-CONTRACT.md:44) and every `decisionHash` input, so it needs its own contract revision and four-repo gate. It also cannot model a literal-value object in GKS today: every fact object must be a resolved mention entity (`subjectId`/`objectId` come from `entityByMentionId` — GKS@2b205f0:packages/gks-core/src/pipeline.mjs:248-260) |

### D.3 How `rule_v1` "structured .85" applies

`parseStructuredClaim()` recognizes a chunk whose whole text is a JSON object with string
`subject`/`predicate`/`object` (or `value`) fields. It emits a claim at
`PIPELINE_CONFIDENCE.structured` (0.85) with `basis: "structured"` when both endpoints
resolve to mentions in that chunk (GKS@2b205f0:packages/gks-core/src/pipeline.mjs:86-104,
240-243). The C-4 claim chunk (§B) is built to meet exactly that. The function itself needs
no change; only the §D.1 aliases/table are needed so the new predicate names survive
`normalizePredicate()` (pipeline.mjs:45-48) and endpoint validation. `parseExplicitClaims`'
prose-relation regex never matches the JSON and is not relied on.

### D.4 HELD paths

The mechanism is unchanged. It must be tested against the new predicates:

| Condition | HELD reason | Source |
|---|---|---|
| Chunk has ≥2 mentions and no parsed structured/explicit claim → INFERRED candidate at `inferredMax` (.70) → below write floor | `"confidence_below_write_floor"` | GKS@2b205f0:packages/gks-core/src/pipeline.mjs:244-245, 265 |
| `normalizePredicate()` returns null (predicate not in `RELATION_ALIASES`) and confidence ≥ write floor | `"unknown_predicate"` | GKS@2b205f0:packages/gks-core/src/pipeline.mjs:279-282 |
| Predicate known but subject/object types do not match its endpoint rule | `"invalid_endpoint"` | GKS@2b205f0:packages/gks-core/src/pipeline.mjs:289-294 |

The first row is why a C-4 descriptive chunk carries exactly one mention.

**Interaction with Stage 17 (see §F):** `evaluatePipelineQuality`'s knowledge
dimension treats **any** non-empty `decision.held` as WARN
(`` `${decision.held.length} fact(s) remain held for review.` `` — GKS@2b205f0:packages/
gks-core/src/pipeline.mjs:536). The flow doc says "Stage17 รับ PASS เท่านั้น; WARN
เป็น terminal failure ที่ไม่ publish" (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:199).
So one unmappable relation blocks publication of the whole run. Per C-7:

- every relation the fixture emits maps to a v2 predicate with valid endpoint types;
- the fixture set also includes one record that is expected to be HELD, and its test proves
  that the run ends as a documented WARN/no-publish, never a false PASS.

## E. Stage 12 — catalog version validity (temporal)

`temporalClaim()` (GKS@2b205f0:packages/gks-core/src/pipeline.mjs:151-175) reads dates
**only from the chunk's raw text** by regex, whether or not the claim was structured.
There is no structured temporal input path. Two outcomes already exist and need **no GKS
code change**:

| Chunk text | `temporalClaim` outcome | Status |
|---|---|---|
| Contains an ISO 8601 date (`YYYY-MM-DD`) | The first date becomes `validFrom`; a second date, if any, becomes `validTo` (pipeline.mjs:160-163) | `mapped` |
| No date-shaped text and no human/numeric/relative/temporal-language match | Keeps the initial `validFrom`/`validTo`/`status` = `"not_applicable"` (pipeline.mjs:157-159) | explicit `not_applicable` |
| (to avoid) Human/numeric/relative date or temporal-language phrase without an ISO date | `validFrom`/`validTo` null, `status: "unmapped"` (pipeline.mjs:164-167) → HELD `temporal_unmapped` (:302-306) | held |

**Rules for `-parser-2` rendering (C-5), asserted by parser-2 tests:**

- Every claim chunk carries **exactly one** ISO-8601 date: the catalog version date from the
  source manifest. If the manifest has no version date, no claim chunk carries a date. A batch
  is therefore uniformly dated or uniformly undated, never mixed (see the C-10 finding below).
- It never carries `updatedAt` or any second date, because a second date would become
  `validTo`.
- Descriptive chunks carry no date.
- Rendered text avoids phrases the temporal-language regex matches (pipeline.mjs:156; e.g.
  "from 1000", "in 2026"), which would be held as `temporal_unmapped`.

An undated batch falls to the existing default and produces `not_applicable` for every fact.
**No Stage 12 code change is proposed.**

**C-10 finding — mixed-temporal lane count (pre-existing, not a Phase 2 dependency).** One
generation can contain both dated (`mapped`) and `not_applicable` facts. GKS's expected
bitemporal lane count is `allFactsNotApplicable ? 0 : facts.length`
(GKS@2b205f0:packages/gks-core/src/pipeline.mjs:404, 410), so a mixed generation expects an
object for **every** fact. The worker's `verifyTemporalLane` reports only the rows it classifies
as `mapped` (GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs:243-258, 1471-1531). The
two counts differ, and GKS's graph dimension then FAILS on the lane-count comparison
(pipeline.mjs:528). This was confirmed by reading both sides on 2026-09-11. The C-5 rendering
rule keeps every catalog batch uniform, so the structured-record profile never produces a mixed
generation. The fix belongs in GKS: expect the count of `mapped` facts. It is tracked as its own
change with a mixed-generation test in GKS and the worker, and is not bundled into Phase 2.

## F. Stage 13 / 14 / 15-16 / 17

| Stage | Expected change | Why |
|---|---|---|
| 13 (worker validate + graph write) | **Code change required (C-9).** Version check (GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs:280) → the supported set {`ontology_v1`, `ontology_v2`}. Predicate allowlist (:296) and endpoint ternaries (:303-305, :1156-1160) → the shared, version-selected table. `entityKind()` (:758-763) gains package/category/price_tier. `test/worker.test.mjs` fixtures | The worker validates every claimed decision against v1 literals (C-1) |
| 14 (`enrich_v1`) | **None.** `derivePipelineSummaries()` iterates `decision.entities` generically and counts per entity regardless of `semanticType` — GKS@2b205f0:packages/gks-core/src/pipeline.mjs:421-442. `PACKAGE`/`CATEGORY`/`PRICE_TIER` entities are counted like any other; counting price tiers as entities follows from O-1 | No type-conditional logic |
| 15 (embed) | **None.** Embedding operates on chunk text uniformly — GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs; no entity/predicate-aware branch in the embedding path | Model/pin/dimension unaffected |
| 16 (index) | **None** in logic. `laneManifest()` computes the six lanes from generic counts — GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs:1533 onward. No lane is keyed by entity/predicate type (the mixed-temporal lane-count mismatch is the GKS-side C-10 finding) | Six lanes: vector, lexical, graph, sqlite, bitemporal, provenance |
| 17 (gate) | **One of five dimensions changes in code (knowledge); graph is exercised by §E's open item** | See below |

**Stage 17's five dimensions** (`dimensions = { data, graph, knowledge, security,
retrieval }` — GKS@2b205f0:packages/gks-core/src/pipeline.mjs:556):

| Dimension | Affected? | Why |
|---|---|---|
| `data` | No | Checks source-reference/derived-summary integrity generically (pipeline.mjs:466-497) |
| `graph` | No logic change | Compares actual vs. expected counts, computed generically from entity/fact/held counts (pipeline.mjs:338-341, 398-412); new types change the numbers, not the check. See the §E C-10 finding for the mixed-temporal lane count |
| `knowledge` | **Yes** | `decision.ontologyVersion !== PIPELINE_ONTOLOGY_VERSION` (pipeline.mjs:534) compares against the **imported constant** (GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:15); only the reason text `"ontology version is not ontology_v1."` is a literal, and it is critical (pipeline.mjs:537). Per C-3 the check becomes membership in the supported set {`ontology_v1`, `ontology_v2`}, with each decision validated against its own version's table, and the message is fixed. Rollout is accept-before-produce: (1) worker accepts both; (2) GKS accepts both and starts producing `ontology_v2` — the constant bump and the supported-set gate ship in that one GKS change; (3) zuri-ai sends parser-2 batches. In-flight v1 decisions finish under v1 rules, so no drain is needed. Any HELD fact (§D.4) still makes this dimension WARN, which is terminal |
| `security` | No | Scope-completeness and cross-tenant-leak checks are unrelated to the vocabulary (pipeline.mjs:540-542) |
| `retrieval` | No (benchmark-driven) | Recall@5/MRR/citation/cross-tenant thresholds are fixture-driven (§I) |

## G. Wire/envelope — every proposed change, by owner

Per the change protocol, no repo may add a field unilaterally
(zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:218). This table is the agreement surface:

| Field / change | Owner repo | Crosses to | MSP relay awareness needed? |
|---|---|---|---|
| `GENESIS_RAG17_PARSER_VERSION_2 = 'genesisrag17-parser-2'` + `genesisrag17-structured-recognizer-1` (§A, §C) | zuri-ai | Internal (parsed-artifact metadata; never leaves Tier 1) | No |
| Stage 8 `semanticType` values `PACKAGE`/`CATEGORY`/`PRICE_TIER` | zuri-ai (producer) | Batch: `zGenesisRag17Mention.semanticType` is an unconstrained `zNonEmptyString` (zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:96) and GKS only requires a non-empty string (`requirePipelineString` — GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:326), so **no batch schema change**. Decision: the types reach the worker inside `entities[]` (C-1) and need GKS `ENDPOINT_TYPES` plus worker `entityKind()` support | No |
| `RELATION_ALIASES` + predicate→endpoint table for `HAS_COMPONENT`/`PRICED_AT`/`IN_CATEGORY` (§D.1) | GKS | Facts carrying the new predicates reach the worker in the claimed decision (C-1) | No |
| `PIPELINE_ONTOLOGY_VERSION = 'ontology_v2'` + supported-version set (§F) | GKS (gks-contracts) | Recorded on the immutable `decision.ontologyVersion`, **validated by the worker** at Stage 13, and visible to zuri-ai as opaque evidence `details` | No (MSP relays opaquely) |
| Worker version check → supported set; predicate allowlist + endpoint ternaries → shared table; `entityKind()` extension (GenesisBlock@5dc75ff:genesisrag17-worker/src/worker.mjs:280, :296, :303-305, :1156-1160, :758-763) | GenesisBlock worker | Consumer of the claimed decision; must ship **first** (rollout step 1, C-3) | No |
| Frozen contract pin `ontologyVersion:"ontology_v1"` (zuri-ai:docs/plans/GENESISRAG17-CONTRACT.md:44) and flow-doc pins (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:158, :213) | zuri-ai | Documentation of the four-repo contract | No — updated in the implementation change that ships **rollout step 2**, not before, so no doc claims v2 is live early |
| `qualifiers` on `facts[]`/`graph.edges[]` (§D.2 Option B) | — | — | **Deferred future option (O-2)**; not part of revision 2 |
| Source catalog version date in claim-chunk text (§E) | zuri-ai (Stage 2 producer) | Consumed by GKS Stage 12 as ordinary chunk text — no schema field | No |

**`credential`/`relayCredential` mapping — noted as a risk, kept out of scope.** MSP
strips any inbound `credential` field and substitutes its own configured
`MSP_GKS_PIPELINE_CREDENTIAL` as `relayCredential` before calling GKS
(MSP@15b4565:apps/msp-server/src/transport/handlers/pipeline-handlers.mjs:13, 27-28). This
proposal introduces no new credential field and does not touch that mapping.

**"Nine tools" vs. eight `gks_pipeline_*` — noted as a risk, kept out of scope.** MSP
exposes nine `msp_pipeline_*` tools (MSP@15b4565:packages/msp-contracts/schemas/
GENESISRAG17.tools.json — 9 `"name"` entries). GKS's own tool list
(GKS@2b205f0:packages/gks-contracts/src/pipeline-tools.mjs) defines eight
`gks_pipeline_*` tools. It has no `query`: query goes to the worker's loopback endpoint
instead (MSP@15b4565:apps/msp-server/src/transport/handlers/pipeline-handlers.mjs:15-25,
`suffix === "query"` branch). This is a pre-existing discrepancy unrelated to
structured records. This proposal neither depends on it nor changes it.

## H. Versioning / replay

| Rule | Application here |
|---|---|
| A semantic change creates a new processing version/attempt/generation; earlier snapshots stay queryable | `-parser-2` is a distinct `parserVersion` (§A), so it gets its own parsed-artifact row, chunk set and Stage 9 batch/attempt. `ontology_v2` is a distinct version recorded on `decision.ontologyVersion`. Both GKS and the worker accept {v1, v2}, so v1 decisions already in flight complete under v1 rules (C-3). Neither rewrites a `-parser-1`/`ontology_v1` snapshot |
| Old evidence stays readable but cannot complete newer attempts | Unaffected. No new evidence-cursor semantics; Stage 9-17 evidence rows already carry `pipelineStageId`/`executionStepId`/`attemptId`, independent of parser/ontology version (zuri-ai:apps/server/src/modules/knowledge/genesisrag17-contract.js:139-153) |
| No repo silently reuses a snapshot | The `findParsedByRawAndParser` dedupe key (§A) enforces this for parsed artifacts. GKS's `decisionId` is a hash of `{scope, batchId, batchHash}` (GKS@2b205f0:packages/gks-core/src/pipeline.mjs:344), so a parser-2 batch from different chunks produces a different `decisionId` |

## I. Fixtures / tests required per boundary

Follow the existing pattern in zuri-ai:apps/server/tests/acceptance/genesisrag17-e2e.test.js
(`describe('GenesisRAG17 actual four-process acceptance (no skips)', ...)`, lines 71+).
It already covers:

- raw→publish citation resolution (91);
- restart-after-correction (160);
- wrong scope/forged reporter (188);
- malformed-evidence cursor safety (194);
- crash recovery at each stage (244);
- FR-071 replay with new attempts (272);
- reply-loss resend (294);
- negated/ambiguous temporal text (411).

This profile needs the same shape of coverage, scoped to the new boundary:

| Boundary | Positive | Negative | Duplicate | Reply loss | Restart | Wrong scope |
|---|---|---|---|---|---|---|
| Stage 2/7 `-parser-2` | Valid JSON array renders one descriptive chunk (one mention) + one claim chunk per relation, with exact offsets | Malformed JSON record → parser error, no chunks emitted; rendered text with a second ISO date, `updatedAt` or a temporal-language phrase fails the parser-2 test (C-5) | Same raw content + `-parser-2` twice → same `parsedArtifactId`, no duplicate row (409 guard, zuri-ai@f5261cf8:…/genesisrag17-executor.js:594) | Resubmitted `submit` with identical batch → idempotency key reused, no double-write | Executor restarts mid Stage-2/7 → resumes from durable intent (ADR-073 mechanism, unchanged) | Batch scope mismatch → rejected before Stage 9 (existing `assertGenesisRag17ScopeEqual`) |
| Stage 8 new types | Each of `PACKAGE`/`CATEGORY`/`PRICE_TIER` extracted with `resolutionKey` = SmartGift code verbatim (not organization-normalized) | A record whose code is missing/blank → no mention emitted, not a crash | Two records with the same category code → same `resolutionKey`, two distinct `sourceMentionId`s | n/a (Tier 1 local) | n/a | n/a |
| Stage 10/11 `ontology_v2` | `HAS_COMPONENT`/`PRICED_AT`/`IN_CATEGORY` each produce a `facts[]` entry with correct endpoint types at 0.85 (`structured`) | Unrecognized predicate → `unknown_predicate`; wrong endpoint type → `invalid_endpoint`; the run ends WARN/no-publish, not a crash or false PASS | n/a | n/a | n/a | n/a |
| Stage 12 temporal | Claim chunk with one embedded ISO date → `status: "mapped"` | Chunk with no date-shaped text → explicit `"not_applicable"` (not `"unmapped"`) | n/a | n/a | n/a | n/a |
| Stage 13 worker | `ontology_v2` decision with each new predicate/type accepted and written | `ontology_v1` decision still accepted; unsupported version → `DECISION_VERSION_INVALID` | n/a | n/a | n/a | n/a |
| Stage 17 gate | A full SmartGift fixture run reaches PASS with `allowPublication: true` | The deliberately held record reaches WARN/no-publish, and the run's evidence explains why (§D.4, C-7) | n/a | n/a | n/a | Cross-tenant SmartGift catalogs isolate like the existing two-tenant test (genesisrag17-e2e.test.js:455) |

**Per-repo local tests (C-8).** No repo's tests import another repo, so each keeps its own
cases alongside the shared corpus:

| Repo | File | Cases |
|---|---|---|
| zuri-ai | acceptance tests mirroring `apps/server/tests/acceptance/genesisrag17-e2e.test.js`, scoped to the new boundary; parser-2 unit tests | Rows above for Stages 2/7/8/12/17; C-4 chunk shape; C-5 date/phrase rules |
| GKS | `tests/contract/pipeline-genesisrag17.test.mjs` | A pass case and an `invalid_endpoint` case per predicate; a v1 regression; a v1 in-flight decision at the gate; the Stage 12 date cases; the inferred-hold case (§D.4); a `normKey` collision test for `PRICE_TIER` codes (resolution identity is `[normKey(resolutionKey), normalizeType(semanticType)]`, GKS@2b205f0:packages/gks-core/src/pipeline.mjs:56). Existing pins at lines 168 and 204 hard-code `ontology_v1` and are updated |
| GenesisBlock worker | `genesisrag17-worker/test/worker.test.mjs` | `ontology_v2` decisions with each new predicate/type; a v1 decision still accepted; the mixed-temporal bitemporal case (§E) |
| MSP (optional) | `tests/contract/pipeline-relay.test.mjs` | A structured batch proving relay transparency |

**Shared corpus and acceptance metrics (unchanged thresholds, new fixture):**

- The corpus is zuri-ai:apps/server/tests/fixtures/genesisrag17/smartgift-catalog/, at commit
  87184a97 today; the exact commit is pinned again at implementation.
- It is run through the real four-process chain.
- It must reach Recall@5 ≥ .80, MRR ≥ .65, citation correctness = 1.00 and cross-tenant
  leaks = 0 (GKS@2b205f0:packages/gks-contracts/src/pipeline.mjs:60-65) before this profile
  counts as accepted.
- Per the existing rule, this benchmarks the fixture set; it makes no claim about production
  quality (zuri-ai:docs/KNOWLEDGE-INGESTION-17-STAGE-FLOW.md:222).

## Open items — resolved in revision 2

1. **§D.1 vocabulary** — resolved by C-2: `HAS_COMPONENT`, `PRICED_AT`, `IN_CATEGORY` are added.
   `PACKAGED_AS` is dropped, there is no `OFFER`, and `PRICE_TIER` is added. v2 is a superset
   of v1, and GKS and the worker share one table.
2. **§D.2 Option A vs. B** — resolved by O-1/O-2: Option A is chosen, and Option B is deferred
   as a future option that needs its own contract revision and four-repo gate.
3. **`ontology_v2` label and gate timing** — resolved by C-3. Both GKS and the worker accept
   {`ontology_v1`, `ontology_v2`}, and rollout is accept-before-produce (worker → GKS →
   zuri-ai). The constant bump and the supported-set gate ship in one GKS change at step 2,
   together with the zuri-ai doc pins. Revision 1 framed this as a GKS-only same-PR rule; it
   is a cross-repo ordering rule.
4. **§C recognizer guard** — resolved by C-6: `genesisrag17-structured-recognizer-1` is the
   single pinned exception, and its `resolutionKey` is the SmartGift code verbatim.
5. **§I fixture location** — resolved by C-8: the corpus lives in zuri-ai at
   `apps/server/tests/fixtures/genesisrag17/smartgift-catalog/` and is re-pinned at
   implementation, with per-repo local tests.

**Remaining open verification (must close before acceptance, not before the gate note):**

- A `normKey` collision test for `PRICE_TIER` resolution keys in GKS (§I). Two distinct
  `{productCode}:{tier}:{price}` codes must not normalize to one entity.

## Explicitly out of scope

- The `credential`/`relayCredential` mapping in MSP (§G) — pre-existing, unrelated.
- The nine `msp_pipeline_*` vs. eight `gks_pipeline_*` tool-count discrepancy (§G) —
  pre-existing, unrelated.
- `apps/server/src/modules/knowledge/smartgift-knowledge-catalog.js`. This is an
  **existing, unrelated** curated fixture (FR-024) that once fed a GenesisBlockDB
  seeder retired by ADR-063. It is a static data file for a different (non-GenesisRAG17)
  test fixture path, not a structured-record intake surface. This proposal does not touch
  it or reuse its content.
- The parallel, already-`structuredRecords`-aware `knowledge-ingestion-executor.js` /
  `stage-runner.js` / `entity-extraction.js` pipeline (FR-109/FR-110/FR-118, zuri-ai:
  apps/server/src/platform/integrations/core/knowledge-ingestion-executor.js).
  - It is a **different, receiver-based** Tier 1 implementation of the same 17-stage
    catalog, not the isolated forward pipeline this proposal targets
    (`genesisrag17-executor.js`, ADR-073).
  - It already accepts `structuredFields`/`structuredRecords` inputs
    (zuri-ai:apps/server/src/modules/knowledge/stage-runner.js:29-30).
  - Its `extractEntityCandidates` reads a caller-named `mention` field from records at
    confidence 1.0 (zuri-ai:apps/server/src/modules/knowledge/entity-extraction.js:48-93),
    which is design precedent for §C's structured recognizer.
  - It is **not wired to MSP/GKS/worker today**, and this proposal does not merge the two
    pipelines. zuri-ai therefore has two non-identical "17-stage" Tier 1 implementations;
    reconciling them is a separate decision.

## Changelog

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| rev 2 | 2026-09-11 | PROPOSAL rev 2 — owner approved Option A; four-repo acceptance pending | Four-repo review outcome recorded (O-1..O-3, C-1..C-9). The fact shape crosses to the worker, so this is a four-repo change and the worker changes too. The vocabulary drops `PACKAGED_AS`/`OFFER` and adds `PRICE_TIER`. Chunking is one descriptive chunk plus one claim chunk per relation. Adds the inferred-hold path, the temporal rendering rules, the supported-version set with accept-before-produce rollout, worker Stage 13 changes, per-repo tests and the resolved open items. Citations re-pinned to `origin/main` commits and line numbers corrected | Claude Opus 5 |
| rev 1 | 2026-09-11 | PROPOSAL — not approved | Initial proposal | Claude Sonnet 5 |
