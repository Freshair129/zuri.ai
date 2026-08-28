---
domain: knowledge
feature: FR-111
module: knowledge
source: v2-native
version: "0.1.1b"
status: "implemented"
---

# FR-111 — Knowledge sensitivity lattice and processing policy

## Intent

Business knowledge used to carry no real classification. The FR-047 import
contract admitted exactly one value — `sensitivity: z.literal('PUBLIC')` in
`src/modules/knowledge/business-contract.js` — which was correct for a pilot
that served only an allow-listed public product projection, and was not
sufficient for a pipeline that ingests invoices, contracts, CRM records and
internal documents.

FR-111 widens that literal into the four-level lattice of spec §10 and adds the
per-object processing policy the pipeline obeys before anything indexes an
object. It orders the pipeline as `classify → scope → index → scoped
retrieval`, and `assertIndexable` refuses the `index everything → retrieve
everything → filter afterward` pattern at the gate (spec §3.3).

It extends — never replaces — SEC-001's cross-tenant/business guard and
SEC-009's deny-by-default public read boundary. Both are untouched; FR-111 adds
a dimension underneath them and relaxes neither.

What is built:

| File | What it holds |
|---|---|
| `src/lib/validation/enums.js` | `KNOWLEDGE_SENSITIVITY_LEVELS` — the lattice, most open first |
| `src/modules/knowledge/classification.js` | `classifyKnowledgeObject`, `resolveExecutionLocation`, `assertIndexable` |
| `src/modules/knowledge/business-contract.js` | record schema widened; query filter left alone; packet made to verify |
| `tests/unit/knowledge-classification.test.js` | 24 tests |

## The lattice

Four levels, from spec §10's minimum set:

| Level | What it admits |
|---|---|
| `PUBLIC` | Knowledge that may be served to an unauthenticated public surface — the LINE public read path FR-047 and SEC-009 already govern. |
| `INTERNAL` | Knowledge readable inside the owning Business by any authorized viewer of that Business; never a public surface. |
| `CONFIDENTIAL` | Knowledge that Business membership alone does not admit: inside the owning Business it is reachable only by an explicit grant, never by default. |
| `RESTRICTED` | Knowledge whose processing itself is constrained, not only its readership — the level at which `cloud_processing_allowed = false` becomes meaningful. |

`CONFIDENTIAL` says that admission is by explicit grant; **which** principals a
CONFIDENTIAL object admits is not expressible in anything FR-111 declares. The
allow-list fields that would express it — `allowed_roles`, `allowed_agents`,
`allowed_vaults` — are Tier-2/MSP territory owned by FR-057 and SEC-013 and are
deliberately outside this declaration. Until they are declared, `CONFIDENTIAL`
binds only the processing-policy fields and the no-default-admission rule; the
grant itself has no shape here.

A level admits a reader; it does not by itself decide where processing happens.
That is what the policy fields are for. The specification calls these four a
minimum (`ขั้นต่ำ`), so a deployment may distinguish more; FR-111 declares these
four and nothing beyond them.

## The two decisions that share a word

SDD-062. `business-contract.js` holds two decisions that both say
`sensitivity`, plus a third site that enforces the difference between them:

1. **The record schema** — `sensitivity: z.enum(KNOWLEDGE_SENSITIVITY_LEVELS)`,
   widened from `z.literal('PUBLIC')`. This says what may be **stored**.
2. **The query filter** — `record.sensitivity === 'PUBLIC'` in
   `createInMemoryBusinessKnowledgeReader`, mirrored by `sensitivity=eq.PUBLIC`
   in the Supabase adapter. This says what may be **served**. It is unchanged,
   and that is the point of this section.
3. **The packet** — `packet()` scans the records it was handed and throws if any
   is above `PUBLIC`, instead of stamping `sensitivity: 'PUBLIC'` on whatever
   arrived.

The filter staying at `PUBLIC` while the enum grew to four values is the
boundary, not staleness. Widening what knowledge may *carry* is not widening
what knowledge is *served*; the two only look inconsistent if the comparison is
read as a list that fell behind its enum.

