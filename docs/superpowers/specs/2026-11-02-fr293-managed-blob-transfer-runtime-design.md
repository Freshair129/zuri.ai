---
doc_type: subordinate-implementation-design
status: task-authorized
version: "0.1.8"
---

# FR-293 Managed-Blob Transfer Runtime Design

Version: 0.1.8
Status: Task-authorized design; owner selected the PM workflow and disposable TEST-only confirm scope on 2026-11-02
**Selected approach:** PM-owned transfer workflow with dedicated durable jobs, selected by the normal Backup UI when reserved refs exist
**Decision date:** 2026-11-02

## Intent

Implement the supported backup round trip required by ZAI:FR-293. An installation operator must be able to export a complete snapshot containing reserved managed-blob refs and their exact original bytes, preview that package on a target, and confirm a target-local restore that derives new immutable refs from the target's trusted configuration. The workflow must preserve current metadata, authority, audit, and protected-family boundaries.

This design is subordinate to [ZAI:FR-293](../../requirements/FR-293.md), the approved [OR0 adoption](../../change-requests/project-manager/compact-managed-blob-recovery-adoption-20261030.md), and its source-bound [OR0 contract proposal](../../change-requests/project-manager/compact-managed-blob-recovery-or0-20261029.md). It does not create a new requirement or change those records.

## Goals

- Provide a complete operator export, preview, confirm, status, inspect, abandon, and package-download workflow for reserved recovery refs.
- Let the same authorized operator recover durable job IDs after a lost response without exposing confirmation material.
- Bind each FileAsset and ProjectFile row to exact original bytes using the adopted closed manifest, canonical TAR, row/ref digests, hash and size witnesses.
- Persist target-local transfer jobs and entry receipts outside generic snapshots; derive provider selection and destination refs from trusted target configuration.
- Persist the export snapshot selection in the private spool before source-provider reads; return 202 only after the durable job can be polled or resumed.
- Keep legacy JSON snapshot backup and restore behavior for targets without reserved refs, including local-file content and remount behavior.
- Preserve installation-operator authority for whole-installation transfer and Business OWNER authority for per-file recovery as separate decisions.
- Keep ordinary recovery unavailable until a supported round trip is implemented and proven; this task does not activate recovery or qualify OR5.

## Non-goals

- Qualifying full PostgreSQL installation restore, off-host failure domains, production, release, AI profiles, Knowledge, or LINE.
- Granting Business ownership from an installation-operator grant, uploaded manifest, backup possession, or source authority.
- Replacing the generic snapshot format, weakening protected-family or credential guards, using raw SQL, adding a host-path reader, or trusting uploaded refs/configuration.
- Enabling ordinary recovery as a side effect of transfer implementation or of a successful transfer test.

## Approaches considered

1. **PM-owned transfer orchestration with dedicated endpoints and durable jobs — selected.** The Backup UI detects reserved refs and uses the versioned package workflow. Existing JSON endpoints remain unchanged for snapshots without reserved refs. This matches FR-293's accepted target-local job, audit, mapping, and complete-round-trip contract while isolating transfer state from replace-all snapshot data.
2. **Add TAR and byte mapping directly to generic snapshot export/import — rejected.** This mixes transfer custody and provider IO into the replace-all snapshot path, obscures the existing installation restore guard, and makes it harder to preserve the old JSON and protected-family behavior.
3. **Provide a CLI-only transfer tool — rejected.** It does not satisfy the adopted normal Backup UI and supported operator-workflow acceptance; it also risks creating an authority bypass through script or direct database access.

## Architecture and flow

### Export

