---
doc_type: implementation-evidence
status: reviewed
version: "0.1.1"
recorded_at: "2026-10-27"
implementation_base: "419eafae96616d82b5903d5e52ac68fa38b2bee5"
qualification_revision: "16825173d0784ac2a5223ead99b595cc8b3a4096"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
relations:
  - type: references
    target: ZAI:ADR-115
  - type: references
    target: ZAI:FR-107
---

# Compact Task3 requalification and shared bootstrap serialization

The corrected Task3 candidate passed the local TEST core flow on the exact
artifact built from clean source `16825173d0784ac2a5223ead99b595cc8b3a4096`.
The composed browser test passed on its first attempt, including cleanup.
Native PostgreSQL contention tests also proved a single first operator across
the Compact and existing CLI entrypoints. This is bounded Task3 requalification
under [ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md) and the
[approved plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md),
not release, production activation or optional-AI qualification.
The [original Task3 evidence](task3-core-qualification.md) remains a snapshot of
its earlier implementation and executions; it is not relabelled as this run.

## Confirmed gap and correction

The Compact command already held advisory transaction lock `115107`, but the
existing direct CLI called the shared bootstrap service without that lock.
The service checked for a standing operator before its write transaction.
Two distinct callers could therefore observe an empty operator set and both
commit an ACTIVE OPERATOR grant. The database's per-person grant uniqueness
does not serialize the installation-wide first-operator decision.

The new [native race suite](../../apps/server/tests/postgres/operator-bootstrap-races.test.js)
reproduced two successful callers in all three cases: Compact first, direct CLI
first, and Compact competing with direct grant-only. It runs two real Node
processes against a new database created inside the suite's disposable embedded
PostgreSQL cluster. A test-only Person-insert trigger and observed advisory locks
control the ordering. The Compact command is the shipped command with only its
`/app` import locations relocated to the host; this test does not claim Docker
transport acceptance. The actual packaged Docker path is exercised below.

The [existing authority](../../apps/server/src/modules/identity/operator-bootstrap.js)
now takes the same PostgreSQL transaction lock, or SQLite's writer reservation,
and rechecks operator and credential state before any grant/credential write.
Its preflight refusals remain inexpensive; they cannot authorize a later write.
An unrecognized database provider fails closed. Person, credential, grant and
audit writes remain in one transaction, including the Compact adapter's existing
outer transaction. Grant-only still creates no credential and normal bootstrap
never overwrites an existing credential. No authority, role, schema, migration,
provider policy or timeout was expanded.

The code checkpoint precedes artifact qualification because the existing fixture
requires an explicit package whose image labels and manifest match clean source.
That checkpoint alone was not treated as Task3 acceptance. Generated runtime
evidence and the tracked feature verification view were regenerated with the
existing tooling; no canonical record or identity was edited.

## Executed checks

Code checks ran on the composed patch committed unchanged as `16825173`.
Artifact/browser checks then ran with that clean commit selected.

| Check | Actual result | Scope |
|---|---|---|
| Cross-entrypoint native race | RED 3/3: two successful callers per case; GREEN 3/3 | Both entrypoint orders and direct grant-only; one grant/audit and no losing password output |
| Locked state/provider unit regressions | RED 3; GREEN in the identity run below | Concurrent standing grant, newly credentialed Person and unknown-provider refusal |
| Identity unit/CLI/lifecycle regressions | PASS 33/33, no skips | Existing bootstrap, credential format, grant-only, audit/privacy and operator lifecycle |
| `npm run test:postgres` | PASS 34 files / 351 tests, no skips; 329.91s | Existing disposable PostgreSQL profile plus the three native bootstrap races |
| `npm run compact:test` | PASS 202/202, no skips | Existing package, baseline, target, bootstrap, diagnostics, OCI and qualification contracts |
| `npm run test:compact:provider` | PASS 1/1 | Selected TEST storage digest with `server /data`; versioning, conditional write, exact read/erase preserving a replacement |
| Immutable `tools` / `runner` builds | PASS | Git archive of the code checkpoint, linux/amd64; runner includes Next compilation, lint/types and static generation |
| `npm run test:compact:core` | PASS 1/1, first attempt, 1.9min | Exact supplied OCI package; HTTPS login, unprivileged signup, scoped Business/PM writes, cross-Business denial, seven views, restart/recreation and safe installed retry |
| Resource inventory reconciliation | PASS | Existing container IDs/names/states, volumes and networks identical before/after core qualification; run-owned cleanup PASS |
| Code governance | PASS 0 critical / 0 warnings / 43 info | Initial stale generated verification view was retained as a failure, regenerated and rechecked |
| Document-reader contracts | PASS 146/146, no skips | Existing document/identity/registry/view/query/profile readers |
| Independent code review | No remaining static findings | GPT-6 Luna Max reviewed the shared transaction fix and native test isolation; reviewer did not execute tests |

