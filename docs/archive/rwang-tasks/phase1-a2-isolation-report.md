---
version: "0.1.0b"
created_at: "2026-08-14T09:00:46+07:00,Tesla"
last_update: "2026-08-14T09:00:46+07:00,Tesla"
status: "candidate"
superseded_by: null
attributes:
  domain: "data-security"
  doc_type: "task-report"
  scope: "FR-054 live runtime isolation prerequisites and evidence audit"
---

# A2 report — live runtime isolation prerequisite audit

## Outcome

**Overall state: `BLOCKED`; live probe state: `NOT_RUN`.**

The production-disabled FR-054 probe and its unit contract exist, but the current checkout is not
ready for a truthful live run. No database connection, SQL mutation, migration, password change,
project link, binding change, or remote write occurred during this audit.

Two independent blockers must be closed before execution:

1. the current Supabase CLI profile does not expose project `qcnmhyglarzcpudjorzc`, and this
   worktree has neither a local project link nor any `SUPABASE*` / `ZURI_LINE*` environment variable;
2. the probe casts scope parameters to PostgreSQL `uuid`, while the accepted production contract
   intentionally stores `tenant_id` and `business_id` as `text`. The live scope queries therefore
   do not match the deployed column types and cannot be treated as runnable evidence.

## Authority and evidence inspected

| Evidence | Observed state | Result |
|---|---|---|
| `docs/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md` | Production IDs remain UUID-formatted `text`; dedicated login and live probe are activation gates | authoritative |
| `docs/ADR-019-PHASE1-ACTIVATION-READINESS.md` | Readiness tooling is implemented; live probe remains external and `NOT_RUN` | consistent |
| `.agent/reports/PHASE-1-ACTIVATION-READINESS.md` | Live dedicated-login isolation is `NOT_RUN` | consistent |
| `.agent/evidence/supabase-2026-08-14/manifest.json` | 74 rows, forced RLS and role attributes were previously verified; live login is `PENDING_PASSWORD_PROVISION` | historical evidence only |
| same manifest | WAL-G enabled, PITR disabled, zero available physical backups | activation blocker remains |
| `supabase/migrations/20260813213654_production_tenant_bootstrap.sql` | Tenant/business IDs are `text`; login is `LOGIN NOINHERIT NOBYPASSRLS`; policy role is read-only | static PASS |
| `src/modules/knowledge/runtime-isolation-probe.js` | Environment-only URL, dedicated username check, redacted fingerprints, `ROLLBACK` in `finally` | static PARTIAL PASS |
| `tests/unit/runtime-isolation-probe.test.js` | Fake client covers result shaping, redaction and rollback, but does not execute SQL against PostgreSQL types | test gap |
| Focused Vitest rerun in this worktree | `vitest` executable is absent from the incomplete `node_modules`; no install was authorized for this read-only lane | `NOT_RUN` (current turn) |
| Supabase changelog, breaking-change filter, observed 2026-08-14 | Data API table auto-exposure changed; direct PostgreSQL paths are unaffected. Postgres 17 remains current for this project contract | reviewed; no direct blocker |
| `npx supabase@2.114.0 --version` | `2.114.0` | PASS |
| `npx supabase@2.114.0 projects list --output json` | Returned other accessible projects but not `qcnmhyglarzcpudjorzc`; CLI then reported no linked project | BLOCKED |
| `supabase/.temp/project-ref` | absent | NOT LINKED |
| environment-name inventory | no `SUPABASE*` or `ZURI_LINE*` names present; values were never printed | BLOCKED |

The tracked logical backup is post-apply and scoped. It is useful rollback material, but it is not
physical-backup/PITR approval and does not satisfy ADR-018 activation gate 3.

## Root cause / readiness defects

### A2-RC-01 — SQL parameter type mismatch

The migration deliberately preserves Prisma-compatible UUID strings as PostgreSQL `text`, and
ADR-018 records that decision. The live probe instead compares those columns with `$1::uuid` and
`$2::uuid` in all three scope/mutation statements. PostgreSQL has no implicit `text = uuid` or
`text <> uuid` operator for this comparison, so a real server is expected to reject the query
before the positive/cross-tenant assertions can pass.

The unit test escaped this because its fake client branches on SQL substrings and returns prepared
rows; it never parses or type-checks the SQL. This must be corrected and covered by a real
PostgreSQL integration test before provisioning a production runtime URL for the probe.

### A2-RC-02 — current operator profile cannot identify the production target

The authenticated CLI profile available in this process does not list the production project ref.
The worktree also has no local link. This may be account/profile drift or removed access; the
read-only evidence cannot distinguish those causes. Linking or changing profiles is an operator
action and was intentionally not attempted.

