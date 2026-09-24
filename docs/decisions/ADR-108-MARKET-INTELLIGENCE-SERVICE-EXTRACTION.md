---
id: ZAI:ADR-108
title: "Market Intelligence service extraction on the ownership trigger"
version: "0.1.0b"
status: approved
created_at: "2026-09-24T09:30:00+07:00,Claude"
last_update: "2026-09-24T09:30:00+07:00,Claude"
author: Claude
approval_scope: architecture-and-local-implementation
approved_on: "2026-09-24"
approved_by: "Owner instruction: Ownership, continue M2; remaining decisions delegated to Claude Fable 5.1"
integration_status: pending
implementation_status: in-progress
attributes:
  doc_type: architecture-decision
  domain: market-intelligence
  scope: "Market Intelligence runs as its own process that owns MarketObservation writes, behind core-owned authority, raw-evidence and audit façades"
relations:
  - type: relates_to
    target: ZAI:ADR-038
  - type: relates_to
    target: ZAI:ADR-057
  - type: relates_to
    target: ZAI:FR-092
---

# ADR-108 — Market Intelligence service extraction on the ownership trigger

**Status:** Approved for local implementation on 2026-09-24. Production cutover,
the core façade routes, the restricted database role and CI wiring are separate,
later gates. This ADR does not authorize any of them.

**Risk:** MEDIUM. The service owns one table with no foreign keys. A new writer is
still a correctness risk (double execution, scope leaks), which is why routing and
ownership are gated twice (D6).

## Context

[ADR-038](ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md) D8 says a Market worker is an
execution topology, not a microservice. It permits extraction only for a real
operational trigger: independent load, deployment cadence, security/compliance,
availability or **ownership**. The service-extraction refactor (Session 4, see
`docs/migrations/service-extraction/`) finished M1: a pure Market core in
`services/market-intelligence/` that imports no foreign domain, kept equal to the
executing legacy module by shared golden vectors.

On 2026-09-24 the owner chose **ownership** as the trigger. The owner then delegated
the remaining decisions for this lane to Claude Fable 5.1. D1–D8 below record those
rulings.

## Decision

### D1 — Trigger and scope of the amendment

Market Intelligence is extracted on the **ownership** trigger: one team-owned process
is the only writer of Market-owned state and the only executor of Market logic. D8 of
ADR-038 stays the default for every other domain; this ADR amends it for Market only.
No other domain may cite this ADR as precedent without its own trigger.

### D2 — Persistence: one port, two adapters, one conformance suite

`ObservationStore` has a `pg` adapter, which is the only production path, and a
`node:sqlite` adapter for local and test use only. Both must pass
`services/market-intelligence/test/store-conformance.js`. That suite covers
CREATED/UNCHANGED replay, exact UTC timestamps, scope refusal, explicit
`businessId` with null as its own scope, bounded newest-first reads, cross-scope
lineage collision as a fault, a race of 8 concurrent inserts from **separate
connections** (threads for SQLite, connections for Postgres) yielding exactly one
row, and restart durability. When Docker is absent, the Postgres run reports
`NOT_RUN`. Prisma is not used inside the service.

### D3 — Data ownership during transition

The service uses the same physical Postgres and the same `"MarketObservation"` table.
IDs, `lineageKey` and every column are preserved. `test/ddl-parity.test.js` pins the
service's column list to the production migration and to the generated Prisma model.
The service connects as a restricted role with `SELECT, INSERT` on that table only
(no `UPDATE`, no `DELETE`, no other table). The service never runs DDL in production.
The role is applied by an operator (ADR-057) from the runbook below; no file under
`supabase/migrations/` is written by this lane. Until D6's switch flips, the legacy
Prisma writer still writes, so ownership is **declared, not enforced**.

### D4 — Authority: core stays the only identity authority

The console BFF forwards the end user's own credential opaquely in `x-zuri-subject`,
and authenticates itself to the service with its own bearer token. The service
authenticates to core's private façade (`/api/internal/market-intelligence/v1/*`)
with a different bearer token and passes the subject through unchanged. Core resolves
the viewer and answers `authorize`, `raw-candidates`, `audit`, `execution-ownership`
and `health` in the `market-core.v1` envelope. The service holds no viewer-resolution
code and no shared signing secret, and it never logs or stores the subject. A signed
actor assertion was rejected because it creates a second trust root; trusting a plain
actor id was rejected as a confused deputy by construction.

### D5 — Runtime, API and image

The service is a plain Node ≥22.13 ESM process (`node:http`). Its endpoints:

- `/healthz`: the process is up.
- `/readyz`: the store answers, core answers, and the execution-ownership answer has
  arrived. The response body names `deps.core`, so a fake core can never read as
  production. A production config never becomes ready on a non-`remote` core.
- `GET /v1/observations`: feed version 1.0, same shape as today.
- `POST /v1/translations`: 64 KiB body cap, strict schema.

Error bodies keep the legacy `{ error, issues? }` shape. The image is built from the
repository root, copies only this package (`Dockerfile.dockerignore` denies everything
else), mounts nothing, and needs no `next build`. `compose.rehearsal.yml` is a
separate Compose project (`zuri-market-rehearsal`) with loopback-only ports, used for
local image-start proof. It must never be layered onto the live `zuri-ai` project, and
`test/compose-guard.test.js` enforces that.

### D6 — Single writer, gated twice

