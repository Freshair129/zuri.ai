---
domain: knowledge
feature: FR-111
module: knowledge
source: v2-native
version: "0.1.0b"
status: "declared"
---

# FR-111 — Knowledge sensitivity lattice and processing policy

## Intent

Business knowledge today carries no real classification. The FR-047 import
contract admits exactly one value — `sensitivity: z.literal('PUBLIC')` in
`src/modules/knowledge/business-contract.js` — which was correct for a pilot
that served only an allow-listed public product projection, and is not
sufficient for a pipeline that ingests invoices, contracts, CRM records and
internal documents.

FR-111 **widens** that literal into the four-level lattice of spec §10 and adds
the per-object processing policy the pipeline must obey before it indexes
anything. It orders the pipeline as `classify → scope → index → scoped
retrieval`, and it refuses the `index everything → retrieve everything → filter
afterward` pattern outright (spec §3.3).

It **extends** — never replaces — SEC-001's cross-tenant/business guard and
SEC-009's deny-by-default public read boundary. Those two remain exactly as
they are; FR-111 adds a dimension underneath them, it does not relax either.

## The lattice

Four levels, from spec §10's minimum set:

| Level | What it admits |
|---|---|
| `PUBLIC` | Knowledge that may be served to an unauthenticated public surface — the LINE public read path FR-047 and SEC-009 already govern. Today's single literal value. |
| `INTERNAL` | Knowledge readable inside the owning Business by any authorized viewer of that Business; never a public surface. |
| `CONFIDENTIAL` | Knowledge that Business membership alone does not admit: inside the owning Business it is reachable only by an explicit grant, never by default. |
| `RESTRICTED` | Knowledge whose processing itself is constrained, not only its readership — the level at which `cloud_processing_allowed = false` becomes meaningful. |

`CONFIDENTIAL` says that admission is by explicit grant; **which** principals a
CONFIDENTIAL object admits is not expressible in anything FR-111 declares. The
allow-list fields that would express it — `allowed_roles`, `allowed_agents`,
`allowed_vaults` — are Tier-2/MSP territory owned by FR-057 and SEC-013 and are
deliberately outside this declaration (below). Until they are declared,
`CONFIDENTIAL` binds only the processing-policy fields and the
no-default-admission rule; the grant itself has no shape here.

A level admits a reader; it does not by itself decide where processing happens.
That is what the policy fields are for. The specification calls these four a
minimum (`ขั้นต่ำ`), so a deployment may distinguish more; FR-111 declares
these four and nothing beyond them.

Widening the enum is a widening of what the contract *accepts*, not of what any
existing surface *serves*. `src/modules/knowledge/business-contract.js` filters
its served projection to `sensitivity === 'PUBLIC'` today, and adding three
levels to the enum must not change which rows that filter returns.

## Scope dimensions

Classification is one axis; scope is the other. Spec §10 requires every
indexed object to carry an enforceable scope:

```text
portfolio_id
tenant_id
business_id
workspace_id
project_id
```

Optional, where the deployment has them:

```text
branch_id
department_id
vault_id
```

**Critical invariant (spec §10): every object that is indexed must have an
enforceable scope. Unscoped business knowledge may not be created.** These are
the same scope-chain levels zuri-ai already uses — Portfolio → Tenant →
Business → Workspace → Project — so this is not a new hierarchy, it is the
existing one made mandatory on a knowledge object before it can be indexed.

## Processing policy fields

FR-111 declares four per-object policy fields, all from spec §10:

| Field | What it governs |
|---|---|
| `retention_policy` | How long the object and its derivations may be kept |
| `export_policy` | Whether and how the object may leave the boundary it was classified inside |
| `cloud_processing_allowed` | Whether any stage may execute off the local edge for this object |
| `embedding_allowed` | Whether the object may be embedded at all (Stage 15) |