- Resolve the persisted session and FR-075 installation-operator authority before exposing snapshot metadata or reading any managed-blob bytes; record operator use through the existing audit path.
- Acquire the shared installation fence before snapshot extraction. Require an admitted generation and no unresolved recovery or transfer custody. Persist an EXPORT job and immutable selection before provider IO.
- Capture one consistent snapshot and inventory every reserved FileAsset and ProjectFile ref, including retained rows required by the contract. Bind rows to Tenant, Business, purpose, source-row digest, source-ref digest, and exact content witness.
- Check current erasure/legal-hold disposition before reading source bytes. If the current source or snapshot custody cannot be proved, refuse export before provider reads.
- Read each original through the configured private storage port using the pinned source configuration and exact immutable version. Verify stream byte limits, SHA-256, size, and purpose. Seal transfer.json, the unchanged snapshot.json, and object sidecars into the strict flat TAR format.
- Publish a downloadable package only when the durable job is COMPLETE and the same operator is currently authorized. Do not expose provider refs, credentials, spool paths, or raw provider errors in DTOs or logs.
- Return 202 after the immutable selection and its private spool receipt are durable. A source-provider read may resume after a process restart because it is read-only; a lost response is recoverable from the actor-bound current-job list and status route. Each export claim receives its own finite 15-minute worker window, persisted as `workerStartedAt`; stale-lease resume refreshes that window while the original 24-hour private-payload deadline remains fixed.

### Preview and target restore

- Accept a bounded raw TAR upload only after session, operator, CSRF, and origin checks. Decode into server-owned staging without extracting caller paths. Reject unknown records, links, duplicate entries, wrong order, extra bytes, unknown fields, mismatched row bindings, missing objects, and invalid hashes.
- Give each PREPARED upload a durable worker identity and finite lease, and bind spool publication and preview finalization to that identity, job version, target generation and live lease. Maintenance may reclaim a PREPARED upload only after its lease/legacy expiry, with no restore attempt or entry intents, and only by removing its exact job-UUID spool path. A stale uploader cannot publish or finalize after cleanup.
- Run all current snapshot validators and protected-family checks. Persist a target-local RESTORE preview bound to the package digest, target generation, target configuration digest, and expiry. Return only a bounded safe DTO and a single-use confirmation binding.
- FR-075 installation-operator authority, re-resolved from the persisted session and audited, authorizes the whole-snapshot replace-all. Per-file Business OWNER authority is not substituted for this decision. On confirm, reauthorize the current operator and revalidate the target generation/configuration, preview version, package digest, and confirmation binding. A disposable qualification run also requires explicit source-bound **pre-restore TEST admission**; this admission is harness-controlled, never an uploaded flag or injected Viewer.
- A normal installation restore additionally needs an approved maintenance/quiescence and target-provenance admission before provider writes or destructive replacement. That general admission is outside this task and is not present in the current source. Therefore the ordinary runtime composition must refuse transfer confirmation for any target lacking a trusted server-side admission; only the separately selected, owned disposable TEST lane may reach confirm in this task. The TEST gate binds the exact isolated database/provider/profile, proves the target is quiesced, checks current erasure/legal-hold obligations, and uses a real persisted operator session. The runtime accepts that TEST decision only as a short-lived Ed25519-signed local envelope verified against a separately mounted public key. The harness keeps the private signing key outside the app and binds the envelope to the loopback `zuri_server_test` identity including PostgreSQL database OID, exact transfer job, target generation, storage-profile digest, source revision/evidence, synthetic dataset and package digest. A unique durable admission ID can be claimed by one job only. New confirms require an unexpired envelope; after the atomic restore claim, retries verify the persisted signature and exact current target binding after preview and byte deadlines while unresolved custody is retained. Missing, malformed or mismatched admission fails before provider IO and replace-all.
- Before destructive writes, durably enter RESTORING, increment the installation-fence generation, and bind the restore attempt ID while excluding new transfers and recovery work. Keep the fence through replace-all and post-transaction status reconciliation. Missing, inconsistent, or failed pre-restore admission remains closed; no startup repair or finally block returns it to READY.
- Persist a worker epoch and renewable lease. After a worker lease expires, resume only untouched PENDING entries or verified receipts. Any ambiguous provider write must be reconciled by exact-key read/recovery before any new PUT; a stale worker cannot write a receipt or commit replacement.
- Give each restore worker claim a finite job-duration window. An explicit operator inspect/confirm may use one bounded read-only reconciliation window after an earlier claim expires. Once every ambiguous effect is proved, a resumed durable claim starts a fresh finite worker window; expiry alone never clears custody or starts a duplicate provider write.
- Derive every destination from the current target selection and private storage port. Write a new immutable object, verify exact version, hash, and length, and retain durable custody for any ambiguous result. Provider IO stays outside metadata transactions.
- Under the shared fence and replace-all transaction, map only the manifest-bound reserved refs to verified target refs. Preserve snapshot row IDs, row versions, Tenant/Business scope, links, audit lineage, and all other snapshot fields. Commit the mapping, replacement, redacted audit, and durable job result atomically.
- That transaction records `METADATA_COMMITTED` with the transfer job and metadata audit. The FileAsset postpass runs afterward; one final transaction moves both the fence and job to `NEEDS_ADMISSION` and writes the completion audit. A crash after metadata commit resumes only the postpass and finalization, never replace-all again.
- After the replace-all and postpass succeed, keep the target fence and RESTORE job in NEEDS_ADMISSION. A separate reviewed **post-restore generation admission** must validate restored-target authority, erasure, and provenance before any recovery action can become READY. Transfer confirmation, pre-restore TEST admission, operator authority, and a successful package round trip do not constitute this post-restore admission. This runtime task does not implement that admission or enable recovery.
- A provider retry is permitted only with evidence for the exact selected provider's conditional semantics. Without that proof, quarantine the ambiguous entry; never overwrite, use latest, list-and-guess, or delete an unknown object.

