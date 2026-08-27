---
domain: knowledge
feature: FR-112
module: knowledge
source: v2-native
version: "0.1.0b"
status: "implemented"
---

# FR-112 — Structural knowledge chunking with parent-child lineage

## Intent

FR-112 implements Stage 7 of `DPL-KNOWLEDGE-INGEST-V1` — the `DPS-KI-CHUNK`
row of FR-109's catalog — as a pure calculator in the knowledge lane:
`src/modules/knowledge/chunking.js`, function `chunkDocument`.

It takes the blocks of a parsed document and returns the retrieval-sized units
the rest of the pipeline is defined in terms of. Nothing downstream exists
without it: Stage 8 attaches `source_chunk_id` to every entity candidate,
Stage 15 embeds chunks, and the spec §8 provenance chain
`Fact → Chunk → ParsedArtifact → RawArtifact → Source` has no middle link until
a chunk has an id.

Stage 7 is **Tier 1** under [ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
D2, which is why this one executes here rather than being declared and monitored
like Stages 9–17.

## Contract

`chunkDocument({ documentId, blocks, scope, provenance, maxTokens })` returns
`{ chunks, warnings }`. `maxTokens` defaults to `DEFAULT_MAX_TOKENS` = **400**.

Every chunk carries the eight fields the `DPS-KI-CHUNK` catalog row fixes:

| Field | Meaning | Carried or derived |
|---|---|---|
| `chunk_id` | `documentId` + `#` + the chunk's position; unique within the document | derived |
| `parent_id` | `null` for a section chunk; the section's `chunk_id` for a fallback window beneath it | derived |
| `document_id` | the parsed document this chunk belongs to | carried (`documentId`) |
| `sequence` | emission order across the whole document, starting at 0 | derived |
| `heading_path` | the full ancestor heading chain, e.g. `['Contract', 'Payment']` | derived |
| `token_count` | whitespace-word approximation of the chunk's own text | derived |
| `scope` | tenant / business / sensitivity, from FR-111 classification (Stage 5) | **carried verbatim** |
| `provenance` | the Stage 3 envelope (`source_ref`, `pipeline_version`, …) | **carried verbatim** |

Chunking derives nothing it is given. `scope` and `provenance` are copied onto
every chunk exactly as received and are never computed, inferred or defaulted
here — classification is FR-111's job and provenance is captured at Stage 3,
both upstream.

The chunk object additionally carries its own `text`. The catalog row fixes the
metadata a chunk must report; the payload is what that metadata describes.

`warnings` is a string array — empty on the structural path, one entry per
oversized section on the fallback path.

## Structure over stride

The specification's preferred strategy (§12) is `Document → Section → Semantic
Chunk`, stated against the alternative in one line:

> แทนการ chunk ทุก 500 token แบบตายตัว

So the split follows the document's own headings. A `heading` block closes the
current section and emits it; the heading stack is then truncated to the new
heading's level and the heading written at that level, so a level-2 heading
under a level-1 heading yields `heading_path` `['Contract', 'Payment']` — the
whole ancestor chain, not the nearest heading. A chunk retrieved on its own
therefore still says where in the document it came from.

Two consequences of following structure rather than a stride:

- Section sizes are uneven by construction. A one-sentence section is one chunk;
  `maxTokens` is a ceiling that triggers the fallback, not a target.
- A heading with no body text under it produces no chunk. An empty section is
  not a zero-token chunk with a `heading_path` and nothing to retrieve.

There is **no document-level chunk object**. The document is present as
`document_id` on every chunk; the two levels that exist as objects are the
section chunk and — only when the fallback runs — its windows.

## The fallback

A section whose `token_count` exceeds `maxTokens` is too large to retrieve as
one unit, so it *additionally* gets fixed windows beneath it. This is the
degraded path: the spec lists sliding-window as a fallback strategy, and the
code reports it as a warning naming the section and its size, because a fallback
that stays silent becomes the default by accident.

- Windows are cut over the section's whitespace-split words, `maxTokens` words
  per window.
- `overlap = max(1, floor(maxTokens * 0.1))`; `step = max(1, maxTokens - overlap)`.
  At the default 400 that is a 40-word overlap and a 360-word step.
- The windows **overlap** because without it this is fixed chunking wearing a
  nicer name: a sentence lying across a boundary would be left whole in neither
  window. The `max(1, …)` on the step is what guarantees progress, so overlap can
  never make a window repeat its predecessor.
- Every window is parented to the section chunk and inherits its `heading_path`.
- **The section chunk survives alongside its children.** It is emitted first and
  is not replaced, so nothing is retrievable only as a fragment torn out of its
  context, and the parent-child lineage the spec asks for is a real edge rather
  than a naming convention.

## Determinism

`chunkDocument` is pure: no I/O, no database, no clock, no randomness, no
counter outside the call. `chunk_id` is `documentId` plus the chunk's position,
so the same document chunks to the same ids every time.

That is what lets BR-021 treat a reprocessed document as the same knowledge
rather than a duplicate: ingestion idempotency is keyed on source identity +
source version + content hash + pipeline version, and a chunker that produced
fresh ids on each run would defeat that key downstream however correct the key
itself was.

## Acceptance criteria

Each criterion is checked when a test in
`tests/unit/knowledge-chunking.test.js` proves it (12 tests).

- [x] **AC-112.1** A document splits into one chunk per section, in document
      order, with `sequence` running 0…n.
- [x] **AC-112.2** Every chunk carries all eight `DPS-KI-CHUNK` fields.
- [x] **AC-112.3** `scope` and `provenance` are carried verbatim and
      `document_id` is echoed; none of the three is computed here.
- [x] **AC-112.4** `heading_path` carries the full ancestor chain, not the
      nearest heading.
- [x] **AC-112.5** `token_count` counts whitespace-separated words of the
      section body; the heading text is not counted.
- [x] **AC-112.6** The same document chunked twice produces the same
      `chunk_id`s.
- [x] **AC-112.7** A section within `maxTokens` is a single chunk with
      `parent_id` `null` and no children.
- [x] **AC-112.8** An oversized section keeps its own chunk and gains children
      naming it as `parent_id`, each within `maxTokens` and inheriting its
      `heading_path`.
- [x] **AC-112.9** Consecutive windows share at least one token, cover every
      token of the section between them, and never repeat one another.
- [x] **AC-112.10** Falling back to fixed windows emits a warning naming the
      section, because that is the degraded path.
- [x] **AC-112.11** A heading with no body text under it produces no chunk.
- [x] **AC-112.12** `heading_path` never contains an empty segment. The heading
      stack is indexed by level, so a document that opens at H2 — or skips
      H1 → H3 — leaves holes in it; the path is compacted at the emit boundary.
      Before this was pinned, such a document produced `[undefined, 'Payment']`,
      which JSON-serializes to `null` and reads as an ancestor heading the
      document does not have. Found by review, reproduced by a failing test,
      then fixed.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** Chunks are returned to
  the caller and never stored, so the knowledge charter's `owns_models: []`
  stays true (SDD-059, SDD-057). Persisting chunks is a later slice and will
  need a charter change.
- **No stage ADR-050 assigns to GKS or GenesisBlockDB.** No entity resolution,
  no fact or relation extraction, no ontology or temporal mapping, no graph
  write, no embedding, no indexing, no quality gate — Tier 1 is not a substrate
  writer (ADR-043 D2.1).
- **Not a model tokenizer.** `token_count` is a whitespace-word approximation on
  purpose: an exact count is model-specific and would couple Stage 7 to
  whichever embedding model Stage 15 happens to use. This number exists to
  choose a split point; exactness belongs at the embedding boundary, where the
  model is known (SDD-059).
- **Not semantic chunking.** Of the five strategies §12 lists, this implements
  structural chunking with a sliding-window fallback and parent-child lineage.
  Embedding-similarity boundaries and record chunking are not built.
- **Not parsing.** The `blocks` this consumes are Stage 2 output; producing them
  is not FR-112's.
- Does not compute the BR-021 idempotency key. It makes that key usable by being
  deterministic; the key itself belongs to Stage 6.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace](./FR-109-knowledge-ingestion-stage-catalog.md) — the `DPS-KI-CHUNK` catalog row this implements
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md)
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md) — where `scope` comes from
- [PRD-SDD v1.0 — FR-112, SDD-059, SDD-057, BR-021](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge ingestion tier boundary and stage ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) — D2 puts Stage 7 in Tier 1
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §12 (Stage 7) is the source requirement
