---
id: ZAI:PRODUCT
version: "1.5.0"
status: active
superseded_by: null
relations:
  - type: relates_to
    target: ZAI:ADR-024
  - type: relates_to
    target: ZAI:ADR-025
  - type: relates_to
    target: ZAI:ADR-027
  - type: relates_to
    target: ZAI:ADR-045
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:ADR-105
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:ADR-110
  - type: relates_to
    target: ZAI:VERIFICATION-POLICY
---

# zuri.ai — Product Definition

zuri.ai is a standalone, AI-native business operating system. It models business
execution across operating domains, not only software delivery. The product has
two deliberately different primary surfaces:

| Surface | Role |
|---|---|
| LINE | Primary conversational intake and interaction surface, subject to the current server-owned ingress and account contracts. |
| Web | Back-office console for business context, planning, operations, complex edits, and review. |

This repository is a different product from the legacy zuri project. It does not
replace, extend, version, reuse, or migrate that project. No tenant cutover or data
migration from the legacy project is part of this product ([ADR-024](decisions/ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md)).

## People and operating scope

Profile is the first user-facing setup step after identity and session establishment.
A Profile represents a Person; it does not create a Business or grant access. A
member may complete a Profile and wait for an invitation without creating operating
scope. The product hierarchy and the technical model use distinct names:

| Product term | Current technical meaning |
|---|---|
| Profile | A person's profile over the canonical `Person` identity. |
| Workspace | The shared top-level collaboration container, represented by `Portfolio`. |
| Organization | The isolation boundary, represented by `Tenant`. |
| Business | An operating business inside a Tenant. |
| Space | The project-grouping context represented by schema `Workspace`; it groups Projects inside one Business and is not an ambient scope level. |
| Project | An outcome-oriented unit of work owned by a Business. |
| Workstream | A parallel execution stream inside a Project. |

The product hierarchy a person navigates is **Workspace → Organization → Business →
Project → Workstream**. A Space may group Projects inside a Business, but users do not
have to select it as an operating scope. The database's `Tenant` is an isolation
boundary, never a branch or operating business. The exact onboarding and membership
contract is defined by [ADR-027](decisions/ADR-027-PROFILE-FIRST-WORKSPACE-ONBOARDING.md)
and [FR-066/FR-067](requirements/FR-066.md).

## Business planning and execution

Work starts from an objective. Planning decomposes it into Workstreams and each
Workstream uses one of the seven canonical execution modes:

```text
SOFTWARE_SPRINT
DATA_MIGRATION
B2B_SALES
B2C_CAMPAIGN
PRODUCT_LAUNCH
OPERATIONS
BUSINESS_EXPANSION
```

The system activates the corresponding execution view from the Workstream's mode.
Project creation does not begin with an unrelated template picker. A manual mode
override may be exposed in advanced settings. All seven modes share the same neutral
Project, Workstream, WorkContainer, WorkItem, dependency, milestone, gate, and evidence
model; a mode changes its view and rules, not the application's core data model.

Progress is evidence-based and strategy-driven. Each Workstream contributes according
to its declared progress strategy and weight; a Project roll-up is not the ratio of
completed tasks to total tasks. Business planning and human execution state remain
separate from developer delivery plans, CI results, and test receipts.

External plans are data. The application validates a plan, presents a dry-run preview,
checks conflicts, and commits through the canonical import path with audit evidence.
It never executes code embedded in an imported plan ([BR-007](requirements/BR-007.md),
[BR-009](requirements/BR-009.md), [PlanEnvelope schema](../apps/server/contracts/plan-envelope.schema.json)).

## Product constraints

- **Identity and scope:** internal identities and server-resolved scope govern access;
  external tax, provider, repository, and channel identifiers are references, never
  primary keys ([BR-002](requirements/BR-002.md), [ADR-045](decisions/ADR-045-CANONICAL-IDENTITY-AND-ACCESS-MANAGEMENT.md)).
- **Domain ownership:** business rules and model writes belong to their declared
  domains. Services define process, deployment, and test boundaries; they do not
  transfer business ownership ([ADR-025](decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
  [service index](services/README.md)).
- **LINE:** LINE account configuration and durable job state remain in their owning
  Zuri domains. Integration owns provider transport and secrets. The Conversation
  Runtime can execute eligible work only through versioned Core ports; a device does
  not own LINE answers or credentials ([ADR-061](decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md),
  [ADR-100](decisions/ADR-100-LINE-OA-RUNS-SERVER-EXECUTED-ON-BROWSER-PROVISIONED-API-KEYS.md),
  [ADR-106](decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md),
  [ADR-110](decisions/ADR-110-RETIRE-EDGE-DEVICE-AND-HARNESS-SURFACES.md)).
- **Persistence:** local/offline SQLite and hosted PostgreSQL/Supabase are distinct
  environment profiles. Development and test may use isolated local PostgreSQL or a
  separate Supabase project. Storage choice does not imply network sync, a production
  cutover, or permission to combine environments ([ADR-018](decisions/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md),
  [ADR-105](decisions/ADR-105-LINE-OA-STUDIO-STATELESS-APPLICATION-TIER.md)).
- **Canonical requirements:** functional and non-functional statements, business
  rules, security requirements, design constraints, and explicit feature membership
  remain in the [canonical document registry](../registry/document-registry/index.json).
  `FEATURE-MAP.md` and other navigation products are generated views, not sources.

The [SoT rebuild blueprint](architecture/blueprint/README.md) is a source-revision-bound
build projection of those authorities. It helps another team implement the product;
it is not a second editable requirements registry and does not claim that every target
behavior has shipped.

## Version diff

1.4.1b → 1.5.0: removes the retired V1/V2 replacement and reuse narrative, the old
PM-only/local-SQLite product summary, and the dated delivery-state snapshot. Defines
the standalone product, current Profile/Workspace/Organization/Business/Space terms,
objective-first seven-mode planning, and accepted Core/LINE/runtime/storage boundaries.
No requirement ID, subject, or feature membership changes.
