---
version: "0.2.0b"
created_at: "2026-08-14T10:09:00+07:00,ATHER"
last_update: "2026-08-14T10:17:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "task-report"
  scope: "FR-055 W2 controlled binding activation and rollback CLI"
---

# FR-055 W2 report — activation and rollback operator CLI

## Outcome

**PASS after review remediation; ready for independent re-review.** The lane adds an injected PostgreSQL
operator service and a dry-run-default command. It does not apply a migration, contact Supabase or
LINE, read a real secret, expose a browser/API/webhook/agent-tool surface, stage or commit files.

## Delivered boundary

- Activation and rollback always pass the W1A Zod parser before evidence or database work.
- The three evidence artifacts are re-read and SHA-256 checked before the transaction.
- The service independently verifies `session_user = zuri_line_activation_login`, then assumes and
  verifies `current_user = zuri_line_activation_operator` inside the transaction.
- The lock pins exact binding identity, version, status and hash presence without using PostgreSQL
  transaction-start `now()` as a mutable-time authority.
- DRY_RUN reads `clock_timestamp()` only after obtaining the row lock, validates the fresh approval
  and activation-expiry bounds, then rolls back and returns a named `preview`, never a receipt.
- APPLY uses a one-row materialized `clock_timestamp()` CTE in the UPDATE, repeats approval and
  activation-expiry predicates atomically, and returns the database timestamp used for
  `valid_from`, `updated_at` and the persisted event receipt.
- `APPLY` activation HMACs destination and bearer with the existing `hashBindingSecret`, performs
  `PENDING -> ACTIVE`, increments exactly once and inserts one `EVIDENCE_VERIFIED` event atomically.
- Rollback performs routing-first `ACTIVE -> INACTIVE`, increments exactly once and leaves both
  persisted hashes and other binding data untouched before appending its event.
- Every existing mutation event for the supplied correlation fails closed before row lock or
  mutation. W2 no longer claims byte-identical replay because W1B stores no canonical request hash.
- The CLI accepts only operation and artifact paths plus explicit `--apply`. Database URL,
  destination, bearer and pepper are environment-only; only the dedicated login URL is accepted.
  Before output, the CLI projects only explicit wrapper keys and validates the nested preview or
  receipt through W1A; hostile top-level fields are dropped and hostile nested evidence is rejected.
  Unexpected executable errors collapse to `LINE_ACTIVATION_FAILED`.

## TDD and verification evidence

| Phase | Command | Result |
|---|---|---|
| RED | `npx vitest run --config vitest.fr055-w2.temp.config.js` | expected FAIL: 2 suites, module and CLI absent |
| Review-remediation RED | same isolated focused config | expected FAIL: 5 failures covering preview, temporal CAS, expired dry-run clock and hostile output |
| GREEN | same isolated focused config, W2 files | PASS: 2 files / 19 tests |
| W1A/W1B compatibility | same isolated config including contract and migration unit tests | PASS: 4 files / 45 tests |
| Syntax | `node --check src/modules/agent/line-binding-activation.js` and `node --check scripts/manage-line-binding.mjs` | PASS |
| Whitespace hygiene | `git diff --no-index --check -- NUL <each W2 file>` | PASS for all five owned files |
| Direct CLI load smoke | `node scripts/manage-line-binding.mjs` without arguments | expected safe failure: `LINE_ACTIVATION_CLI_OPERATION_INVALID`, exit 1 |

The temporary Vitest config disabled repository global setup and included only these FR-055 unit
files, so the run did not access shared `prisma/test.db`. The temporary config was removed after
verification.

## Files produced

- `src/modules/agent/line-binding-activation.js`
- `scripts/manage-line-binding.mjs`
- `tests/unit/line-binding-activation.test.js`
- `tests/unit/line-binding-activation-cli.test.js`
- `docs/.rwang-tasks/fr055-w2-activation-cli-report.md`

## Limitations and remaining gates

- Query behavior is proved through an injected PostgreSQL client in W2 unit tests. W1B separately
  proves the migration's roles/RLS/constraints; a composed real-PostgreSQL W4 test is still needed.
- No real operator-login connection, production mutation, LINE transport or external canary was
  run. Those states remain `NOT_RUN`.
