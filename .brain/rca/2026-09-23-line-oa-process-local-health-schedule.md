# RCA — LINE OA worker health sweep used process-local scheduling

## Symptom

The authenticated LINE worker route throttled the hourly transport-health sweep
with a module-level `lastHealthSweepAt` value. The first request handled by each
API process started its own clock, so a restart or a second replica could run
the same sweep independently, while a process that stopped could leave the
monitoring cadence absent until another process happened to receive a request.

## Evidence

- `apps/server/src/app/api/line-oa/worker/route.js` stored
  `lastHealthSweepAt` in module memory and updated it before calling the sweep.
- The route can be served by more than one stateless API instance, and module
  memory is lost on restart.
- `sweepLineTransportHealth` only reads durable account/evidence state; no
  durable checkpoint or lease identified which instance owned the hourly run.
- The approved ADR-105 contract permits process-local caches as disposable
  optimisations, but does not permit a local timer to be the authority for a
  scheduled operation.
- Adding the durable checkpoint changed the canonical Prisma schema from 187 to
  188 application models. The frozen Phase B recovery inventory and its exact
  schema binding initially remained at 187, so the recovery loader correctly
  failed closed during the full-suite run.

## Root Cause

The worker route treated an operational schedule as an in-process concern. The
worker jobs themselves already used durable status/version/lease fencing, but
the health-monitoring trigger was left behind as a module-level timer when the
route was made callable by the supervised worker.

## Why the issue escaped detection

The route tests executed one module instance and asserted that the sweep was
not part of the response contract. They did not load two route instances,
restart the process between ticks, or assert durable ownership of the hourly
cadence. The health result was advisory, so ordinary job and provider tests
remained green.

## Proposed prevention

Persist one `TRANSPORT_HEALTH` worker checkpoint with a short lease and a
next-due timestamp. Claim it with a database compare-and-set before probing,
clear the lease after completion or failure, and keep the existing endpoint
probe cache explicitly disposable. Add unit coverage for concurrent claims,
restart-equivalent empty process state and failure lease release.

When a Prisma model is added, rebind the frozen Phase B inventory and exact
schema hashes in the same change, even when the model is excluded from backup
contents. Add the inventory loader to the focused regression set.
