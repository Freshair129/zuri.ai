---
id: ZAI:ARCHITECTURE
version: "1.0.0"
status: active
superseded_by: null
relations:
  - type: relates_to
    target: ZAI:ADR-018
  - type: relates_to
    target: ZAI:ADR-024
  - type: relates_to
    target: ZAI:ADR-025
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

# Architecture

This document summarizes the current build boundary from accepted decisions,
canonical requirements, domain charters, and service contracts. It does not adopt
runtime or database choices from a candidate target architecture unless a controlling
decision explicitly does so. Domain charters own business meaning and model writes;
service documents own execution and verification boundaries.

## Product and execution boundary

```text
Person / Browser / LINE
        │
        ▼
Core / Server (apps/server)
  ├─ web shell and public routes
  ├─ Identity, scope, consent, domain services, protected writers
  ├─ LINE signature ingress, account binding and durable admission/jobs
  ├─ CRM conversation records and canonical Work mutations
  ├─ Integration secret/provider ports and external-system adapters
  └─ authenticated, versioned Core contracts
        │
        ├──────────────► LINE and other external providers
        ├──────────────► MSP and GKS through their existing service ports
        └──────────────► Conversation Runtime (eligible, explicitly owned jobs)
                              └─ no Prisma, Next.js, global DB credential,
                                 direct table access, or LLM-supplied scope
```

Core / Server remains the control plane and the durable authority for its domain
records. A domain service owns each business rule and protected write. The service
layer may host more than one domain; a process boundary does not transfer a model to
the process that reads or executes it ([ADR-025](decisions/ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md),
[Core service](services/server/SERVICE.md)).

The independently buildable Conversation Runtime executes a bounded conversation
loop only through `conversation-runtime.v1` Core ports. Core retains authentication,
scope and consent decisions, channel binding, LINE job/admission persistence, CRM
records, Integration secrets and transport, protected Work writers, and MSP/GKS
adapters. The Runtime cannot read Core tables directly or become a second authority
([ADR-106](decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md),
[Runtime service](services/conversation-runtime/SERVICE.md)).

## Domain authority and external ports

| Concern | Authority and boundary |
|---|---|
| Person, membership, session, roles, scope and authorization | Identity resolves a server-owned Person and active Membership/RoleBinding before protected reads or writes. Client, prompt, model, and tool scope values cannot widen it (ADR-045). |
| Portfolio, Tenant, Business, Projects and human work planning | Project Manager owns its declared models and services. Tenant is an isolation boundary; Workspace/Space names follow ADR-027 and the domain model. |
| LINE account and durable operation state | LINE OA Studio owns its account/design/job state. The Integration domain owns external connection metadata, credentials and LINE transport. CRM owns conversations/messages; Agent supplies its answer/turn contract. |
| Conversation execution | Core owns admission, job identity, authoritative executor cohort, leases and receipts. The Runtime is one separately buildable executor behind authenticated versioned ports; service readiness alone never selects ownership. |
| Memory and canonical knowledge | MSP and GKS remain external system boundaries reached through their approved ports. Their persistence, credentials, and governance are not hidden implementation work inside Zuri or the Conversation Runtime. |
| Audit and execution evidence | Domain writes use their purpose-specific audit, job, identity, pipeline, or agent journals. A combined timeline is a projection, not a new authority. |

The [service index](services/README.md) locates execution boundaries. A service may
contain multiple domain owners. Domain folders, route grouping, and runtime process
placement do not infer ownership.

## LINE ingress, jobs, and side effects

```text
LINE signed event
  → Core verifies origin and resolves the enabled account
  → Integration records provider evidence
  → Core durably marks/admit the event and conversation job
  → one Core-selected executor claims a fenced lease
  → Agent answer and other operations run through bounded ports
  → Integration performs the provider call and records its receipt
  → Core persists terminal state and conversation evidence
```

