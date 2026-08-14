---
version: "0.3.0b"
created_at: "2026-08-14T09:35:00+07:00,ATHER"
last_update: "2026-08-14T10:00:00+07:00,ATHER"
status: "candidate"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "task-report"
  scope: "FR-055 W1B operator role and activation-event migration"
---

# FR-055 W1B report — operator role and activation event migration

## Outcome

**W1B local database boundary: PASS_WITH_WARNINGS. Production apply: NOT RUN.**

The additive migration was created only through
`npx supabase@2.114.0 migration new controlled_line_activation`. It adds a separated NOLOGIN
operator privilege role and NOINHERIT/NOBYPASSRLS login, exact SmartGift binding RLS policies,
column-limited binding mutation grants, and a forced-RLS append-only activation-event table.

No Supabase remote command, LINE call, credential provisioning, secret read, migration apply,
stage, commit or push occurred in this lane.

## Files owned

- `supabase/migrations/20260814023027_controlled_line_activation.sql`
- `tests/unit/controlled-line-activation-migration.test.js`
- `tests/integration/controlled-line-activation.postgres.test.js`
- `docs/.rwang-tasks/fr055-w1b-migration-report.md`

## TDD evidence

| Phase | Evidence | Result |
|---|---|---|
| RED | Focused Vitest before migration creation | 1 file, 4 tests failed because no `_controlled_line_activation.sql` existed |
| GREEN-1 | Focused Vitest after initial migration | 1 file, 4 tests passed |
| PostgreSQL regression discovery | PostgreSQL 17 applied the existing bootstrap, then rejected the new migration because an auto-generated inline CHECK name collided with an explicit table CHECK | expected fail; transaction rolled back |
| RED-2 | Added assertions requiring distinct receipt-state constraint names | assertion initially unmet; a concurrent shared `prisma/test.db` lock caused one unrelated EPERM rerun |
| GREEN-2 | Renamed the value and event/state constraints, then reran focused Vitest | 1 file, 4 tests passed |
| PostgreSQL verification | PostgreSQL 17 applied bootstrap plus corrected migration with `ON_ERROR_STOP=1` | PASS |
| Independent review RED | Review found W1A/DB value drift, two mutations per correlation, blocked receipt history and missing retained PostgreSQL proof | FAIL confirmed |
| Remediation GREEN | Ephemeral Vitest config without shared Prisma setup ran tracked unit + PostgreSQL 17 integration proof | 2 files, 7 tests passed |
| Local database advisors | `supabase@2.114.0 db advisors` against the migrated ephemeral PostgreSQL 17 database | PASS, no issues found |
| Identifier parity RED | Static test required W1A's 1..200 bound for provider/model/approval fields | 1 test failed for the expected missing bounds |
| Identifier parity GREEN | Migration added the three upper bounds; focused no-global-setup run | 1 file, 4 tests passed |
| New negative PostgreSQL cases | Tracked test now asserts invalid mutation state and invalid version delta return `23514` | NOT_RUN in final rerun; official image bootstrap server restarted and terminated the hook |

The PostgreSQL proof also confirmed:

- `line_activation_event` has both RLS and FORCE RLS enabled;
- the operator role is NOLOGIN/NOINHERIT/NOBYPASSRLS and the login is
  LOGIN/NOINHERIT/NOBYPASSRLS;
- the operator can update the permitted `status` column but cannot update `code`;
- the operator can insert but cannot update activation events;
- runtime and `service_role` cannot read activation events; and
- an exact-scope PENDING→ACTIVE update plus matching append-only event succeeds inside a
  transaction that was explicitly rolled back.

## Implemented boundary

1. The migration preserves the existing binding status enum and production bootstrap migration.
2. Binding SELECT/UPDATE RLS predicates pin Tenant, Business, binding ID, binding code and LINE
   provider to the reserved SmartGift row.
3. UPDATE is granted only for credential hashes, status, validity timestamps, update timestamp and
   version. Identity/code/provider columns remain immutable to the operator.
