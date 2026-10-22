---
status: active
superseded_by: null
version: "1.0.0"
artifact_kind: resolved-source-projection
source_revision: "18008b774fc54febd23ca675d142f15da7d67db5"
---

# Data and contracts

This chapter defines how a builder consumes current data and API authority. It
does not synthesize missing fields or replace the canonical schemas. Exact
current persistence is in the raw Prisma source and generated schema dictionary
for the pinned revision; the exact set of accepted API schemas is listed by the
source-bound package manifest.

## Source precedence for data shapes

Use the authority that owns each shape:

1. An accepted canonical requirement, owning endpoint contract or ADR selects
   the product boundary and behavior. A typed schema is normative only when one
   of those accepted sources selects it for that boundary; the schema defines
   only the wire shape it actually declares. A typed file alone does not make a
   product contract.
2. The selected endpoint contract or ADR defines authorization, transaction,
   refusal, error and idempotency behavior where a machine schema is incomplete.
3. Domain charters and service contracts define model ownership and call
   direction within those decisions.
4. [`apps/server/prisma/schema.prisma`](../../../apps/server/prisma/schema.prisma)
   defines the current persisted model, scalar and relation shape. It is an
   as-built data source, not independent authority to change target behavior.
5. A generated OpenAPI route inventory identifies route coverage. Where a
   generated schema is explicitly only a route-inventory schema, it does not
   prove handler DTO fields, nullability, errors or complete response shape.

Do not create permissive schemas that make an untyped inventory look like an
accepted API contract. The operation census is a navigation and coverage view;
the selected typed source schemas are the machine contract. For internal DTO
fields that no accepted source declares, the owning implementation may choose
its representation while preserving canonical behavior, scope, persistence and
error guarantees. The blueprint does not assert a byte-for-byte clone of every
current API response.

## Identity and references

- A persisted entity is identified by the primary key declared by its owning
  schema. Use internal UUID identity where the schema defines it; do not derive
  keys from labels, file paths, provider IDs, content hashes or external
  identifiers.
- External IDs such as LINE identities, tax numbers, provider object IDs and
  repository provider IDs are references or attributes, not internal primary
  keys.
- `Person` is the product's principal; `Customer` is a CRM customer record.
  Workspace collaboration, Tenant membership and Business authority are
  separate relationships. An ID in a payload does not prove access.
- Keep FR-071 and SDD-040's `contract_id` meaning as CRM Contact context. Do not
  replace it with a universal inter-system contract identity. Use
  `execution_contract_id` or `workflow_contract_id` only in the source-specific
  meanings that declare them.
- A domain-specific alias may resolve to an existing record only where its
  canonical contract says so. It does not create a second table, key family or
  foreign-key authority.

The exact field names, scalar types, enums, indexes, relations and model count
are bound to the raw schema file and hash in the rebuild package. Derive all
counts from that pinned file; do not maintain a manually copied schema census
in this chapter.

## Serialization and imported plans

Only schemas selected for a product boundary define its normative
serialization. The package manifest records their source bindings. In this
profile:

- [PlanEnvelope schema](../../../apps/server/contracts/plan-envelope.schema.json)
  defines the envelope used for plan intake.
- [ExecutionPlanBundle schema](../../../apps/server/contracts/execution-plan-bundle.schema.json)
  defines the execution bundle consumed by its owning contract.
- [Conversation Runtime operation schema](../../../services/conversation-runtime/contracts/v1/operation.schema.json)
  defines the versioned Core/Runtime operation boundary selected by ADR-106.
- [LINE conversation execution v2](../../../apps/server/contracts/line-conversation-execution-v2.schema.json)
  is the selected current version with the Server/Core conversation path under
  FR-149/FR-265 and ADR-100/106. The [v1 schema](../../../apps/server/contracts/line-conversation-execution.schema.json)
  is retained as retired Edge provenance only (FR-150, ADR-061/100/110); it
  does not authorize an Edge route, adapter or execution surface.