The specific failure this guards against is not somebody deliberately opening
the public surface. It is somebody reading `record.sensitivity === 'PUBLIC'`,
noticing the enum now has four values, concluding the comparison is stale, and
"correcting" it. That edit would be a one-line disclosure of every INTERNAL,
CONFIDENTIAL and RESTRICTED row to the LINE public path.

Site 3 is what makes that edit fail loudly instead of leaking. The packet's
`sensitivity: 'PUBLIC'` is the surface's ceiling, not a description of its
contents — it reads as a claim, so it is now verified as one rather than
asserted. If a future change widens the filter, the packet refuses to wrap the
result and the request errors; before, it would have relabelled the record and
returned it.

## The name

The enum is `KNOWLEDGE_SENSITIVITY_LEVELS`, not `SENSITIVITY_LEVELS`, because
`sensitivity` already means something else in this codebase: FR-026 action
sensitivity, `LOW`/`HIGH`, about step-up re-authentication for agent writes
(`src/modules/agent/write-tools.js`, `src/modules/agent/action-gate.js`). The
two vocabularies share the word and nothing else.

The agent side rejects anything outside its own two values — `write-tools.js`
throws at registration on a descriptor whose `sensitivity` is not `LOW` or
`HIGH` — so a knowledge level cannot become a step-up decision today. The
collision is real but not currently exploitable, and the prefix is what keeps it
that way: nothing imports one list where it meant the other, because the names
do not match.

## Scope dimensions

Classification is one axis; scope is the other. Spec §10 requires every indexed
object to carry an enforceable scope, drawn from the chain zuri-ai already
uses — Portfolio → Tenant → Business → Workspace → Project, with `branch_id`,
`department_id` and `vault_id` optional where a deployment has them.

**Critical invariant (spec §10): every object that is indexed must have an
enforceable scope. Unscoped business knowledge may not be created.**

What `classifyKnowledgeObject` enforces is the tenant and business levels:
`scope.tenantId` and `scope.businessId` must both be present or the object is
refused, and the frozen classification it returns carries exactly those two.
That is AC-111.2's bar. The remaining levels are spec-side and not enforced
here; a slice that needs workspace or project granularity extends this function
rather than adding a second scope check elsewhere.

## Nothing is assumed

`classifyKnowledgeObject` requires five fields — `sensitivity`,
`retention_policy`, `export_policy`, `cloud_processing_allowed`,
`embedding_allowed` — and none of them has a default. Absent or `null` is a
refusal naming the field.

The reason is not strictness for its own sake. A default for a classification
field is a decision made about data nobody looked at, and the convenient default
is always the permissive one — nobody defaults `sensitivity` to `RESTRICTED` or
`export_policy` to "never". That is how an unclassified object becomes public:
not by a decision, but by the absence of one.

`false` is a stated value and is kept. The check tests for `undefined` and
`null`, never truthiness, so `cloud_processing_allowed: false` and
`embedding_allowed: false` — the two most restrictive things an object can say
about itself — survive classification intact rather than being mistaken for
missing.

## Processing policy fields

Four per-object policy fields, all from spec §10:

| Field | What it governs |
|---|---|
| `retention_policy` | How long the object and its derivations may be kept |
| `export_policy` | Whether and how the object may leave the boundary it was classified inside |
| `cloud_processing_allowed` | Whether any stage may execute off the local edge for this object |
| `embedding_allowed` | Whether the object may be embedded at all (Stage 15) |

Spec §10 lists three further policy fields — `allowed_roles`, `allowed_agents`
and `allowed_vaults` — that FR-111 does not declare. They are recorded here as
spec-side fields this requirement has **not** taken; adding them is a change to
FR-111, not an elaboration of it. The narrowing is deliberate: who a principal
is and which vaults it may reach is FR-057 and SEC-013's policy-before-retrieval
boundary at Tier 2, and a second allow-list declared here would be a second
answer to a question MSP already owns.

`embedding_allowed = false` is not a performance switch. An embedding is a lossy
but reconstructible projection of content into a vector index; an object that
may not be embedded may still be indexed lexically or structurally, and Stage 16
routing must respect the difference when it is built.

## Execution location

SDD-058. `resolveExecutionLocation(classification)` returns `LOCAL` when
`cloud_processing_allowed` is false and `ANY` when it is true. It takes the
classification and nothing else.