4. Event ancestry uses the composite Tenant/Business/Binding foreign key and the exact Supabase
   project reference.
5. Correlation IDs are UUID-shaped. A partial unique index across `ACTIVATION` and `ROLLBACK`
   enforces at most one mutation per correlation, while
   `(correlation_id, event_type, receipt_state)` retains one row per truthful state.
6. Event values match W1A. Mutations require `EVIDENCE_VERIFIED`, advance version once and carry no
   transport evidence. `CANARY_TRANSPORT` does not move version; `GENERATED` permits an optional
   artifact but no acceptance class, while accepted/display/read observations require artifact
   hash plus `HTTP_2XX`.
7. The event table grants INSERT/SELECT only. No UPDATE/DELETE grant or policy exists.
8. Public, Data API, service, runtime and runtime-login roles receive no activation-event access or
   binding UPDATE authority.
9. No function, privileged definer path, public API or raw secret/customer payload column was
   introduced.
10. `provider_id`, `model_id` and `approval_ref` now enforce length 1..200, matching W1A.

## Remaining gates / concerns

- This lane proves a local migration artifact only; production remains unchanged.
- The operator login has no password in migration source by design. Any later credential must be
  provisioned through an approved secret-store/operator procedure outside Git.
- W2 must implement the exact version/status/hash/approval-window compare-and-swap and atomic event
  write in one transaction; database column grants and RLS do not replace those application checks.
- The tracked integration test hard-rejects non-loopback targets and any database other than
  `zuri_fr055_test`; its login password is random at runtime and absent from source.
- `db lint` cannot run on the vanilla PostgreSQL image because Supabase's `plpgsql_check` extension
  is absent. `db advisors` ran against the same migrated database and returned no issues.
- The newly tracked invalid-state/version PostgreSQL assertions were not promoted to fresh runtime
  evidence because the final temporary container restarted its bootstrap server mid-hook. The
  static constraint test passed; the prior 7/7 PostgreSQL 17 proof remains historical evidence.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | W1B local operator-role/event migration with focused and PostgreSQL 17 evidence | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | candidate | Closed review event/idempotency gaps and added tracked PG17/advisor proof | working-tree | ATHER |
| 0.3.0b | 2026-08-14 | candidate | Closed identifier parity warning; tracked two negative PG cases with final rerun truthfully NOT_RUN | working-tree | ATHER |

## Independent review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:39:03+07:00
**Verdict:** `FAIL` — W1B exit is blocked by correlation-idempotency and W1A/database semantic
incompatibilities, plus non-reproducible PostgreSQL exit evidence.

The migration has a strong least-privilege base: exact-scope forced RLS, separated NOLOGIN/login
roles, column-limited binding UPDATE, append-only event grants, composite ancestry and no
`SECURITY DEFINER` or raw-secret columns. Those controls do not close the contract integration
gate. The database event shape currently disagrees with the W1A receipt contract and permits two
binding mutations under one correlation, contrary to BR-014.

