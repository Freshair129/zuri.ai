---
date: "2026-08-22"
status: "investigating"
scope: "catalog database refresh and LINE direct-message routing"
risk: "HIGH"
---

# RCA: Catalog database refresh and LINE direct-message failures

## Symptom

The active GenesisBlock store was an older, unmanifested store. The catalog
family/variant/offer projection could not safely refresh it in place. The full
test suite also reported four failures in LINE history and identity routing.

## Evidence

- `data/genesis_smartgift_store` contained native database files but no
  `catalog-manifest.json`.
- The current pricing snapshot contains 1,017 source rows, 1,016 canonical
  offers, 845 product families, one exact duplicate source row, and no
  conflicting source code.
- `handleDirectMessages` used `identity?.role ?? 'sales'`, which allowed an
  unknown or revoked caller to reach `answer` instead of requesting access.
- The same handler remembered an event before the reply completed and swallowed
  reply errors, so a failed LINE reply did not reject and did not reliably leave
  the event retryable.
- The webhook server intentionally sends the HTTP 200 response immediately for
  LINE's transport deadline, with `{ status, correlationId, archived }`, then
  processes replies in the background. The history test still expected the old
  synchronous counter envelope.

## Root Cause

1. The legacy store had no snapshot manifest. The ingestion guard correctly
   refused to guess whether its contents matched the current catalog, but no
   versioned replacement store had yet been built.
2. A dirty direct-message routing change replaced the fail-closed identity
   branch with an implicit sales role for every sender.
3. Reply deduplication was recorded before transport success and the transport
   failure was caught without rethrowing.
4. The HTTP test contract was stale relative to the intentional asynchronous
   webhook response contract.

## Why the issue escaped detection

Catalog smoke tests covered the new projection with temporary stores, but the
legacy on-disk store and runtime default were not migrated in the same step.
The targeted catalog tests therefore passed while the full history/identity
suite still exercised pre-existing dirty routing changes.

## Proposed prevention

- Use an explicit versioned store and a persisted catalog manifest for each
  source snapshot; preserve an unmanifested legacy store until migration is
  verified.
- Keep direct-message authorization fail-closed: only approved identities may
  call answer or enqueue; remember an event only after reply or push succeeds.
- Test the webhook HTTP transport envelope separately from the asynchronous
  reply outcome.
- Run the full suite after catalog/runtime changes, not only catalog tests.

## Resolution evidence

- Direct-message routing was changed to deny unknown/revoked identities, create
  an idempotent access request, and call `answer` only for approved identities.
- Event dedupe is now recorded only after reply or push success; transport
  failure is rethrown so the caller can retry.
- The HTTP history test now verifies the immediate `{ status, correlationId,
  archived }` envelope and waits for the asynchronous reply result.
- Targeted history/identity tests pass: 29/29.
- The new database was built at `data/genesis_smartgift_store_family_v2` with
  845 families, 1,016 offers, 2,877 nodes, 2,032 edges, and snapshot
  `d2afc2597c66656a8572a27e4189c99a38f4b1c247b53d32504e39d6ecdddd31`.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed: 247/249 tests, 0 failures, 2 intentional skips.
