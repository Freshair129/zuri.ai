# Domain model

This document explains the product vocabulary and the confirmed model boundaries.
It is not a schema registry. The current physical model is
[`apps/server/prisma/schema.prisma`](../apps/server/prisma/schema.prisma); its
declared fields, relations, enums and constraints are the authority for what is
persisted today. Product and requirement behavior remains governed by the
canonical records and accepted decisions linked below. The portable resolved
projection is in [`architecture/blueprint/`](architecture/blueprint/README.md).

## Scope and names

The product hierarchy follows the accepted [domain spine (ADR-025)](decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
with the Profile-first onboarding and naming decisions in [ADR-027](decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md):

| User-facing concept | Meaning | Persisted name or boundary |
|---|---|---|
| Profile | A person and their personal settings | `Person` |
| Workspace | Shared top-level collaboration context | `Portfolio` in the current schema |
| Organization | Security and data-isolation boundary | `Tenant` |
| Business | Operating business | `Business`, always within a Tenant |
| Space | Project Manager grouping for Projects | `Workspace` in the current schema |
| Project | Business-owned desired outcome | `Project` |
| Workstream | A mode-specific stream of execution | `Workstream` |

The schema name `Workspace` therefore means the product's **Space**. It is not
the top-level product Workspace. A user interface may hide an intermediate level
only when the server establishes the required data relationship and authorization
context. Tenant is never a branch: `tenantId` isolates data, `businessId` names
the operating business, and `branchId` identifies a business location.

The product hierarchy a person navigates is Workspace/Portfolio →
Organization/Tenant → Business → Project → Workstream. A Space (schema
`Workspace`) may group Projects inside a Business; it is not an ambient
authorization or navigation level that every person must select. The current
Project relation still requires the data grouping, so the server must provide
an appropriate Business-scoped Space where a flow omits that step. Supporting
entities are introduced by their owning domain and accepted contracts; this
explanation does not create new universal records for every familiar business
concept.

## Identity rules

Internal UUID primary keys identify persisted records. Human-readable codes are
stable labels for people; provider keys, tax numbers, LINE identities, repository
provider IDs, file paths and hashes are external references or attributes, never
relational primary keys. Use the owning model and its declared unique constraints
from the schema rather than fabricating an identity from a name, path, label or
content hash.

`Person` is the product's human principal. `Membership`, `RoleBinding`,
`WorkspaceMembership`, `Session`, `ExternalIdentity` and their related models
have distinct ownership and authority. Workspace collaboration membership does
not imply Tenant or Business access. Business or Tenant membership does not imply
Project ownership, publication rights, or permission to act on a LINE account.
Each operation resolves the viewer and resource scope through the current
Identity/Core contracts.

The CRM uses `Customer` for a tenant-scoped customer record and `Person` for a
product principal. Keep the pinned meaning of `contract_id` in FR-071 and SDD-040:
it is CRM Contact context in that source contract. Do not reinterpret it as a
generic inter-system contract identity. `execution_contract_id` names the
seven-mode execution contract where that field is declared; `workflow_contract_id`
names the governed workflow contract in the source that defines it. These
references are not interchangeable.

The candidate Project Manager universal `ContractDefinition` / `ContractVersion`
registry, universal contract IDs, workforce/fleet registry and proposed universal
identities remain outside the normative model until accepted canonical sources
authorize them. Do not create a model, UUID, alias, schema field or requirement
to make those proposals appear current. In particular, `risk_id` is usable only
where the owning accepted contract provides a real Risk identity; it is not a
free-text slot or a fabricated ID.

## Current persisted spine

These selected model names are present in the current Server schema and show
the principal ownership boundaries. This list is intentionally not exhaustive;
the pinned raw schema and its generated dictionary provide the full exact
inventory.

| Model family | Current schema models (selected) | Meaning boundary |
|---|---|---|
| Identity and access | `Portfolio`, `Tenant`, `Business`, `Person`, `Membership`, `WorkspaceMembership`, `Session`, `ChannelIdentity`, `ExternalIdentity`, `RoleBinding` | Person, organization, collaboration and account authority remain distinct. |
| Project and human work | `Workspace`, `Project`, `Workstream`, `WorkContainer`, `WorkItem`, `Milestone`, `Gate`, `Dependency`, `ProjectExecutionRun`, `ProjectExecutionStep` | `Workspace` here is the product Space. Project and Workstream are business planning objects; execution traces follow their own owner contract. |
| Files and assets | `ProjectFile`, `FileAsset`, `FileLink`, `AssetIntake`, `AssetEvidence`, `AssetExtractionJob` | File identity, links and evidence follow their owning file/asset contract. Preserved Edge extraction rows do not make Edge execution current. |
| CRM | `Customer`, `Conversation`, `Message`, `MessageAttachment`, `ConversationEvent`, `ConversationSession` | CRM customer/history records are not Person identity and do not grant access. |
| Integration | `IntegrationProvider`, `IntegrationConnection`, `IntegrationCredential`, `IntegrationCredentialVersion`, `IntegrationSecretEnvelope`, `RawExternalRecord`, `ExternalEntityRef` | Integration owns external connection metadata, secret references and provider evidence. |
| LINE and audit | `LineOaAccount`, `LineOaRichMenu`, `LineOaRichMenuVersion`, `LineOaLiffApp`, `LineOaWorkerCheckpoint`, `LineOaRichMenuJob`, `LineConversationJob`, `AuditEvent`, `AgentTraceEvent` | Current persisted LINE/Core records follow Server-owned execution; these names do not imply a device route or direct Runtime database access. |

Candidate names in older explanatory docs such as `LineOaTransportJob`,
`LineOaSchedule`, a universal `Artifact`, `ContractDefinition`, or workforce/fleet
registries are not made persisted models by this list. Confirm existence, fields
and ownership from the exact schema and charters.

## Work and execution

Projects represent business outcomes. Workstreams express parallel execution
within a Project and use a canonical `executionMode` selected from the seven
accepted modes:

```text
SOFTWARE_SPRINT
DATA_MIGRATION
B2B_SALES
B2C_CAMPAIGN
PRODUCT_LAUNCH
OPERATIONS
BUSINESS_EXPANSION
```

The mode determines the focused view over neutral work primitives. Product
creation begins with an objective and planning; it does not begin with a template
picker. Progress uses the Workstream's declared `progressStrategy`, evidence and
weight. A universal `tasks_done / tasks_total` ratio is not a product progress
contract.

`WorkContainer`, `WorkItem`, `Milestone`, `Gate` and `Dependency` are the
confirmed shared Project Manager primitives where present in the schema and
owning domain contracts. Mode-specific identifiers are aliases only where the
approved requirement explicitly says they resolve to an existing record's ID.
They do not authorize seven unrelated mini-applications or duplicate entity
tables.

Human planning state belongs to the business Project and its work. Developer
delivery plans, task-readiness records, CI results, test receipts and release
gates belong to the delivery-control process. `ProjectExecutionRun` and
`ProjectExecutionStep` describe persisted application execution where their
owning contract says so; they are not a synonym for a human Workstream or for a
developer task. `AgentTraceEvent` records agent execution evidence under its
owner contract and does not prove delivery acceptance by itself.

## Domain ownership and persistence

Domain charters declare ownership of current models and business rules. Services
declare execution and versioned boundary contracts. The schema declares the
physical model. Consumers use those contracts and do not write another domain's
rows directly. External systems such as MSP and GKS are ports or authorities at
their declared boundary; the platform does not silently take ownership of their
data or act as a hidden dependency.

The product supports two persistence profiles under accepted decisions:

| Profile | Intended context | Boundary |
|---|---|---|
| Local/offline | Local use and isolated development/test contexts | SQLite through repositories; no network sync is implied |
| Hosted | Hosted Server deployment | PostgreSQL through the Server's repository and Core boundary |

The physical schema is shared under current service ownership. ADR-025 D8 adopts
domain taxonomy and logical ownership only. It does not authorize per-domain
PostgreSQL schemas, an outbox in every domain, network synchronization, or a
newly split database/service architecture. Local SQLite and hosted PostgreSQL
are distinct environment profiles, not an automatic live data migration or a
sync contract.

Meaningful persisted state changes carry the timestamps, versioning and immutable
audit evidence required by the owning canonical contract. Deletion, archival,
retention and erasure follow their specific domain rules; a generic `deletedAt`
field is not a universal substitute for those rules.

## Imported plans and data-only execution

An externally generated plan is data. The importing contract validates its
declared schema, shows a dry-run preview, checks conflicts and authorization, and
commits accepted work transactionally with an audit event. It does not execute
arbitrary code, grant new authority, or bypass the current Project/Business
scope. The authoritative schema files and endpoint contracts are referenced in
the blueprint's [data and contract chapter](architecture/blueprint/DATA-AND-CONTRACTS.md).

## Source boundary and version diff

This revision supersedes the earlier 2026-10-04 explanation that presented
candidate universal inter-system contract IDs and agent/fleet revision IDs as
part of the model. It preserves FR-071 and SDD-040's pinned `contract_id`
meaning and treats the candidate registry as non-normative. It aligns product
names with ADR-027, grounds selected model families in the current Prisma
schema, keeps domain ownership distinct from physical persistence, and separates
business work from developer delivery state. No canonical IDs, requirement
subjects, feature memberships, schema models or runtime behavior are changed
here.