| Review area | Result | Independent finding |
|---|---|---|
| Additive/status preservation | `PASS` | The existing bootstrap migration and binding status enum are not rewritten; no speculative `CANARY` status is introduced. |
| Role separation | `PASS` | Privilege role is NOLOGIN/NOINHERIT/NOBYPASSRLS; login is LOGIN/NOINHERIT/NOBYPASSRLS and must explicitly `SET ROLE`. Security guard rejects privileged attributes. |
| Exact-scope binding RLS | `PASS` | SELECT/UPDATE policies pin Tenant, Business, binding UUID, binding code and `provider = LINE`; both `USING` and `WITH CHECK` are present. |
| Binding grants | `PASS_WITH_WARNING` | UPDATE is column-limited and identity columns are immutable. The database policy itself does not restrict old/new status, null hashes, expected version or validity window; W2 must put every CAS predicate in the same locked transaction and prove zero-row failure. |
| Event RLS/ancestry | `PASS` | Event table has ENABLE+FORCE RLS, exact-scope SELECT/INSERT policies and a composite Tenant/Business/Binding FK. |
| Append-only privileges | `PASS` | Operator gets INSERT/SELECT only; public/Data API/service/runtime roles are revoked; no UPDATE/DELETE policy or grant is added. Migration-owner/superuser maintenance authority remains outside this application-role claim. |
| Database version invariant | `PASS_DB` | Event versions require `> 0` and mutation/receipt movements are constrained. W1A currently accepts version `0`, so end-to-end integration still fails. |
| Correlation one-mutation rule | `FAIL` | `unique (correlation_id, event_type)` allows one `BINDING_ACTIVATED` **and** one `BINDING_ROLLED_BACK` for the same correlation. BR-014 says one activation correlation owns at most one binding mutation. A partial unique constraint/index across both mutation event types or an explicitly separate rollback-correlation contract is required. |
| One-canary versus receipt history | `FAIL/UNRESOLVED` | The same unique key allows only one `CANARY_RECEIPT` row per correlation. That blocks append-only recording of multiple distinct observations (`GENERATED`, `EVIDENCE_VERIFIED`, `ACCEPTED_BY_LINE`, display/read unknown) if they are intended as separate events, while uniqueness alone still does not prove only one transport send. Freeze send idempotency separately from receipt-state history. |
| Event-type integration | `FAIL` | W1A uses `ACTIVATION`, `ROLLBACK`, `CANARY_TRANSPORT`; PostgreSQL uses `BINDING_ACTIVATED`, `BINDING_ROLLED_BACK`, `CANARY_RECEIPT`. No versioned mapping contract or test exists. W2/W3 cannot safely infer this mapping. |
| Receipt-state integration | `FAIL` | W1A requires `receiptState` for every event, but PostgreSQL requires it to be null for both mutation event types. An activation/rollback receipt accepted by W1A cannot be inserted unchanged into the event table. |
| Event/state truth matrix | `FAIL` | PostgreSQL only separates mutation-null from canary-non-null. It allows any of the five states on `CANARY_RECEIPT`; W1A also lacks an event/state compatibility matrix. Readiness, mutation and transport ownership therefore remain ambiguous. |
| Transport acceptance evidence | `FAIL` | Database requires artifact hash + `HTTP_2XX` only for `ACCEPTED_BY_LINE`. It permits `DISPLAYED_UNKNOWN` or `READ_UNKNOWN` with no transport artifact and even `NOT_SENT`; W1A requires hash + `HTTP_2XX` for all three LINE-observed states. |
| Acceptance-class parity | `FAIL/UNRESOLVED` | W1A permits only `HTTP_2XX`, while the table additionally permits `HTTP_4XX`, `HTTP_5XX`, `NETWORK_ERROR`, `NOT_SENT`. Failure receipt semantics and their allowed states are not defined in the shared contract. |
| Field strictness parity | `WARN` | W1A requires UUID correlation and max-200 identifiers. PostgreSQL accepts any 1–128 correlation string and unbounded non-empty provider/model/approval values. Normalize constraints or document the database as a deliberately broader internal representation. |
| Secret/runtime isolation | `PASS_STATIC` | No raw destination/bearer/pepper/token/content column or function is introduced, and runtime/service roles are explicitly revoked. |
| Focused TDD GREEN | `PASS` | Independent rerun passed 1 file / 4 tests. The tests are static SQL-regex assertions, not database behavior tests. |
| RED provenance | `WARN` | The two reported RED phases are not retained as machine-readable artifacts or commits, so they cannot be independently reproduced from the completed tree. |
| PostgreSQL/advisor exit evidence | `FAIL` | The report describes an ad-hoc PostgreSQL 17 run, but no reusable SQL integration test, exact command/output artifact or advisor result is owned by W1B. The implementation plan requires local PostgreSQL grants/RLS/advisor tests; static Vitest cannot substitute for that exit gate. |

### Required fixes before W1B exit

1. Resolve W1A first: binding/event versions must start at `>= 1`, binding expiry must be bounded,
   and an explicit event-type/receipt-state matrix must separate mutation from transport truth.
