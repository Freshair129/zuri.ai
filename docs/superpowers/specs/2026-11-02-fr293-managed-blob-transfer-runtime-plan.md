---
doc_type: implementation-plan
status: task-authorized
version: "0.1.9"
source_revision: "024e4b2798487c2292373d44041d9689efcdc95c"
---

# FR-293 Managed-Blob Transfer Runtime Implementation Plan

Version: 0.1.9

Status: Scoped implementation plan for the owner-authorized FR-293 runtime task

Reviewed source revision: `024e4b2798487c2292373d44041d9689efcdc95c`

Design: [FR-293 runtime design](2026-11-02-fr293-managed-blob-transfer-runtime-design.md)

## Authority and scope

This plan implements the existing planned [ZAI:FR-293](../../requirements/FR-293.md)
under the owner's separate 2026-11-02 authorization of a runtime transfer task.
It follows the selected PM-owned Backup workflow and limits replace-all confirm
to a source-bound disposable TEST target. The approved [OR0 adoption](../../change-requests/project-manager/compact-managed-blob-recovery-adoption-20261030.md)
pins its design envelope to OR0 v0.2.0 at `047bb9c5f0e30fcbfd8d5cdeb326342035e25c92`;
the current v0.3.0 intake records that adoption and makes no transport or
authority change. The [OR5 assessment](../../../reports/compact-selfhost-2026-10-27/or5-prerequisite-assessment-20261101.md)
is a source-bound gap report at `59145776f2513f164b974edae0c4eff0cd5ca416`.

This task does not adopt or mark the whole candidate [OR0-OR5 plan](../../plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md)
authorized. That plan remains `candidate`, OR5 remains `BLOCKED`, AI/operator
remain `NOT_QUALIFIED`, the two hygiene minors remain `DEFERRED/OPEN`, and both
original flakes remain `OPEN/NOT_PROVEN`. Ordinary recovery remains unavailable
with its existing 503. No non-TEST target may confirm replace-all until a
separate maintenance, provenance and restored-generation admission contract is
approved and implemented. This work uses the existing separate clone and does
not touch Knowledge, production, live LINE or any shared runtime/database.

## Source audit at the reviewed base

| Area | Observed state | Planned action |
|---|---|---|
| Wire package | `managed-blob-transfer-contract.js` strictly encodes/decodes canonical `compact-managed-blob-backup.v1` TAR and validates all FileAsset/ProjectFile witnesses. Its observed consumer is the unit suite. | Preserve the codec contract; add service and route-boundary tests around it. Change the codec only where integration reveals a bounded streaming gap. |
| Generic backup | `backup-service.js` and the ordinary JSON routes preserve legacy snapshots but refuse reserved recovery refs as `MANAGED_BLOB_TRANSFER_REQUIRED`. | Keep those refusals for JSON and non-admitted consumers. Add one private, package-bound import context that cannot be supplied through HTTP JSON. |
| Workflow and persistence | No supported transfer application service, API routes, durable transfer job/entry models, or round-trip caller exists. | Add PM-owned target-local jobs/receipts, repositories, service orchestration and the adopted `/api/backup/transfers/*` routes. |
| Backup UI | `apps/server/src/app/(pm)/backup/page.jsx` downloads/pastes JSON and has no TAR job flow. | Select the versioned package for reserved refs; retain JSON/local-file controls for snapshots without them. |
| Recovery boundary | The ordinary `createRecoveryHttpHandler()` composition has no service and returns `503 MANAGED_BLOB_RECOVERY_NOT_QUALIFIED`. The recovery fence has durable RESTORING and NEEDS_ADMISSION transitions. | Keep ordinary routes unavailable. Share the fence with TEST transfer jobs; never let TEST pre-admission release the post-restore generation. |
| Storage | The private Asset/catalog port derives provider and bucket from trusted environment and supports immutable `put`, exact-version `get`, and scoped `remove`. | Use only this port; derive new keys from target-local job and manifest evidence. Never accept source refs or destinations as write instructions. |
| Direct snapshot consumers | Phase B hooks and the PostgreSQL snapshot migration utility call snapshot functions outside the Backup UI. | Keep their existing no-recovery behavior and prove reserved-ref refusal before publication or target writes; do not give them an operator or transfer bypass. |

At this base the application source is unchanged from the assessed `59145776`
tree; the intervening main change is documentation/evidence. The assessment's
unit and disposable-PostgreSQL passes are historical baseline evidence, not
tests for this implementation.