There is no parameter for deployment topology, and the tests pin the absence:
called with `{ preferred: 'CLOUD' }`, and again with
`{ preferred: 'CLOUD', force: true }`, a cloud-forbidden object still resolves
to `LOCAL`. A deployment preference is configuration; the classification is the
data's own statement about itself, and a data boundary that configuration can
widen is not a boundary. The specification's §35 topology split is an
illustrative default, not the contract.

## Classify, then index

Spec §3.3 forbids this ordering:

```text
Index everything → Retrieve everything → Filter afterward
```

and requires this one:

```text
Classify → Scope → Index → Scoped Retrieval
```

`assertIndexable(object)` is the gate. It refuses an object with no
`classification`, and otherwise re-runs `classifyKnowledgeObject` over it in
full.

**Why it re-runs rather than trusting the field.** An object arriving at the
index has crossed module boundaries. Its `classification` may be a real one, or
a hand-assembled literal that carries the right key names and is short a field —
and the two are indistinguishable until the missing field is needed, which is
after indexing. Trusting the field would make the gate a check that a property
exists; re-running makes it a check that the property is valid. The tests pin
both shapes: a classification missing `export_policy`, and one whose `scope`
lost its `tenantId` between classification and indexing.

**Why the ordering is the control.** The two patterns fail differently. In
filter-after-retrieval, restricted content is already inside the retrievable set
and one bad predicate hands it to the wrong reader — a scope mistake is a
disclosure. In classify-before-index, the same mistake is an object that never
got indexed — something that cannot be found, reported as a bug. One is an
incident; the other is a ticket. The filter is the only thing standing between
those two outcomes, and a filter is a line of code that gets refactored.

This is why Stage 5 (`DPS-KI-CLASSIFY`, sequence 50) sits ahead of chunking,
embedding and indexing in the FR-109 catalog and not after them. Stage 7 already
consumes the result: `chunkDocument` carries the classified `scope` onto every
chunk verbatim (FR-112, SDD-059), so a chunk retrieved on its own still says
which tenant and business it belongs to.

The same reasoning drives SEC-021's prohibition on cross-tenant deduplication:
two tenants holding a content-identical document hold two facts, and collapsing
them is a cross-tenant disclosure wearing the costume of an optimisation
(spec §34). Deduplication compares only within one tenant's scope, which makes
Stage 6 (`DPS-KI-DEDUPE`) a stage that must read what Stage 5 wrote. Stage 6 is
not built.

## Relationship to the existing security boundary

| Existing rule | What FR-111 does to it |
|---|---|
| SEC-001 — cross-tenant/business guard (`assertWorkspaceInScope`) | Unchanged. FR-111 adds classification *inside* a tenant; it never becomes an alternative route across tenants. |
| SEC-009 — public LINE knowledge access is server-only and deny-by-default | Unchanged. `PUBLIC` in the lattice does not mean "publicly served"; SEC-009's allow-listed fields, server-owned binding and exclusions still decide that. |
| FR-047 — curated business-knowledge read contract | Its allow-list and deny rules stand. The served projection is still the approved public product projection; the enum widened beneath it (SDD-062). |
| SEC-021 — no cross-tenant dedup, no embedded credentials | FR-111 supplies the classification SEC-021's scoping and redaction rules will act on. |

Three levels added to an enum is not three new read paths. Nothing in FR-111
makes `INTERNAL`, `CONFIDENTIAL` or `RESTRICTED` knowledge reachable by any
surface that could not reach it before.

## Acceptance criteria

Drawn from the specification's §40 Minimum Acceptance Criteria, restricted to
what FR-111 owns. A checked criterion is proved by a test in
`tests/unit/knowledge-classification.test.js` (24 tests). Four are open, each
naming the stage that unblocks it rather than being reworded into something
already passable.

- [x] **AC-111.1** The knowledge contract accepts `PUBLIC`, `INTERNAL`,
      `CONFIDENTIAL` and `RESTRICTED` in place of the single
      `z.literal('PUBLIC')`, and **no existing surface changes which rows it
      returns** (FR-047 / SEC-009).
- [x] **AC-111.2** Tenant and Business scope is enforced on every knowledge
      object, and an object without an enforceable scope cannot be created or
      indexed.