2. Use identical event-type values across the shared contract and database, or publish and test a
   versioned one-to-one mapper. Resolve whether mutation events have no receipt state or a defined
   non-transport state; do not silently drop a required contract field.
3. Enforce BR-014's one-mutation-per-correlation rule across activation and rollback event types.
   If rollback needs its own correlation, encode and test the relationship explicitly.
4. Separate one-canary-send idempotency from append-only receipt observations. Define whether a
   correlation has one final receipt or multiple state events, then choose a uniqueness key that
   supports that model without allowing a second transport send.
5. Align transport hash/acceptance constraints for every LINE-observed state and define failure
   receipt states/classes consistently in W1A, W1B and W3.
6. Add a tracked PostgreSQL 17 integration test that applies bootstrap+migration and proves exact
   grants, RLS, denied columns/roles, valid CAS+event rollback, duplicate correlation behavior and
   invalid event/state/version rejection. Retain the advisor result required by the W1B plan.
7. Add contract-to-row fixture tests so every accepted W1A artifact either maps deterministically
   to one valid database row or is rejected before transaction start.

This review appended only this section. It performed no migration/code/test edit, stage, commit,
remote call, secret access or production/local PostgreSQL mutation.

## Independent review remediation

All actionable W1B FAIL items above are closed in the owned scope:

- database event values and the event/receipt matrix now match W1A;
- UUID correlation plus a partial unique mutation index enforces BR-014 across activation and
  rollback;
- receipt history is append-only and unique per truthful state without implying another send;
- accepted/display/read observations require artifact hash and `HTTP_2XX`;
- a tracked, environment-gated PostgreSQL 17 test applies both migrations and proves roles, grants,
  RLS, denied columns/roles, one mutation, multi-state history, invalid evidence rejection and
  transaction rollback; and
- the local database-advisor run returned no issues.

W2 still owns the lock/CAS/approval-window transaction and W3 owns transport ingestion. Local W1B
proof does not authorize a production mutation.

## Final remediation review

**Reviewer:** Tesla
**Reviewed at:** 2026-08-14T09:54:15+07:00
**Verdict:** `PASS_WITH_WARNINGS` for the W1B local database boundary; production apply remains
`NOT_RUN`, and W2 remains blocked by unresolved W1A operator-input findings.

All prior W1B database-semantic FAIL items are closed in the current migration and tracked test.
The fresh review environment did not contain `ZURI_FR055_TEST_POSTGRES_URL`, so PostgreSQL behavior
tests were safely skipped rather than redirected to another target. Their earlier PostgreSQL 17
and advisor results remain historical evidence recorded by the lane author, not a fresh independent
database execution.