### Compatibility and authority

- Keep /api/backup/export and /api/backup/import on their existing JSON contract for installations without reserved refs. A legacy JSON-only request containing reserved refs remains a typed refusal with a safe UI handoff; it must never report an incomplete backup or perform an incomplete restore.
- Add the dedicated operator endpoints from the adopted contract: export job creation, raw-package preview, job status, complete-package download, confirm, inspect, and abandon. POSTs retain existing CSRF/origin checks, strict DTOs, no-store behavior, and generic safe errors.
- Add an actor-bound current-job read so a fresh authorized session can recover a lost export response and discover the durable status URL. It returns safe DTOs only, never confirmation bindings.
- Update the normal Backup UI to select the transfer format when the snapshot contains reserved refs, then provide package download/upload, preview, confirm, and job status. State when server-side TEST-admission verification is configured, while making clear that preview is not authorization and confirm still requires a current matching signed envelope. The local-file include checkbox continues to affect local files only; it cannot suppress required managed-blob originals.
- Keep Phase B export/clean-target restore and the PostgreSQL migration utility from bypassing the transfer contract. They must refuse reserved refs before artifact publication or target writes unless separately adopted for this workflow; their no-recovery behavior stays intact.
- Transfer jobs, entry receipts, fences, leases, and recovery state remain installation-local and excluded from generic snapshot export/import. The private spool is mounted on a project-local Compact volume. Node runtime maintenance runs at startup and every minute, removing only exact job-UUID payloads for expired terminal jobs, untouched expired previews, or post-erasure exact cleanup; provider-writing and unresolved custody remain retained.
- Apply the PM-owned erasure adapter to transfer-job actor references and byte custody. Check current erasure and legal-hold outcomes before replace-all; if an erasure disposition cannot be established, refuse. Expiry alone never clears an unresolved job or payload.
- The ordinary recovery composition remains unconfigured and returns its existing 503. Transfer completion alone does not close OR5 or enable operator recovery.

## Acceptance

- Existing no-reserved-ref JSON backup/restore, local-file behavior, remounts, and protected-family refusals pass unchanged.
- Reserved-ref export produces a complete sealed package whose manifest covers every admitted FileAsset/ProjectFile binding and exact original bytes; malformed, missing, corrupt, duplicate, extra, reordered, linked, or oversized inputs fail closed.
- A disposable PostgreSQL target can preview and confirm the package through the normal operator workflow, restore new immutable target objects, and read exact bytes with Asset/catalog links intact after the source provider is unavailable. Bind this proof to the separately selected, source-bound disposable TEST lane.
- The restored generation remains NEEDS_ADMISSION after the transfer round trip. The TEST lane's pre-restore admission is evidence only and cannot release the post-restore fence; ordinary recovery continues to return 503, and no fixture-only toggle may mark the product route READY or claim operator qualification.
- The ordinary runtime composition refuses a transfer confirm without the separately approved pre-restore maintenance/quiescence and target-provenance admission; a caller-supplied TEST label, uploaded grant, or manifest cannot bypass this guard.
- Tests cover operator/session/CSRF denial, stale generation/configuration, expiry, package mutation, lost responses, concurrent jobs, snapshot/recovery fence races, quota, crash boundaries, audit/metadata rollback, exact cleanup, erasure refusal, and both conditional-write winner orders. If provider conditionality is not proven, the expected result is quarantine with no retry write.
- The selected Backup UI and every enumerated snapshot consumer preserve old behavior without reserved refs and cannot bypass reserved-ref guards.
- The disposable integration uses a separate short-lived signer process with a sanitized environment; it writes only the public key and signed envelope, never persists the private key, and exits before confirm. This proves process separation from the application code path, not separate host or operating-system identity custody.
- Verification uses disposable isolated databases and providers, the exact committed source/package/profile, scoped unit/integration/browser/native tests, builds, governance, and exact-head hosted CI. No main-dev/UAT/production target or secret is used.

