---
id: ZAI:ADR-116
title: Visual Office repository, data-access and serving boundary
version: "0.2.0b"
status: candidate
created_at: "2026-11-06"
last_update: "2026-11-07"
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
recommendation. It takes effect only when the owner accepts it.

It builds on the [Visual Office client design](../architecture/2026-10-22-visual-office-zuri-client-design.md).
That design records an owner approval on 2026-10-23 of Visual Office as an
optional, separately deployed client registered with Zuri, with Zuri remaining
the authority for identity, Business scope and business data. Decisions 1–3, 5
and 6–7 refine that design. **Decision 4 amends it**: for the first slice only, it
replaces the registered-client prerequisite (design §8 gate 1) with same-origin
serving under explicit conditions. Accepting this ADR therefore also accepts that
amendment.

## Context

Visual Office shows the same Business data as Zuri's web console, rendered as a
navigable office instead of pages. The owner asked three questions: should Visual
Office join the zuri.ai monorepo; should it call the same endpoints as the web
console; or should it read the database directly?

Facts at zuri.ai `main` `46787958` and Visual Office `origin/main` `25cfa8f3`:

- **Browser code never reaches Zuri's database.** Console pages either call Server
  route handlers or are server components that read through Server modules (for
  example `(control)/control/usage/page.jsx`). Authorization of Tenant/Business
  scope happens on the Server in both cases.
- **Other Zuri processes do not read Server tables.**
  - The Conversation Runtime has no Prisma client or table access and reaches
    Core over HTTP ([ADR-106](ADR-106-CONVERSATION-RUNTIME-SERVICE-EXTRACTION.md) D1).
  - Edge consumes wire contracts and does not import Server source or access
    Server tables ([ADR-062](ADR-062-ZURI-SERVER-EDGE-MONOREPO-BOUNDARY.md)
    decision 5).
  - [ADR-025](ADR-025-DOMAIN-DRIVEN-DOCS-ARCHITECTURE.md) adopted only the
    ownership principle of the draft
    [target architecture](../ARCHITECTURE-TARGET-MODULAR-MONOLITH.md): each table
    has one owning domain, and only that owner writes it. That draft's module
    contracts and runtime/database decisions are not accepted.