## Implementation sequence

### 1. Add failing contract and compatibility tests

- Cover normal JSON export/preview/restore with no reserved refs, including
  local-file `includeBinaryContent`, remounts and protected-family refusals.
- Cover JSON requests containing reserved refs, Phase B export/restore and the
  PostgreSQL snapshot utility refusing before any publication/write.
- Cover transfer DTO schemas, persisted operator/session checks, CSRF/origin,
  no-store headers, safe errors and caller-forged authority/target fields.
- Preserve the ordinary recovery route's 503 with no service, even when a test
  caller supplies activation-looking fields.

### 2. Add target-local transfer custody

- Add `ManagedBlobBackupTransferJob` and `ManagedBlobBackupTransferEntry`
  models to both Prisma schemas and a forward migration. Keep these tables,
  recovery operations and the installation fence excluded from snapshot export
  and replace-all imports; use scalar provenance so replacement cannot cascade
  or manufacture authority.
- Implement a PM-owned repository with version/CAS transitions, one active job
  per installation, a shared recovery/export/import fence, reserved quota,
  actor/scope binding, entry intents, exact receipts, and durable UNKNOWN and
  cleanup states. Do not store provider credentials, raw errors, session tokens
  or portable authority.
- Use the adopted 15-minute confirmation and 24-hour private-payload ceilings;
  reserve and account quotas atomically. The bounded Node runtime maintenance
  pass runs at startup and every minute on the project-local private volume; it
  closes only expired previews with no attempts and only PENDING object intents,
  and reclaims PREPARED restore uploads only after their durable finite worker
  lease (or the legacy expiry bound) has elapsed and no entry intent exists.
  Preview workers fence spool publication and finalization by job version,
  worker identity and lease so cleanup cannot be followed by a late package.
  It unlinks only exact job-UUID payloads for safe terminal, abandon-pending
  or erasure-cleanup states. Abandon claims the job before unlinking and keeps
  unresolved cleanup state until the exact spool is removed. UNKNOWN, RESTORING,
  provider-writing and other unresolved custody is retained for reconciliation.
  Require a finite transfer profile for
  manifest, snapshot, entry/binding count, original-byte, package, spool and job
  limits. If the selected profile or custody capacity is missing, refuse before
  reading or writing bytes; do not infer one from the codec unit fixture.
- Add erasure/legal-hold integration through the PM-owned adapter. If current
  disposition cannot be proved, refuse restore. Do not enable broad TTL cleanup
  or delete any unknown, shared, source or unreferenced-unproven version. Payload
  expiry does not clear provider-write or restore uncertainty.

### 3. Implement source export and package delivery

- POST `/api/backup/transfers/export` resolves the persisted session, current
  FR-075 operator authority and audited use before exposing metadata/provider
  reads. Capture snapshot and complete row/ref selection under the shared fence,
  then release metadata transactions before provider IO.
- Journal the immutable selection and job in the private spool before reading
  exact source versions. Return 202 after the job is pollable; expose an
  actor-bound current-job list so a lost response does not strand the job ID.
  Check current erasure/legal-hold disposition before reading any source bytes;
  refuse if source or snapshot custody is unproven.
  Read Asset/catalog bytes only through the pinned configured private port;
  verify hash/length, every FileAsset and ProjectFile alias/tombstone binding,
  current erasure/legal-hold state and the full configured package profile.
- Build `compact-managed-blob-backup.v1`, seal its digest and complete job state,
  then allow the same currently authorized operator to download only the
  complete package through GET `/api/backup/transfers/{jobId}/package`. No
  partial artifact, public URL, raw spool path, source ref or provider detail is
  returned. Interrupted or missing-byte export is not complete; stale export
  workers resume only from the exact persisted snapshot selection. Persist a
  `workerStartedAt` per export claim and allow at most 15 minutes per worker;
  stale-lease resume refreshes that window while the original 24-hour
  `byteDeadline` stays fixed.

### 4. Implement target preview and confirmation

- POST `/api/backup/transfers/preview` checks session, FR-075 operator,
  CSRF/origin and quota before consuming the raw bounded TAR stream. Stage only
  under server-owned private storage; verify the whole package with the existing
  codec, all snapshot validators, every protected-family guard and target
  config/generation binding. A forged or partial upload never creates a valid
  preview.