The typed [document-link metadata schema](../../../apps/server/contracts/doc-link-metadata.schema.json)
is repository documentation tooling. The typed [domain-state schema](../../../apps/server/contracts/domain-state.schema.json)
is a generated implementation-readiness projection. Both are support artifacts,
not normative product data or external API contracts, and the package records
them separately from selected product schemas.

Plan import proceeds through the owning contract in this order: validate the
complete declared data shape; authorize the viewer and target Business/Project;
show a dry-run preview; detect conflicts; commit accepted changes transactionally;
write the required audit evidence. Invalid, unauthorized or conflicting input
does not partially modify business state. Imported data never executes code,
widens permissions, supplies its own authoritative viewer, or bypasses a domain
owner.

UTF-8 JSON, field casing, required/optional fields, enumerations, numeric bounds
and unknown-property behavior are defined by each selected source schema. Apply
the schema's declared version, `$id` and compatibility rules. No universal
`ContractDefinition` registry or version label is implied.

## Authorization and refusal

Core resolves the authenticated viewer, current roles and target resource scope.
Tenant, Business, Workspace, account and Project identifiers supplied by a
client are selectors, not grants. The owning service rechecks the current scope
at the boundary that performs the write or external action. A Workspace member
does not acquire Business authority through collaboration membership.

Refuse an operation before mutation when the caller lacks current authority,
the resource is outside their scope, a required contract or provider is missing,
or a validation/conflict gate fails. Use the same not-found-shaped refusal for
out-of-scope resources where FR-072 governs. Refusal content must not disclose
whether an inaccessible Business, Person, account or stored object exists.
Secret values, authorization headers, raw LINE user IDs and unapproved customer
content do not appear in responses, logs, audits or transport receipts.

The exact HTTP status and error object are governed by the source contract for
the operation. The API route inventory does not supply missing handler error
schemas. Do not add a conflicting universal response envelope in this blueprint.

## Transactions, idempotency and versions

- Apply a multi-record operation atomically where its canonical contract
  requires one business outcome. Plan import and durable LINE admission do not
  leave partial accepted work after a failed transaction.
- Repeated requests have one durable outcome only where the owning contract
  declares its idempotency key and lifetime. Do not infer that a generic
  request ID, trace ID or entity version is an idempotency key.
- A version or ETag protects only the entity or contract where it is declared.
  A stale/conflicting version is reported according to that contract. Do not
  add a universal `version` field to every model.
- External sends with uncertain outcome remain `UNKNOWN` or the source-defined
  equivalent until reconciled. Never present an unknown provider result as
  delivered or retry it blindly. Provider acceptance, delivery and read are
  distinct facts.
- Audit, job receipt, agent trace, user usage and provider-ingestion records
  retain their separate purposes. An audit event captures a durable business
  mutation; it does not substitute for job or provider evidence.

## LINE-specific contract boundary

Current LINE answer execution is Server/Core-owned. The Server receives and
adjudicates LINE events, persists the accepted admission/job state, and invokes
the versioned Runtime boundary as selected by ADR-100 and ADR-106. Integration
is the only boundary that resolves the configured LINE credential and calls
LINE. The Runtime receives no direct database authority or reusable channel
secret. ADR-110 removes device pairing, Edge extraction and Edge routes while
preserving existing rows and schema for recovery.

Preserve native LINE behavior selected by FR-148, FR-149 and FR-265 under
ADR-100/106/110. FR-050 and FR-140 remain source records, but their old
transport-specific behavior is deferred from this minimum profile until an
accepted replacement transport contract is selected. FR-050's model-request
cardinality does not define the Runtime tool-loop. FR-150's Edge conversation
behavior is out of profile. Existing transport-specific source clauses are
resolved in [Reconciliation](RECONCILIATION.md), not copied as current DTOs.

## Rebuild artifacts

The portable package generated from this chapter must include the unmodified
raw schema and an exact dictionary of models, fields, enums and relations. It
must also include every API operation as a source-linked inventory entry and
label each entry as either an accepted typed contract or route-coverage-only.
The per-requirement acceptance matrix must cite the exact statement hash and the
accepted schema or behavior clause that supplies its oracle. A missing typed
schema remains an explicit contract gap for that operation; do not fill it with
fabricated fields or imply that the inventory proves behavior.