- [x] **AC-111.3** Classification and scope are assigned at Stage 5, before
      chunking, embedding or indexing; no code path indexes an unclassified
      object and filters afterwards.
- [x] **AC-111.4** Every knowledge object carries `retention_policy`,
      `export_policy`, `cloud_processing_allowed` and `embedding_allowed`, and
      each is an explicit value rather than an absent default.
- [ ] **AC-111.5** An object with `cloud_processing_allowed = false` executes
      all seventeen stages locally, and no deployment topology, environment
      variable or configuration change can widen that — **waits on an
      all-seventeen-stage executor that consults `resolveExecutionLocation`.**
      Wider than FR-118 (2026-08-28): that composition runs seven Tier 1
      stages unconditionally, in-process, and never calls
      `resolveExecutionLocation` — location is FR-118's caller's concern, not
      the composition's. It also covers none of the nine Tier 3/4 stages
      this repository does not execute (ADR-050 D3), so "all seventeen"
      cannot be satisfied here even in full. `resolveExecutionLocation`
      answers the question per object and refuses to be widened; this
      criterion needs a caller that asks it before every stage runs.
- [x] **AC-111.6** Execution location is resolved per object from the object's
      own policy at each stage boundary, never read from deployment
      configuration.
- [ ] **AC-111.7** An object with `embedding_allowed = false` is never embedded
      at Stage 15, and Stage 16 routing still admits it to the lanes its
      classification allows — **waits on Stage 15 embedding.** The field is
      required and preserved through classification; there is no embedder to
      obey it and no Stage 16 router to test.
- [ ] **AC-111.8** Deduplication compares only within one tenant's scope; two
      tenants holding a content-identical document keep two distinct knowledge
      objects — **waits on Stage 6 deduplication** (`DPS-KI-DEDUPE`, SEC-021).
      No dedup code exists to be scoped.
- [x] **AC-111.9** SEC-001's cross-tenant guard and SEC-009's deny-by-default
      public read boundary hold unchanged with the lattice in place, proven by
      the existing tests continuing to pass unmodified.
- [ ] **AC-111.10** A classification violation or restricted-content leakage is
      a critical security finding at the Stage 17 gate and blocks publication
      (spec §22.4; FR-110) — **waits on the Stage 17 gate.** FR-110 declares the
      gate; nothing evaluates findings or blocks a publication yet, so there is
      no gate for a classification violation to fail.

## Non-goals

- **No Prisma model, no persistence, no route, no API.** `classification.js` is
  a pure calculator: it opens no database, writes no table and declares no
  model, so the knowledge charter's `owns_models: []` stays true (SDD-057,
  ADR-050). The store behind the knowledge port is the production runtime's
  `zuri_core.business_knowledge`; persisting a classification column there is a
  Supabase migration in a later slice, not a Prisma schema change made here.
- **Not a change to what any existing surface serves.** The enum widened; the
  query filter did not (SDD-062). The LINE public read path keeps FR-047's
  allow-list and SEC-009's exclusions and returns exactly the rows it returned
  before.
- **No stage ADR-050 assigns to GKS or GenesisBlockDB.** FR-111 says what the
  policy is and when it binds, not who runs the stage that obeys it. Tier 1 is
  not a substrate writer (ADR-043 D2.1).
- Not a replacement for SEC-001 or SEC-009, and not a route around either.
- Not a role or permission model. `allowed_roles`, `allowed_agents` and
  `allowed_vaults` exist in spec §10 and are deliberately outside this
  requirement.
- No fifth classification level, and no per-field classification — the object is
  the unit.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-047 — LINE business-knowledge pilot](./FR-047-line-business-knowledge-pilot.md)
- [FR-109 — Knowledge ingestion stage catalog](./FR-109-knowledge-ingestion-stage-catalog.md)
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md)
- [FR-112 — Structural knowledge chunking](./FR-112-structural-knowledge-chunking.md)
- [PRD-SDD v1.0 — FR-111, SDD-058, SDD-062, SEC-001, SEC-009, SEC-021](../../../PRD-SDD-v1.0.md)
- [ADR-041 — Zuri edge device topology](../../../decisions/ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md)
- [ADR-043 — Four-tier cognitive architecture](../../../decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md)
- [ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §3.3, §10 (Stage 5), §34, §35 are the sections
  this note elaborates
