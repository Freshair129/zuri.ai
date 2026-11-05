---
id: ZAI:ADR-116
title: Visual Office repository, data-access and serving boundary
version: "0.1.0b"
status: candidate
created_at: "2026-11-06"
last_update: "2026-11-06"
author: Claude Opus 5.5
superseded_by: null
attributes:
  doc_type: architecture-decision
  domain: project-manager
  scope: "Where Visual Office code lives, how it obtains Zuri business data, and which origin serves its first platform-backed slice; no route, schema, permission or implementation is issued"
relations:
  - type: relates_to
    target: ZAI:ADR-025
  - type: relates_to
    target: ZAI:ADR-026
  - type: relates_to
    target: ZAI:ADR-045
  - type: relates_to
    target: ZAI:ADR-062
  - type: relates_to
    target: ZAI:ADR-106
  - type: relates_to
    target: ZAI:VISUAL-OFFICE-CLIENT-DESIGN
  - type: references
    target: ZAI:FR-294
  - type: references
    target: ZAI:FR-295
---

# ADR-116 — Visual Office repository, data-access and serving boundary

**Status:** Candidate. Proposed on 2026-11-06 at the owner's request for a
recommendation; it takes effect only when the owner accepts it. It refines, and
does not replace, the owner-approved (2026-10-23) placement in the
[Visual Office client design](../architecture/2026-10-22-visual-office-zuri-client-design.md):
Visual Office is an optional, separately deployed client, and Zuri remains the
authority for identity, Business scope and business data.

## Context

Visual Office shows the same Business data as Zuri's web console, rendered as a
navigable office instead of pages. The owner asked three questions: should Visual
Office join the zuri.ai monorepo; should it call the same endpoints as the web
console; or should it read the database directly?

Facts at zuri.ai `main` `46787958` and Visual Office `origin/main` `25cfa8f3`:

- **The web console never reads the database directly.** Its pages call Server
  route handlers. The handlers resolve the session viewer, authorize
  Tenant/Business scope and call domain services.
- **Other Zuri processes do not read Server tables.**
  - The Conversation Runtime has no Prisma client or table access and reaches
    Core over HTTP ([ADR-106](ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md) D1).
  - Edge consumes wire contracts and does not import Server source or access
    Server tables ([ADR-062](ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md)
    decision 5).
  - The [target architecture](../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md)
    (§26 invariants 2, 3, 8 and 12): only the owning domain writes a table;
    cross-domain writes go through module contracts; reporting reads stay
    non-owning; and agent runtimes do not bypass domain authority.
- **Visual Office is a separate repository.**
  - Stack: plain ES-module JavaScript with Three.js, pnpm, its own CI and a large
    binary asset pipeline (GLB models, Blender sources).
  - It depends on no zuri.ai package.
  - Its own SRS (VO-FR-009) and integration-boundary documents already require
    authenticated, allow-listed Zuri endpoints and forbid direct database or
    broker access.
- **Its current Zuri connector is a loopback-only development proxy.** It forwards
  the `zuri_session` cookie to more than ten page-shaped web-console endpoints
  (`/api/projects`, `/api/crm/conversations`, `/api/inventory/products` and others).
- **There is no cross-origin path into Zuri today.** Zuri has no CORS
  configuration, its session cookie is `SameSite=Lax`, and no registered-client or
  Office enrollment contract exists. The only live Office integrations are
  [FR-294](../requirements/FR-294.md) design custody and the
  [FR-295](../requirements/FR-295.md) handoff popup, and both run same-origin with
  the Zuri session.
- **ADR-062 allows independently built applications under `apps/`.** Each needs
  its own lockfile, CI job and service documentation, and absorbing a repository
  requires preserved history and provenance.

## Decision

1. **No direct database or broker access.** Visual Office never connects to Zuri's
   database, the MSP store or any broker, and holds no database credential. All
   Business data reaches it through Zuri HTTP contracts that resolve the viewer
   from the session and authorize Business scope on the server.