At M3, the two Market-owned Next routes read one deployment flag,
`MARKET_EXECUTOR=legacy|service`, which defaults to `legacy`. The service also refuses
translation writes (409 `MARKET_NOT_EXECUTION_OWNER`) unless core's execution-ownership
answer says it owns execution. Reads need only the flag. The flag is per deployment,
never per request or client-controlled. `MARKET_TEST_ASSUME_EXECUTION_OWNER` exists for
local runs and is refused in production. Cohort routing needs its own ADR if a second
tenant arrives.

### D7 — Failure semantics

- **Core unreachable, timed out or malformed:** 503 `CORE_UNAVAILABLE` on both reads
  and writes, and readiness flips to not ready. There is no cached decision and no
  stale feed. Only the idempotent core reads retry (bounded, jittered, sub-second).
  The audit append is never retried.
- **Audit:** observations commit, then one audit event is sent (counts only, never
  payloads). An audit outage fails the request, now 503 instead of legacy's 500
  because it is a dependency outage, and the observations stay committed and
  idempotent through `lineageKey`. Every `CORE_UNAVAILABLE` body carries `phase`
  (`before-write` or `audit`) and `committed`, and an audit-phase failure is logged,
  so operators and the M4 work can tell "nothing written" from "audit lost". A durable audit handoff is M4 and needs the audit
  owner's contract review. M2 must not add an outbox that silently changes the audit
  owner.
- **Concurrency:** `insertIfAbsent` is the only serialization point. There are no
  advisory locks and no run mutex.
- **Cross-scope lineage collision:** a server fault (500, logged), never `UNCHANGED`.
- **Raw evidence:** every candidate is re-checked against the authorized tenant,
  Business and lane. A mismatch is refused per record (`RAW_EVIDENCE_SCOPE_MISMATCH`).

### D8 — Identifiers

This ADR is the only new id. Annotations reuse FR-092, NFR-018, SDD-049 and SEC-017:
the service changes where FR-092 executes, not what it does. Any SDD for the service
contract is declared after the parallel lanes (ADR-106, SDD-108) land, by whichever
lane merges second.

## Operator runbook — restricted role (NOT applied by this lane)

Apply only under an operator instruction (ADR-057), before `MARKET_EXECUTOR=service`
is set anywhere. The table has row-level security enabled
(`20260820080000_market_observation.sql`), so a non-owner role also needs a policy.

```sql
-- Run as the table owner. The password is set out of band, never committed.
CREATE ROLE zuri_market_service LOGIN NOINHERIT;
GRANT USAGE ON SCHEMA public TO zuri_market_service;
GRANT SELECT, INSERT ON TABLE "MarketObservation" TO zuri_market_service;
CREATE POLICY market_service_rw ON "MarketObservation"
  FOR ALL TO zuri_market_service USING (true) WITH CHECK (true);
-- Verify: the role cannot see any other table.
-- SET ROLE zuri_market_service; SELECT count(*) FROM "Business";  -- must fail
```

The policy is `FOR ALL` because the table grant already limits the role to
`SELECT, INSERT`. Rollback: `DROP POLICY market_service_rw ON "MarketObservation";
DROP OWNED BY zuri_market_service; DROP ROLE zuri_market_service;`. No observation is
lost, because the legacy writer keeps its own privileges throughout.

## Migration and rollback

1. **M2 (this checkpoint):** the process, adapters, conformance and image-start
   rehearsal. Nothing routes to the service.
2. **M3:** core façade routes (integrator lane), the BFF flag in the two Market routes,
   provider conformance against the fake core's contract.
3. **M4:** the restricted role applied, a durable audit handoff, a replay/version
   rehearsal, and a revoke/redaction path.
4. **Cutover:** `MARKET_EXECUTOR=service` plus core execution-ownership true, under a
   separate operator instruction. Rollback is setting the flag back to `legacy`. Rows
   written by the service are in the same table with the same lineage and remain
   readable by the legacy path and backup-service. Nothing is copied back or dropped.

## Alternatives rejected

- **Keep Market in-process (ADR-038 D8 unchanged):** rejected by the owner's ownership
  trigger.
- **Separate database or schema with backfill:** it adds dual-write, backfill and
  rollback risk for one tenant and a foreign-key-free table.
- **Prisma inside the service:** it drags the server's schema and generated client
  back into the service.

## Verification

See `docs/migrations/service-extraction/MARKET-INTELLIGENCE-HANDOFF.md` for the exact
commands, counts and states per axis.

## Decided by

The decisions above were made on 2026-09-24 by Claude Fable 5.1, acting as the
product owner's explicitly delegated decision-maker for the rest of the Market
Intelligence service-extraction lane. They cover how ADR-038 D8 is resolved for Market
(trigger: ownership), the persistence engine and adapter conformance, data ownership
during transition, actor propagation, single-writer routing, requirement-id policy,
M2 checkpoint scope, and the readiness, unreachable-core, audit-durability and
concurrency semantics. The delegation followed the owner's instruction to continue
with M2 and let Fable 5 decide everything remaining. These decisions bind Session 4's
M2 work. They do not authorize any merge, production deployment or migration,
live-provider call, or edit to shared governance, CI or root files; those remain with
the integrator (Session 1) and the owner. Any later reversal is an amendment to this
ADR, not a silent change.

## CHANGELOG

- 0.1.0b (2026-09-24): initial decision and M2 scope.
