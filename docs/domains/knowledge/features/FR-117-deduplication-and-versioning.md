---
domain: knowledge
feature: FR-117
module: knowledge
source: v2-native
version: "0.1.0b"
status: "implemented"
---

# FR-117 — Deduplication and version relationships within one tenant

## Intent

FR-117 implements Stage 6 of `DPL-KNOWLEDGE-INGEST-V1` — Deduplication /
Versioning, [§11](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) of the
specification — as a pure calculator in the knowledge lane:
`src/modules/knowledge/dedup.js`, exporting `ingestionIdentity` and
`classifyAgainst`.

Stage 6 is **Tier 1** under
[ADR-050](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
(row 6 of its stage table), which is why this one executes here.

It answers one question about an incoming artifact: is this the same knowledge
as something already held, a newer version of it, or neither.

## Two rules that had no code

This slice declares no new rule. It gives two existing ones their first
implementation.

**BR-021** (ingestion idempotency keyed on source identity, source version,
content hash and pipeline version) and **SEC-021** (deduplication never crosses
a tenant) were both declared with the 17-stage landing. From that commit until
this one, both sat in the list `npm run docs:graph` prints as `rules with no
code anchor` — the committed graph before this branch names `BR-021` and
`SEC-021` among the eight rules on it. A rule with no anchor is a sentence in a
registry: nothing in `src/` was obliged to obey it, and nothing would have
failed if something did not.

That is the honest framing of this slice. Not a new capability — a pair of
rules finally acquiring the code that has to hold them.

## The identity, and the other one

`ingestionIdentity(artifact)` is BR-021's four-part key —

- `source_id` — source identity
- `source_version` — source version
- `content_hash` — content hash
- `pipeline_version` — pipeline version

— hashed together with a fifth part the rule takes for granted and the code
makes explicit: `artifact.scope.tenantId`, folded in first.

**This is not [FR-081](../../integration/features/FR-081-raw-external-ingestion.md)'s
key, and the difference is not cosmetic.** `buildIdempotencyKey` in
`src/platform/integrations/core/idempotency.js` computes
`sha256(tenantId, connectionId, entityType, externalId, payloadHash)` over a
canonically serialized payload. That is the raw boundary's key, and it answers
*"have I already received this delivery"* — a re-delivered event resolves to
`UNCHANGED` instead of a second raw row. It carries neither a source version
nor a pipeline version, because at the raw boundary neither exists yet.

FR-117's key answers a later and different question: *"is this the same
knowledge"*. Two artifacts can arrive through the same delivery and be
different knowledge, and arrive through different deliveries and be the same.

The consequence worth stating outright: **a reparse under a changed
`pipeline_version` is a revision, not a duplicate, even when every byte of the
document is identical.** That is what makes it safe to re-run a whole corpus
through a new parser or a new embedding model — the second pass is recognised
as a new derivation rather than discarded as noise.

## Inexpressible, not forbidden

This is [SDD-065](../../../PRD-SDD-v1.0.md), and it is the design decision here
that carries the most weight.

SEC-021 could have been implemented as a comparison: compute the key without
the tenant, then check the tenant before collapsing two artifacts. That version
works, and it works for exactly as long as the check survives.

Instead the tenant is part of the hash input. Two tenants holding a
byte-identical document cannot produce the same key, so there is no
cross-tenant collapse to prohibit — the operation the rule forbids cannot be
expressed.

The reason to prefer this is not elegance. A check can be deleted. A reviewer
some months from now who finds a tenant comparison sitting next to an already
scope-filtered candidate list will read it as redundant and remove it, and
everything stays green, because the case it prevented was never exercised by a
test that did not also set up the filter. A key that cannot collide has nothing
to delete: taking the tenant out of the hash input changes what the function
returns, and the tests asserting that two tenants get different identities fail
on the spot.

## Duplicate, revision, or neither

`classifyAgainst(artifact, candidates)` asks three questions in order and stops
at the first that answers:

| Condition | Result | Edges |
|---|---|---|
| A candidate has the same identity | `DUPLICATE_OF` | none |
| A candidate has the same `source_id` | `REVISION_OF` | a supersession pair |
| Neither | `INDEPENDENT` | none |

Candidates are filtered to the artifact's own tenant before any of this, and
the survivors are returned as `compared`. That field exists so a caller can
tell the two silences apart: an out-of-scope candidate was not judged
independent — it was never looked at.

`INDEPENDENT` is not one of §11's five relationship names. It is the absence of
a relationship, and it is named rather than returned as `null` so that "nothing
matched" is an answer the caller receives instead of a hole it has to read.

## Supersession is a pair

A `REVISION_OF` result carries two edges, always:

```text
{ from: incoming, type: 'SUPERSEDES',    to: prior    }
{ from: prior,    type: 'SUPERSEDED_BY', to: incoming }
```

The reason is a question, not a preference for symmetry. A graph carrying only
the forward edge can answer "what did this artifact replace?" — which nobody
asks, because whoever holds the new artifact already has the answer. It cannot
answer "what replaced this?" from the side that was replaced, and that is the
side that gets asked: a stale citation, an old chunk still sitting in an index,
a fact retrieved from a superseded document. Reaching the replacement from the
replaced is the point, and one direction makes that a scan.

**A duplicate emits no edge.** It replaced nothing, and writing a supersession
for an artifact that changed nothing would put a version history into the graph
where there is no version history.

## What it declines to decide

Each of these is declined for a reason, not merely left unimplemented. §11
lists five dedup strategies; this implements three — exact checksum, canonical
checksum and source-native id — all of which read what the artifacts say about
themselves.

- **Content similarity and structural similarity are declined.** Both require a
  threshold. A threshold set in this module would be a judgement about which
  documents count as "the same" — made by whoever typed the number, applied to
  every tenant, and inherited by everyone after without the argument that
  produced it. There is no correct default to fall back on here, so the module
  does not pretend to hold one.
- **A filename is never read as a lineage.** `contract-v1.pdf` beside
  `contract-v2.pdf` reads exactly like two versions of one document. It is a
  hint a human left, not a claim the system can verify, and when the two carry
  different `source_id`s this classifies them `INDEPENDENT`.
- **`DERIVED_FROM` is never assigned here.** That edge is provenance and
  [FR-116](./FR-116-derived-object-provenance.md) owns it. Stage 6 knows
  whether two artifacts are the same thing; it does not know what either was
  derived from.

And nothing is defaulted. A missing `source_id`, `source_version`,
`content_hash`, `pipeline_version` or `scope.tenantId` is refused by name —
`undefined`, `null` and `''` alike — rather than hashed as an empty string. A
hole in a key is not an absence; it is a value, and it is the *same* value for
every other artifact missing that same part, so all of them collide with each
other. Defaulting a key component does not lose information quietly, it
manufactures duplicates that were never duplicates.

## Acceptance criteria

Each criterion is checked when a test in `tests/unit/knowledge-dedup.test.js`
proves it (18 tests).

- [x] **AC-117.1** An identical artifact held by another tenant is classified
      `INDEPENDENT`, not `DUPLICATE_OF`.
- [x] **AC-117.2** Two artifacts whose every content field matches get
      different identities when their tenants differ.
- [x] **AC-117.3** A candidate from another tenant does not appear in
      `compared` — it was never judged.
- [x] **AC-117.4** A byte-identical re-ingest of the same source is
      `DUPLICATE_OF`, and `of` names the held artifact's identity.
- [x] **AC-117.5** The same source at a later `source_version` is `REVISION_OF`,
      not a duplicate.
- [x] **AC-117.6** A different source with identical content is `INDEPENDENT` —
      the same bytes are not the same thing.
- [x] **AC-117.7** A reparse under a changed `pipeline_version` is not a
      duplicate; it is `REVISION_OF`.
- [x] **AC-117.8** Two artifacts whose filenames read as `v1` and `v2` but whose
      `source_id`s differ are `INDEPENDENT`.
- [x] **AC-117.9 … AC-117.12** Each of the four BR-021 components is separately
      required and refused by name — `source_id` (9), `source_version` (10),
      `content_hash` (11), `pipeline_version` (12). One `it.each` case per
      field.
- [x] **AC-117.13** An artifact with no `scope` is refused, with the tenant
      named in the error.
- [x] **AC-117.14** A revision names what it supersedes in `supersedes`.
- [x] **AC-117.15** A revision emits both edges — `SUPERSEDES` from the incoming
      artifact and `SUPERSEDED_BY` back to the prior one — so both ends exist.
- [x] **AC-117.16** A duplicate emits no edge; nothing was replaced.
- [x] **AC-117.17** An independent artifact emits no edge.
- [x] **AC-117.18** No classification path — duplicate, revision or independent
      — returns `DERIVED_FROM` or emits a `DERIVED_FROM` edge.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** Identity is computed
  and the classification returned in memory, so the knowledge charter's
  `owns_models: []` stays true. Where the key and the edges are *stored* is a
  later decision, not this one.
- **It stores nothing.** No dedup index, no held-artifact table, no cache. The
  caller supplies the candidates it wants considered; this module cannot
  discover them and keeps no memory of a previous call.
- **It decides nothing about what is published.** Whether a duplicate is
  dropped, a revision promoted, or a superseded artifact pulled from an index is
  the caller's decision — the publication contract is
  [FR-110](./FR-110-published-knowledge-snapshot-contract.md)'s.
- **It mints no identifiers.** The identity is derived entirely from fields the
  artifact already carries.
- **Not provenance.** Where an artifact came from is
  [FR-116](./FR-116-derived-object-provenance.md)'s; this says only how it
  relates to its neighbours.
- **Not classification or scope.** `scope.tenantId` is read as a boundary, never
  assigned — the lattice is
  [FR-111](./FR-111-knowledge-sensitivity-lattice.md)'s.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-109 — Seventeen-stage knowledge ingestion stage catalog and job trace](./FR-109-knowledge-ingestion-stage-catalog.md) — the catalog Stage 6 belongs to
- [FR-116 — Derived-object provenance and the lineage chain back to a source](./FR-116-derived-object-provenance.md) — owns `DERIVED_FROM`, which this never assigns
- [FR-115 — Document parsing into a structured artifact that keeps its link to the raw source](./FR-115-document-parsing.md) — Stage 2, which produces the artifact this places
- [FR-112 — Structural knowledge chunking with parent-child lineage](./FR-112-structural-knowledge-chunking.md) — its deterministic chunk ids are what let BR-021 treat a reprocess as the same knowledge
- [FR-111 — Knowledge sensitivity lattice](./FR-111-knowledge-sensitivity-lattice.md) — where `scope` comes from, not from here
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md) — the publisher that acts on these decisions
- [FR-081 — Raw external ingestion boundary](../../integration/features/FR-081-raw-external-ingestion.md) — the other key, answering the other question
- [PRD-SDD v1.0 — FR-117, SDD-065, BR-021, SEC-021, FR-081](../../../PRD-SDD-v1.0.md)
- [ADR-050 — Knowledge ingestion tier boundary and stage ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md) — its stage table puts Stage 6 in Tier 1 and names BR-021 and SEC-021 as the rules it must carry
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §11 (Stage 6) is the source requirement: its four outcomes, five strategies and five version relationships
