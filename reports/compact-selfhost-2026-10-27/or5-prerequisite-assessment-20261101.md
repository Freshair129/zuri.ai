---
doc_type: source-assessment
status: draft
version: "0.1.0"
recorded_at: "2026-11-01"
source_revision: "59145776f2513f164b974edae0c4eff0cd5ca416"
scope: "OR5 managed-blob operator qualification prerequisites; no activation"
---

# OR5 operator qualification prerequisite assessment

OR5 qualification is **BLOCKED** at the inspected revision. The owner selected
OR5 in the existing separate clone after OR4 merged. This assessment records the
preconditions and actual checks; it does not mark OR5 complete, qualify recovery
or adopt the candidate plan. Application source is unchanged in this patch.

## Authority and method

[ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md),
[ZAI:FR-292](../../docs/requirements/FR-292.md),
[ZAI:FR-293](../../docs/requirements/FR-293.md) and the
[candidate OR5 plan](../../docs/plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md#or5--exact-artifact-operator-qualification-and-gate-decision)
control the boundary. Both canonical records retain delivery **planned**.
FR-293 requires a supported backup round trip before recovery activation.

The source inspection enumerated tracked application modules, API routes and
tests, then inspected the exact transfer codec, backup service/routes, recovery
handler/routes and their callers. Local inventories and command logs are retained
under ignored `.tmp/or5-*` paths. This is a bounded assessment of that revision,
not a repository-wide absence claim or a new requirement authority.

## Blocking dependencies

| Dependency | Observed source at `59145776` | Consequence for OR5 |
|---|---|---|
| Supported transfer export/preview/confirm and target-local jobs | `managed-blob-transfer-contract.js` exports `encodeManagedBlobTransfer` and `decodeManagedBlobTransfer`. Its observed callers are unit tests. The enumerated backup routes delegate to the existing snapshot service, not to a supported managed-blob transfer service. | Codec validation is present; the supported workflow and its target-derived mapping/metadata/audit transaction are not implemented in the inspected path. A codec unit round trip cannot satisfy FR-293. |
| Reserved-ref backup round trip | `backup-service.js` refuses reserved recovery refs with `MANAGED_BLOB_TRANSFER_REQUIRED`; native installation fencing also refuses unresolved custody. | Preserve these refusals. A recovered ref must not become enabled while the supported transfer path is missing. |
| Ordinary operator entrypoint | The ordinary exported route binding uses `createRecoveryHttpHandler()` without a recovery service. After identity/CSRF boundaries, it returns `503 MANAGED_BLOB_RECOVERY_NOT_QUALIFIED`. That route binding has no caller-visible/environment activation switch; tests can inject a service into a separate handler composition. | Positive prepare/preview/stage/confirm through the installed ordinary entrypoint cannot run. Injecting the service or setting a fixture fence READY would prove a different composition. |
| Installed authority and restore provenance | Existing service/native/browser tests use explicit TEST composition and owned fixture admission. Synthetic restore uses its separately identified harness. | These remain regressions, not installation restore, supported transfer or operator qualification. |

No new operator lane is represented as complete: its supported workflow cannot
be exercised yet. No always-skipped lane, environment admission, direct SQL ref
remap or relabelled synthetic PASS is added. A new package build is not itself a
remedy for an entrypoint intentionally held unavailable by the accepted contract.

## Qualification matrix

| OR5 obligation | This selection |
|---|---|
| Clean committed prepared inputs/package, actual image labels/digests, baseline, CLI and inventory at one new source SHA | NOT_RUN; no new package/prepared artifact built |
| Real product ingestion and supported owner recovery into new immutable versions | BLOCKED by the supported transfer activation dependency |
| Installed restart, stale/foreign/corrupt inputs, session races, lost responses, every crash boundary, exact cleanup and remaining custody | NOT_RUN as installed qualification; existing scoped regressions are reported separately below |
| Delayed actual selected-provider PUT and conditional retry in both winner orders | NOT_RUN; no real-provider conditional retry qualification |
| Exact-head hosted CI for this new branch | NOT_RUN; no push/PR/workflow dispatch in this selection |
| AI profiles and aggregate operatorRecovery | NOT_QUALIFIED |

## Executed verification

Application source is still exactly the inspected merge tree. The following
commands ran on this branch with unchanged checks/timeouts and retained logs:

| Command (Server directory) | Actual result | Evidence boundary |
|---|---|---|
| `npm run compact:test` | 217 PASS, exit 0 | Contract/packaging regressions, not a new prepared/package artifact |
| `npm run test:postgres -- tests/integration/managed-blob-recovery-consumers.test.js tests/integration/managed-blob-recovery-custody.test.js tests/integration/managed-blob-recovery-http.test.js tests/postgres/managed-blob-recovery-races.test.js` | 88 PASS / 4 files, exit 0 | Owned disposable embedded PostgreSQL, explicit TEST service/fence composition and controlled provider; not installed operator qualification |
| `npm test -- --run tests/unit/managed-blob-recovery-contract.test.js tests/unit/managed-blob-transfer-contract.test.js tests/integration/managed-blob-recovery.test.js tests/integration/managed-blob-recovery-custody.test.js tests/integration/managed-blob-recovery-http.test.js tests/integration/backup.test.js tests/unit/fr045-backup-contract.test.js` | 166 PASS / 1 SKIP / 7 files, exit 0 | Isolated SQLite; existing POSIX-only remount case skipped on Windows |

Logs are `.tmp/or5-compact.log`, `.tmp/or5-postgres.log` and
`.tmp/or5-sqlite.log`, with corresponding exit files retained locally. The
HTTP suite verifies the ordinary handler still returns 503 with no operation
created even if caller activation flags are supplied. Custody/native tests verify
reserved-ref backup refusal and snapshot/restore exclusion; the transfer suite
exercises the bounded codec only. All named suites ran whole-file; no selection
of individual OR4 consumer cases conceals the known fixture dependency.

Document governance/readers and independent review results are retained separately
in local ignored `.tmp/or5-*` evidence; only completed checks can be called PASS.
No full local application suite, new installed/native-provider/browser acceptance,
application build, lint or deployment is claimed for this documentation assessment.
The successful post-merge CI on `59145776` is historical baseline evidence, not
exact-head hosted CI for this new documentation patch. No prior FAIL is rewritten.

## Open items and next implementation boundary

The two OR4 review minors remain **DEFERRED/OPEN**: individual corruption/refusal
cases depend on earlier fixture-producing cases; additional scope/session/domain
and queued ingestion fixture rows remain until disposable database teardown.
A passing whole-file or native run does not prove order independence or close
either minor. The two original E2E flake causes remain **OPEN/NOT_PROVEN**.

The missing implementation is the existing plan's cross-task FR-293 transfer
prerequisite: supported private export/preview/confirm, trusted target-derived
jobs, native mapping/metadata/audit/result commit, protected-family refusals,
exact cleanup and fresh target authorization/generation admission. Follow the
plan's contract reconciliation and separate implementation selection before
implementing/testing that prerequisite or enabling ordinary recovery. Then build a
new committed exact-source package and exercise the full OR5 matrix on disposable
TEST targets through the supported interface. Do not advance the plan checkboxes
or installed/operator gate based on this assessment.

The plan remains **candidate**, whole-plan `implementation_authorized: false`.
AI/operator **NOT_QUALIFIED**, whole-installation/off-host/provider/erasure/host
and release gates remain open. No Knowledge checkout, production, live LINE,
existing runtime or worktree changes are part of this selection.