| Prior W1B finding | Result | Final evidence |
|---|---|---|
| Role/RLS/grants | `PASS` | Separated NOLOGIN/login roles remain NOINHERIT/NOBYPASSRLS; exact binding SELECT/UPDATE policies and column-limited grants are unchanged; event table is forced-RLS INSERT/SELECT only. |
| Existing status preservation | `PASS` | Migration does not replace the binding status enum or introduce a `CANARY` status. |
| Version semantics | `PASS` | Event versions require `> 0`; mutation advances exactly once and transport leaves version unchanged, matching current W1A receipt semantics. |
| Event names | `PASS` | Database and W1A now use exactly `ACTIVATION`, `ROLLBACK`, `CANARY_TRANSPORT`. |
| Event/receipt-state matrix | `PASS` | Mutation requires `EVIDENCE_VERIFIED` and no transport fields; transport permits generated/accepted/display-unknown/read-unknown only. |
| Transport acceptance truth | `PASS` | Accepted/display/read rows require artifact SHA-256 plus `HTTP_2XX`; generated rows forbid an acceptance class. |
| One mutation per correlation | `PASS` | Partial unique index on `correlation_id` across both `ACTIVATION` and `ROLLBACK` prevents two binding mutations under one correlation. |
| Multi-state append-only history | `PASS` | Unique `(correlation_id, event_type, receipt_state)` permits one row per truthful transport state while rejecting a duplicate state; UPDATE/DELETE remain unavailable. |
| Correlation strictness | `PASS` | Database correlation is now UUID-shaped, matching W1A. |
| Composite ancestry/exact scope | `PASS` | Tenant/Business/Binding composite FK, fixed project ref and exact RLS scope remain enforced. |
| Raw static credentials | `PASS` | Migration contains no password/raw-secret column. The tracked test generates a random Base64URL password at runtime and accepts its admin URL only from environment; source contains no static credential. |
| Target safety | `PASS` | PostgreSQL test rejects any host other than loopback and any database path other than `/zuri_fr055_test`. |
| Tracked PostgreSQL behavior proof | `PASS_REPRODUCIBLE_NOT_FRESH` | Test applies bootstrap+migration, checks role/grant/RLS behavior, exact-scope visibility, one-mutation uniqueness, multi-state history, invalid accepted evidence and final transaction rollback. Current rerun skipped 3 tests because the dedicated env URL was absent. |
| Advisor proof | `WARN_HISTORICAL` | Report records `supabase@2.114.0 db advisors` returning no issues, and CLI help confirms a `--db-url` path. No machine-readable advisor output or wrapper command is tracked, so this result was not independently replayed. |
| Invalid database cases | `WARN` | PostgreSQL test proves missing accepted-transport evidence and uniqueness failures, but does not execute explicit invalid mutation-state, invalid version-movement or mutation-with-transport cases. Table CHECKs express them and unit tests inspect the SQL; adding behavioral cases would strengthen regression proof. |
| Identifier-length parity | `WARN` | W1A limits provider/model/approval identifiers to 200 characters; database checks only non-empty. All writes must pass the W1A parser, or database constraints should be aligned for defense in depth. |
| Fresh local test result | `PASS_WITH_SKIP` | `controlled-line-activation-migration.test.js`: 4/4 PASS; tracked PostgreSQL test: 3 SKIPPED due missing dedicated loopback URL. |

### Remaining integration boundary

W1B is ready as a local database migration artifact, but it does not make W2 executable. The
current final W1A review still blocks handoff because activation input lacks exact `bindingCode`
and `channelProvider: LINE`, has no strict rollback/disable input, and still has Ajv/Zod timezone-
offset divergence. W2 must also implement `SELECT ... FOR UPDATE`, exact version/status/null-hash/
approval predicates and atomic event insertion; column grants and RLS alone are not CAS.

Before final integration, retain a machine-readable advisor result and run the tracked PostgreSQL
test with the dedicated loopback database. No production or non-loopback target may be substituted.

This final review appended only this section. It made no migration/test/code edit, stage, commit,
remote call, secret access or PostgreSQL mutation.

## PASS_WITH_WARNINGS closure follow-up

The two code-level warnings from the final review are addressed:

- database `provider_id`, `model_id` and `approval_ref` constraints now match W1A's 1..200 range;
- the tracked PostgreSQL test now executes explicit invalid mutation-receipt and invalid
  version-delta inserts under savepoints and expects SQLSTATE `23514`.

The final focused static run passed 4/4. A fresh run of the two added PostgreSQL cases is
`NOT_RUN`: the exact PG17 temporary container entered the official-image bootstrap
shutdown/restart cycle after readiness and terminated the test hook. Per infrastructure safety,
the lane did not retry repeatedly or substitute another target; the exact container was removed.

The earlier advisor evidence was produced locally with this exact command against the then-running
ephemeral PG17 target:

```powershell
npx supabase@2.114.0 db advisors --db-url 'postgresql://postgres:test@127.0.0.1:55455/zuri_fr055_test?sslmode=disable' --type all --level warn --fail-on error
```

Target: loopback `127.0.0.1:55455`, dedicated database `zuri_fr055_test`, disposable container.
Result: exit code `0`, `{"results":[],"message":"db advisors"}`, `No issues found`. The container
was removed. No machine-readable advisor artifact was created or claimed, and no remote database
was contacted.