Spec §10 lists three further policy fields — `allowed_roles`, `allowed_agents`
and `allowed_vaults` — that FR-111's declaration does not name. They are
recorded here as spec-side fields that this requirement has **not** declared;
adding them is a change to FR-111, not an elaboration of it. This note may not
widen the requirement it explains. The narrowing is deliberate: who a principal
is and which vaults it may reach is FR-057 and SEC-013's policy-before-retrieval
boundary at Tier 2, and a second allow-list declared here would be a second
answer to a question MSP already owns.

`cloud_processing_allowed = false` on RESTRICTED knowledge forces all seventeen
stages onto local execution (SDD-058). That is resolved per object at each stage
boundary from the object's own policy — never read from deployment
configuration, because a data boundary that configuration can widen is not a
boundary. The specification's §35 topology split is an illustrative default,
not the contract.

`embedding_allowed = false` is not a performance switch. An embedding is a
lossy but reconstructible projection of content into a vector index; an object
that may not be embedded may still be indexed lexically or structurally, and
the routing decision at Stage 16 must respect the difference.

## Classify before index — and why the alternative is refused

The specification forbids this ordering (§3.3):

```text
Index everything
      ↓
Retrieve everything
      ↓
Filter afterward
```

and requires this one:

```text
Classify
   ↓
Scope
   ↓
Index
   ↓
Scoped Retrieval
```

The reason is a difference in failure mode, not in tidiness. When everything is
indexed and the filter is what keeps tenants apart, a scope mistake is a
**disclosure** — restricted content is already inside the retrievable set and
one bad predicate hands it to the wrong reader. When classification happens
first, the same mistake is a **ranking error**: the wrong thing is ranked
poorly, because the wrong thing was never admitted to that reader's index in
the first place. The filter is the only thing standing between those two
outcomes, and a filter is a line of code that gets refactored.

This is why Stage 5 (`DPS-KI-CLASSIFY`, sequence 50) sits ahead of chunking,
embedding and indexing in the FR-109 catalog and not after them. The ordering
is the control.

The same reasoning drives SEC-021's prohibition on cross-tenant deduplication:
two tenants holding a content-identical document hold two facts, and collapsing
them is a cross-tenant disclosure wearing the costume of an optimisation
(spec §34). Deduplication compares only within one tenant's scope, which makes
Stage 6 (`DPS-KI-DEDUPE`) a stage that must read the classification Stage 5
wrote.

## Relationship to the existing security boundary

| Existing rule | What FR-111 does to it |
|---|---|
| SEC-001 — cross-tenant/business guard (`assertWorkspaceInScope`) | Unchanged. FR-111 adds classification *inside* a tenant; it never becomes an alternative route across tenants. |
| SEC-009 — public LINE knowledge access is server-only and deny-by-default | Unchanged. `PUBLIC` in the lattice does not mean "publicly served"; SEC-009's allow-listed fields, server-owned binding and exclusions still decide that. |
| FR-047 — curated business-knowledge read contract | Its allow-list and deny rules stand. The served projection remains the approved public product projection; the enum widens beneath it. |
| SEC-021 — no cross-tenant dedup, no embedded credentials | FR-111 supplies the classification that SEC-021's scoping and redaction rules act on. |

Three levels being added to an enum is not three new read paths. Nothing in
FR-111 makes `INTERNAL`, `CONFIDENTIAL` or `RESTRICTED` knowledge reachable by
any surface that cannot reach it today.

## Acceptance criteria

Drawn from the specification's §40 Minimum Acceptance Criteria, restricted to
what FR-111 owns — classification, scope and processing policy. None is built.

- [ ] **AC-111.1** The knowledge contract accepts `PUBLIC`, `INTERNAL`,
      `CONFIDENTIAL` and `RESTRICTED` in place of the single
      `z.literal('PUBLIC')`, and **no existing surface changes which rows it
      returns** (FR-047 / SEC-009).
- [ ] **AC-111.2** Tenant and Business scope is enforced on every knowledge
      object, and an object without an enforceable scope cannot be created or
      indexed.
