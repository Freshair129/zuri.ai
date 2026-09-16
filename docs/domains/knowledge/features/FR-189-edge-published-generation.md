---
id: ZAI:FR-189-IMPLEMENTATION
feature: FR-189
module: knowledge
domain: knowledge
source: v2-native
version: "0.1.0b"
status: beta
created_at: "2026-09-11T20:00:00+07:00,Claude Opus 5"
last_update: "2026-09-11T20:00:00+07:00,Claude Opus 5"
relations:
  - type: references
    target: ZAI:ADR-075
  - type: relates_to
    target: ZAI:FR-187
  - type: relates_to
    target: ZAI:FR-188
---

# FR-189 — edge reads the published GenesisRAG17 generation (Phase 4, default off)

ADR-075 D7 and the Phase 4 row of D8, built as **code that does nothing until an
operator turns it on**. The owner approved Phase 4 on 2026-09-11. This change
enables nothing: no production setting changes, the running edge device and its
configuration are untouched, and no migration or deployment ships with it.
Phase 4 cannot do anything useful until the Phase 2 contract (#327, FR-188) is
accepted in all four repositories and Phase 3 has deployed MSP, GKS and the
GenesisBlock worker on the edge device (owner question 2).

## Where it lives and why this domain

The code is in `apps/edge/src/rag/genesisrag17/`. No charter names `apps/edge`
RAG explicitly. The agent charter treats Edge as an external authority, while
ADR-075, FEAT-026 and FR-187's note all sit in `knowledge`. FR-189 is the query
half of the same convergence, so its note sits beside FR-187's.

## The one setting

`ZURI_EDGE_GENESISRAG17_MODE` = `off` | `shadow` | `primary`, default `off`.

| Mode | Answer comes from | Also does |
|---|---|---|
| `off` | v4, as today | Nothing. `wrapAnswerRag` returns the v4 `GenesisLocalRag` instance itself rather than a wrapper, and no other setting is read |
| `shadow` | v4, unchanged (the same evidence object) | Asks the published generation the same text question through MSP, compares, and writes one content-free record. A shadow failure is recorded as an error code and never reaches the answer |
| `primary` | the published generation, with `published` (schema version, `snapshotId`, `generation`) and per-passage citations (`sourceId`, `rawArtifactId`, `parsedArtifactId`, `chunkId`, `contentHash`) | Falls back to v4 **strictly before** `ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL` and records every fallback. At or after that instant there is no v4 answer: the evidence is `unavailable`, and that is recorded too |

Both the compute worker (`conversation/executor.ts`) and the legacy webhook
(`cli/index.ts webhook serve`) read the mode once at start-up. Any mode other
than `off` **refuses to start** if a prerequisite is missing. The error names
the setting and never its value. The prerequisites are:

- `ZURI_MSP_COMMAND` / `ZURI_MSP_ARGS` / `ZURI_MSP_CWD` / `ZURI_MSP_TIMEOUT_MS`,
  the same names zuri-ai's server uses to start MSP. The command, the working
  directory and the entry script must exist on this device, which is the check
  for "no MSP runtime here".
- `ZURI_EDGE_GENESISRAG17_CREDENTIAL` (or `_FILE`), the MSP `source`-role credential.
- `ZURI_EDGE_GENESISRAG17_SCOPE`, the six-field scope as JSON. `visibility` must be `private`.
- `ZURI_EDGE_GENESISRAG17_FALLBACK_UNTIL` (primary only). A bare `YYYY-MM-DD`
  is inclusive in Bangkok time. It is configuration, not a constant, because
  owner question 3 defines it as 120 days after cutover or the end of the New
  Year 2027 season, whichever is later, and neither date is known yet.

Optional: `ZURI_EDGE_GENESISRAG17_TOP_K` (default 5),
`_RECORD_ROOT` (default `state/genesisrag17`), `_RETENTION_DAYS` (default 400,
enough to span both campaign windows), `_MAX_RECORDS_PER_DAY` (default 20000).

## Boundaries it keeps

- **One call direction.** Edge starts MSP over stdio (a TypeScript mirror of
  `apps/server/src/modules/agent/msp-stdio-transport.js`) and calls only
  `msp_pipeline_query`. MSP relays that call to the worker's loopback `/query`,
  never to GKS. There is no URL in edge's code path, so a job has no endpoint to
  name (ADR-061). The loopback check in `validateExecutionPolicy` is unchanged.
- **No second writer.** Nothing here writes GenesisBlockDB or the v4 store. v4
  keeps its existing write path until Phase 5.
- **Secrets.** The MSP child does not receive the edge device key, the LINE
  tokens, the model API key or the GenesisRAG17 credential. The credential goes
  only into the tool-call envelope.
- **Edge checks the response itself** even though MSP already has. It checks
  the scope, that every hit comes from one generation, that each hit carries
  all five citation ids, and that there are no more than `topK` results.

## What a record holds

Records are one JSONL file per Bangkok day, bounded per day and pruned past
retention. Each holds only ids, counts, a generation, latencies, flags and a
fixed error code. It never holds the question, passage text, a product name, an
MSP error message or the credential.

A shadow comparison counts v4's top-k product codes and how many of them some
published passage *is* (its JSON `externalId`, the FR-187 record key) or names.
The comparison is recorded as a **mismatch** when one side found products and
the other found none, or when both found some and share none. All the counts
are kept, so a stricter reading can be taken from the same evidence later.

`npm run genesisrag17:report -- [--since YYYY-MM-DD] [--until YYYY-MM-DD]`
summarises the records by day. It reports comparisons, mismatches (and whether
each was an emptiness disagreement or zero overlap), shadow errors kept apart
from mismatches, primary answers served, fallbacks, refused fallbacks, and the
generations seen. This is the Phase 5 exit evidence: owner question 3 asks for
zero mismatches across the Christmas 2026 and New Year 2027 windows.

## Known limits

- **Budget and price lookups have no published equivalent yet.** Under
  `ontology_v1` a generation holds catalog records as opaque text, so
  `searchWithConstraints` (budget) and `priceForCode` are typed lookups the
  published generation cannot answer. Shadow does not compare them. Primary
  records them as `UNSUPPORTED_OPERATION` fallbacks, and they stop being
  answered at sunset. FR-188's `PRICED_AT` is what closes this gap. Sunset
  should not come before it lands.
- **No publication `receiptHash` in the query response.** `msp_pipeline_query`
  returns `snapshotId` and `generation` but no receipt hash. The answer cites
  `snapshotId`, which is the identity the Stage 17 publication receipt binds.
  Resolving it to its receipt is Tier 1's lineage resolver's job.
- **Primary passages are text, not cards.** In primary mode `matches` is empty
  and the model sees `passages`, so Flex product cards need the typed Phase 2
  profile before primary can match v4's card output.
- **The Tauri-managed worker** passes only a fixed set of settings to its
  child. It stays `off` unless the mode reaches that process's own environment.