The browser flow uses an ordinary account's real self-provisioned membership for
Business ownership. Platform administration remains separate; this does not
resolve the previously documented combined operator/founder limitation. Signup
itself still creates neither a membership nor a platform grant. All seven views
and the same Project/seven Workstreams survived restart and actual web recreation.
The native table census remained 210. HTTPS used a run-generated SPKI-pinned
certificate without a host trust-store change or a general certificate bypass.

## Artifact binding

| Identity | SHA256 |
|---|---|
| Git source archive | `4666840c07e5830d630ac45bed6534e3b8d134319299e0d4db5034eefc002578` |
| Release manifest | `e2d080a46fd40e8eab72820af5e8799ad713f3426bd4f424ca2845a59b5ad34d` |
| Package inventory (`SHA256SUMS` bytes) | `91328271f020d776c060f14efa24793fa716a1d525870d80d0ed39218a42e071` |
| Bundled host CLI | `3768d1c713896a019b6986f3304df1d93aa649413d9db2d5f339c3c14c14f7c4` |
| Fresh-only baseline SQL | `a8b8fe155b21e39e709e534971ae0f485117094e1e77717bbbae1e8e897d1232` |
| OCI archive | `519a38d165c16fc9c207e2a31404926057b6af5e8174154f04453dd58ab6e631` |

The package contains 1,602 payload files. Selected linux/amd64 image manifests
are web `53533548558d1fa188bcb5065898bb42f43cead3713df10e55aaccf1665d1e5a`,
tools `b27217610929043d84cd2de713655a630320b94786f526bed73bcc41a25be9ce`,
PostgreSQL `1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551`
and storage `c256d3e46c78fd863813d43b4540e8a50a4dc515466ea7d0db8ceac02eef2f11`.
Web/tools actual image configs carry the qualification revision. The strict OCI
verifier checked 45 reachable blobs before packaging/import. A first preparation
attempt with tag-only descriptors was correctly refused; prepared descriptors
were corrected to contain their exact immutable names, without weakening the
validator or importing that refused input.

Raw observations, logs, original/refused inputs and source/OCI artifacts remain
in the private `compact-task3-requalification-419eafae` checkpoint. The core target
was `zuri-compact-e945b68e-d5cb`, with run-owned database/storage volumes and
loopback ports distinct from the existing development/UAT targets. Provider and
core fixture cleanup passed. Built TEST images and evidence are retained.

## Limits and remaining gates

This is Windows Docker Desktop evidence for the selected core TEST artifact.
Native two-process contention is qualified on PostgreSQL only. SQLite's writer
reservation has unit and functional lifecycle regression coverage, but no native
SQLite contention result is claimed here.
It does not qualify Linux hosts, a production storage/license selection,
minimum hardware, off-host backup, managed-blob operational recovery, live LINE,
Knowledge, inference pools, every business feature or a production operation.
The existing diagnostic still reports unqualified capabilities honestly; this
report is not imported as runtime authority. Later Task4–7 evidence keeps its own
revisions and limits rather than being requalified by this Task3 test.

The local qualification run above did not execute hosted CI, PR/merge,
publication/release or production activation. The separate delivery is tracked
in [PR #753](https://github.com/Freshair129/zuri.ai/pull/753); hosted delivery
checks do not requalify the exact-image core artifact. The original checkpoint
tags/bundles/backups, existing runtimes
and the separate Visual Office repository were not modified. No worktree was
created. Documentation closeout verification is recorded with this evidence's
final revision; it does not change the qualified executable/artifact revision.