- Duplicate correlation is intentionally unavailable as a successful replay. Retrying requires a
  new approved correlation and fresh exact-state expectations; this is the fail-closed ADR-020
  interpretation and avoids claiming identity that the event schema cannot prove.
- The CLI intentionally has no package-script alias in this lane because package files were out of
  scope. Direct Node execution emits Node's existing typeless-package performance warning before
  the command output; removing that warning requires the out-of-scope package-level module-mode
  decision. Invoke the command directly only after the composed gate is approved.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Local operator activation/rollback service and dry-run-default CLI with isolated RED→GREEN evidence | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | candidate | Closed temporal CAS, replay identity, dry-run preview, output projection and failure-matrix review findings | working-tree | ATHER |

## Independent review

**Reviewer:** Pascal
**Reviewed at:** 2026-08-14T10:11:10+07:00
**Verdict:** `FAIL` — the static implementation is close, but approval-time CAS and replay identity
do not yet meet ADR-020/W2's fail-closed contract. This verdict blocks W2 exit, not W1A/W1B or
production-independent documentation work.

### Findings

| Gate | Result | Evidence and action |
|---|---|---|
| Transaction and role ordering | `PASS` | The service parses W1A input and hashes all three evidence files before connecting, then executes `BEGIN`, verifies `session_user`, assumes the constant operator role, verifies `current_user`, checks replay, locks the binding, updates, inserts and commits. All post-`BEGIN` thrown failures enter the rollback path and the client is released. |
| Dedicated service role | `PASS` | Both CLI URL parsing and in-transaction `session_user` require `zuri_line_activation_login`; `current_user` must become `zuri_line_activation_operator`. The role name is constant, not caller-controlled. W1B grants this exact NOINHERIT login membership in the bounded NOLOGIN operator role. |
| Exact binding CAS | `PASS_WITH_BLOCKER_BELOW` | Lock and update predicates pin binding/Tenant/Business/code/LINE provider/version/status/hash presence. Update row count and returned post-version must match exactly one increment; insert row count must equal one. Project is separately fixed to the one approved project and W1B RLS fixes the same Tenant/Business/binding. |
| Approval and expiry at mutation time | `FAIL` | `bindingLockSql` uses PostgreSQL `now()`. PostgreSQL `now()` is the transaction-start timestamp, so a transaction that begins before expiry but waits on `FOR UPDATE` until after expiry can still pass. The later UPDATE has no approval-window or activation-expiry predicate, and `valid_from`, `updated_at` and event `occurredAt` use the application timestamp captured before evidence reads/connect/lock. Action: use a fresh database wall-clock (`clock_timestamp()` or one DB time value obtained after the lock), recheck approval and binding expiry in the mutating statement/CTE, and derive persisted occurrence/validity timestamps from that database value. Add a delayed-lock test that crosses expiry and proves zero UPDATE/INSERT. Apply the equivalent fresh approval check to rollback. |
| Evidence byte hashes | `PASS_WITH_WARNING` | `readFile(path)` bytes are SHA-256 recomputed and compared before connection. This meets the immediate pre-transaction contract, but files are not held open/locked; W4 should consume immutable/pinned artifacts or rehash the exact bytes handed to downstream logic to close filesystem TOCTOU. |
| Environment-only secrets and HMAC order | `PASS` | CLI accepts no secret option; destination/bearer/pepper come only from named environment variables for activation APPLY. Service minimum checks run before connect. `hashBindingSecret(pepper, destination)` and `(pepper, bearer)` match the existing HMAC-SHA256 signature, and unit assertions prove raw values do not enter SQL parameters. |
| Dry-run zero mutation | `PASS_WITH_WARNING` | DRY_RUN locks the exact row then explicitly rolls back before UPDATE/INSERT. The returned object is marked `dryRun: true`, but its nested W1A mutation receipt previews `bindingVersionAfter = before + 1` and `EVIDENCE_VERIFIED` despite no durable mutation/event. Keep this explicitly typed/named as a preview or add a dry-run result contract so it cannot be detached from the wrapper and misrepresented as a persisted receipt. |
| Correlation replay identity | `FAIL` | W2 says a **byte-identical** replay may return the stored result. `replayMatches` compares a semantic subset and omits approval `notBefore`/`expiresAt`; those values are not persisted by W1B. A request with changed approval timestamps but the same `approvalRef`, scope, version and evidence can therefore replay successfully if its new window is active. Action: persist and compare a canonical request SHA-256 (preferred), or persist every replay-authoritative field and compare it; otherwise amend the approved contract before claiming byte identity. Add changed-window and canonical-byte replay tests. |
| Replay secret/current-row proof | `PASS` | Activation replay recomputes destination/credential HMACs and locks the current ACTIVE row at the expected post-version, hashes and exact expiry. Rollback replay locks the exact INACTIVE post-version row and requires hashes to remain present. A mismatch rolls back with correlation conflict and never updates/inserts. |
| Routing-first rollback | `PASS` | Rollback SQL changes only status/updated timestamp/version, leaves both hashes and other data untouched, and runs before the event insert. Insert failure rolls the atomic transaction back, consistent with the approved all-or-nothing boundary. |
| CLI dual APPLY gate | `PASS_IMPLEMENTATION` | Both `--apply` plus contract `mode: APPLY` are required; either one alone fails. Rollback APPLY does not request activation secrets. Only the dedicated URL is passed to a one-connection pool, and privileged Supabase credential variables are rejected. |
| CLI logging/redaction | `WARN` | The executable prints `JSON.stringify(result)` without validating/reconstructing a known redacted result at the CLI boundary. The real service currently returns only a safe wrapper, but the test injects a service and proves only that the DB password is absent; it would log an injected destination/token field unchanged. Action: validate and project the result through the approved receipt/result contract before output, and test hostile service output plus stderr redaction. |
| Test quality | `WARN` | Existing unit coverage proves evidence mismatch before connect, exact lock shape, HMAC order, dry-run no SQL mutation, activation/rollback order, replay hash mismatch, event rowcount failure and rollback. Missing focused cases include wrong `current_user` after successful `SET ROLE`, UPDATE rowcount/version mismatch, commit/query failure after mutation, reverse dual-gate (`input APPLY` without flag), privileged-env rejection, hostile output redaction, changed approval-window replay, and the lock-wait expiry race. The service tests use an injected client only; composed PostgreSQL service verification remains correctly assigned to W4. |