- Persist a target-local preview and one-use confirmation binding over package
  digest, target generation/config, job version and expiry. GET job status and
  POST inspect/abandon re-resolve current operator authority and return bounded
  safe DTOs; inspect never lists provider objects or blindly retries a PUT.
- POST confirm returns 202 only after the restore attempt is durable. A duplicate
  committed confirm returns its saved result and does not rerun replace-all.
- Before confirm, require source-bound TEST admission for the exact disposable
  PostgreSQL database, private storage profile, synthetic dataset and quiesced
  target; recheck erasure/legal-hold, operator session, job/package digest,
  generation/config and all snapshot guards. Refuse every other target before
  provider IO and replace-all. The normal runtime accepts that harness decision
  only in a short-lived Ed25519-signed local envelope verified with a separately
  mounted public key; the envelope binds loopback database identity including
  PostgreSQL database OID, one transfer job, target generation, private profile
  digest, source revision/evidence, synthetic data and package digest. A unique
  durable admission ID is claimable by one job only. The harness private key
  stays outside the app. New confirms require an unexpired envelope; after the
  atomic restore claim, retries verify the persisted signature and exact target
  binding without requiring preview or byte deadlines to remain live. Unresolved
  restore custody retains its private payload for reconciliation.
- Persist RESTORING, the generation increment, attempt and all per-entry
  target intents before provider writes. Record operator use before provider
  reads/writes. Bound each provider call with AbortSignal and the finite worker
  window that starts at the durable restore claim, so package expiry cannot
  strand an already-claimed restore. An explicit operator inspect/confirm may
  use one bounded read-only reconciliation window after an earlier claim
  expires; only after each ambiguous effect is proved and a durable claim is
  resumed does the next worker receive a fresh finite window. Expiry alone
  never clears custody or admits a new provider PUT. Create new immutable target
  objects with server-derived keys, exact-version read them back, and verify
  hash/length.
  Apply no retry without exact selected-provider conditional-write evidence;
  ambiguous writes remain UNKNOWN/quarantined and inspectable.
- Persist worker epoch/lease ownership and resume after crash only for untouched
  PENDING intents or already verified entries. An ambiguous provider intent must
  be reconciled by exact key before any further restore step; never resend its PUT.
- Construct a private typed import context only after complete package
  validation and verified target receipts. In one replace-all metadata
  transaction, recheck operator, TEST admission, generation and guards; map
  every exact source row/ref digest to its target receipt; preserve IDs,
  versions, links and scope; record redacted audit and durable result. Plain JSON,
  uploaded maps or caller flags cannot create this context.
- In that transaction mark `METADATA_COMMITTED` and append its audit. Resume a
  later postpass from that checkpoint without repeating replace-all; atomically
  advance the recovery fence and transfer job to `NEEDS_ADMISSION` after the
  postpass, with a separate completion audit.
- Keep RESTORING through the existing FileAsset status postpass. Successful
  TEST restore remains `NEEDS_ADMISSION`; the fence is not released to READY,
  old sessions/jobs do not become grants, and recovery remains 503. Failure or
  crash preserves durable custody/admission state; no finally block clears it.

### 5. Wire the Backup UI and preserve consumers

- Update the Backup page to request a transfer export when the snapshot contains
  reserved refs and to download the sealed TAR without JSON stringification.
  Add TAR upload, bounded preview summary, explicit confirmation, target-local
  LOCAL_FILE remounts persisted through the postpass checkpoint, job polling,
  inspect/abandon and format-required safe handoff. Recover a completed export
  package from the actor-bound current-job list after a lost response or reload.
  Describe server-side TEST-admission verification as enabled only; say that a
  preview is not authorization and confirm still validates a current matching
  signed envelope.
- Keep the current JSON download/paste/preview/confirm behavior for snapshots
  without reserved refs. `includeBinaryContent` continues to control LOCAL_FILE
  only and never suppresses required managed-blob bytes.
- Preserve existing direct-consumer guard behavior for Phase B and the
  PostgreSQL migration utility. No CLI, direct SQL, mock viewer, fixture route
  or test flag can call the reserved-ref import exception.

### 6. Prove the complete disposable round trip

- Use owned disposable PostgreSQL and private provider instances, distinct from
  main-dev/UAT/production, with real persisted operator sessions and synthetic
  data. Exercise product Asset/catalog ingestion, recovery fixture refs,
  supported package export, source-provider absence after export, target
  preview/confirm, new immutable refs, exact content reads and intact consumer
  links after restore. Sign the TEST admission in a separate child process with
  an allowlisted environment; generate the private key only in memory, persist
  no private key, and exit before the app verifies the public key and envelope.
  Record that this proves process separation only, not a separate host or OS
  identity for deployed signer custody.
