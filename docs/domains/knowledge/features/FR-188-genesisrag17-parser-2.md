---
id: ZAI:FR-188-IMPLEMENTATION
feature: FR-188
module: knowledge
domain: knowledge
source: v2-native
version: "0.1.0b"
status: beta
created_at: "2026-09-11T12:30:00+07:00,Claude Opus 5"
last_update: "2026-09-11T12:30:00+07:00,Claude Opus 5"
relations:
  - type: references
    target: ZAI:ADR-075
  - type: relates_to
    target: ZAI:FR-187
  - type: references
    target: ZAI:GENESISRAG17-CONTRACT
---

# FR-188 — `genesisrag17-parser-2` and the structured recognizer (Tier 1, Stages 1–8)

This is the zuri-ai side of ADR-075 D6 (Phase 2): contract revision 2 in
`.brain/proposals/2026-09-11-genesisrag17-structured-record-profile.md`. It is
**rollout step 3**. It merges only after the GenesisBlock worker accepts
`{ontology_v1, ontology_v2}` (step 1) and GKS accepts both and produces
`ontology_v2` (step 2). Until then a SmartGift decision would fail the worker's
or the gate's version check. MSP needs no change: it relays opaquely.

No model, column, migration or deployment. Nothing here changes the
`genesisrag17.v1` wire: no field is added. `rule_v1`, `enrich_v1` and the
metrics are unchanged.

## What changed

| Stage | Prose sources (unchanged) | `SMARTGIFT_CATALOG` sources |
|---|---|---|
| 2 parse | `genesisrag17-parser-1`; parsed content = raw text | `genesisrag17-parser-2`; parsed content = the rendered record text |
| 7 chunk | sections windowed at 80 whitespace tokens | one rendered section = one chunk, no window (`chunkBoundary: record-section`) |
| 8 mentions | `rule_v1`, `resolutionKey = normalizeOrganizationName(name)` | `genesisrag17-structured-recognizer-1`, `resolutionKey` = SmartGift code verbatim |

The profile follows the provider (`genesisRag17ParserProfileForProvider`). A caller
cannot choose it: naming `genesisrag17-parser-1`, a token budget or a chunker
version on a SmartGift source is a 400 `GENESISRAG17_PARSER_CONFIG_UNSUPPORTED`.
The recognizer guard stays closed. Its one exception is the pinned structured
recognizer object (C-6); any other function is still
`GENESISRAG17_CUSTOM_RECOGNIZER_UNSUPPORTED`.

### Rendering (C-4)

Each record renders as one **descriptive** section, followed by one **claim**
section per relation. Sections are joined by one blank line.

- The descriptive section's first line is `<entityType> <own code>`, followed by
  `key: value` lines. It carries exactly one mention, the record's own entity:
  `Product` (ProductMaster), `PACKAGE` (BundleOffer) or `PRICE_TIER`
  (PriceListEntry). It carries no date.
- A claim section's **whole text** is the canonical JSON (sorted keys, no
  whitespace — this repository's `canonicalGenesisRag17Json`) of
  `{subject, predicate, object}`, for example
  `{"object":"eco-friendly","predicate":"IN_CATEGORY","subject":"PM-BOTTLE-LED"}`.
  Subject and object are exact substrings of that text and are the two mentions
  of that chunk. That is exactly what GKS `parseStructuredClaim` +
  `occurrenceMatches` need for a `structured` .85 claim.

| Record | Relations |
|---|---|
| ProductMaster | `IN_CATEGORY` product → its `category` |
| BundleOffer | `HAS_COMPONENT` package → each component product; `IN_CATEGORY` if it names a category |
| PriceListEntry | `PRICED_AT` product or package → `PRICE_TIER` `{itemCode}:qty{qty}:{priceInSatang}` |

`ProductMaster.priceTiersThb` and `BundleOffer.offerPriceTiersThb` stay in the
descriptive text only. The fixture's PriceListEntry records are the priced facts.

### Stage 8 typing

- A descriptive chunk's type comes from its header entity type.
- A claim object's type comes from the predicate: `HAS_COMPONENT` → `Product`,
  `PRICED_AT` → `PRICE_TIER`, `IN_CATEGORY` → `CATEGORY`.
- A claim subject is `PACKAGE` when its code starts with `PKG-`, SmartGift's
  bundle namespace, and `Product` otherwise. The renderer refuses any
  ProductMaster/BundleOffer whose own type disagrees with that rule, and any
  bundle component that is a `PKG-` code. So the rule can only ever decide the
  one case the record does not state itself: the item a PriceListEntry prices.

### Where the catalog version date comes from (C-5)

The date comes from **an optional record field, `catalogVersionDate`**
(`YYYY-MM-DD`, a real calendar date). SmartGift's exporter stamps its export
manifest date identically on every record of one export. The field is inside
the immutable record bytes, so the record's `contentHash` covers it, and two
parses of the same raw can never differ. The adapter's strict shapes (FR-187)
accept it.

- When it is present, every claim chunk carries exactly that one ISO date, as a
  fourth canonical-JSON key. Descriptive chunks carry none. `updatedAt` never
  appears, and a second date never appears.