### A2-RC-03 — dedicated credential and physical recovery approval remain absent

No `ZURI_LINE_DB_URL` is present, and the retained manifest explicitly records
`PENDING_PASSWORD_PROVISION`. PITR is disabled and no physical backup is listed. These are
documented external activation gates, not defects to bypass.

## Acceptance-state matrix

| Assertion / gate | State | Reason |
|---|---|---|
| Static least-privilege role design | `PASS` | migration defines no-login policy role plus no-inherit/no-bypass login |
| Probe output redaction contract | `PASS` (unit/static) | URL, host, role and error text are excluded from serialized report |
| Rollback control | `PASS` (unit/static) | `ROLLBACK` runs in `finally`; no commit path exists |
| Probe SQL compatible with production schema | `FAIL` | `text` columns are compared with `uuid` parameters |
| Current operator can identify target project | `BLOCKED` | target ref absent from current profile; worktree unlinked |
| Dedicated runtime URL available to process | `BLOCKED` | required environment name absent |
| Physical backup/PITR approval | `BLOCKED` | PITR false; zero physical backups in retained evidence |
| Live positive-scope assertion | `NOT_RUN` | no approved connection and SQL type defect open |
| Live cross-tenant denial assertion | `NOT_RUN` | no approved connection and SQL type defect open |
| Live direct-grant denial assertion | `NOT_RUN` | no approved connection |
| Live mutation-denial + rollback assertion | `NOT_RUN` | no approved connection and SQL type defect open |
| FR-054 live isolation acceptance | `BLOCKED` | hard join prerequisites are incomplete |

## Safe next commands

Run these only after the code defect is fixed and reviewed. They do not contain credential values.

### 1. Verify the intended CLI profile can see the target (read only)

```powershell
npx supabase@2.114.0 projects list --output json |
  ConvertFrom-Json |
  Where-Object { $_.ref -eq 'qcnmhyglarzcpudjorzc' } |
  Select-Object ref,name,region,status
```

Expected: exactly one healthy Seoul project. Zero rows remains `BLOCKED`; do not link blindly.

### 2. Verify required environment names without printing values

```powershell
$requiredNames = @(
  'ZURI_LINE_DB_URL',
  'ZURI_LINE_ISOLATION_TENANT_ID',
  'ZURI_LINE_ISOLATION_BUSINESS_ID',
  'ZURI_LINE_ISOLATION_CROSS_TENANT_ID'
)
$missingNames = $requiredNames | Where-Object { -not (Test-Path "Env:$_") }
if ($missingNames.Count -gt 0) { throw "Missing required environment names: $($missingNames -join ', ')" }
```

The secret manager must inject `ZURI_LINE_DB_URL`; never place it in shell history, Git, an issue,
or a PR. Its username must be exactly `zuri_line_smartgift_login`.

### 3. Run the redacted probe once all hard gates pass

