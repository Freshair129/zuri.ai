---
id: ZAI:ADR-113
title: Retire Developer Delivery Control
version: "1.0.0"
status: accepted
created_at: "2026-10-22T00:00:00+07:00,Codex"
last_update: "2026-10-22T00:00:00+07:00,Codex"
author: Codex
approval_scope: repository-local-ddc-retirement
approved_on: "2026-10-22"
approved_by: User instruction in this session
attributes:
  doc_type: architecture-decision
  domain: platform-control
  scope: "Retire developer-only delivery controller and observability surfaces; retain product delivery, documentation governance and standard repository CI"
relations:
  - type: relates_to
    target: ZAI:ADR-048
  - type: relates_to
    target: ZAI:ADR-092
  - type: relates_to
    target: ZAI:FEAT-044
---

# ADR-113 — Retire Developer Delivery Control

**Status:** Accepted for repository-local implementation on 2026-10-22.
Deployment removal, external credential revocation, production data changes,
and deletion of local/private history are outside this decision.

## Context

The repository accumulated a developer-only delivery controller, task
preflight, autonomous supervisor, worker dispatch and observation tooling,
machine model/gate policy, and a Mission Control interface for these developer
execution records. The active instructions made routine development depend on
that system even though the durable workflow and state boundaries were not a
reliable prerequisite for ordinary repository work. The user has directed that
the entire DDC system be retired.

The repository already has normal Git branches and pull requests, targeted
application and document checks, required independent review, hosted GitHub CI,
and deployment/release controls. Documentation graph/preflight tooling is a
separate system. Product Project Manager records and approval/admission flows
are business functionality and must not be conflated with developer delivery
control.

## Decision

### D1 — Retire repository-local DDC execution

Remove the developer task readiness preflight, controller, supervisor, worker
dispatch/observation pipeline, their CLI entry points, and their DDC-specific
tests. The retired `delivery:*` package commands are removed. No replacement
controller, task ledger, admission ceremony, or readiness gate is introduced.

### D2 — Retire developer execution UI and API

Remove `/control/mission-control`, the DDC worker-observability API and data
projection, the Workers tab on `/control/roadmap`, and the dedicated Compose
overlay. Keep `/control/roadmap`, its programme plan and domain inventory, and
the time-bounded `/roadmap` member view. Preserve their existing authorization
and redaction contracts.

### D3 — Use the repository's ordinary delivery controls

Development work follows the trusted user task, repository source documents,
Git branches and pull requests, change-relevant tests/builds, independent
review for substantive changes, and the existing required hosted CI. Document
changes continue to use the canonical document registry and `npm run govern`
where applicable. No local DDC preflight result is required. Production and
release operations still require their existing environment-specific
authorization and evidence.

### D4 — Keep product and documentation workflows

This decision does not remove business Project Manager work items, Project
Approval Gateway behavior, business-agent requirements, tenant/business
admission, or product execution records. It does not remove document
governance (`docs:preflight`, `docs:graph`, identity checks, registry
projections, or generated views), verification selection, Server/Edge/Runtime
CI, Docker CI, GitHub review, or deployment controls.

### D5 — Retire DDC requirement identities without reusing them

FEAT-044 and FR-260 through FR-264 are superseded because they specify the
developer DDC projection and worker observation behavior being removed. The
canonical records are migrated with their existing IDs, feature membership and
subject anchors intact. The sanctioned ID ledger records every identity as
superseded; none may be reused. Existing FR-105 and FR-241 requirements remain
the source for the roadmap surfaces that stay.

### D6 — Preserve history; do not perform cleanup outside Git

Historical DDC documents, source pins, CI receipts, and roadmap evidence remain
available as history and are clearly marked as retired where they previously
looked active. This ADR does not delete local/private controller evidence,
worktrees, databases, credentials, containers, volumes, or deployed artifacts.
An old deployment continues to run its existing image until separately
rebuilt/released.

## Consequences

- Ordinary repository work no longer depends on DDC task records or controller
  availability.
- The developer team entry points must describe Git review and existing CI,
  not retired preflight, controller, or dispatch contracts.
- Historical DDC records may still mention the former system; their presence is
  provenance only and is not active authority.
- Code removal changes the source tree only. It does not claim that a running
  local Docker image or any remote deployment has been rebuilt or updated.

## Authority

Approved scope and migration provenance: [retirement change record](../change-requests/engineering/RETIRE-DEVELOPER-DELIVERY-CONTROL-20261022.md).