- When it is absent, no chunk carries a date. **The frozen fixture has none,
  so its batches are uniformly undated** and GKS maps every fact
  `not_applicable`.
- A multi-record source that mixes dated and undated records, or two dates, is
  a parser error. A batch is never mixed (C-10).
- A claim that GKS would read as a second date, a negation, a question or
  unmapped temporal language (`in 2026`, `from 1000`, …) is refused at Stage 2.
  It is never left to be held downstream as `temporal_unmapped`. The detectors
  mirror GKS `temporalClaim` exactly.

### Lineage consequences inside Tier 1

Before FR-188, parsed content always equalled raw content, and three places
relied on it. Each now uses the parser's own output:

1. **Stage 9 batch.** GKS and the worker both require every chunk to be a
   substring of `source.content` and `contentHash = sha256(content)`. So the
   batch carries the parsed content. For parser-1 that is the raw text byte for
   byte, so prose batches are unchanged.
2. **Citation resolver.** For a parser-2 artifact the resolver re-renders the
   raw bytes and requires the stored parsed content to match. The chunk is then
   checked against the parsed content. `contentHash` returned to the corpus is
   still the raw hash.
3. **Corpus publication.** A parser-2 batch's source hash is accepted only when
   the ingestion's parsed artifact is a `genesisrag17-parser-2` child of the
   same raw artifact and hashes to it.

### Identity and replay

The parser version is part of `parsedArtifactId`. So a parser-2 parse of a raw
gets its own parsed row and never collides with a parser-1 row. The same raw
parsed twice reuses one row: the render is deterministic, and the 409 guard
fires only on different content. The text-profile intent derivation is byte
for byte the pre-FR-188 shape, so every existing prose intent replays
unchanged. A SmartGift intent created under parser-1 before this change would
be refused on replay as `GENESISRAG17_INTENT_CONFLICT`. That is correct: it is a
different processing version. FR-187 is not deployed, so no such intent exists
outside test databases.

### Stage 2 versus Stage 5

Parser-2 validates the shapes it renders. Unknown **top-level** fields are
stripped, not rejected. They are never rendered, and a customer-shaped field
must still reach the Stage 5 Zero-PII deny (ADR-075 D5) with its own terminal
evidence. Admission stays strict. Any other malformed record fails Stage 2 with
422 `GENESISRAG17_STRUCTURED_RECORD_INVALID` and emits no parsed artifact, chunk
or batch. Its details name paths and codes, never values.

## Where this departs from, or reads into, contract revision 2

- §A says the input is "one JSON array of structured records". FR-187 admits
  one record per raw artifact, so parser-2 accepts a single record object or an
  array.
- §B writes the triple as `{"subject", "predicate", "object"}`. The bytes are
  this repository's canonical JSON, whose sorted key order is
  object, predicate, subject. GKS parses either.
- §C's example category key is `cat:drinkware`. The fixture's categories are
  bare slugs (`eco-friendly`), and they are used verbatim, as C-6 requires.
- C-7 asked for one deliberately HELD record in the fixture. The frozen,
  hash-pinned fixture has none: every relation it emits maps to a v2 predicate
  with valid endpoints. The four-process acceptance run (PR #335) then showed
  why the record could not have produced a Stage 17 warning at all: parser-2
  mirrors every guard GKS would hold on, so such a record is refused at Stage 2
  with `GENESISRAG17_STRUCTURED_RECORD_INVALID` — no batch, no decision, no
  publication, and the previously published generation untouched. The contract
  records that as C-7 rev 2.1; Stage 17's WARN path still covers prose sources.
- Descriptive sections are checked for ISO dates only. Temporal language inside
  a data value (a product name) is not refused, because a one-mention
  descriptive chunk produces no fact to hold.

## Not done here

- The four-process acceptance run on the SmartGift corpus (§I Stage 17 row and
  the Recall@5 / MRR / citation / cross-tenant thresholds) needs steps 1 and 2
  merged first.
- The PRD-SDD, FEATURES and ROADMAP status of FR-188 is left to the integration
  owner after PR #326 lands.

## Code and proof

- `apps/server/src/modules/knowledge/genesisrag17-structured-record.js` —
  rendering, guards and the structured recognizer.
- `apps/server/src/modules/knowledge/genesisrag17-source.js` — profile
  identity, parse dispatch and the recognizer exception.
- `apps/server/src/platform/integrations/core/genesisrag17-executor.js` —
  provider-selected profile, recorded recognizer identity, batch content and
  resolver.
- `apps/server/src/modules/knowledge/knowledge-corpus-service.js` and
  `knowledge-repository.js` — the publication hash check.
- `apps/server/src/modules/knowledge/smartgift-catalog-adapter.js` —
  `catalogVersionDate`, and bundle `category`.
- Tests: `apps/server/tests/unit/genesisrag17-parser-2.test.js`,
  `apps/server/tests/integration/genesisrag17-parser-2.test.js`, and the
  parser-2 case in `apps/server/tests/integration/knowledge-corpus.test.js`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-11 | beta | ADR-075 Phase 2 Tier 1 side: parser-2 rendering, pinned structured recognizer, parsed-content lineage, rollout-step-2 doc pins; merges after the worker and GKS `ontology_v2` PRs; not deployed | working-tree | Claude Opus 5 |
