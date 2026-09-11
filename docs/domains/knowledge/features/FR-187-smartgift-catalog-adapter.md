---
id: ZAI:FR-187-IMPLEMENTATION
feature: FR-187
module: knowledge
domain: knowledge
source: v2-native
version: "0.1.0b"
status: beta
created_at: "2026-09-11T13:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-11T13:00:00+07:00,Claude Fable 5.1"
relations:
  - type: references
    target: ZAI:ADR-075
  - type: relates_to
    target: ZAI:FR-173
---

# FR-187 — SmartGift structured-record source adapter (Phase 1)

ADR-075 Phase 1 only: Tier 1 adapter code, **no new model, no column, no
migration, no deployment**. The record travels through the existing
`rule_v1` / `ontology_v1` profile as an opaque structured document; the typed
parser profile and `ontology_v2` are FR-188's four-repo contract change
(Phase 2) and are not started here.

## How it enters

It enters through the FR-173 admission queue, not beside it. A `FILE` source
that names `format: "SMARTGIFT_CATALOG_V1"` reaches the same
`admitKnowledge` boundary as every Text/Markdown admission: the same ACL
(`assertKnowledgeFileWritable`), the same runtime binding check, the same
byte freeze against `FileAsset.sha256`/`size`, and the same queue the
process-owned runtime drains into `ingestGenesisRag17Raw`. There is no second
caller, no second route and no second write path.

The adapter's only job is the extension map's "Before Stage 1" row: authorize,
freeze bytes/hash/version, split, enqueue. It synthesizes no stage result.

## Decisions this note records

**Identity (ADR-075 D3).** For each record in the projection:

| Field | Value |
|---|---|
| `sourceKey` | `smartgift-catalog:<fileName>#<record externalId>` |
| `version` | the file-level SHA-256 — SmartGift's registry hash for those exact bytes, which is also the `FileAsset.sha256` because they are the same bytes |
| `contentHash` | SHA-256 of `canonicalGenesisRag17Json(record)`, which is also the stored `content` |
| idempotency key | `hashGenesisRag17Json({ fileAssetId, fileSha256, externalId })`, namespaced the way every other admission key is |

`externalId` is the record key rather than `code` because it is the one field
all three shapes carry (`PriceListEntry` has no `code`), and because
`code`/`externalId` agree for the two shapes that carry both.

The per-record idempotency key deliberately **excludes the caller's request
key**. That is what makes re-admitting identical bytes report every record
`unchanged` regardless of which request key the caller used, instead of
colliding on `KNOWLEDGE_SOURCE_VERSION_CONFLICT`.

**A changed record is a new version, never a rewrite.** A corrected file is a
new version of the same `FileAsset`; the derived `sourceKey` is stable, so the
record takes revision 2 with a new `contentHash`, and the earlier ingestion
stays exactly where it was. Because the version is keyed to the *whole file*
(D3), an untouched record in a changed file also takes a new version — with an
identical `contentHash`, which is precisely what Stage 6 `DPS-KI-DEDUPE`
already reads as the same content in a new version. Cheaper per-record
versioning would need a second definition of "changed", which D3 declines.

**A file name is one source stream.** Two different `FileAsset`s claiming the
same catalog file name inside one corpus is refused with 409
`KNOWLEDGE_SOURCE_CONFLICT` rather than silently merged. The adapter is not
the right place to guess which of two assets is the real `products.json`.

**A record absent from a re-admitted file is not withdrawn.** Phase 1 admits
what the file contains; it does not diff the file against the corpus and it
does not revoke a source whose record disappeared. Withdrawal stays the
explicit `knowledge.source_withdraw` operation FR-173 already owns. A
delete-by-absence rule would let a truncated upstream export silently retire
live knowledge, which is a bigger decision than this phase makes.

**Zero-PII is per record, at two points (ADR-075 D5).** The deny expression is
ported verbatim from SmartGift's own
`pipeline/knowledge_registry/core.py` `DENIED`:

```
/05_crm_customer_data|customer|contact|quotation|ลูกค้า|ใบเสนอราคา/i
```

