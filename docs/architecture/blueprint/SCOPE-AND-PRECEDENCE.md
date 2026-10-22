---
status: active
superseded_by: null
version: "1.0.0"
artifact_kind: resolved-source-projection
source_revision: "18008b774fc54febd23ca675d142f15da7d67db5"
---

# Scope and precedence

The operative inclusion, exclusion and clause-overlay rules for the pinned
profile are in [`resolutions.json`](resolutions.json). This chapter explains
their context and precedence for readers; it is not an independently writable
resolution source. Generated obligation/oracle views bind exact canonical
statements to that machine-readable projection. If this prose is inconsistent
with the JSON or its controlling accepted source, the JSON and source govern and
this explanation must be corrected.

## Target profile

The target profile is the buildable product baseline resolved from canonical
Zuri.ai records and accepted amendments at the pinned source revision. Include
every canonical non-retired behavior in the selected product scope whether its
source says planned, in progress or implemented. A planned behavior remains a
target obligation; an implementation receipt does not prove current acceptance.
Derive record counts from the source registry and the exclusions below.

Exclude the eight records whose canonical lifecycle is retired at the pinned
revision: `FR-141`, `FR-144`, `FR-220`, `FR-221`, `FR-222`, `FEAT-035`,
`SDD-001`, and `SEC-004`. Do not reproduce their retired behaviors as current
requirements.

The following additional records stay unchanged in the canonical registry but
are outside this minimum profile because an accepted amendment retires the
specific behavior or because no replacement transport contract has been
selected:

| Preserved canonical ID or clause | Profile disposition |
|---|---|
| `FR-050`, `FR-140` | Defer the legacy transport-specific behaviors. No replacement transport contract is selected here. Their registry status and statement remain unchanged. In particular, do not transpose FR-050's at-most-one-model-request clause into the Conversation Runtime tool loop. |
| `FR-143`, `SDD-085`, `SEC-025`, `FEAT-017` Edge-specific behavior | Exclude the retired Edge extraction/device behavior under ADR-110 D5. Keep the source rows, subjects, IDs and original feature membership unchanged; this scope overlay is not a registry migration. |
| `FR-150` former Edge conversation behavior | Exclude under ADR-100 and ADR-110. Keep the source row and FEAT-019 membership; the former Edge implementation path is not a target contract. |
| `FR-146` Edge-specific transport/selection clauses | Keep the core account aggregate behavior governed by the current row. Treat legacy Edge transport and the `FR-144` device-selection dependency as inoperative under ADR-100/110. |

ADR-110 D5 explicitly retires the Edge-specific behavior in `FR-143`,
`SEC-025`, `SDD-085` and `FEAT-017`, while the historical records remain
available for provenance. It also explicitly retires `FR-141`, `FR-144` and
the other Edge/harness records named by that decision. Do not infer that the
canonical registry text was silently rewritten.

`FR-288`, `SDD-114` and `FR-289` remain in the target profile even when their
canonical row is planned. For binary Knowledge parsing, retain the exact limits,
typed source spans, replay/version behavior and refusal conditions in the
canonical clauses; OCR, remote fetch, production activation, native Stage 9
onward and full publication acceptance are not authorized by those records.
For Knowledge Studio, preserve its installation-operator-only, read-only scope,
source-path rules and local loopback component boundary. Inclusion as target
behavior does not claim implementation or production evidence.

## Authority order

Apply the source that owns the question. When sources conflict, resolve them in
this order:

1. An accepted ADR amendment controls the specific decision or clause it names.
   Preserve the amended source record and cite the controlling ADR beside the
   resolved clause.
2. Canonical requirement statements and explicit FEAT membership define the
   issued behavior and grouping, subject to controlling accepted amendments.
   Record metadata is provenance and lifecycle, not a substitute for statement
   content or product approval.
3. Domain charters define business ownership and domain rules within that
   canonical scope.
4. Accepted service documents define execution and service-boundary contracts
   within the decisions and requirements they implement.
5. An accepted canonical requirement, owning endpoint contract or ADR selects
   the product boundary. A typed machine schema is normative only when one of
   those sources selects it for that boundary, and defines only its declared
   shape. An OpenAPI route inventory without typed handler behavior is a
   coverage reference only.
6. Current application code, Prisma schema, tests, task plans and receipts
   describe what exists or was observed. Use the Prisma schema for the current
   persisted shape; do not use implementation evidence to rewrite target scope.

The product baseline is not inferred from legacy imports, candidate PM
specifications, generated compatibility exports, route counts, source-preserved
status labels, or old implementation/test receipts. A typed export can make a
source easier to consume, but it cannot resolve a conflict by itself.

## Identity and record handling

Canonical IDs are permanent keys. Keep each original statement, subject anchor,
status, version, membership and source path unchanged in this work. Where an
accepted ADR retires a behavior but the canonical row remains present, the
projection records a clause-specific overlay and the original row remains
available in the provenance package. Do not allocate aliases, reinterpret IDs,
rewrite statuses, or create requirements to make a count fit.

`FR-071` and `SDD-040` pin `contract_id` as CRM Contact context. Do not convert
that identifier into a universal contract registry. `execution_contract_id`
and `workflow_contract_id` retain their source-specific meanings. Candidate
`ContractDefinition` / `ContractVersion`, universal ID, workforce or fleet
registry proposals are excluded until accepted canonical authority selects
them.

## Product state and delivery plan

State transitions that describe a Business, Project, Workstream, import,
Conversation, dispatch, Runtime admission, or domain record are product
behavior. They belong in normative product contracts and acceptance scenarios.
Developer delivery plans, implementation state, task owners and dates, CI/test
results, historic receipts and production activation evidence are separate
artifacts. A plan cannot add a requirement; an implementation status cannot
remove one; a test receipt is not the target contract.

## Selected exclusions

Do not promote these materials into the normative minimum profile:

- `PM17-SRS` and `PM19Blueprint` candidate material, including the proposed
  PM runtime/schema/dispatch choices not adopted by controlling ADRs;
- candidate target modular-monolith runtime choices. ADR-025 D8 adopts domain
  taxonomy and logical ownership only, not per-domain PostgreSQL schemas,
  universal outbox behavior, network sync, or a code-level module contract;
- the proposed Market Intelligence SRS where it has not been accepted;
- proposed complete asset lifecycle behavior beyond accepted active records;
- approved-but-unintegrated inference-pool expansions and runtime-engine
  details beyond accepted source clauses;
- proposed ADR-060's concrete `LineOaSchedule` model, scheduled-dispatch
  behavior and timed flow-WAIT design. ADR-105 D2/D3's accepted Studio schedule
  ownership, durable lease/idempotency and restart invariants remain target
  wherever an accepted behavior selects scheduled work;
- candidate `PMR` and `MA` names as new canonical requirements or aliases;
- a V1 replacement, parity, migration or cutover from the discontinued legacy
  `zuri` repository.

The product keeps human business planning as a first-class behavior. The
separate developer delivery plan can refer to that behavior without turning
business Projects or WorkItems into implementation tickets.
