---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-27"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
implementation_base: "fdf64c5a77bdaebc236a50db328bdde7c977dd3b"
---

# Compact Task4 private Asset/catalog storage

This milestone implements Task4 of the approved [plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md)
under safe Compact continuation, on the existing primary-checkout branch. It adds
no production/main-dev/UAT operation, provider migration, credential persistence,
live model/LINE request, publication or canonical requirement/lifecycle change.

Existing public factories and default Supabase behavior remain compatible.
Explicit per-purpose S3 configuration supplies server-owned endpoint, bucket and
credentials. Unknown/missing configuration fails closed. Separate bucket and key
namespaces distinguish Asset evidence, catalog projections and Knowledge objects.
The new business ref pins purpose, bucket, scoped key and immutable version; it
cannot select an endpoint or credential. Reads/removes use exact versions.

The FileAsset service checks current visibility and active state before reading,
then supplies persisted Tenant/Business identity for private ref validation.
Pricing catalog explicitly selects the catalog S3 writer before the older
Knowledge-private compatibility path. Its new namespace does not alter existing
Knowledge/Supabase keys or migrate old refs. Domain authorization remains unchanged.

## Actual provider evidence

The explicit `test:compact:storage` profile creates a uniquely labeled container,
volume and network from cached TEST image
`sha256:ca499c729f62921367079f685d29e03e262b2d1be31e0af9fa6f6b564dc8850f`.
It publishes only a random loopback port and uses a separate disposable SQLite
application database. Task2/3's PostgreSQL claims remain separate. No existing
runtime, data volume or provider credential is selected.

Ephemeral admin authority initializes versioned TEST buckets and distinct users;
the app receives only purpose-scoped credentials. Each policy allows PutObject,
GetObject, GetObjectVersion, DeleteObject and DeleteObjectVersion on its own bucket
namespace, without admin/list/bucket creation privileges. Actual wrong-purpose
credentials cannot read or write the other bucket. The MinIO fixture required
DeleteObject as well as DeleteObjectVersion; the first restricted-policy failure
is retained. Application refs still delete only selected immutable versions.

The seven actual tests cover upload/authorized FileAsset read; current visibility
and wrong Business refusal; structured catalog bytes and credential separation;
extraction-read into an injected TEST extractor; exact cleanup after metadata
failure; older-version reads after replacement and deletion preserving the newer
version; object loss with retained DB metadata failing closed; and a versioning-
suspended provider refusing a mutable `null` version before FileAsset publication.
The metadata-loss case
models the missing-object postcondition of a DB-only restore; it does not execute
a complete backup/restore procedure or claim recovery from a metadata snapshot.

Provider setup first failed on missing-resource error classification and an
internal network's absent published port. Those setup attempts executed no tests.
The initial scoped policy then refused deletion; failed cleanup did not become a
success. All first failures remain in the private checkpoint. The successful run
executes seven tests with zero skips; a selected test name is not a model/provider
acceptance claim. The injected extractor proves only delivery of authorized bytes.

## Checks and remaining gates

| Check | Actual result |
|---|---|
| New private port TDD | RED5 failures against the unimplemented selectors; GREEN5 initial tests |
| Review version-pinning fixes | RED4 independent failures for null PUT, missing/null GET version headers and null refs; GREEN after strict business-boundary checks |
| Review evidence-integrity fix | RED missing result aggregator; tracks completed assertions and serializes after owned cleanup, reporting failure for missing cases or failed cleanup |
| Scoped unit/consumer regressions | PASS10 files,65 tests,0 skips after both review fixes and the ambient database-alias guard; includes existing Supabase, Knowledge S3, pricing, FileAsset and authorization behavior |
| Isolated actual provider | PASS7 tests,0 skips after version checks; no root credentials used by app ports |
| Current Server build | PASS: Next compilation, lint/types,94 static pages and build traces |
| Final same-patch independent review | Performed by GPT-6 Luna Max; both blockers corrected through RED→GREEN regressions; integrator owns final verification |
| Compact orchestration regressions | PASS136 tests,0 skips |
| Serial registry → graph → views; `npm run govern` | PASS553 canonical records,96 views; strict preflight0 critical/0 warning/43 info |

The [redacted provider observation](task4-storage-observation.json) records only run identities, policy
resources/actions and actual checks. Secrets, initial users/passwords and private
environment files are excluded. Cleanup verifies captured resource identities and
ownership before deletion; it removes only this run's resources. Locally cached
images and checkpoint evidence remain intact.

A focused run executed one case with six deliberately unselected cases; its
post-cleanup observation correctly remained FAIL. That is an evidence-integrity
regression, not full acceptance. A first quoted npm filter invocation selected no
files and failed; it is retained and not counted as executed tests. Full seven-case
acceptance was rerun separately. The database selector also refuses foreign URLs
and removes ambient PostgreSQL aliases before application imports; its regression
failed with alias stripping removed and passed after restoration.

Independent GPT-6 Luna Max source/diff review identified the version-pinning and
evidence-integrity blockers above. The integrator fixed them with failing-first
regressions and reran the composed consumer/provider checks. The reviewer ran no
tests or Docker and did not judge Tasks5–7 or production/release/provider gates.

The existing Asset service attempts exact object cleanup after DB failure; cleanup
failure still requires operational reconciliation and never yields success. This
is not an atomic cross-system transaction. A PUT returning no immutable version
may already have stored bytes, but cannot safely be erased by a latest-object
cleanup; it is refused and needs provider reconciliation. Core CLI diagnostics do not inspect or
import the new port's qualification and still report storage unavailable.
Production provider/license approval, hosted CI, Linux-host qualification, complete
restore/release evidence and Tasks5–7 remain separate gates. No broader business,
AI profile or production completion follows from these tests.
