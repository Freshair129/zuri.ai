---
domain: knowledge
feature: FR-113
module: knowledge
source: v2-native
version: "0.1.0b"
status: "implemented"
---

# FR-113 — Entity candidate extraction from chunks and structured records

## Intent

FR-113 implements Stage 8 of `DPL-KNOWLEDGE-INGEST-V1` — the
`DPS-KI-ENTITY-EXTRACT` row of FR-109's catalog — as a pure calculator in the
knowledge lane: `src/modules/knowledge/entity-extraction.js`, function
`extractEntityCandidates`.

It reads FR-112's chunks and caller-supplied structured records and returns
`EntityCandidate` objects: a mention, a type guess, and a pointer back to where
the mention was found. Nothing more. The specification's objective for Stage 8
is "ตรวจหา entity candidates จาก structured และ unstructured data" — *find*,
not *identify*.

Stage 8 is **Tier 1** under [ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
D2, which is why this one executes here. Stage 9, the row directly below it in
the same table, is not.

## Contract

`extractEntityCandidates({ chunks, records, recognizer })` returns
`{ candidates, warnings }`. `recognizer` defaults to the exported
`defaultRecognizer`; `chunks` and `records` are each optional, and a call may
supply either or both — they are read in one pass, records first.

Every candidate carries the six fields the `DPS-KI-ENTITY-EXTRACT` catalog row
fixes, plus the three that say where it came from and who may read it:

| Field | Meaning | Carried or derived |
|---|---|---|
| `candidate_id` | `${chunk_id}~e${index}` for a text mention; `${record_id}~e0` for a record | derived |
| `type` | the type the recognizer claimed, or the record's declared type | **carried** |
| `mention` | the surface string exactly as it appears in the chunk or the record field | **carried** |
| `normalized_name` | the mention reduced to a comparable form, lexically | derived |
| `source_chunk_id` | the FR-112 chunk the mention was found in; `null` for a record | derived |
| `confidence` | the recognizer's number; `1` by default for a record | **carried** |
| `source_record_id` | the record the mention was read from; `null` for a text mention | **carried** |
| `scope` | tenant / business / sensitivity, from the chunk or record it came from | **carried verbatim** |
| `provenance` | the Stage 3 envelope, from the chunk or record it came from | **carried verbatim** |

`scope` and `provenance` are copied, never computed — classification is FR-111's
job (Stage 5) and provenance is captured at Stage 3, both upstream. Carrying
`scope` onto every candidate is what makes a candidate unreadable outside its
tenant (SEC-001, BR-001); a candidate that lost its scope on the way out of a
chunk would be a mention with no access rule attached.

`warnings` is a string array, present so this stage's return shape matches
FR-112's. Neither the default recognizer nor the assembly loop writes to it
today, so it is always empty.

## The Stage 9 boundary

This is the whole design constraint, and the specification states it in one line
at the end of §13:

> EntityCandidate ยังไม่ใช่ canonical entity

§14 assigns Stage 9 — Entity Resolution — to **GKS** by name, under its own
`## Owner` heading. [ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
D2 agrees, row 9: *GKS Tier 3 — the spec names the owner outright*, and Tier 1
records the occurrence on the FR-109 job trace and nothing more. So:

- **Two mentions of the same name stay two candidates.** A document naming
  `บริษัท เอบีซี จำกัด` under `Seller` and again under `Guarantor` produces two
  candidates, two ids, two `source_chunk_id`s. Nothing here merges, links,
  aliases or resolves them.
- **No candidate carries a canonical identity field.** No `entity_id`, no
  `canonical_id`, no `resolved_to`. A test asserts their absence rather than
  trusting the shape.
- The resolution strategies §14 lists — internal id, `ExternalRef`, exact match,
  alias match, deterministic rule, fuzzy match, embedding similarity,
  LLM-assisted, human review — are all Stage 9's, and none of them is
  approximated here.

**`normalized_name` is where this boundary is easiest to lose.** It exists to
make comparison *possible later*, not to perform it now. It is lexical and uses
**only the mention itself**: trim, collapse whitespace, strip the legal wrapper,
repeat until nothing more strips. The moment it consults a registry, a canonical
catalogue, or the other candidates in the same batch, it has started deciding
that two mentions are one thing — and that decision belongs to Stage 9, not to
this one.

That is pinned by a test rather than left to good intentions: the same mention is
normalized alone, then normalized again inside a chunk that also contains
`บริษัท เอบีซีดี จำกัด` and `ABC Limited`, and the two answers must be identical.
A normalizer that looked at its neighbours — clustering near-matches, preferring
the longest form, collapsing a batch — would fail that test on the day it was
written.

## Two sources, one shape

Structured records and prose chunks converge on the same candidate object.

- **A chunk mention is found.** The recognizer is handed `chunk.text` and returns
  hits; each hit becomes a candidate indexed by its position in that chunk's hit
  list, so `candidate_id` is `${chunk_id}~e0`, `~e1`, and so on.
- **A record mention is read.** The caller passes `{ record_id, type, mention,
  scope, provenance }` and the mention is taken from the field the caller named.
  `candidate_id` is `${record_id}~e0` — one mention per record, by construction.

A record mention carries **`confidence: 1`** by default, and the reason is not
optimism: the value was read from a declared field, not guessed out of prose.
The uncertainty in a structured record is about *which entity it denotes*, and
that is Stage 9's question. A caller may still pass an explicit `confidence`, and
it is respected.

**The caller names the field, not this module.** Only the caller knows its
record's shape; teaching this module which CRM column holds a customer name would
put another domain's schema inside the knowledge lane.

A record with no `mention` is skipped rather than producing an empty candidate.

## What the default recognizer will and will not claim

SDD-060 makes recognition a **seam with a deterministic default, not a model
dependency**. The default recognizes legal-form organisation patterns only,
because in those the suffix *is* the evidence — the grammar announces the type
without anyone having to recognise the name inside it. Three patterns:

| Pattern | Example |
|---|---|
| `บริษัท … จำกัด` | `บริษัท เอบีซี จำกัด` |
| `ห้างหุ้นส่วนจำกัด …` | `ห้างหุ้นส่วนจำกัด เอบีซี` |
| Capitalised words + `Co., Ltd.` / `Ltd.` / `Limited` | `ABC Co., Ltd.`, `ABC Limited` |

Every hit is typed `Organization` with `confidence: 0.85`, and hits are returned
in offset order so the `~e0`, `~e1` suffixes follow the text.

One implementation detail earns a sentence because it is a real trap: the English
pattern ends with a **negative lookahead**, `(?![A-Za-z0-9])`, rather than `\b`.
After `Ltd.` the boundary between the period and the following space is not a
word boundary, so `\b` backtracks and hands back `Ltd` with the period shorn off
— a mention that no longer matches the text it was extracted from.

**The default finds nothing for a person, a product or a location** — nor for any
of the other types §13 lists. That is deliberate, not a gap awaiting an apology.
Those types need a model, and a model in the knowledge lane would couple Stage 8
to whatever recognises Thai and English text this month (the SDD-059 reasoning,
one stage over). Tests pin the silence: a sentence whose only entity is a person
returns `[]`, and so does one whose only entity is a product.

The alternative — an empty seam, a hook with nothing behind it — was rejected by
SDD-060 by name, because that shape is what makes a stage read as delivered when
it is not. A caller needing broader recognition passes its own `recognizer`; it
then supplies the type and the confidence, and this module supplies the id, the
normalization, the scope and the provenance.

## Determinism

`extractEntityCandidates` is pure: no I/O, no database, no clock, no randomness,
no model. `candidate_id` is composed from the source id and the mention's index,
so the same chunks and records yield the same candidate ids on every run.

That is what lets BR-021 treat a reprocessed document as the same knowledge
rather than a duplicate. The idempotency key is keyed on source identity + source
version + content hash + pipeline version; an extractor that minted fresh ids on
each run would defeat that key downstream however correct the key itself was —
the same argument FR-112 makes for `chunk_id`, and it only holds for the chain if
both links hold.

The module-level patterns carry the `g` flag and are used with `matchAll`, which
iterates over an internal clone, so no `lastIndex` state leaks between calls.

## Acceptance criteria

Each criterion is checked when a test in
`tests/unit/knowledge-entity-extraction.test.js` proves it (17 tests). The tests
run over FR-112's real `chunkDocument` output rather than hand-built chunk
fixtures, so the two stages are proven to compose.

- [x] **AC-113.1** A Thai company name in a chunk yields one `Organization`
      candidate whose `source_chunk_id` is that chunk's id.
- [x] **AC-113.2** `candidate_id` is deterministic — the same input yields the
      same id twice.
- [x] **AC-113.3** `normalized_name` strips the legal wrapper lexically
      (`บริษัท เอบีซี จำกัด` → `เอบีซี`).
- [x] **AC-113.4** `confidence` is a number in `(0, 1]`.
- [x] **AC-113.5** `scope` is carried from the chunk, so a candidate can never be
      read outside its tenant.
- [x] **AC-113.6** `ABC Co., Ltd.` is recognized whole — period included — and
      normalizes to `ABC`.
- [x] **AC-113.7** `ABC Limited` is recognized and normalizes to `ABC`.
- [x] **AC-113.8** Two mentions of the same name in two chunks stay two
      candidates, with distinct ids and distinct `source_chunk_id`s.
- [x] **AC-113.9** A mention normalizes identically alone and surrounded by
      near-matches — no cross-candidate lookup.
- [x] **AC-113.10** No candidate carries `entity_id`, `canonical_id`,
      `customer_id` or `resolved_to`.
- [x] **AC-113.11** A record yields a candidate carrying `source_record_id`, with
      `source_chunk_id` `null`.
- [x] **AC-113.12** A record mention normalizes by the same lexical rule as a text
      mention.
- [x] **AC-113.13** A record mention carries `confidence: 1` by default.
- [x] **AC-113.14** Chunks and records are read in one pass and produce distinct
      candidate ids.
- [x] **AC-113.15** A sentence whose only entity is a person yields no candidates.
- [x] **AC-113.16** A sentence whose only entity is a product yields no
      candidates.
- [x] **AC-113.17** A caller-supplied recognizer replaces the default entirely;
      its type and confidence reach the candidate unchanged.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** Candidates are returned
  to the caller and never stored, so the knowledge charter's `owns_models: []`
  stays true (SDD-059, SDD-057). Persisting candidates is a later slice and will
  need a charter change.
- **No resolution, merging or canonical identity.** Stage 9 is GKS's (§14,
  ADR-050 D2). Nothing here decides that two candidates are one entity, and
  nothing here writes a canonical id.
- **No model dependency.** SDD-060 keeps the model out of this lane. The default
  recognizer claims only what legal-form grammar gives it; a caller needing
  broader recognition supplies its own recognizer.
- **No other stage ADR-050 assigns to GKS or GenesisBlockDB.** No fact or relation
  extraction, no ontology or temporal mapping, no graph write, no embedding, no
  indexing, no quality gate — Tier 1 is not a substrate writer (ADR-043 D2.1).
- **Not chunking or parsing.** The `chunks` this consumes are FR-112's output.
- **Not an entity type taxonomy.** §13's example type list is something this stage
  passes through, not something it validates against.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace](./FR-109-knowledge-ingestion-stage-catalog.md) — the `DPS-KI-ENTITY-EXTRACT` catalog row this implements
- [FR-112 — Structural knowledge chunking with parent-child lineage](./FR-112-structural-knowledge-chunking.md) — where the chunks and their `chunk_id`s come from
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md) — where `scope` comes from
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md)
- [PRD-SDD v1.0 — FR-113, SDD-060, SDD-059, BR-021](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge ingestion tier boundary and stage ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) — D2 puts Stage 8 in Tier 1 and Stage 9 in GKS Tier 3
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §13 (Stage 8) is the source requirement; §14 (Stage 9) is the boundary it stops at
