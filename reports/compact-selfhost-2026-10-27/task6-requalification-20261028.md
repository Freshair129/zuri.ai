---
doc_type: implementation-evidence
status: reviewed
version: "0.1.0"
recorded_at: "2026-10-28"
implementation_base: "9fd5f4b65d4a1d2d9eabeb34eb1eee96fb6cf110"
cleanup_revision: "42df4a4e01d9e13070513f64d16fce3e4fe605bc"
qualification_source: "ca661631b6c5af72c073e3912f82052f1edee1b5"
admission_test_revision: "ef7cf7d2e5235c63279b75acc8a5659096c68a07"
---

# Compact Task6 profile verification and remaining gates

The owner selected Task6 on a new branch in the primary checkout, with tests
and independent review, without a worktree, production operation or live LINE
UAT. This report follows [ADR-115](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md)
and [Task6 of the approved plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task6-qualify-optional-line-and-knowledge-profiles).
It supplements the [preparation milestone](task6-profile-prerequisites.md);
neither snapshot closes the selected-profile qualification gates.

## Source reconciliation

Reviewed the manifest/package loader, exact model/pin checks, Compose mounts,
diagnostic CLI, worker-cohort inspection and inert recovery probe against
the current contracts and canonical
[ZAI:FR-110](../../docs/features/FEAT-013/requirements/FR-110.md),
[ZAI:FR-173](../../docs/features/FEAT-013/requirements/FR-173.md),
[ZAI:FR-254](../../docs/features/FEAT-013/requirements/FR-254.md) and
[ZAI:FR-266](../../docs/features/FEAT-045/requirements/FR-266.md).
Canonical statements, membership and lifecycle remain unchanged. Configuration
presence, a valid model descriptor, and an owned Docker cohort still cannot
establish bootstrap authority, serving authorization or AI readiness.

The [Knowledge admission contract](../../docs/plans/KNOWLEDGE-ADMISSION-CONTRACT.md)
defines source withdrawal as manifest-membership removal and current query/citation
denial. Historical native-store deletion is not its acceptance criterion.
Restarting a worker with retained stores and restoring objects/DB mappings are
separate from restoring a lost native Stage9+ store.

## Corrected probe cleanup

The old teardown stopped on the first ownership/daemon refusal, skipping later
owned resources, and never removed its inert-model temporary directory. The
probe now uses the existing all-actions cleanup finalizer. Each Docker callback
retains its inspect-before-delete owner check; refusal does not authorize removal.
Tracking entries leave their sets only after a successful removal. The model
directory must resolve to a direct child of the OS temp directory with the
run-created prefix; symlinks and path mismatches are refused.

Two new failure-injection cases first failed because the profile helper was
absent, then passed: a refusal preserves the original error while later owned
cleanup and model removal proceed; a foreign temporary prefix survives cleanup.
The actual Docker probe also passed after the change. No timeout, grant,
application, schema, provider pin or production configuration changed.

## Corrected admission child runtime

The actual Next admission harness still used the test runner's `process.execPath`
for MSP, bypassing `KI17_NODE`. This is a harness defect in the split-runtime
image: Tier1 runs Node22, while MSP/GKS/native worker must use pinned Node24.18.
The harness now uses the existing `ki17NodeExecutable` selector, preserving the
native same-runtime default and refusing a missing configured child executable.
Two regressions reproduced the old fallback after exporting the environment
builder, then passed with the selector. No product provider or authority behavior
was changed. The initial admission attempt was interrupted after discovering
this defect and supplies no acceptance result.

## Corrected browser acceptance synchronization

The corrected-runtime admission run then failed two cases: the Console
generation-history assertion still saw `Loading…` at its unchanged five-second
assertion deadline, and the dependent FILE case refused to proceed. The harness
already awaited the run-detail response, but not generation history or evidence
artifact responses. The correction registers each expected request before the
UI action, requires successful HTTP data, checks exact corpus/snapshot membership,
then retains the original DOM/content and download assertions. Artifact responses
are bound to the selected citation and requested layer. No timeout or retry value
was increased. This tests the response/UI contract; it is not latency acceptance.
The successful rerun measured 2,391 ms for its generation response, without
claiming that this reconstructs the earlier request's timing.

