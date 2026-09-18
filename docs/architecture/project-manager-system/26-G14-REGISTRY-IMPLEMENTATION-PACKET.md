---
id: ZAI:PM-G14-IMPLEMENTATION-PACKET
title: G14 workforce implementation handoff packet
version: "0.2.0b"
status: candidate
created_at: "2026-09-18T00:00:00+07:00,RWANG,worker packet"
last_update: "2026-09-18T04:48:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: implementation-packet
  domain: project-manager
  scope: G14 workforce implementation entry and verification gates
relations:
  - type: references
    target: ZAI:PM-G14-REGISTRY-CANDIDATE
  - type: references
    target: ZAI:PM-WORKFORCE-DESIGN
---

# G14 Implementation Packet

## Implementation entry

Use [g14-registry.candidate.json](contracts/g14-registry.candidate.json) as the bounded registry input. The PM-G14 extension is now composed into the PM-G01 authority for this documentation pass. Runtime implementation remains gated by canonical ID reconciliation and the selected contract checks. It pins the source snapshot to
`0c7fd88418b8be40a78f1fb8bc743b34c5a52c39` and preserves the Final Gate's
document-only limitations.

### Required root actions before code

1. Reconcile PMR-033/PMF-11/PMD-14/PMT-033 against `docs/FEATURES.md`,
   `docs/PRD-SDD-v1.0.md` and `docs/.id-ledger.json`; allocate canonical IDs or
   explicitly record why the requirement remains pending.
2. **Completed in this reconciliation:** PM-G14 is composed into
   `contracts/architecture.model.json` as the single graph authority. Keep the
   extension candidate/codegen-disabled until canonical ID and contract gates close.
3. Register the eight workforce operations and 30 schemas as the selected
   candidate contract; retain `PROPOSED_NOT_IMPLEMENTED` until handlers exist.
4. Close only the SPEC gates needed by the selected phase. G02/G03/G04/G06/G07/
   G08/G09 remain implementation blockers where their evidence is absent.
5. Bind the Identity capability matrix and owner-port decisions before any
   mutation service, route, migration or UI entrypoint is written.

## Work packages

| Package | Owner | Deliverable | Required proof |
|---|---|---|---|
| G14-P1 | PM + People + Identity | Scope/capability/status mapping, typed estimates/calendar/history | Registry + owner sign-off + refusal fixtures |
| G14-P2 | PM planning + People ports | Capacity calculator, preview/commit, allocation/calendar writers | Atomic transaction, stale version, overlap and idempotency tests |
| G14-P3 | PM UI/projection | WF-R01/R02/R03 and Resources navigation bindings | Field/operation parity, accessible table/agenda, browser checks |
| G14-P4 | PM metrics + Identity | WF-R04/R06, twelve metric result variants, correction lifecycle | Cohort/formula/coverage fixtures and authorization tests |
| G14-P5 | Integrator + independent verifier | PMT-033 A–P, pilot and release evidence | Tests, build, governance, exact revision and separate deployment receipt |

## Contract and data checklist

- [ ] `PM-G01` remains the base graph authority; `PM-G14` edges have typed
  direction, owner, authorization, timeout, failure policy and classification.
- [ ] Workload and schedule are Business-scoped with explicit Project/Domain/
  Feature filters; underlying cross-project capacity checks remain authorized.
- [ ] All internal effort uses integer minutes and IANA timezone intervals;
  story points are not silently converted to hours.
- [ ] Missing estimate/calendar/log/review data renders `UNKNOWN` or `PARTIAL`;
  it never becomes zero or a free-capacity claim.
- [ ] WorkItem state maps are versioned for all seven execution modes; acceptance
  is backed by immutable `DeliveryEvent`, never `updatedAt`.
- [ ] `WorkAllocation` is the one PM human allocation writer. Team membership,
  Employment and Person identity retain their existing owners.
- [ ] Preview pins source versions and exact input hash; commit rechecks the
  complete capacity set and returns an idempotent receipt.
- [ ] Performance uses frozen cohorts, policy/formula revisions, numerator/
  denominator coverage and evidence links; Team percentages pool counts.
- [ ] Individual/team/business performance permissions are separate and are
  resolved before aggregation; hidden identifiers and denominators are absent.
- [ ] Physical schema/migration/RLS/backfill/rollback work waits for SPEC-G07.

## Acceptance matrix

The implementation must execute all sixteen `PMT-033-A..P` cases from document
15 and the registry JSON. The high-risk gates are:

- A/D/E/F: arithmetic, deduplication, interval union and concurrent commit.
- G/I/P: scope, reassignment/history and unresolved/foreign identity refusal.
- H/J/K/L/N: frozen cohorts, unknown evidence, event dedup/reopen and metric
  aggregation/quality states.
- M/O: accessible schedule editing and idempotent receipts.

Static examples or Swagger validation can support fixture authoring but do not
count as service, migration or production evidence.

## Integration with TaskUsageLedger

TaskUsageLedger is parallel and separate. The G14 packet may consume a redacted
`taskCode`/`reportRef`/hash for delivery evidence only when a direct binding is
present. It must not:

- fill missing workforce actuals with predicted values;
- mark G14 screens or operations implemented;
- change Identity capabilities or owner-port authority;
- aggregate task-level telemetry into employee performance without an approved
  metric policy and source coverage.

## Known gaps to merge into the root packet

1. **Canonical registration:** PMR-033 and PMF-11 remain local proposal IDs.
   Root must allocate/pin a canonical subject or document an explicit pending
   state.
2. **Graph composition:** `architecture.model.json` now contains the PM-G01 base
   plus 13 PM-G14 nodes and 15 typed edges. Canonical ID registration and
   runtime activation remain pending.
3. **Metric result shape:** The current workforce OpenAPI has candidate result
   schemas; complete discriminator/dimension/quantile shapes and examples are
   still SPEC-G04 work.
4. **Owner ports/migration:** Calendar/assignment/history ports and physical
   SQLite/Postgres/RLS/backfill/rollback mapping remain SPEC-G02/G07 work.
5. **Security transport:** Generic API CSRF/Origin/session binding remains
   partially open under SPEC-G05.
6. **Executable conformance:** PMT-033 A–P are planned documentation cases;
   service and e2e tests are still NOT_RUN.
7. **Route activation:** WF-R01–WF-R06 are candidate screen families; no active
   application route or button should be claimed from this packet.

## Exit evidence

The root final gate can close this packet only when the exact composed revision
contains: canonical registry rows, one reconciled graph, validated operation and
schema references, owner and Identity bindings, migration proof where applicable,
all selected PMT cases passing, and a separate local/hosted/production evidence
record. `PRODUCTION_ACTIVE` must be proven for the exact deployed revision;
documentation and artifact publication are separate evidence classes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-18 | candidate | Add G14 implementation entry, work packages, TaskUsageLedger boundary and merge gaps | worker-local; uncommitted | RWANG |
| 0.2.0b | 2026-09-18 | candidate | Record composed PM-G01 plus PM-G14 graph while retaining runtime and canonical-ID gates | pending | RWANG |