2. **A dedicated Office read projection on the same Server, not a second data
   path.**
   - Zuri publishes one versioned, Business-scoped snapshot contract for Office.
     Working name: `GET /api/businesses/{businessId}/office/snapshot`, envelope
     `office.snapshot.v1`.
   - Content: visible leaf domains (floors), agent roster and status, pending
     work and approval counts, per-object source and freshness, and a revision.
   - The Server builds it from the owning domains' existing read models and
     services. It adds no new table owner and no reporting copy.
   - Updates: the first slice polls with the revision (`If-None-Match`
     semantics). A later, separately contracted Server-Sent Events stream may
     replace polling.
   - Visual Office does not assemble its view from web-console page endpoints.
     Their shapes follow pages and change when pages change.

3. **Writes reuse the owning domain services.** Approvals, commands and CRUD
   started from Visual Office call the same domain write contracts as the web
   console. They carry idempotency keys and expected revisions and record the
   same audit events. A scene action never has a write path of its own.

4. **Same-origin serving for the first platform-backed slice.**
   - Zuri serves the built Visual Office client under its own origin, for
     example at `/office/` behind the deployment's reverse proxy or as static
     assets.
   - The existing session cookie, CSRF protection and cross-site refusal then
     apply unchanged. No CORS and no new client credential are needed.
   - Serving from a separate origin remains possible later, but only after the
     identity owner publishes the registered-client contract that the client
     design requires (§3 and §8 gate 1).

5. **Separate repository; Zuri owns the contract.**
   - Visual Office stays in `Freshair129/zuri-visual-office` with its own build,
     CI and asset pipeline.
   - The `office.snapshot.v1` JSON Schema and its fixtures live in zuri.ai
     `contracts/`.
   - Visual Office pins a contract version and tests against those fixtures.
     Zuri contract tests prove the Server response.
   - This mirrors the existing FR-294 pattern of a vendored verifier pinned to
     an exact Office revision.

6. **Revisit the monorepo only on evidence.** Move Visual Office into `apps/`,
   under ADR-062's preservation rules, only if one of these becomes true:
   - contract and client changes routinely have to land in the same change;
   - the client starts sharing UI or domain code with the Server;
   - separate release coordination causes defects.

   Binary assets would first need Git LFS or external storage.

## Alternatives and consequences

- **Read the database directly.** Rejected. It would duplicate Tenant/Business
  authorization outside the owning domain, couple the client to the physical
  schema, and put credentials in or near a browser application. It also
  contradicts ADR-106, ADR-062, the target invariants and VO-FR-009.
- **Reuse the web-console endpoints as they are.** Rejected as the target. It needs
  many calls per view and a cookie-forwarding proxy, and any refactor of a web page
  breaks Office. It may stay as a local development aid until the snapshot exists,
  but it is not an integration contract.
- **Separate Office backend or database.** Rejected for the first slice. It would
  create a second business-data authority, which the approved client design
  excludes.
- **Monorepo now.** Deferred. Today the shared surface is one small contract. The
  cost would be a third independent dependency tree and CI lane, plus a large
  binary asset history.

Consequences:

- Zuri gains one read contract and its tests.
- Visual Office retires its cookie proxy for Business data once that contract
  exists.
- Deployment gains an `/office/` path on the Zuri origin.
- TASK-ZAI-019..023 can be planned against a named contract instead of page
  endpoints.

## Verification

When this is implemented, add:

- contract tests for `office.snapshot.v1` against shared fixtures in both
  repositories;
- authorization tests for cross-Tenant/Business denial and inaccessible domains;
- floor-projection tests: one lobby plus one floor per visible leaf domain,
  including a domain with no agents;
- revision and freshness tests for polling;
- an end-to-end check that an approval made from Office writes the same audit row
  as one made from the web console (TASK-ZAI-023).

This ADR issues no requirement ID, route, permission or migration. The snapshot
contract still needs its own FR and contract under the normal doc-first process.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-11-06 | candidate | Initial proposal: no direct DB, dedicated snapshot projection, shared write services, same-origin first slice, separate repository with Zuri-owned contract | uncommitted | Claude Opus 5.5 |