## Actual inputs and test environment

All five cached E5 files were checked as regular files with the exact byte sizes
and SHA-256 values in `COMPACT_KI17_MODEL`, before readonly mounting. No model
download was performed. The selected model is `intfloat/multilingual-e5-small`
at `614241f622f53c4eeff9890bdc4f31cfecc418b3`; component commits remain MSP
`d0d48c1a8e833478525d9a6ce5ee16af2c85444d`, GKS
`ecf1e4de269e949406a6a5f791f9ff8fe30c9578` and GenesisBlock
`5156f412da73905a23d74775a82cc14d1f6d04d0`.

The cached acceptance carrier contains this runtime tuple, but its old Zuri label
does not attest current application code. A new TEST-only image was therefore
built from a committed Server tree: the old
`/app` was removed except for dependencies, the identical dependency lock was
verified, current source/tests were copied and both Prisma clients regenerated.
The selected pin checker passed. Build networking was disabled. A second TEST
image adds the lock-selected Playwright browser and OS dependencies at build
time. These are acceptance images, not shipped Compact web/worker artifacts.
The first source export omitted the root line-ending policy and inherited
`core.autocrlf=true`: it produced CRLF bytes and the merged-fixture suite failed
to parse, after 36 other cases passed and four LINE cases were deselected. This
failed attempt is retained separately, not treated as exact-source acceptance.
Exporting with `git -c core.autocrlf=false archive` corrected the local build
input; no product script was edited to hide the parse error. All 2,835 exported
Server blobs were then verified against Git object identities before building.

The native source and runtime-harness revision is
`ca661631b6c5af72c073e3912f82052f1edee1b5`; its TEST image is
`zuri-compact-task6-current@sha256:1c37c4eefef9b4c5e7510db8b71410fc6bfa3f2669f7d08d5eb9744332c67d16`.
The carrier is
`sha256:6a21147e2adbdd596924918fd7223b817ce95cf61878ac7f7104f5abe7624a39`;
the intermediate browser image is
`sha256:8447290b4b18f8120b9490551847ccdc0637d0ed71c82e477c290811333e836b`.
The final build replaces the intermediate `/app` again with the byte-verified
current source, checks the selected KI17 receipt and regenerates both clients
with networking disabled. Tier1 remains Node22 and the child runtime Node24.18;
the harness no longer confuses these identities. Application/schema sources
remain identical to the implementation base; only test support changed.

The final admission run adds only the byte-pinned Console test file from
`ef7cf7d2e5235c63279b75acc8a5659096c68a07`, SHA-256
`e20f182ca8777484395ede3e193c08f8196d43efcbe91d004587c42141829a5a`,
to that base. Its TEST image is
`zuri-compact-task6-admission-sync@sha256:1ac1dcf8d5036894f05a0d5df1586b3a9c71d7e4704e4f7debf11746e55bc2b3`.
The tested file hash was rechecked before committing it. A separate readonly
version probe observed runner `v22.23.4` and KI17 child `v24.18.0`.

Native test containers use unique TEST run labels, no network, no published
ports, no Docker socket, no ambient credentials and only the model bind, readonly.
Their SQLite/native data stays inside the disposable container. The provider
restore uses its existing independently owned disposable PostgreSQL and private
MinIO fixture, fresh credentials and separate source/backup/target buckets.
That restore uses the existing embedded-PostgreSQL profile rather than installing
the Compact PostgreSQL artifact. Its buckets share one ephemeral provider
instance; this is not separate-host disaster recovery.

## Executed checks

