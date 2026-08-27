---
domain: knowledge
feature: FR-116
module: knowledge
source: v2-native
version: "0.1.0b"
status: "implemented"
---

# FR-116 — Derived-object provenance and the lineage chain back to a source

## Intent

FR-116 implements Stage 3 of `DPL-KNOWLEDGE-INGEST-V1` — Provenance Capture,
[§8](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) of the specification — as a
pure calculator in the knowledge lane: `src/modules/knowledge/provenance.js`,
exporting `buildSourceProvenance`, `assertPublishable` and `traceToSource`.

Stage 3 is **Tier 1** under [ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
D2, which is why this one executes here.

The word "capture" in the specification's title is misleading about what was
missing. Provenance was already being *carried* through this lane before FR-116
existed. What did not exist was anything that said what it had to contain, or
anything that refused an object whose provenance said nothing.

## The contract that arrived after the field

Be clear about the order of events, because a reader six weeks from now will
otherwise assume Stage 3 was designed alongside Stages 7 and 8. It was not.

Three stages had already been passing a `provenance` object between them:

- **FR-115** (parsing) is where `parsed_from` — the
  `ParsedArtifact → RawArtifact` link §7 requires, and which FR-109's
  `DPS-KI-PARSE` catalog row already fixes — is set. That lane is still open;
  the field is named in the catalog and in §7's diagram, and no module writes
  it yet.
- **[FR-112](./FR-112-structural-knowledge-chunking.md)** (chunking) takes
  `provenance` as a parameter of `chunkDocument` and writes it onto every chunk
  **verbatim** — its own comment says so: "carried verbatim from the caller.
  This function never derives them … provenance is captured at Stage 3, both
  upstream of here."
- **[FR-113](./FR-113-entity-candidate-extraction.md)** (extraction) copies
  `chunk.provenance` and `record.provenance` onto each candidate, again
  verbatim.

So an opaque blob crossed three module boundaries with a contract of "whatever
the caller handed us." Nothing defined its fields, nothing validated it, and
every downstream stage's honesty about where knowledge came from rested on a
value none of them inspected. FR-116 is what gives that blob a meaning; the
field predates the contract by two stages of work.

`buildSourceProvenance(input)` is the definition. It requires all ten fields §8
names for an object that came from a source — `source_id`, `source_type`,
`source_uri`, `source_version`, `artifact_id`, `ingested_at`, `parsed_at`,
`pipeline_version`, `extractor_version`, `checksum` — and returns them frozen.

Three properties are deliberate:

- **No defaults on any of the ten.** `undefined`, `null` and `''` are each
  refused by field name. A default here is the same mistake
  [FR-111](./FR-111-knowledge-sensitivity-lattice.md) refuses for
  classification: a fact asserted about an artifact nobody looked at.
- **An empty `provenance` object is refused as loudly as an absent one.** The
  failure mode this stage exists against is not a missing field; it is a field
  that is *present and means nothing*, which is exactly what the three stages
  upstream were passing around.
- **`parsed_at` before `ingested_at` is refused**, because that order cannot
  have happened. It is a cheap check that catches a clock or a copy-paste
  before the lie is written into a lineage record nobody re-reads. Equal
  instants are allowed.

## Carries identifiers it does not mint

The boundary with **[FR-071](./FR-071-supabase-data-pipeline-monitor-and-replay.md)**
is the one place this requirement could quietly grow into another's subject, so
state it plainly.

FR-071 owns the execution ledger — definition, run, stage, step, attempt,
record, batch — and it is **persisted and replayable**. FR-116 is about what a
knowledge object *carries*, and it is **pure**: no model, no table, no route, no
clock. [ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
D2 already assigns Stage 3 to Tier 1 "**FR-071 / SDD-042** — the append-only
stage/record ledger carrying `doc_id`, `pic_id`, `fact_id`". FR-116 sits beside
that row, not on top of it.

They can collide because they name the same identifiers: FR-071's subject
already names `doc_id`, `pic_id` and `fact_id`, and this chain walks those same
ids. The rule:

> **FR-116 consumes identity established by FR-071's execution ledger and by
> Stage 2 parsing. It validates a chain of identifiers it does not mint.**

The moment this module generated a `doc_id` — or any other id in that
envelope — it would have crossed into FR-071's subject rather than sitting
beside it. Nothing in `provenance.js` calls a generator, reads a clock, or
composes an id: `buildSourceProvenance` only copies the ten fields the caller
supplied, and `traceToSource` only follows ids it was handed.

## Declaring derived is a claim

This is [SDD-064](../../../PRD-SDD-v1.0.md), and it is the part of FR-116 that
matters most.

§8's invariant forbids publishing a Fact or Relation whose source cannot be
traced — **เว้นแต่** it is explicitly declared `DERIVED`, `INFERRED` or
`COMPUTED`. Read naively that is an escape hatch: type the word and the
requirement lifts. An escape hatch is what every laundering pattern in this
repository has turned out to be, so the declaration is treated as a **claim**
and checked in three steps.

**1. The declaration exempts an object from a RAW source, never from having
sources.** A derived Fact does not point at a `RawArtifact` — that is what makes
it derived — but it still came from *something*, and it must say what.

**2. An object that declares derived and names nothing is unattributed, and
unattributed knowledge does not publish.** `assertPublishable` refuses a
`derivation_method` with no `source_objects`, and refuses an empty
`source_objects` array, because an empty list names nothing. It also refuses an
object that is neither sourced nor declared derived at all.

**3. Naming is not having — the part review had to catch.** The first
implementation checked only that `source_objects` was non-empty. Under that
check, `["chunk_that_does_not_exist"]` satisfied the invariant exactly as well
as a real reference. The check guarded **presence**; the property that actually
matters is **resolvability**. A check that accepts an unresolvable name lets the
declaration back itself — which is the laundering SDD-064 exists to stop,
arriving through the door SDD-064 itself built.

`assertPublishable(object, resolve)` therefore takes a resolver and refuses any
named source that nothing resolves, naming the missing ids in the error.

**There is deliberately no shape-only mode.** Called without a resolver, the
function throws immediately rather than degrading to a structural check:

> `assertPublishable requires a resolver: whether a named source EXISTS is the
> question, and a shape-only mode would answer a different one`

A permissive default would not be a weaker version of this check. It would be a
different check that returns the same green.

## Walking the chain

`traceToSource(object, resolve)` walks the §8 chain —
`Fact → Chunk → ParsedArtifact → RawArtifact → Source` — and returns
`{ reached, path, unresolved }`, plus `source_id` when it arrived and `cycle`
when it did not.

**It reports rather than throws.** "This cannot be traced" is an answer a caller
must act on — quarantine, escalate, refuse to publish — not an exception to
swallow at some outer boundary that has lost the context to decide. A trace that
threw would make the negative answer the caller's exception handler's problem
instead of the caller's.

Two properties follow from that:

- **A link nothing resolves is named in `unresolved`**, and `reached` is
  `false`. The walk stops there and says which id it could not follow, rather
  than reporting a shorter chain as a successful one.
- **A chain that points at itself terminates.** The walk keeps a `seen` set and
  returns `{ reached: false, cycle }` on re-entry. A cycle is a broken chain,
  not a reason for a pure function to stop responding — hanging is the one
  answer a caller cannot act on.

## Acceptance criteria

Each criterion is checked when a test in
`tests/unit/knowledge-provenance.test.js` proves it (23 tests).

- [x] **AC-116.1** `DERIVED` with nothing named as its source is refused.
- [x] **AC-116.2** `DERIVED` with an empty `source_objects` array is refused —
      an empty list names nothing.
- [x] **AC-116.3** `DERIVED` that names what it came from, and that resolves, is
      accepted.
- [x] **AC-116.4** A `provenance` object that is present but empty is refused;
      the field being there proves nothing.
- [x] **AC-116.5 … AC-116.14** Each of the ten source fields is separately
      required and refused by name — `source_id` (5), `source_type` (6),
      `source_uri` (7), `source_version` (8), `artifact_id` (9), `ingested_at`
      (10), `parsed_at` (11), `pipeline_version` (12), `extractor_version` (13),
      `checksum` (14). One `it.each` case per field.
- [x] **AC-116.15** An artifact whose `parsed_at` precedes its `ingested_at` is
      refused.
- [x] **AC-116.16** `ingested_at` and `parsed_at` at the same instant are
      allowed.
- [x] **AC-116.17** `traceToSource` walks Fact → Chunk → ParsedArtifact, returns
      `reached: true`, the full `path`, and the terminal `source_id`.
- [x] **AC-116.18** A chain naming a link nothing resolves reports
      `reached: false` and names that link in `unresolved`, rather than
      declaring success.
- [x] **AC-116.19** A chain that points at itself terminates instead of
      hanging.
- [x] **AC-116.20** `assertPublishable` refuses `DERIVED` naming a source
      nothing resolves, and names the unresolvable id in the error.
- [x] **AC-116.21** `assertPublishable` accepts `DERIVED` naming a source that
      resolves.
- [x] **AC-116.22** `assertPublishable` refuses to run at all without a
      resolver — shape-only is not a mode this offers.
- [x] **AC-116.23** An object that is neither sourced nor declared derived is
      refused.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** Provenance is built,
  checked and walked in memory and returned to the caller, so the knowledge
  charter's `owns_models: []` stays true.
- **It mints no identifiers.** No `doc_id`, no `artifact_id`, no run or record
  id. Identity arrives from FR-071 and Stage 2; this validates the chain, it
  does not create links in it.
- **It does not replace or duplicate FR-071's execution ledger.** That ledger is
  persisted, replayable and append-only; this is a pure calculator over what an
  object carries. Two records of the same run would be two answers to one
  question.
- **It does not publish anything.** `assertPublishable` is the check a publisher
  must pass, not the publisher. Nothing here writes, snapshots or promotes; the
  publication contract is [FR-110](./FR-110-published-knowledge-snapshot-contract.md)'s.
- **Not parsing, chunking or extraction.** The objects this validates come from
  Stages 2, 7 and 8.
- **Not classification.** `scope` is [FR-111](./FR-111-knowledge-sensitivity-lattice.md)'s;
  provenance says where an object came from, not who may read it.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace](./FR-109-knowledge-ingestion-stage-catalog.md) — the catalog Stage 3 belongs to
- [FR-071 — Supabase data pipeline monitor and replay](./FR-071-supabase-data-pipeline-monitor-and-replay.md) — the execution ledger whose identifiers this consumes and never mints
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md) — the publisher this check stands in front of
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md) — the no-defaults argument, applied to classification
- [FR-112 — Structural knowledge chunking with parent-child lineage](./FR-112-structural-knowledge-chunking.md) — carries `provenance` verbatim; the middle link of the chain
- [FR-113 — Entity candidate extraction](./FR-113-entity-candidate-extraction.md) — copies `provenance` onto every candidate
- [PRD-SDD v1.0 — FR-116, SDD-064, FR-071, SDD-042](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge ingestion tier boundary and stage ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) — D2 puts Stage 3 in Tier 1 and names FR-071 / SDD-042 as the existing piece
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §8 (Stage 3) is the source requirement: the ten fields, the chain diagram and the invariant