- **Visual Office is a separate repository.**
  - Stack: plain ES-module JavaScript with Three.js, its own CI (npm; both npm and
    pnpm lockfiles are committed) and a large binary asset pipeline (GLB models,
    Blender sources).
  - It depends on no zuri.ai package.
  - Its SRS (VO-FR-009) and integration-boundary documents already require
    authenticated, allow-listed Zuri endpoints and forbid direct database or
    broker access.
  - It already proposes its own execution contract
    (`contracts/zuri-office-execution-v1.schema.json`, "proposed … not an existing
    Zuri API"). Zuri has not adopted it.
- **Its current Zuri connector is a loopback-only development proxy.** It forwards
  the `zuri_session` cookie to more than ten page-shaped web-console endpoints
  (`/api/projects`, `/api/crm/conversations`, `/api/inventory/products` and others).
- **There is no cross-origin path into Zuri today.**
  - Zuri has no CORS configuration, its session cookie is `httpOnly` and
    `SameSite=Lax`, and no registered-client or Office enrollment contract exists.
  - The Office integrations implemented on `main` are [FR-294](../requirements/FR-294.md)
    design custody and the [FR-295](../requirements/FR-295.md) handoff popup. Both
    are local implementations whose release and deployment are tracked separately
    in the roadmap, and both run same-origin with the Zuri session.
  - In FR-294 the producer owns the contract: Visual Office authors the
    design-package schema and verifier, and Zuri vendors them pinned to
    `zuri-visual-office@b4e2d8ed` (`apps/server/vendor/office-design/provenance.json`).
- **The key Office write is not idempotent or revision-checked today.** The
  approval decision route (`api/agent/approval-requests/[id]/decision`) accepts
  only `{decision}`, with no idempotency key or expected revision.
- **ADR-062 allows independently built applications under `apps/`.** Each needs
  its own lockfile, CI job and service documentation, and absorbing a repository
  requires preserved history and provenance.

### Facts changed on 2026-11-07

On 2026-11-07 the owner asked again whether Visual Office should join the
monorepo or become a separate service like MSP and GKS. Facts at zuri.ai `main`
`2bf5a5fc` and Visual Office `main` `78182b5d`:

- **New repository.** Visual Office now lives in the public repository
  `Freshair129/visual-office`, created as a single-commit snapshot. The former
  private repository `Freshair129/zuri-visual-office` is archived (read-only) and
  keeps the full history.
- **The FR-294 pin is still valid.** Commit `b4e2d8ed` remains readable in the
  archived repository. The design-package schema in the public repository is
  byte-identical to the vendored copy (SHA-256 `80efbb49…`, matching
  `provenance.json` `schemaSha256`).
- **Brand and generated binaries are no longer in Git.** 88 files (brand
  characters, ImageGen art, brand marks, third-party candidates) are listed with
  hashes in `asset-store/manifest.json`. They are kept as local files, with a
  dedicated object store used only for developer handoff. A fresh clone builds and
  passes CI with procedural fallbacks.
- **Visual Office has a Worker with its own object storage.** Its R2 bucket holds
  T3 job material: chat threads and file metadata, knowledge files, result files
  and work-review records. These are T3 runner data, not Zuri Business records,
  and no Zuri Business data is stored there.
- **MSP and GKS are a different kind of system.** They are backend services with
  their own runtimes and stores, they serve several products, and zuri-ai holds
  only ports and contracts for them
  ([ADR-063](ADR-063-RETIRE-TIER1-GENESISBLOCKDB-DIRECT-CLIENTS.md) D3–D4).
  Visual Office is a user-facing client of Zuri Business data and owns no
  business data.

## Decision

1. **No direct database or broker access.** Visual Office never connects to Zuri's
   database, the MSP store or any broker, and holds no database credential. All
   Business data reaches it through Zuri HTTP contracts that resolve the viewer
   from the session and authorize Business scope on the Server.

2. **A dedicated Office read projection on the same Server, not a second data
   path.**
   - Zuri publishes one versioned, Business-scoped snapshot contract for Office.
     Illustrative name only: `GET /api/businesses/{businessId}/office/snapshot`
     with envelope `office.snapshot.v1`. The real route and schema need their own
     FR and contract.
   - Content: visible leaf domains (floors), agent roster and status, pending work
     and approval counts, per-object source and freshness, and a revision.
   - The Server builds it from the owning domains' existing read models and
     services. It adds no new table owner and no reporting copy.
   - The revision is a composite over the viewer's authorized view.
   - The first slice polls with that revision (`If-None-Match`). Authorization
     runs before any `304`. Responses are `Cache-Control: private, no-store`
     with `Vary: Cookie`. A `304` saves bandwidth, not the cost of building the
     snapshot.
   - A later, separately contracted Server-Sent Events stream may replace polling.
   - Visual Office does not assemble its view from web-console page endpoints.
     Their shapes follow pages and change when pages change.

3. **Writes go through the owning domain's contract, with the same guarantees for
   every client.**
   - Approvals, commands and CRUD started from Visual Office call the same domain
     write contracts as the web console and record the same audit events.
   - Where Office needs idempotency or an expected revision that a contract lacks
     (the approval decision route today), the owning domain adds it to that one
     contract for all clients. That change is a prerequisite for TASK-ZAI-023.
     No Office-only write path is created.

4. **Same-origin serving for the first platform-backed slice (amends design §8
   gate 1).**
   - Zuri serves the built Visual Office client under its own origin, for example
     at `/office/`. The existing session cookie, CSRF protection and cross-site
     refusal then apply unchanged, with no CORS and no client credential.
   - The cost: code under `/office/` runs with the user's full Zuri session. A
     path prefix does not isolate it, and any XSS in the Office bundle (Three.js,
     markdown/mermaid rendering, scene JSON import, GLB parsing) could call any
     Zuri write API.
   - Same-origin serving is therefore allowed only when all of these hold:
     - a strict Content-Security-Policy on `/office/`: no inline or remote
       script, and `connect-src` limited to the Zuri origin;
     - Zuri deploys only a hash-pinned Visual Office release artifact, recorded
       like `provenance.json`;
     - only curated, manifest-listed assets load; no user-supplied remote URLs;
     - Office releases go through Zuri's review and CI as trusted code.
   - If these conditions cannot be met, Visual Office uses a separate origin after
     the identity owner publishes the registered-client contract (design §3 and
     §8 gate 1).
   - The FR-295 popup handoff is unchanged by this decision. Any same-origin
     replacement for it needs its own contract.

5. **Separate repository; the producer owns each contract.**
   - Visual Office stays in its own repository, now `Freshair129/visual-office`,
     with its own build, CI and asset pipeline. Existing pins to the archived
     `Freshair129/zuri-visual-office` stay valid; new pins name the public
     repository and its commit.
   - Zuri produces the snapshot, so its JSON Schema and fixtures live in zuri.ai
     `apps/server/contracts/`. Visual Office pins a contract version and tests
     against those fixtures. Zuri contract tests prove the Server response.
   - Contracts that Office produces, such as the FR-294 design package, stay in
     Visual Office and are vendored by Zuri.
   - Office's proposed `zuri.office-execution.v1` is not adopted by this ADR. It
     must be reconciled with the owning domain's command contract before use.

6. **Revisit the monorepo only on evidence.** Move Visual Office into `apps/`,
   under ADR-062's preservation rules, only if one of these becomes true:
   - contract and client changes routinely have to land in the same change;
   - the client starts sharing UI or domain code with the Server;
   - separate release coordination causes defects.

   Same-origin serving under decision 4 already makes Office part of Zuri's
   trusted release. If that coordination becomes the main cost, it is a reason to
   move. The binary-asset precondition is met: brand and generated binaries
   already live outside Git (see Facts changed on 2026-11-07).

7. **Visual Office is a client application, not a platform service.**
   - It is not modelled on MSP or GKS. It gets no service lane, no business-data
     store and no runtime that other products call. Zuri reaches it only as a
     served client (decision 4) or a registered client.
   - Its Worker and R2 bucket may hold T3 runner material only (job chat, files,
     results and work review). They must not hold Zuri Business data or become a
     second write path into Zuri.
   - If Office later needs server-side Business behaviour, that behaviour belongs
     in the owning Zuri domain, exposed through contracts like decisions 2–3.

## Alternatives and consequences

- **Read the database directly.** Rejected. It would duplicate Tenant/Business
  authorization outside the owning domain, couple the client to the physical
  schema, and put credentials in or near a browser application. It also
  contradicts ADR-106, ADR-062 and VO-FR-009.
- **Reuse the web-console endpoints as they are.** Rejected as the target. It needs
  many calls per view and a cookie-forwarding proxy, and any refactor of a web page
  breaks Office. It may stay as a local development aid until the snapshot exists,
  but it is not an integration contract.
- **Separate Office backend or database.** Rejected for the first slice. It would
  create a second business-data authority, which the client design excludes.
- **Separate origin first.** Preferable for isolation, but it needs the
  registered-client contract, CORS and token handling first. Decision 4 keeps it
  as the fallback.
- **Monorepo now.** Deferred. Today the shared surface is one small contract. The
  cost would be a third independent dependency tree and CI lane in zuri.ai. Since
  2026-11-07 binary history is no longer a cost, because the public repository
  has no brand binaries. Both repositories are public, so CI billing does not
  decide this either way.
- **Separate service like MSP or GKS.** Rejected. Those are shared backend
  systems with their own runtimes and stores. Visual Office is a client: giving
  it a service lane would create a second place where Business behaviour and data
  could live, which decision 1 and the client design exclude.

Consequences:

- Zuri gains one read contract and its tests.
- The approval decision contract gains idempotency and revision checks for all
  clients.
- Visual Office retires its cookie proxy for Business data once the snapshot
  exists.
- Deployment gains an `/office/` path with its own CSP and pinned artifact.
- TASK-ZAI-019..023 can be planned against named contracts instead of page
  endpoints.

## Verification

When this is implemented, add:

- contract tests for the snapshot against shared fixtures in both repositories;
- authorization tests for cross-Tenant/Business denial and inaccessible domains,
  including an unauthorized request carrying a matching revision;
- floor-projection tests: one lobby plus one floor per visible leaf domain,
  including a domain with no agents;
- caching-header and revision tests;
- a CSP and artifact-hash check for `/office/`;
- an end-to-end check that an approval made from Office writes the same audit row
  as one made from the web console (TASK-ZAI-023).

This ADR issues no requirement ID, route, permission or migration. Each contract
named here still needs its own FR and contract under the normal doc-first process.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-11-06 | candidate | Initial proposal: no direct DB, dedicated snapshot projection, shared write contracts, conditional same-origin first slice (amends design gate 1), separate repository with producer-owned contracts | uncommitted | Claude Opus 5.5 |
| 0.2.0b | 2026-11-07 | candidate | Refresh facts: public `Freshair129/visual-office` (old repo archived, FR-294 pin still valid), binaries outside Git, Worker R2 holds T3 data only. Add decision 7 (client, not an MSP/GKS-style service) and the matching rejected alternative; mark the decision 6 binary precondition met | uncommitted | Claude Opus 5.5 |