### Reproducible static counterexamples

1. Begin a transaction one instant before `approval.expiresAt`, wait on the target row lock until
   after expiry, then continue. Because `now()` remains the transaction-start timestamp and UPDATE
   does not repeat the temporal predicate, the current SQL can still activate/rollback.
2. Replay an existing APPLY event with identical persisted fields and `approvalRef`, but different
   `notBefore`/`expiresAt` values that include the current parser/database time. `replayMatches`
   never compares those changed values and W1B has no request fingerprint, so current-row proof can
   return the prior receipt.

This review was static and read-only except for appending this section. It ran no test suite or
database, accessed no environment secret or remote target, changed no implementation/test/schema,
and staged/committed nothing.

## Independent-review remediation

**State:** all actionable W2 review findings are closed in the local lane and ready for re-review.

| Review finding | Remediation evidence |
|---|---|
| Transaction-start time could survive a lock wait | The lock contains no time predicate. APPLY uses one materialized `clock_timestamp()` CTE inside the UPDATE, repeats approval/expiry predicates there and returns the same DB timestamp used by the persisted receipt. A zero-row lock-wait/expiry simulation fails CAS before event insert. |
| DRY_RUN used stale/application time and receipt naming | After the lock, DRY_RUN selects fresh `clock_timestamp()`, validates it, rolls back and returns only `preview`; an expired DB-clock test fails closed. |
| Replay identity could not be proven | Successful replay was removed. Any existing mutation event for the correlation raises `LINE_ACTIVATION_CORRELATION_CONFLICT` and rolls back before binding lock or mutation. |
| CLI trusted arbitrary service result | CLI projects only `{dryRun, preview}` or `{dryRun, receipt}`, validates the nested artifact through `parseLineCanaryReceipt`, drops hostile top-level fields and rejects hostile nested fields. |
| Missing failure matrix | New tests cover wrong `current_user`, UPDATE row-count/version mismatch, insert failure, commit failure, reverse APPLY gate, privileged environment rejection, hostile output and unconditional duplicate rejection. |