```powershell
$env:ZURI_LINE_ISOLATION_TENANT_ID = '77cdbe70-3111-4a04-922a-8059be99a8b0'
$env:ZURI_LINE_ISOLATION_BUSINESS_ID = '834fa869-62f3-431c-a287-e9a95e91175b'
$env:ZURI_LINE_ISOLATION_CROSS_TENANT_ID = 'ef2552ce-ff10-4b1f-8212-d0a729f5a159'
npm run phase1:isolation:verify > .agent/evidence/supabase-2026-08-14/runtime-isolation-report.json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Accept only `status: PASS` with all four assertions passing. A CLI exit code, unit PASS, connection
success, or a redacted fingerprint alone is not live isolation acceptance.

## Required closure order

1. Correct the `text`/`uuid` SQL mismatch through the approved doc/code flow.
2. Add a PostgreSQL-backed integration test that executes the actual prepared SQL against the
   same column types; retain the unit redaction/rollback tests.
3. Restore/confirm least-privilege operator visibility of the exact production project without
   changing its binding or schema.
4. Approve physical backup/PITR and the rollback rehearsal evidence.
5. Provision the dedicated login secret outside Git and inject it only for the bounded run.
6. Execute the probe once, retain only the redacted report, and review all four assertions.

## Out of scope / not performed

- no password creation, reset, display, or retrieval;
- no `supabase link`, profile switch, migration apply, SQL execution, database dump, or advisor run;
- no role/grant/policy/binding change;
- no use of `postgres`, service-role, or other privileged runtime credentials;
- no remote or local database mutation; and
- no claim that historical static evidence proves the live dedicated-login path.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Read-only A2 audit; live probe blocked by SQL type mismatch, current profile access, credential and recovery gates | working-tree | Tesla |

## Integrator remediation follow-up

Owner approval of the gate packet/RCA opened the bounded local fix. The probe now uses the deployed
`text` parameter contract and the OID overload of `has_table_privilege`, preserving the login's
zero direct schema/table grants. A dedicated-loopback PostgreSQL 17 test passes the real role, RLS,
positive scope, cross-Tenant denial and rollback-only mutation path. The integration target is
hard-gated to database `zuri_fr054_test` on loopback.

This closes A2-RC-01 locally. It does not change the report's external verdict: the production
login credential, fresh target visibility, physical recovery approval and live report remain
`BLOCKED` / `NOT_RUN`.

## Independent review

**Overall review: `WARN`.** The report's main safety conclusion and `BLOCKED` / `NOT_RUN` state are
correct. One CLI/profile statement is not independently reproducible from retained local evidence,
and the focused-test availability statement is stale in the current shared checkout. Neither warning
removes the confirmed SQL-type, credential or recovery gates.

| Review point | Verdict | Independent finding |
|---|---|---|
| `text` versus `uuid` | `FAIL` (gate), report confirmed | ADR-018 explicitly preserves UUID-shaped identifiers as PostgreSQL `text` (`docs/ADR-018-SUPABASE-PRODUCTION-TENANT-ISOLATION.md:130-132`). The applied migration declares `business.tenant_id`, binding scope and knowledge scope as `text` (`supabase/migrations/20260813213654_production_tenant_bootstrap.sql:77,94-95,119-120`). The probe casts those comparison parameters to `uuid` in the positive-scope, cross-Tenant and mutation statements (`src/modules/knowledge/runtime-isolation-probe.js:86,101,113`). The report and RCA are correct: a real PostgreSQL run cannot be accepted until the probe follows the deployed physical type and receives a PostgreSQL-backed/schema-contract test. |
| CLI / project identity | `WARN` | ADR-018 fixes `qcnmhyglarzcpudjorzc` as the production project, and `supabase/.temp/project-ref` is absent in this checkout, so **not locally linked** is confirmed. `node_modules/.bin/supabase.cmd --version` returns `2.114.0`, matching the report. The stronger claim that the current authenticated profile lists other projects but not this ref has no retained command transcript/artifact and was not re-run because this review forbids remote access. Treat that profile-visibility statement as an observed-but-unverified point, not durable gate evidence. |
| Dedicated credential | `PASS` with boundary | A name-only environment inventory currently returns no `SUPABASE*` or `ZURI_LINE*` variables; no values were read. The retained manifest records `liveRuntimeLoginProbe: PENDING_PASSWORD_PROVISION`, and ADR-018 activation gate 1 requires the dedicated login password. This confirms that this process is not ready to run. It does **not** prove that no credential exists in an external secret manager; an operator must confirm and inject it without exposing it. |
| Backup / PITR | `PASS` as historical evidence | The tracked manifest classifies the material as `post-apply-scoped-logical-backup`, records WAL-G enabled, PITR disabled and zero available physical backups, and says it is not pre-mutation evidence. All three referenced external local files exist and independently match the manifest byte counts and SHA-256 values. The report correctly refuses to promote this to physical-backup/PITR approval. Because no remote query was allowed, current Supabase backup state remains unrefreshed beyond the manifest timestamp `2026-08-14T07:02:48+07:00`. |
| Probe safety controls | `PASS` (static/unit only) | The URL parser admits only `zuri_line_smartgift_login`, output exposes fingerprints rather than connection material, direct-grant checks precede `SET LOCAL ROLE`, and `ROLLBACK` is attempted in `finally`; there is no commit path. These controls are meaningful but do not compensate for invalid SQL types or prove the live role. |
| Current focused test | `PASS`; original availability note stale | In the current checkout `node_modules/.bin/vitest.cmd` exists. A fresh local run of `npm test -- --run tests/unit/runtime-isolation-probe.test.js` passed 1 file / 5 tests. The report's earlier statement that Vitest was absent may have been true at its observation time, but it is no longer current. The test still uses a fake client and therefore does not type-check SQL against PostgreSQL; the main blocker remains. |

### Review decision

- Keep A2 and FR-054 live isolation `BLOCKED` / `NOT_RUN`.
- Do not execute the report's live command until the approved text-type correction and a real
  PostgreSQL/schema-contract regression test pass.
- Before any later operator run, re-establish exact project visibility, confirm current backup/PITR
  policy, inject only the dedicated credential, and retain a fresh redacted report.
- No remote call, secret read, production/PostgreSQL SQL execution, code change or commit was
  performed by this review; the only executable verification was the local focused Vitest suite.