## Status boundaries

Keep the implementation plan **candidate**. Keep OR5 **BLOCKED**, AI/operator **NOT_QUALIFIED**, both OR4 hygiene minors **DEFERRED/OPEN**, and both original flakes **OPEN/NOT_PROVEN**. Keep ordinary recovery disabled throughout this implementation task. A fresh complete round-trip result is evidence for the prerequisite only; it is not, by itself, an OR5 qualification, production approval, or release decision.

## Decisions left to implementation

- Choose a disposable provider profile only from the already configured private storage ports; bind its exact identity in test evidence. Do not infer retry safety from a provider name or mock.
- Use finite explicit package, spool, entry-count, job-duration, and quota profiles from the adopted contract. If a required profile or retention/erasure behavior is not supported, fail closed and leave the related activation gate open.
- Preserve existing transaction and transport deadlines. Do not add timeouts or relax guards to make races pass.

## Source references

- [FR-293](../../requirements/FR-293.md)
- [OR0 adoption approval](../../change-requests/project-manager/compact-managed-blob-recovery-adoption-20261030.md)
- [OR0 transport and workflow contract](../../change-requests/project-manager/compact-managed-blob-recovery-or0-20261029.md)
- [Candidate OR0-OR5 plan](../../plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md)
- [Current OR5 prerequisite assessment](../../../reports/compact-selfhost-2026-10-27/or5-prerequisite-assessment-20261101.md)
- Existing package codec: apps/server/src/modules/project-manager/application/managed-blob-transfer-contract.js
- Existing generic snapshot boundary: apps/server/src/modules/project-manager/application/backup-service.js

## Version diff

0.1.0 -> 0.1.1 (2026-11-02): records the owner's selected disposable TEST-only
confirmation boundary and the separate FR-293 runtime-task authorization. No
canonical requirement, candidate-plan status, ordinary recovery gate or
qualification state changes.

0.1.1 -> 0.1.2 (2026-11-02): defines bounded in-process private-spool cleanup,
its exact eligible states, and the persistent project-local Compact volume. It
does not make expiry sufficient to clear provider or restore uncertainty.

0.1.2 -> 0.1.3 (2026-11-02): wires a harness-signed disposable TEST admission
envelope into the normal runtime composition. The server verifies exact target,
generation, profile, source and package claims; no ordinary restore admission is
added and qualification states remain unchanged.

0.1.3 -> 0.1.4 (2026-11-02): binds admission to the PostgreSQL database OID and
one transfer job, enforces durable single use, and permits signature-verified
resume of an already claimed unresolved restore after preview and byte deadlines.
No new admission is issued after expiry; qualification states remain unchanged.

0.1.4 -> 0.1.5 (2026-11-02): specifies leased PREPARED-preview cleanup with
fenced spool publication, source erasure/legal-hold checks before export reads,
and fresh bounded restore windows after expired claims are reconciled. The
ordinary restore, candidate and qualification boundaries stay closed.

0.1.5 -> 0.1.6 (2026-11-02): gives each export worker claim a persisted 15-minute
window refreshed on stale-lease resume, while keeping the 24-hour payload
deadline anchored to the original export. This allows bounded read-only resume
after process downtime without extending spool retention or changing gates.

0.1.6 -> 0.1.7 (2026-11-02): distinguishes availability of server-side TEST
admission verification from actual authorization. The UI states that preview
is not authorization and confirm still checks a current matching signed
envelope; no target scope or gate changes.

0.1.7 -> 0.1.8 (2026-11-02): records the disposable signer-process boundary and
its evidence limit. The private key is ephemeral and outside the app process;
host-level signer isolation remains unqualified.