Fresh isolated result: W2 19/19 PASS; W1A/W1B/W2 compatibility 45/45 PASS. No
PostgreSQL, remote Supabase, LINE, real secret, package, staging or commit operation was performed.

## Remediation review

**Reviewer:** Pascal
**Reviewed at:** 2026-08-14T10:19:39+07:00
**Verdict:** `PASS` — the two prior blockers and the CLI/test warnings are closed for the local W2
boundary. Composed PostgreSQL execution remains a W4 gate and production remains `NOT_RUN`.

| Prior finding | Result | Re-review evidence |
|---|---|---|
| Lock wait could cross approval expiry | `PASS` | The `SELECT ... FOR UPDATE` lock no longer treats transaction-start `now()` as time authority. After the lock, APPLY executes one UPDATE with a materialized `clock_timestamp()` CTE and repeats approval bounds in the CAS predicate; activation also repeats binding-expiry bounds. A post-expiry wall clock therefore produces zero updated rows and the service rolls back before insert. Rollback uses the same fresh-clock approval predicate. |
| Application timestamps persisted as mutation time | `PASS` | APPLY returns `wall_clock.occurred_at` from the UPDATE and uses that same database value for `valid_from`/`updated_at` and receipt/event `occurredAt`. DRY_RUN selects `clock_timestamp()` only after acquiring the lock and validates it before returning. |
| Replay was not byte-identical | `PASS_FAIL_CLOSED` | Successful replay code and semantic-subset comparison were removed. Any visible existing ACTIVATION/ROLLBACK event for the correlation raises `LINE_ACTIVATION_CORRELATION_CONFLICT` before binding lock/update. A hidden cross-scope collision still reaches the database unique constraint and rolls the transaction back. This satisfies BR-014's existing-result-or-fail-closed choice without claiming identity W1B cannot prove. |
| Dry-run mutation receipt ambiguity | `PASS` | DRY_RUN returns `{ dryRun: true, preview }`, never a `receipt`, performs no UPDATE/INSERT and rolls back. The CLI preserves that explicit wrapper after revalidating the preview through W1A. |
| CLI trusted arbitrary service output | `PASS` | `projectOperatorResult` admits only `{dryRun: true, preview}` or `{dryRun: false, receipt}`, validates the nested object through `parseLineCanaryReceipt`, drops hostile top-level fields and rejects hostile nested fields before serialization. |
| CLI APPLY/security matrix | `PASS` | Tests cover both halves of the flag/contract dual gate, environment-only activation secrets, privileged Supabase credential rejection before pool creation, dedicated database username and hostile output projection. |
| Failure/rollback matrix | `PASS` | Tests now cover wrong `session_user`, wrong `current_user`, duplicate correlation, exact-row mismatch, temporal/CAS zero-row result, wrong returned version, event insert rowcount failure, query failure and commit failure. Each post-BEGIN failure path ends in rollback; CAS failure proves no event insert. |
| Routing-first rollback and HMAC order | `PASS` | Rollback UPDATE remains before append, changes only status/timestamp/version and preserves both hashes/data. Activation continues to call `hashBindingSecret(pepper, destination)` and `(pepper, bearer)` and excludes raw values from SQL parameters/results. |

### Remaining non-blocking W4 evidence

- Unit tests inspect and inject PostgreSQL behavior; they do not execute the materialized CTE,
  actual lock wait or RLS role transaction. W4 must run the composed service through the dedicated
  loopback PostgreSQL 17 operator login and prove zero durable mutation/event on expiry and every
  failure.
- Evidence files are hashed immediately before connection but not held immutable across the
  transaction boundary. W4 must use immutable/pinned artifacts or retain equivalent exact-byte
  proof before production execution.
- The reported 19/19 W2 and 45/45 compatibility results were inspected in the remediation report;
  this read-only review did not rerun tests or access a database.

This remediation review appended only this section. It changed no implementation/test/schema,
ran no database or remote operation, accessed no secret, and staged/committed nothing.