- Cover malformed, corrupt, missing, duplicate, extra, reordered, linked,
  oversized and stale inputs; authorization/session/CSRF denial; quota/expiry;
  erasure refusal; config/generation drift; lost responses; concurrent
  export/restore/recovery fences; a PREPARED upload crash and cleanup; an
  expired restore with an ambiguous provider write and no duplicate PUT; each
  crash boundary, including claim-before-intent, metadata-commit-before-postpass,
  and postpass-before-finalization;
  audit/result rollback; postpass failure; exact cleanup and both
  conditional-write winner orders.
- Prove no target provider IO, DB replacement or authority disclosure on
  pre-admission refusal. Prove restored status remains `NEEDS_ADMISSION` and the
  ordinary recovery route remains 503 after the successful TEST round trip.
- Run change-scoped Server unit/integration tests, disposable PostgreSQL
  integration and browser coverage; then build, governance and exact diff checks.
  Preserve all prior failed/full-run evidence and known deferred/open findings.
- Request independent read-only review of the final exact diff and test
  evidence. Resolve findings and rerun affected checks before declaring this
  task complete.

## Acceptance and stop conditions

The task is implementation-complete only when the normal PM Backup UI can
round-trip every admitted reserved ref and exact original byte on the selected
disposable TEST profile, while no-ref JSON compatibility and all refusal guards
remain intact. The installed/non-TEST restore path remains fail-closed in this
task. A successful disposable round trip is prerequisite evidence only; it does
not qualify OR5, AI/operator, production, whole-installation restore, off-host
failure domains or release.

Stop before provider IO or destructive replacement if no finite profile,
TEST-target provenance, maintenance/quiescence, current operator/erasure
decision, capacity, provider exact-version behavior or complete row/byte
coverage can be established. Record the specific blocked item; do not relax a
guard, expand timeouts, or report a partial package as complete.

## Version diff

0.1.0 (2026-11-02): initial task-bounded plan. It follows FR-293 and the adopted
OR0 v0.2.0 envelope, records current source gaps, and keeps all wider candidate
plan and qualification statuses unchanged.

0.1.1 (2026-11-02): adds bounded private-spool maintenance and the persistent
Compact volume contract. Expiry does not clear ambiguous provider or restore
custody.

0.1.2 (2026-11-02): adds restartable durable export selections, actor-bound job
discovery, restore worker leases, and atomic metadata/postpass completion
checkpoints. Ambiguous provider intents remain inspect-only.

0.1.3 (2026-11-02): defines the signed TEST admission envelope and wires it into
the normal runtime service composition while keeping every non-TEST target
closed. This does not activate ordinary recovery or change candidate/gate status.

0.1.4 (2026-11-02): binds the admission to database incarnation and one job,
and records signature-verified resume after expiry for an already claimed
unresolved restore.

0.1.5 (2026-11-02): closes runtime review gaps for actor-scoped export resume,
operator-use audit before provider IO, crash-safe abandon cleanup, postpass
erasure refusal, stable PostgreSQL cluster identity, bounded provider calls,
lost export response recovery, and target-local remount persistence. A restore
claim receives its own finite worker window, independent of preview/package
expiry; only an admitted disposable TEST target is exercised.

0.1.6 (2026-11-02): adds leased PREPARED-preview reclamation with fenced spool
publication, requires current source erasure/legal-hold disposition before
export reads, and gives explicit reconciliation plus resumed restore workers
finite fresh windows after an earlier claim expires. It adds no non-TEST restore
admission and changes no candidate or qualification status.

0.1.7 (2026-11-02): persists an export worker start per claim so bounded
read-only export can resume after downtime longer than one 15-minute worker
window. The original 24-hour byte-retention deadline is not extended; wider
candidate, recovery and qualification statuses remain unchanged.

0.1.8 (2026-11-02): makes the Backup UI distinguish verifier availability
from a verified admission. Confirm still requires the live source-bound TEST
envelope; the task and wider candidate statuses remain unchanged.

0.1.9 (2026-11-02): moves disposable TEST signing to a separate process with
only the public key and signed envelope returned to the app. No private key is
persisted; process separation does not qualify host-level signer custody.