For accepted LINE behavior, the signed webhook and durable admission are owned by
Core. A successful HTTP acknowledgement follows the durable capture/handoff required
by the selected account contract. Leases, idempotency, fencing, and current scope are
rechecked before completion or a new side effect. Provider timeout with unknown
acceptance stays `UNKNOWN`; `ACCEPTED_BY_LINE` means that LINE accepted a request, not
that a recipient read or received it. Reply/Push recovery follows the exact LINE
contracts and does not retry an ambiguous Reply as a Push
([ADR-061](decisions/ADR-061-SERVER-LINE-AND-OPTIONAL-EDGE.md),
[ADR-100](decisions/ADR-100-LINE-OA-RUNS-SERVER-EXECUTED-ON-BROWSER-PROVISIONED-API-KEYS.md),
[ADR-105](decisions/ADR-105-LINE-OA-STUDIO-STATELESS-APPLICATION-TIER.md),
[ADR-106](decisions/ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md)).

LINE OA account execution is server-only. `transportMode` is `CLOUD` and
`executionMode` is `SERVER`; when the Conversation Runtime is selected, that is a
Core-owned executor cohort behind ADR-106, not an Edge device. Runtime ownership is
durably recorded and changed only through the accepted account contract. Edge Device,
device pairing, Edge extraction, and harness product surfaces are retired by ADR-110.
Existing records and schema remain historical evidence; their presence does not
authorize new device routes or work.

The Studio and all worker instances are disposable processes. Durable domain state,
leases, audit evidence, Integration credential references, and receipts carry restart
correctness. Raw secrets stay inside the Integration secret boundary and are never
returned in payloads, traces, or audit records. A deployment's live readiness or an
operator-configured endpoint is not a scope grant or executor selection.

## Business writes and import

Business mutations pass through the owning domain's application service and the
server-side authorization seam. The writer checks current scope and version, applies
the bounded state transition, and records its audit evidence within the transaction
required by that contract. A separate process or domain cannot bypass the owner by
writing its database tables directly.

Every supported intake adapter converges on the same import path:

```text
structured input → schema validation → dry-run preview
                → conflict and authorization checks
                → one canonical transactional write → audit / import receipt
```

Plan input remains data, never executable code. A failed validation or conflict
produces a visible refusal and no partial canonical write. The exact payload schema
and error contract come from the owning machine-readable contract, including
[PlanEnvelope](../apps/server/contracts/plan-envelope.schema.json) and the
[ExecutionPlanBundle](../apps/server/contracts/execution-plan-bundle.schema.json)
where each applies.

## Persistence profiles

The logical domain model and the physical database profile are separate concerns.

| Environment | Relational profile |
|---|---|
| Offline/local adapter | SQLite remains the local/offline adapter where the owning feature uses it. |
| Development, test, preview, and staging | Use an isolated local PostgreSQL/Supabase instance or separate Supabase project where the server profile requires PostgreSQL. Never create fake test tenants in the production project. |
| Hosted Zuri and LINE-facing reads | Supabase/PostgreSQL is the hosted relational authority, with tenant integrity, RLS, and least-privilege runtime roles governed by ADR-018. |

The profiles do not imply network sync, a local-to-cloud dual write, or an automatic
SQLite cutover. Development, UAT, and production credentials and databases remain
separate. A schema's existence or a local passing check does not establish that a
production migration or activation occurred ([ADR-018](decisions/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md),
[ADR-105](decisions/ADR-105-LINE-OA-STUDIO-STATELESS-APPLICATION-TIER.md)).

## Explicitly unselected topology

ADR-025 accepts the domain taxonomy and ownership principle from the target modular
monolith proposal; it does not adopt its per-domain PostgreSQL schemas, generic
outbox, or code-level module contract design. Do not add those choices, general
network synchronization, or a database/service split by interpreting this document.
Specific durable handoffs remain only where their accepted owning contract defines
them, such as the LINE admission state in ADR-106. External MSP and GKS systems remain
ports, not new services to implement as part of this architecture summary.

## Version diff

0.2.2b → 1.0.0: replaces the Project Manager/SQLite-only diagram and stale optional
Edge framing with the accepted Core, domain, LINE Studio, Integration, Agent and
Conversation Runtime boundaries; separates physical database profiles; and marks
the unaccepted target modular-monolith runtime choices as unselected. No new domain,
schema, service, route, or requirement identity is introduced.