| Check | Result | Evidence boundary |
|---|---|---|
| Initial `npm run compact:test` | PASS 207/207, zero skipped | Existing baseline |
| New profile cleanup regressions | RED, then PASS 18/18 | The 18-case profile file includes the two new fault injections |
| `npm run compact:test` after correction | PASS 209/209, zero skipped | Includes the profile regressions; counts are not additive |
| `npm run test:compact:profiles` | PASS 3/3 | Inert wiring/rebind/synthetic state only |
| `server-line-jobs`, worker routes/cadence, MSP stdio transport | PASS 74/74 | Disposable SQLite, synthetic ingress and fake sends; no live LINE |
| `npm run test:knowledge-restore:isolated` | PASS 1/1 | Actual MinIO exact versions and PostgreSQL remapping; Stage9 PENDING, serving disabled |
| Split-runtime and corpus unit checks | PASS 7/7 on Windows; 21/21 on Linux | Missing/selected child-runtime regressions and 14 corpus tests |
| Selected actual KI17 suites | PASS 38, four deliberately deselected | All three Knowledge/SmartGift/merged suites passed; the four synthetic LINE-grounding cases require a separate local model and are outside this selection |
| `npm run test:knowledge-admission` after synchronization | PASS 2/2 | Actual browser/HTTP/MCP, Next process restart, correction, query exclusion/citation 404 after withdrawal, managed FILE and binary denial |
| Pre-final root `npm run govern` on the composed sources/indexes | PASS, zero CRITICAL/warnings | Precedes final evidence reconciliation; generated views remain ignored |
| Pre-final `docs:llms`, `docs:llms:check` | PASS | Ignored reader corpus only; final document freshness is checked again at close |
| `docs:migration:test` | PASS 146/146, zero skipped | Existing document readers/contracts |
| Independent code/evidence review | PASS | GPT-6 Luna Max reviewed the complete patch; no code blocker or public secret/path leak; required pre-final labeling corrected before final verification |
| Full Server suite/production build, shipped Compact AI install and release E2E | NOT_RUN | Test-support/doc changes; selected acceptance above does not substitute for these gates |

The [public observation](task6-requalification-observation-20261028.json) records
source/image/model identities, actual test counts, failed/interrupted attempts
and hashes of non-secret evidence files. Final native/admission containers and
the provider fixture's container/volume were observed absent after owned cleanup.
The model cache, acceptance images, backups and raw evidence were retained.

## Remaining gates

LINE and Knowledge remain `NOT_QUALIFIED`; Task6 is not closed. The core-only
shipping lane keeps these profiles unselected. In particular:

- A complete selected-profile release package and install must bind actual shipped
  web/LINE/native worker image digests, non-secret configuration selectors/versions
  and all model bytes. Secret values and secret hashes are excluded from evidence.
  The TEST acceptance images above do not supply that release-artifact proof.
- The current CLI diagnoses stale worker namespaces. The runbook and inert probe
  manually stop/recreate workers around web replacement. Actual selected-cohort
  recreation, durable queue drain/replay and no duplicate send across replacement
  still need composed acceptance under the existing worker contracts. The
  74 contract tests and inert rebind are separate evidence.
- Native Stage9+ restoration after store loss remains unproven. Retained-store
  restart and exact object/DB restoration with serving disabled cannot close it.
- Live LINE UAT is NOT_RUN under the owner's explicit exclusion. Real account,
  model/context and outbound receipt acceptance remains separately authorized.
- Supported Linux-host, off-host disaster recovery, hosted exact-head CI,
  publication, release and production activation are not established here.

Raw logs, build inputs, image identities and model verification are retained in
the local `zuri-checkpoint-20261028/compact-task6-qualification-9fd5f4b6`
evidence directory. Public observations contain only non-secret identities
and executed results; diagnostic reports are not runtime authority.

## Version diff

0.1.0: records the bounded Task6 source audit, cleanup correction and isolated
acceptance, while preserving selected-profile and environment gates.