SmartGift applies that expression to *source locators* (file paths), never to
prose, and the port keeps that meaning. It inspects the source identity
(`sourceId`, `sourceUri`), every field **name** at any depth (a `customerName`
or `contact` field is structural evidence of a CRM shape) and the **values of
locator-like fields** (`file`, `path`, `uri`, `url`, `upstream`, `source`,
`origin`, `locator`). Descriptive text is not scanned: a corporate-gift
catalog legitimately says "ของขวัญสำหรับลูกค้าองค์กร", and a rule that refused
it would be a different policy from SmartGift's, not a stricter one. The
denial names the offending path (`record.provenance.upstreamFile`) and the
matched policy literal, never record data.

- In the **adapter, before enqueue**: a denied record never becomes a
  `KnowledgeSource` at all. The deny is **per record** — the other records in
  the same file still proceed, and the response reports the denied ones. A
  file in which *every* record is denied is a 422.
- At **Stage 5 `DPS-KI-CLASSIFY`**, for any structured provider, whatever
  route the record arrived by: the throw is a 422
  (`GENESISRAG17_ZERO_PII_DENIED`), so `runLocalStage` commits terminal
  `STEP_FAILED` evidence, the intent goes `FAILED`, and the runtime maps 422
  to a permanent `KNOWLEDGE_INGESTION_REJECTED`. Stage 6, chunking, Stage 8
  mentions and the Stage 9 batch never happen.

Stage 5 running *before* Stage 8 matters: the Stage 8 recognizer's
`EXPLICIT_PERSON` pattern matches the literal word `customer`, so a denied
record must die before any mention could be extracted from it.

**FlowAccount / SKU codes are attributes (ADR-075 D4, BR-002).** They are
fields on the record and never part of `sourceKey`. Nothing here touches
`Product`, and no new identity table is created.

**Sizes.** The 1 MiB `MAX_CONTENT_BYTES` is the **per-record** limit and is
enforced after splitting. The file gets its own explicit bound of **16 MiB**,
because upstream's real `pricelist_master.json` is ~6.4 MB and the per-record
limit cannot double as a file limit.

**JSON is admitted only with a format.** `application/json` passes the MIME
gate only when the caller names a known structured format; a bare `.json`
upload is still 415, exactly as before FR-187.

**Record shapes are strict.** `ProductMaster`, `BundleOffer` and
`PriceListEntry` are validated by strict Zod schemas, so an unexpected
upstream field is a 422 rather than a silent passenger. That is deliberate:
the fixture's whole point is that cost, margin, freight and supplier-identity
columns were stripped, and a strict schema is what stops one reappearing
unnoticed.

## Phase 1 limits, measured rather than patched

- **Chunking splits records mid-record.** Stage 7 uses the frozen 80-token
  `genesisrag17-chunker-1`, which knows nothing about JSON structure, so a
  record's canonical JSON is cut at token boundaries. That is FR-188's problem
  — a structured parser profile — and the `maxTokens` default and
  `genesisRag17ParserIdentity` are deliberately left alone here, because
  changing either would change the parser identity every existing artifact was
  built under.
- **No typed catalog occurrences.** Stage 8 still produces `rule_v1`
  Person/Organization/Product mentions over JSON text. `PRODUCT` / `OFFER` /
  `PACKAGE` / `CATEGORY` and `ontology_v2` are Phase 2.
- **Nothing is deployed.** Local tests only; no migration exists to apply
  because no column was added — the structured descriptor rides in the
  existing `KnowledgeIngestion.sourceMetaJson`.

## Code and proof

- `apps/server/src/modules/knowledge/smartgift-catalog-adapter.js` — shapes,
  splitter, identity, hashes.
- `apps/server/src/modules/knowledge/structured-record-policy.js` — the ported
  deny policy and its two call sites.
- `apps/server/src/modules/knowledge/knowledge-admission-service.js` — the
  `format` surface and the single-transaction fan-out.
- `apps/server/src/modules/knowledge/knowledge-runtime.js` — carries provider,
  entity type and content type from the admitted row.
- `apps/server/src/platform/integrations/core/genesisrag17-executor.js` — the
  Stage 5 gate and the carried `entityType`.
- Tests: `tests/unit/smartgift-catalog-adapter.test.js`,
  `tests/unit/knowledge-zero-pii-policy.test.js`,
  `tests/integration/smartgift-catalog-admission.test.js`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-11 | beta | ADR-075 Phase 1: structured-record adapter, per-record identity and Zero-PII deny at admission and Stage 5; implemented locally, not deployed | working-tree | Claude Fable 5.1 |