- [ ] **AC-111.3** Classification and scope are assigned at Stage 5, before
      chunking, embedding or indexing; no code path indexes an unclassified
      object and filters afterwards.
- [ ] **AC-111.4** Every knowledge object carries `retention_policy`,
      `export_policy`, `cloud_processing_allowed` and `embedding_allowed`, and
      each is an explicit value rather than an absent default.
- [ ] **AC-111.5** An object with `cloud_processing_allowed = false` executes
      all seventeen stages locally, and no deployment topology, environment
      variable or configuration change can widen that.
- [ ] **AC-111.6** Execution location is resolved per object from the object's
      own policy at each stage boundary, never read from deployment
      configuration.
- [ ] **AC-111.7** An object with `embedding_allowed = false` is never embedded
      at Stage 15, and Stage 16 routing still admits it to the lanes its
      classification allows.
- [ ] **AC-111.8** Deduplication compares only within one tenant's scope; two
      tenants holding a content-identical document keep two distinct knowledge
      objects.
- [ ] **AC-111.9** SEC-001's cross-tenant guard and SEC-009's deny-by-default
      public read boundary hold unchanged with the lattice in place, proven by
      the existing tests continuing to pass unmodified.
- [ ] **AC-111.10** A classification violation or restricted-content leakage is
      a critical security finding at the Stage 17 gate and blocks publication
      (spec §22.4; FR-110).

## Non-goals

- **This note authorizes no code, no route, no Prisma model and no schema
  change.** The widening of `business-contract.js` described here is a declared
  intent, not an approved edit; FR-111's PRD status column says documentary
  declaration only.
- zuri-ai does not execute the stages ADR-050 assigns to GKS or
  GenesisBlockDB. FR-111 says what the policy is and when it binds, not who
  runs the stage that obeys it.
- Not a replacement for SEC-001 or SEC-009, and not a route around either.
- Not a role or permission model. `allowed_roles`, `allowed_agents` and
  `allowed_vaults` exist in spec §10 and are deliberately outside this
  requirement's declaration.
- Not a change to what any existing surface serves. The LINE public read path
  keeps FR-047's allow-list and SEC-009's exclusions.
- No fifth classification level, and no per-field classification — the object
  is the unit.

## Implementation boundary

Nothing is implemented. When implementation is authorized, the enum belongs in
`src/lib/validation/enums.js` as the single source of truth and is consumed by
`src/modules/knowledge/business-contract.js`, never hand-copied into it — the
Excel dropdowns, the OpenAPI document and validation all derive from that one
list. The knowledge domain owns no Prisma model; the store behind the knowledge
port is the production runtime's `zuri_core.business_knowledge`, so a
classification column is a Supabase migration under the existing workflow and
not a Prisma schema change made here.

## Related documents

- [Knowledge domain charter](../CHARTER.md)
- [FR-047 — LINE business-knowledge pilot](./FR-047-line-business-knowledge-pilot.md)
- [FR-109 — Knowledge ingestion stage catalog](./FR-109-knowledge-ingestion-stage-catalog.md)
- [FR-110 — Published knowledge snapshot contract](./FR-110-published-knowledge-snapshot-contract.md)
- [PRD-SDD v1.0 — FR-111, SDD-058, SEC-001, SEC-009, SEC-021](../../../PRD-SDD-v1.0.md)
- [ADR-041 — Zuri edge device topology](../../../decisions/ADR-041-ZURI-EDGE-DEVICE-TOPOLOGY.md)
- [ADR-043 — Four-tier cognitive architecture](../../../decisions/ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md)
- [ADR-050 — Knowledge Ingestion Tier Boundary and Stage Ownership](../../../decisions/ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md)
- [Zuri 17-Stage Knowledge Ingestion & GraphRAG Preparation Pipeline Specification](../../../KNOWLEDGE-INGESTION-17-STAGE-SPEC.md) — §3.3, §10 (Stage 5), §34, §35 are the sections
  this note elaborates
