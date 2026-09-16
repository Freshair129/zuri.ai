# FR-077 Inventory returns HTTP 400 when its read transaction outlives a stalled event loop

Status: root cause confirmed by a deterministic reproduction; fixed in the read model.
Supersedes the open investigation in `2026-09-06-fr077-containment-ci-flaky.md`.

## Symptom

`tests/e2e/fr077-project-inventory.spec.js:53` ("limit=1 exposes partial/truncated metadata")
failed its first attempt and passed on retry in governance run 34561856530 (PR #326, docs only),
so `--fail-on-flaky` failed the job. The status-only diagnostic added on 2026-09-06 recorded
`Inventory limit=1 returned HTTP 400`. The failing attempt took 10.1 s; the other attempts of
this spec take about 1–2 s.

## Evidence

- `handle()` in `apps/server/src/app/api/_helpers.js` answers 400 for a `ZodError` and for any
  error whose message matches `/denied|not allowed|cycle|must|cannot|requires|unknown/i`.
- `getProjectInventory` ran its whole read inside `db.$transaction(read)`, an interactive Prisma
  transaction with Prisma's default 5 000 ms timeout, measured in wall time from its start.
- Experiment (throwaway Vitest file against the per-run SQLite database, same read model and the
  real `handle()`):

  | Scenario | Status | Time | Error |
  |---|---|---|---|
  | No contention | 200 | 10 ms | — |
  | Another connection holds a write transaction for 7 s | 500 | 5 388 ms | "Operations timed out … database failed to respond to a query within the configured timeout" |
  | 40 short concurrent writes during the read | 200 | 5 ms | — |
  | Event loop blocked synchronously for 6 s after the Project lookup, inside the transaction | **400** | 6 010 ms | "Transaction API error: Transaction already closed: A batch query cannot be executed on an expired transaction. The timeout for this transaction was 5000 ms, however 6001 ms passed …" |

  SQLite lock contention produces a 500, not the observed 400. Only an expired interactive
  transaction produces a slow 400, because Prisma's message contains "cannot".
- The e2e server is `next dev`. Right after `chooseBusiness`, the overview page fires
  `/api/viewer` and one `/api/progress/project/{id}` per card, which can trigger first-request
  compiles; a compile blocks the one Node event loop that also runs the test's inventory request.
  That is the same class of stall behind the rotating flakes fixed by the warm-up in PR #285.
  After the first attempt everything is compiled, so the retry passes.
- Local reruns on an idle machine (`--no-deps --retries=0 --repeat-each=10`) passed 50/50; the
  stall only occurs under CI load, which is why the deterministic experiment was needed.

## Root cause

A read-only composite (Project lookup, authorization, ~10 section queries, activity) held an
interactive transaction open across JavaScript awaits. Any event-loop stall longer than 5 s while
it was open expired the transaction, and the error mapper reported the engine's message as a
client error (400). The same failure mode exists in production, which uses the same Prisma
default, under GC or CPU pressure.

## Fix

`getProjectInventory` runs the same reads directly instead of inside `$transaction`. SDD-045
requires a read-only DTO with authorization before composition; it does not require a single
snapshot, and the progress route already authorizes and then reads without a transaction. A stall
now only delays the response. No timeout was raised and no retry was added.

`tests/integration/project-inventory-stall.test.js` reproduces the stall (6 s, longer than the
transaction timeout) through the real `handle()` and requires HTTP 200 with the partial metadata;
it failed with 400 before the fix. The e2e assertion now includes the response body on failure,
so any future non-200 names its own cause.

## Not changed (follow-ups)

- ~~`project-roadmap-read-model.js` and `projects-dashboard-read-model.js` use the same
  `db.$transaction(read)` construct and have the same failure mode.~~ Done: both were
  reproduced with the same stall harness (each answered 400 with the identical
  "expired transaction" message) and changed the same way. FR-068/FR-070 (SDD-039,
  ADR-028, ADR-029) and FR-086 (SDD-047, ADR-036) were checked first and neither asks for a
  single snapshot: their only transactional requirement is the *write* commit path, and
  SDD-047 states outright that it follows SDD-045's discipline. Covered by
  `tests/integration/project-roadmap-stall.test.js` and
  `tests/integration/projects-dashboard-stall.test.js`.
- ~~`handle()` classifies Prisma engine messages by keyword, so a server-side transaction or
  timeout error can surface as 400. Mapping Prisma client errors explicitly (500) would keep
  infrastructure failures from reading as validation errors.~~ Done: `handle()` now classifies
  Prisma's own error types before sniffing the message, so P2028 and a malformed query answer
  500 rather than 400. P2025 keeps its 404 (the one Prisma code that describes the request),
  and a status a service set deliberately still wins. Matched by error `name`, not
  `instanceof`: this app builds two Prisma clients and their error classes are distinct
  constructors, so an `instanceof` fix would have worked in test and been absent in
  production. Covered by `tests/unit/api-error-mapping.test.js`.

  Two call sites had already worked around the symptom by raising their interactive
  transaction timeouts — `line-server-provisioning-service.js` ("surfaced to the browser as a
  400 with no field to blame") and `line-conversation-jobs.js`. Those timeouts are left as
  they are: they were chosen for the work those transactions do, and this change only stops
  the failure from being misreported.
