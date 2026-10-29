---
id: ZAI:COMPACT-MBR-OR0-CONTRACT-20261029
title: Compact managed-blob recovery OR0 contract proposal
doc_type: change-request
status: proposed
superseded_by: null
version: "0.2.0"
source_revision: "63749acd7a279e4cded6bc88f7f5315819e79acc"
implementation_authorized: false
relations:
  - type: references
    target: ZAI:COMPACT-MANAGED-BLOB-RECOVERY-PLAN-20261029
  - type: references
    target: ZAI:ADR-115
---

# Compact managed-blob recovery OR0 contract proposal

## Authority, decision and limits

This is a proposed contract for review, not a canonical requirement or an
implementation authorization. It resolves the technical choices left by the
[candidate plan's OR0 review package](../../plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md#or0-contract-review-package--draft-2026-10-29).
The integrator proposes the choices below under the instruction to continue OR0;
they are not attributed to the owner as approved decisions. Adoption and record
issuance remain separate from review, implementation and qualification.

**Owner scope selection, 2026-10-29:** add the transfer/backup contract before
enabling recovery to preserve backup capability. This selects the design work
below, not adoption of this whole proposal or permission to implement it. The
earlier temporary full-export refusal is a fail-closed fallback for unsupported
formats, not the behavior to ship as the normal operator backup workflow.

Scope is one existing, undeleted ACTIVE MANAGED_BLOB FileAsset in a trusted
Compact PostgreSQL target, restoring its exact persisted SHA256/length and
rebinding only its internal ref to a new immutable Asset/catalog object. No
changed bytes, cross-Business/Tenant moves, native Knowledge object, local-file
relink, installation database restore, off-host proof or production operation.
AI profiles and aggregate operatorRecovery remain **NOT_QUALIFIED**.

Use the existing authenticated File Management application boundary and a
PM-owned journal. A direct-SQL operator tool cannot prove product authority;
reusing the installation-wide backup/import endpoint would change scope. A new
process would add transport and ownership without solving this transaction.
The existing [Files service](../../../services/file-management/README.md) already
owns FileRecord/FileVersion/FileOperation, but its
[charter](../../domains/file-management/CHARTER.md) explicitly retains
FileAsset/ProjectFile/FileLink in the PM compatibility cohort until a reviewed
cohort migration. This slice stays inside that cohort, Server and its existing
private-business storage port. Its proposed journal is not the standalone
FileOperation, and that service's authority/readiness or conditional-write code
does not qualify this operation. No new service, Files schema/authority port,
FileUsageReference implementation, cohort migration or caller cutover is selected.
The candidate plan remains candidate.

## Source audit and proof boundary

Inspected source at `63749acd`; application code is unchanged from `05a47191`.
The inventory covers direct writes to Person, Membership, Session, Tenant and
Business across `apps/server/src`, dynamic delegates in scope/import/restore,
raw Business writes, and FileAsset write/cascade surfaces. It is a source audit,
not proof that a new fence already works. Native two-session tests remain NOT_RUN.
Tests, seed/admin scripts, direct DBA access and future writers are outside this
runtime inventory; a deployment permitting those writers concurrently cannot
claim this recovery qualification without separately admitting them.

| Existing surface | Observed inputs/order and proposed treatment |
|---|---|
| [resolve-viewer](../../../apps/server/src/modules/identity/resolve-viewer.js), [viewer-authority](../../../apps/server/src/modules/identity/viewer-authority.js) | ACTIVE/unexpired OWNER Membership, exact Business or compatible Tenant-wide expansion. RoleBinding/visible Business/platform label is not ownership. Preserve current null-Business/TENANT compatibility. |
| [session-port](../../../apps/server/src/modules/identity/session-port.js) | Persisted checking is conditional on cookie/session ID and store availability; trusted injection, legacy and nonproduction fallback do not prove it. Recovery independently requires the real persisted Session and token binding in every environment. |
| [membership-lifecycle](../../../apps/server/src/modules/identity/membership-lifecycle-service.js) | Suspend/revoke/offboard mutate Membership and bindings before stranded Sessions; reinstate changes Membership/bindings. Lock the actual qualifying witness before Session, then reread all live predicates. Multi-row offboard is not asserted to have a universal sorted lock order. |
| [profile-permission](../../../apps/server/src/modules/identity/profile-permission-service.js) | Role/domain update writes Membership without a version increment. A witness version comparison alone misses a role change; compare live role/status/scope/expiry under its row lock. |
| [auth-service](../../../apps/server/src/modules/identity/auth-service.js), [logout](../../../apps/server/src/app/api/auth/logout/route.js) | Logout and logout-all update persisted Session; password reset calls session revocation. Session row locks serialize these updates; token validation before the transaction alone is insufficient. |
| [session-assurance](../../../apps/server/src/modules/identity/session-assurance.js), session lastSeen | Session updates can contend but do not confer Business ownership. Recheck required session fields, not an unrelated version-only fingerprint. This proposal does not require or invent an assurance grant. |
| [erase-principal](../../../apps/server/src/modules/identity/erase-principal.js) | Refuses live grants, then revokes Sessions, and may redact/disable Person later. Session-before-Person differs from recovery order; do not claim universal deadlock freedom. Exercise erasure/regrant races, rollback victims and no-resurrection; approved erasure must also dispose recovery-owned custody. |
| [scope-service](../../../apps/server/src/modules/project-manager/application/scope-service.js) | Dynamic `tx[config.model].updateMany` mutates Tenant/Business state under CAS, not merely literal delegate calls. Lock and reread the exact scope rows; an archive or relation change serialized earlier denies recovery. |
| [Pipeline authority](../../../apps/server/src/modules/project-manager/application/pipeline-transaction.js), [writer](../../../apps/server/src/modules/project-manager/application/pipeline-writer.js) | Person/Membership/RoleBinding inputs are locked before Business/Tenant; native writes use Serializable transactions with bounded retry. This is prior art, not an injectable recovery grant or a shared global lock to acquire. Its order differs: contention must be tested; retries must retain current deadlines and contain DB work only. |
| Business [provisioning](../../../apps/server/src/modules/project-manager/application/business-provisioning-service.js), [capability](../../../apps/server/src/modules/business/application/business-capability-service.js), [Knowledge switch](../../../apps/server/src/modules/business/application/business-knowledge-candidates-service.js), [strategy mutation](../../../apps/server/src/modules/project-manager/application/business-strategy-mutation-service.js), [WIG execution](../../../apps/server/src/modules/project-manager/application/business-wig-execution-service.js) | Metadata/version updates also lock Business. They are contention inputs, not OWNER grants; no broad grant or unnecessary invalidation on every version change. |
| [onboarding](../../../apps/server/src/modules/identity/onboarding-service.js), [LINE link](../../../apps/server/src/modules/identity/link-line-identity.js), [membership grant](../../../apps/server/src/modules/identity/membership-grant-service.js) | Person display changes contend; inserted memberships can add authority but do not replace the locked witness. Resolve a valid witness afresh after any aborted transaction. |
| [FileAsset service](../../../apps/server/src/modules/project-manager/application/file-asset-service.js), [ProjectFile compatibility](../../../apps/server/src/modules/project-manager/application/project-file-service.js), [file API](../../../apps/server/src/app/api/files/route.js) | Caller blobRef is currently accepted on creation, the legacy DTO exposes it, ProjectFile stores it and migration copies it; deleted rows can retain it. Key secrecy is not exclusive custody. The new reserved-ref admission/cleanup fence below must cover both model families before cleanup is enabled. Local staging ACTIVE/QUARANTINED and local relink are LOCAL_FILE-only. Delete after recovery may win later; recovery may not resurrect it. CAS includes status/deletedAt/ref/hash/length and scope, not version alone. |
| [plan import](../../../apps/server/src/modules/project-manager/import/plan-import-service.js), [delta](../../../apps/server/src/modules/project-manager/import/plan-delta-service.js), [model allowlist](../../../apps/server/src/modules/project-manager/application/pipeline-state.js) | Generic delegates require classification: these graph entity allowlists do not mutate the five authority models. They still contend through Pipeline authority resolution. No new recovery writer is added to import envelopes. |
| [backup service](../../../apps/server/src/modules/project-manager/application/backup-service.js) | Replace-all uses dynamic delete/create and restores FileAsset statuses. It is not a concurrent Business writer admitted here: installation restore requires a separately approved maintenance/quiescence contract. Startup or fixture SQL is not recovery authority. |
| [plugin auth](../../../apps/server/src/modules/identity/plugin-auth-service.js) | Replay invalidates PluginSession, a different family; plugin identity is not accepted as the persisted cookie Session for this first slice. |

The proposed confirm lock order stays Tenant, Business, Person, qualifying
Membership, Session, operation, FileAsset. Locks conflict with ordinary updates
to those rows; after waiting, read current values rather than pre-lock snapshots.
No claim is made that existing writers use the same total order. Deadlock or
serialization victims roll back; return a bounded retry/conflict response, not
success. A failed revocation is not represented as successful revocation.
Retain existing transaction deadlines; do not increase timeout to hide a cycle.
Native acceptance must prove both victim outcomes for each cross-order writer.
If acceptable bounded behavior cannot be shown, the design must be revised before
activation; it is not permission to disable a writer or weaken authority.

Carry the server-trusted session ID and cookie token-hash binding into confirm,
then independently lock and recheck persisted Session identity/status/expiry,
Person access disablement, the actual OWNER witness role/status/scope/expiry and
ACTIVE Tenant/Business relationship. Use current database time after waiting,
with expiry predicates in the final CAS decision, never transaction-start time.
A trusted injection without persisted proof fails closed in every environment.
The same principal may resume under a different currently valid session; the
operation/token is never authority and the old session cannot authorize it.
The installation fence below precedes these locks but replaces none of them.

## Proposed transport v1

All paths below are **proposed, absent implementation**. They live under existing
File Management; installation CLI and imported plans acquire no write surface.
Use the existing persisted cookie Session, current OWNER authority and Identity
[API-write CSRF](../../../apps/server/src/modules/identity/api-write-csrf.js)
token/origin checks for every POST. A plugin-consent token is not this token.
Failures in session/configuration stores fail closed. Reject unknown JSON and
multipart fields and all client-supplied refs, keys, endpoints or credentials.

| Method/path | Strict request and result |
|---|---|
| POST `/api/files/{fileId}/recovery-operations` | JSON `{expectedVersion}`; authorize before disclosure. Derive the full tuple/purpose from the existing FileAsset, create server UUID PREPARED intent and 15-minute expiry; return operation ID, version, safe descriptor and expiry. No provider IO or FileAsset mutation. |
| POST `/api/files/{fileId}/recovery-operations/{operationId}/preview` | Multipart `descriptor` UTF-8 JSON and `content` bytes only. Authorize before consuming application bytes; stream-limit/spool privately, compute actual digest/length, match tuple/purpose/config, refuse expired/conflicting input. Return safe file summary, operation version and opaque confirmation binding. No provider PUT. |
| POST `/api/files/{fileId}/recovery-operations/{operationId}/stage` | JSON `{confirmationBinding, expectedOperationVersion}`. Live authorization and serialized operation attempt; persist unique key/intent before IO, then immutable PUT and exact-version GET verification. Return STAGED or explicit pending/unknown/quarantine; never a client ref. |
| POST `/api/files/{fileId}/recovery-operations/{operationId}/confirm` | Same strict JSON; live fenced confirm, FileAsset tuple CAS, one metadata version/audit/result transaction. Return `{operationId,state,fileId,fileVersion}`. Duplicate commit performs no new PUT, version increment or audit. |
| GET `/api/files/{fileId}/recovery-operations/{operationId}` | Current actor/scope authorization before disclosure; safe status/result/custody counts only, Cache-Control no-store. No provider IO and no binding/token/locator in response. |
| POST `/api/files/{fileId}/recovery-operations/{operationId}/inspect` | Empty strict JSON plus CSRF; authorize and inspect the known internal operation intent. Persist a verified receipt/outcome. No PUT, attachment or broad listing. Expired operations may be inspected for custody resolution, never renewed for confirm. |
| POST `/api/files/{fileId}/recovery-operations/{operationId}/abandon` | JSON `{expectedOperationVersion}` plus CSRF; make no attachment, record abandonment and exact cleanup obligations. Unknown provider outcomes retain unresolved custody and cannot be erased blindly. |

The descriptor has exactly `schemaVersion:1`, `fileId`, `fileVersion`, `tenantId`,
`businessId`, `purpose`, `sourceRefSha256`, `sha256` and `byteLength`. UUIDs,
positive integer versions, lowercase 64-hex hashes, safe nonnegative integer
length and purpose `asset|catalog` are validated strictly and compared with
server rows; scope fields are matching evidence only. No filename/path is needed.
Budget is 64 KiB descriptor and 32 MiB content, additionally bounded by the
existing owner policy (Asset currently 20 MiB). Actual streaming limits apply
even if Content-Length is absent/false; compression/archive parsing is refused.
Ingress must not buffer an unbounded body before the application guard.
Proposed admission limits are two unresolved operations per actor, eight per
Business and 64 per installation, plus 256 MiB total reserved private spool.
PREPARED and all unresolved custody states count, even after lease expiry;
abandonment does not release unresolved capacity. Before accepting preview
bytes, reserve the exact persisted expected length atomically against quota;
release the reservation only after owned spool deletion is confirmed. Concurrent
admission must not overbook via count-then-write races. Missing capacity refuses
with 429 before byte consumption/IO, never pruning someone else's custody. These
are proposed feature ceilings, not measured minimum-host or throughput claims.

The source bytes may be fetched through the existing authorized content route
while available, or supplied from an operator-held copy. Preparing metadata
does not assert source availability; a missing source cannot be exported and
does not excuse missing persisted hash/length. The supplied bytes always undergo
the same exact verification. Descriptor plus bytes remain private data, not a
public qualification artifact or a generic installation backup.

Confirmation binding is 32 random bytes generated server-side, with only its
digest stored and compared in constant time. Bind its durable record to actor,
operation, full expected tuple, purpose, configuration generation and expiry.
It is an operation token, never a credential or authority grant. Do not export,
log, snapshot or audit its clear value. One logical commit consumes it; an
authorized identical commit retry within its original expiry can retrieve the
durable matching result, but cannot trigger another write. After expiry use the
authorized GET result, never renew confirmation or recreate an operation using
a caller identity. Lost preview responses may rotate the binding only before
provider staging, atomically invalidating the prior one without extending expiry.

Errors are strict `{code,message,requestId,retryable}` with generic messages and
no nested causes/refs/SQL. Proposed statuses: 401 missing/invalid session; 403
CSRF/origin failure; uniform 404 for absent/foreign/no-current-authority operation
or file; 400 malformed/bad bytes; 413 byte budget; 409 tuple/config/state conflict;
410 expired eligible operation after authorization; 429 custody capacity;
503 unavailable store/provider
or retry-exhausted transaction. An ambiguous PUT returns an explicit UNKNOWN
operation outcome, not success or a generic retry instruction. Pending attempt
may return 202 with safe status. A missing or failed HTTP response is not evidence
that an external PUT rolled back; status/inspect must resolve its durable outcome.

The stage 202 payload is `{operationId,state,outcome,retryable:false}`:
STAGING uses outcome `IN_PROGRESS`; UNKNOWN uses `RECONCILIATION_REQUIRED`.
It directs authorized polling/inspection, never blind resubmission of bytes.
Failed/expired workers cannot attach a late receipt or claim response success.
Committed confirm retries and GET expose a safe result with `targetCurrent` and
`availability`. A later ref change or deletion yields a historical committed
result (`targetCurrent:false`), not current recovery success. Authorize this
history by the operation's actor and current Business ownership even if its
file is tombstoned; absence/foreign scope remains uniform 404. GET performs no
provider IO and reports availability `NOT_CHECKED`. Confirm's post-commit
exact-version read may report `VERIFIED` at its checked time or persist/report
`RECOVERY_REQUIRED`; it never undoes the committed tuple or audit. No historical
result or prior byte check is an ongoing availability guarantee.

## Proposed persistence and retention

Propose a PM-owned `ManagedBlobRecoveryOperation` journal and a singleton
`ManagedBlobRecoveryInstallationFence`, with their repositories; no new service
or Identity grant family. Adoption precedes actual Prisma/baseline work.
The model has server UUID, actor/tenant/business/file IDs, immutable expected
tuple, purpose/config generation, internal destination key, expected bytes/hash,
private spool locator, state/version, attempt history (at most two PUT attempts),
confirmation digest/expiry, worker ID, claim epoch, lease deadline, heartbeat,
attempt number/deadline, installation generation, exact immutable receipt if known, outcome/result,
cleanup/custody flags and created/updated/closed timestamps. Enforce operation
identity uniqueness and actor/scope indexes; immutable binding fields cannot be
patched by ordinary routes. AuditEvent remains immutable evidence, not a journal.
Identity/scope/file UUIDs are scalar provenance, not cascading foreign keys into
snapshot-replaced authority tables; every API still resolves current authority
and actual target rows. Erasure uses the explicit adapter below.

Claim an attempt by transactional state/version CAS and a new server-generated
worker ID/monotonic epoch. Proposed coordination lease: 30 seconds, renewed at
most every 10 seconds only by that same epoch while live. Attempt deadline is
bounded by the original operation expiry and existing provider/transport deadline;
renewal extends neither. This is coordination, not an increase of any test or
provider timeout. Persist the claim before IO, allow at most one live worker and
two total PUT attempts. A response may update the journal only under its current
epoch/state CAS. Lease expiry with a possibly issued PUT becomes UNKNOWN by
reconciliation CAS, never PREPARED; it does not prove the process or PUT stopped.
New claims permit scoped inspection first, with retry PUT only under the admitted
conditionality rule. Late workers fail the epoch CAS and cannot attach or overwrite
newer state. Crash recovery must inspect the known intent rather than stay stuck
in STAGING or infer that an expired worker never wrote.

Use durable private shared staging under the selected Compact data directory,
outside static serving/cache, with restricted filesystem permissions and bounded
quota. Persist the staging receipt after writing/closing/hash verification and
atomic promotion; reconcile a crash before journal attachment using operation-
owned staging IDs. Do not assume a container-local temporary file survives a
restart. Missing/unverified spool denies stage; no fallback to host path input.
Do not make a put while holding metadata/authority row locks.

Each provider attempt is journaled before IO. Normal path permits one original
PUT. At most one conditional retry of the same intent/key/exact bytes is allowed
only after matching selected-provider proof is admitted and the original lease
is live; preserve the [draft UNKNOWN transition](../../plans/COMPACT-MANAGED-BLOB-RECOVERY-20261029.md#separate-selected-provider-proof-contract).
DB transaction retry never replays external PUT. Worker lease expiry means
UNKNOWN, not permission to send again. No proof means quarantine and zero retry
PUT. A verified receipt is checked by exact-version GET; HEAD alone is insufficient.

Proposed retention choices, deliberately separate from unrelated usage policies:

- Confirmation lease: 15 minutes from preparation, never extended by retry.
- Uploaded private spool: remove on committed/abandoned exact custody release,
  and no later than 24 hours after preparation. After deletion, no new PUT can
  occur without a fresh operation. Expiry cannot cause a ref attachment.
- Terminal resolved operation metadata/results: retain at most 30 days after
  closure, then remove through the PM-owned retention job. Audit retains only
  already-adopted sanitized evidence; this does not change global audit retention.
- UNKNOWN/unresolved custody: remove spool at its byte deadline but retain only
  the minimal scoped intent/key/receipt obligations until accounted for. No
  indefinite copy of uploaded bytes, descriptive metadata or confirmation secret.
  This is an explicit unresolved-custody exception, not a blanket retention pass.
  Keep its age/count visible to authorized owners, and require explicit resolution.

TTL is not a storage bound. Propose a hard 128 MiB per-Business and 512 MiB
installation-wide budget for recovery-owned journal/results plus its reserved
and retained audit footprint, including terminal operations. Each operation
reserves at most 16 KiB journal/result and 16 sanitized audit events of at most
2 KiB each before admission. Unchanged polling/inspection creates no audit row;
reserve the final two event slots for closure/custody resolution. Bound every
internal record field and reject oversized provider receipts rather than store
raw errors. Quota accounting and reservations are atomic in the installation
fence transaction, so rapid create/resolve cycles cannot evade the cap. Refuse
new preparation with 429 if full; existing reconciliation/cleanup uses its
reserved capacity and is not blocked from resolving custody. Release unused
reservations at closure and journal space after its retention deletion, but do
not delete or stop counting immutable retained audit evidence to free capacity.
Consequently a long-lived installation may reach this feature's hard ceiling;
further growth then requires a separately adopted archive/retention policy.
These ceilings cover this feature, not total application logs/storage or a
hardware-minimum claim, and never shorten existing audit/erasure obligations.

The proposed bounded maintenance worker may dispose only recovery-owned spool
and known unreferenced exact target versions, and inspect operation-owned intents;
it cannot read unrelated Business content, change FileAsset, issue grants or
publish bytes. Maintenance is server-controlled custody policy, not an operator
Business-read bypass. Revoked users cannot use it as an API. Never delete source
objects, a committed/currently referenced target, or an unknown version. Cleanup
is fenced against confirm, retries and any reference attachment; inability to
prove exclusive ownership/unreferenced status leaves CLEANUP_PENDING visible.
Lifecycle rules or a TTL on the provider bucket cannot substitute for this fence.

**Reserved attachment invariant:** propose generated target keys under the
existing purpose namespace, followed by Tenant/Business and a reserved
`recovery/{operationId}/{randomSegment}` suffix. Preserve the private-business
port's segment, purpose and scope validation. Before enabling writes, inspect
existing metadata for reserved-prefix collisions and refuse activation rather
than silently reclassify existing user refs. The prefix is not an access secret.
All FileAsset and legacy ProjectFile attachment paths, including migration and
domain callers of the shared writer, must reject caller-supplied recovery refs.
Only the exact operation's confirm transaction can attach its verified target
to the one bound FileAsset, except for the explicit verified target-local backup
transfer mapping defined below. Normal FileLinks to that FileAsset remain allowed;
they do not create another object owner. Reserve this rule for recovery targets;
it does not remove existing general managed-ref behavior for other namespaces.

Cleanup locks the same operation and its bound FileAsset, verifies no commit or
attempt can still attach, and checks **both FileAsset and ProjectFile**, including
retained soft-deleted rows, for the exact key/version. While this fence holds,
no new reference to that target may be admitted. Persist a cleanup claim before
provider delete outside the DB transaction; all later attachment/confirm must
refuse a claimed target even after worker crash/lease expiry. Record delete
outcome durably; an unknown delete outcome remains inspectable, not success.
An already referenced or insufficiently classified version stays retained.
Until every relevant attachment writer participates and native attach/confirm/
cleanup races pass, **automated provider cleanup remains disabled**; a query
which happened to find zero rows is not sufficient. This is part of the new
recovery contract, not a claim about existing attachment guards.

### Proposed shared snapshot/recovery exclusion

The current [import route](../../../apps/server/src/app/api/backup/import/route.js)
calls `importSnapshot`; no recovery fence exists there. The backup service's
replace-all transaction and later status reconciliation can race this proposed
journal, which is not part of that snapshot. An external-scope label or manual
promise is insufficient. Before enabling recovery or provider cleanup, require:

1. The singleton fence stores mode, monotonic generation, restore attempt ID and
   quota accounting outside replace-all snapshots. Missing/inconsistent fence
   fails closed. Only the approved fresh-target baseline may initialize READY;
   no runtime startup repair, implicit migration or reset is introduced.
2. Every recovery preparation/claim/confirm/cleanup transaction locks/checks this
   row before its normal row locks and captures its READY generation. Journal
   intent precedes any byte/provider effect. UNKNOWN, streaming/attempt leases,
   cleanup claims and retained unresolved custody all count as unresolved even
   after expiry; do not clear them merely to admit restore.
3. `importSnapshot` itself, including non-HTTP callers, first retains its existing
   operator, preview/confirm and refusal guards. Under the same fence row lock,
   refuse if mode is not READY or any unresolved recovery work exists. Inspect
   imported FileAsset **and ProjectFile** refs and reject every reserved recovery
   namespace ref, including deleted rows, unless a separately reviewed transfer
   contract admits them. A same-prefix caller string is not transfer evidence.
4. Before destructive writes, durably enter RESTORING, increment generation and
   bind the attempt ID while admissions are excluded. Keep that mode through
   replace-all **and** post-transaction FileAsset status reconciliation. An
   already completed receipt survives as historical evidence, not a rebind grant.
   Any failure/crash keeps a failed/needs-admission mode; no finally block resets
   READY or clears custody. Actual installation restore remains separately gated.
5. Successful import enters NEEDS_ADMISSION rather than READY. A separately
   approved restored-target authority/erasure/provenance procedure must explicitly
   admit the new generation before any new recovery action. Old operation
   generations can supply authorized historical status only; no provider effect,
   attachment, confirmation or cleanup can resume across that boundary.
6. `exportSnapshot` itself, including non-HTTP callers, must participate too.
   The existing [export route](../../../apps/server/src/app/api/backup/export/route.js)
   and Serializable extraction currently have no such guard. Inside that same
   extraction transaction, acquire the singleton fence exclusively, check READY
   and zero unresolved custody/claims, and retain the fence through complete
   extraction. All recovery admissions/claims/confirmations/cleanup acquire the
   conflicting fence before their work, so a count check cannot race a new
   operation. On success release only after the immutable extraction is complete;
   on failure roll back without an export. Do not add a nontransactional fallback
   or raise existing extraction deadlines to accommodate contention.
7. While no recovery transfer contract exists, reject full snapshot export if
   either extracted FileAsset or ProjectFile has any reserved recovery ref,
   including retained tombstones; never strip rows/refs or silently present an
   unreplayable recovery snapshot as a complete backup. Keep journal, spool and
   fence out of generic exports and imports. This is a proposed conservative
   compatibility guard: after recovery creates such a ref, full snapshot export
   cannot resume until the separately reviewed transfer/backup contract admits
   it. The owner selected the transfer design below before activation, so this
   fallback may not be shipped as a loss of normal backup capability. This
   proposal does not claim full installation backup/restore parity. Ordinary
   targets without recovery work/refs retain their existing snapshot behavior.

This fence is a proposed runtime custody/exclusion primitive, not a global
authorization grant or developer delivery controller. It must be excluded from
generic snapshot replace-all together with the journal, and all current import
paths must participate. A direct DBA/script replacement while the runtime is
active is outside the admitted environment. Native tests must prove both orders
of preparation, in-flight PUT, late worker, confirmation, cleanup and import/export,
plus crashes before/inside/after replace-all and its postpass. Until implemented
and proved, this prerequisite is **ABSENT/OPEN**, recovery/cleanup activation is
disabled, and this document does not qualify PostgreSQL installation restore.

FR-022/Identity erasure must receive a PM-owned adapter to redact actor references
and dispose operation-owned byte custody under the existing erasure transaction/
outcome contract. Erasure may not silently erase UNKNOWN obligations or grant
access to another actor. This integration and its legal-hold precedence must be
reviewed before enabling retention/cleanup. No recovery row or spool is admitted
to installation backup/export until its dedicated restoration/erasure contract
exists: reject an export containing unresolved recovery custody rather than
silently pretending it is a complete recoverable backup. Do not add a new model
to generic snapshot replace-all by convention.

## Backup transfer prerequisite — selected design, not implemented

### Compatibility and authority

Current snapshots use schema `1.0`; `includeBinaryContent` packages local files,
not these managed S3 originals. Keep that JSON schema and old no-recovery/local
snapshot behavior, remount semantics and every Phase B, Marketing, pricing,
Knowledge, archive/erasure and credential refusal. Do not weaken a family guard
to make transfer pass. A source with reserved recovery refs needs a supported
complete export/restore path **before recovery is enabled**.

Propose `compact-managed-blob-backup.v1`, a versioned package around unchanged
snapshot JSON and verified original-byte sidecars. The normal operator backup
UI automatically selects this format when reserved refs exist; restore previews
and confirms the complete package. Legacy JSON-only requests may fail closed
with a specific format-required outcome and safe UI handoff, never an incomplete
success. Targets without recovery refs retain existing JSON behavior. Acceptance
must prove the normal operator workflow can still back up and restore; manual
SQL, missing sidecars or a permanently disabled export is not that workflow.

Installation export and replace-all restore retain **FR-075 operator** authority
and audited use. Per-file recovery still requires a Business OWNER. Do not
fabricate an owner Viewer to call it or compose ownership into operator authority.
Identity must resolve/recheck the persisted session and live installation grant
before each privileged phase and immediately before metadata replacement.
Internal restore context is derived from a durable local job, current authority,
target generation and verified package digest, never an uploaded flag or grant.
The byte port is a scoped transport, not the authority decision. PM owns this
compatibility transfer; standalone Files/FileOperation and cohorts are unchanged.

### Typed package and bounds

Use an uncompressed flat TAR allowing regular files `transfer.json`,
`snapshot.json` and manifest-listed `obj_<UUID>.bin` only. Parse into server-named
owned staging slots without extracting supplied paths. Refuse duplicate/unlisted
entries, links, devices, directories, PAX/GNU extensions, compression, unexpected
trailing records, unknown fields, versions or inconsistent counts/lengths. This
is a specific backup decoder, not a generic archive/import tool.

**Canonical bytes v1:** snapshot JSON is captured once using its existing
JSON-serializable representation, including existing Date/Decimal serialization,
then encoded by the code-point-key-sorted
[`canonicalJSON`](../../../apps/server/src/modules/project-manager/application/handoff-contract.js)
rules: compact UTF-8, no BOM or trailing newline, finite JSON values only.
Preserve table/array order, every included field, null and omission; do not
silently add defaults, reorder row arrays or coerce date strings on import.
Reject duplicate JSON keys and unsupported numeric/value representations before
hashing. Row digests use that same canonical encoding of the **entire serialized
row**, not a handpicked projection. Validate exact original snapshot bytes against
their manifest digest before any parse/reserialize transformation. Retried export
uses its sealed bytes; the UI must not pretty-stringify the transfer payload.

Manifest object keys use the same encoding; entries sort by object UUID and
bindings by model then row ID using the same code-point comparison. Source refs
must pass the private-business port's `parseBusinessObjectRef` canonical encoding
and scope checks; reject alternate encodings, not URL-normalize them into aliases.
The ref digest is SHA256 of its validated canonical UTF-8 ref string. Imported
row digests are checked before replacing refs; target mappings do not alter the
sealed source snapshot or its digest.

TAR is canonical ustar: `transfer.json`, `snapshot.json`, then object entry names
in UUID order; each is a regular file with mode 0600, uid/gid/mtime zero, empty
user/group/link/prefix fields, valid octal size and header checksum. Refuse
noncanonical headers, entry order or padding. Bodies have zero padding to the
next 512-byte boundary, followed by exactly two zero end blocks and no extra
records. Golden byte fixtures for empty/single/multiple entries, Unicode JSON,
dates/nulls and adversarial headers are required before protocol implementation
is accepted. The snapshot and package digests bind these exact bytes, not a
semantically similar archive produced by another serializer.

The 512-byte ustar header layout is fixed, not producer-dependent: name[100]
is the allowed ASCII filename followed by zero bytes; mode[8] is `0000600`
plus NUL; uid[8]/gid[8] are `0000000` plus NUL; size[12] is eleven zero-padded
octal digits plus NUL; mtime[12] is eleven zero digits plus NUL. Typeflag[1]
is ASCII `0`, linkname[100] is zero, magic[6] is `ustar` plus NUL, version[2]
is ASCII `00`; uname[32]/gname[32] are zero. Devmajor[8]/devminor[8] are
`0000000` plus NUL; prefix[155] and final padding[12] are zero. Checksum[8]
is six zero-padded octal digits, NUL, then ASCII space, calculated as the
unsigned sum of all 512 header bytes with those eight checksum bytes treated
as ASCII spaces. No alternative regular-file flag or numeric encoding is valid.

Strict `transfer.json` carries schema version, source revision/time, exact
snapshot-byte SHA256, source selection/configuration-generation digest, entry
count/total bytes and per-entry UUID, byte hash/length, purpose and ordered row
bindings. Each binding has model `fileAsset|projectFile`, ID, derived Tenant/
Business, canonical source-row SHA256 and normalized exact source-ref digest.
Cover every reserved ref in both table families, including tombstones; reject
missing/extra/duplicate bindings. Derive ProjectFile scope through its snapshot
Project/Workspace/Business graph. A legacy alias must match a verified FileAsset
content witness; missing evidence is unsupported, not a skipped row. Deduplicate
a shared exact ref only when every scope/row/content witness agrees. Hash-equal
bytes across scopes do not merge authority.

The following is the closed v1 wire schema. Every listed property is required;
none accepts null, omitted values or additional properties. `SHA` means exactly
64 lowercase hex characters, `UUID` a lowercase hyphenated UUID string, `UINT`
a nonnegative safe JSON integer, and `POSINT` a positive safe JSON integer.
No coercion is permitted. Array/profile limits apply before allocation.

| Object | Required properties and types |
|---|---|
| Manifest root | `schemaVersion`: literal `compact-managed-blob-backup.v1`; `sourceRevision`: 40 lowercase hex characters; `exportedAt`: UTC timestamp exactly `YYYY-MM-DDTHH:mm:ss.sssZ` and a valid calendar instant; `snapshotSha256`: SHA; `sourceGeneration`: POSINT; `sourceConfigSha256`: SHA; `entryCount`: UINT; `totalOriginalBytes`: UINT; `entries`: array of Entry. |
| Entry | `objectId`: server-generated UUID; `sha256`: SHA; `byteLength`: UINT; `purpose`: literal `asset` or `catalog`; `bindings`: nonempty array of Binding. Its TAR filename is exactly `obj_<objectId>.bin`, never a separate caller-controlled path field. |
| Binding | `model`: literal `fileAsset` or `projectFile`; `id`: UUID; `tenantId`: UUID; `businessId`: UUID; `sourceRowSha256`: SHA; `sourceRefSha256`: SHA. Scope must match the verified snapshot graph, not merely validate as UUIDs. |

`entryCount` equals entries.length and `totalOriginalBytes` equals the exact
sum of entry.byteLength without integer overflow. Object IDs are unique; each
model/row ID binding appears exactly once in the manifest. A shared source ref
therefore has one entry with all its verified aliases. Source config digest is
the SHA256 of canonical JSON `{generation,asset,catalog}` captured by the server:
generation equals sourceGeneration; each purpose is `{provider,bucket,namespace,
configurationRevision}` for its admitted selection or null if unconfigured.
Provider is `s3`, bucket/namespace are exact validated port strings, and
configurationRevision is a server-owned UUID changed on every endpoint,
credential, bucket or other selection change. That private tuple is retained in
the local export intent, not uploaded as authority or exposed in the manifest.
No runtime credentials enter the digest input. The manifest digest cannot
authorize using the same selection on a target. Package SHA256 is over the
entire sealed TAR and delivered out of band; it is not a self-referential field.

Source refs are matching evidence, not import routing. The package contains no
provider endpoint/credential, destination ref, confirmation secret, worker lease,
journal or fence. Hashes prove consistency, not trusted origin, current authority
or erasure compliance; all uploaded data still undergoes existing validation.
Require a finite, explicitly configured qualification profile for snapshot/
manifest bytes, entry count, total package/staging bytes and job duration; only
one active transfer job per installation. Each original retains the 32 MiB/owner
policy bound. Reserve capacity before copy/upload and enforce actual streamed
counts/bytes. Retain existing provider/transport deadlines. A missing/unsupported
profile or insufficient capacity fails preflight, never prunes unresolved custody
or claims a complete backup. Freeze actual profile limits in TEST evidence; they
are not a hardware minimum. Transfer control/result/audit capacity uses the
bounded accounting above; payload disk quota is a separately reserved backup
budget. Activation must demonstrate the selected target fits that profile.

### Export and restore protocol

Propose PM-owned `ManagedBlobBackupTransferJob` and entry receipts, excluded from
generic snapshots. Persist actor, mode, source/target generation, package/snapshot
digests, immutable bindings, per-entry intent/status/receipt and worker epoch/
deadline/result/custody. Never resume an imported job as a local worker or grant.
Apply the existing lease/UNKNOWN/late-worker and unknown-delete rules per entry;
DB retries never replay provider IO. Each restore entry permits at most two PUTs,
the second only under admitted exact-provider conditionality proof; otherwise
inspect/quarantine. Provider IO never holds a metadata row transaction.

### Proposed HTTP and consumer contract

Every endpoint below is proposed, operator-only, persisted-session-bound and
no-store. POSTs use existing API-write CSRF/origin validation **before** body
consumption; the binary upload carries that token in `X-Zuri-API-Write-CSRF`.
Use strict DTOs and the existing generic error envelope/status policy above.
UUIDs, positive safe-integer versions/generations and lowercase SHA256 are bounded
and validated; no request contains a provider ref, grant, credential or spool path.

| Method/path | Request and safe result |
|---|---|
| POST `/api/backup/transfers/export` | JSON `{format:"compact-managed-blob-backup.v1",includeBinaryContent:boolean,expectedGeneration:integer}`. Creates server UUID/epoch and immutable export selection; 202 job DTO. |
| POST `/api/backup/transfers/preview` | Raw `application/x-tar` upload under the configured streamed limits, plus CSRF header. Creates a target-local RESTORE preview job; returns `{job:JobDTO,confirmationBinding}` including jobId/jobVersion, validated counts/digests and target generation. The opaque single-use confirmationBinding binds the target configuration too and expires at job.expiresAt, 15 minutes after preview. Failed/partial upload never becomes a valid preview. |
| GET `/api/backup/transfers/{jobId}` | Live operator authorization, then safe job DTO/result; no provider IO and no confirmation token. |
| GET `/api/backup/transfers/{jobId}/package` | Only COMPLETE EXPORT job, same authorized actor; streams canonical TAR with attachment headers and package digest. Never serves partial/expired artifacts. |
| POST `/api/backup/transfers/{jobId}/confirm` | JSON `{confirmationBinding,expectedJobVersion}`. Live operator plus matching RESTORE preview/package/generation; persist target-local attempt before work and return 202 status. Duplicate committed confirm reads durable result, never repeats replacement. |
| POST `/api/backup/transfers/{jobId}/inspect` | Empty strict JSON. Reauthorize and reconcile the exact local job/entry intents; no blind PUT or generic listing. |
| POST `/api/backup/transfers/{jobId}/abandon` | JSON `{expectedJobVersion}`. Records a non-attaching outcome and exact custody obligations; no unknown-version deletion. |

Job DTO fields are `jobId`, `kind:EXPORT|RESTORE`, `jobVersion`, `generation`,
`state`, `snapshotSha256`, `packageSha256`, `counts`, `expiresAt`, `outcome` and
`retryable`. Digests are null only before sealed verification. Counts contain
bounded table/entry/byte totals, not row IDs/refs. State is one of PREPARED,
COPYING, PREVIEWED, RESTORING, UNKNOWN, METADATA_COMMITTED, NEEDS_ADMISSION,
COMPLETE, FAILED or ABANDONED. Outcomes separately identify metadata commit,
byte verification, postpass and admission as pending/passed/failed/not-applicable.
202 with UNKNOWN means reconciliation required and `retryable:false`, never
permission to resend bytes. Confirmation tokens use the scoped digest/single-use
rules above and never extend expiry. Fresh sessions for the same currently
authorized operator can resume status/inspection. Capture a unique active job
in the singleton; preparation/preview owns its admission slot, so restore confirm
excludes **other** jobs/custody without rejecting its own bound preview. Stale
generation/config or foreign/expired confirmation fails without effects.

Current [Backup UI](../../../apps/server/src/app/%28pm%29/backup/page.jsx) downloads
JSON and pastes JSON for preview/confirm; it does not implement this workflow.
Migration must add TAR download/upload/validation/status and format-required
handoff, retain old JSON/remount controls, and never stringify a sealed package.
`includeBinaryContent` still controls **LOCAL_FILE only**; it never suppresses
mandatory reserved MANAGED_BLOB originals, even when the checkbox is false.
The existing [PostgreSQL migration utility](../../../apps/server/scripts/migrate-to-postgres.mjs)
calls snapshot services directly. It is legacy JSON-only, not an authorized
transfer bypass: detect reserved refs and fail before writes unless upgraded to
the same verified transfer orchestration and real operator authority. Do not
invent an owner/operator Viewer to make that script pass. Inventory all supported
UI/CLI/automation consumers for the selected target before activation and migrate
each relied-on backup consumer; an excluded old utility cannot be its only
supported backup path. No script, migration or production command is run here.

The supported Phase B CLI pair also needs an explicit compatibility boundary:
[`phase-b-protected-export.mjs`](../../../apps/server/scripts/phase-b-protected-export.mjs)
and [`phase-b-clean-target-restore.mjs`](../../../apps/server/scripts/phase-b-clean-target-restore.mjs)
use [`phase-b-recovery-hooks.mjs`](../../../apps/server/scripts/phase-b-recovery-hooks.mjs)
and [`phase-b-recovery.mjs`](../../../apps/server/scripts/phase-b-recovery.mjs)
to call extractSnapshot/insertSnapshotIntoEmptyTarget outside the operator UI.
Under the existing [Phase B decision](../../architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md),
their protected JSON artifact is not a managed-blob byte-transfer package.
Before recovery activation, require reserved-ref detection in those underlying
export and empty-target insert boundaries too: refuse before artifact publication
or any target write if either snapshot table contains a reserved ref. Do not
silently omit rows/bytes or bypass that refusal via direct hooks. Preserve their
current no-recovery behavior, clean-target/process-only admission, protected-family
guards and no-audit insertion semantics. Supporting reserved refs there needs a
separately adopted Phase B transfer adaptation and proof; this proposal grants
no such adaptation or installation restore qualification. If a selected target
relies on these CLIs, activation must provide its supported complete backup path
through the adopted operator workflow, or wait for that separate adaptation.

| Phase | Required ordering and outcome |
|---|---|
| Export capture | Reauthorize operator, lock singleton, require READY and no unresolved recovery/transfer custody. Durably enter EXPORTING and capture a consistent snapshot plus complete row/ref inventory in its extraction transaction. This is the metadata snapshot point, not proof of byte availability. |
| Export originals | Seal snapshot/manifest intent privately, then read each captured immutable version through its pinned source configuration outside the DB transaction. Verify actual hash/length, copy into owned staging and journal verified sidecars. No latest/fallback/live-row substitution or missing-byte success. |
| Export completion | Verify the entire package and every digest/count before COMPLETE and download receipt. Keep recovery, cleanup and restore excluded while copying refs. External provider deletion remains possible and makes export fail, not complete. Release EXPORTING only through durable completion/abandonment and accounted custody; lease expiry alone is not proof IO stopped. |
| Restore preview | Privately stage/decode/verify the package, every row/byte/coverage binding and all existing snapshot refusals. Operator-only dry run shows table/byte counts, target configuration choices, remount effects and admission prerequisites. Explicit confirmation binds package digest, target generation/config and expected live state. |
| Restore admission | Require the separately approved target restore/provenance and current authority/erasure policy **before destructive replacement**. Uploaded manifests/grants are not that admission. If unavailable, no replacement or content activation; keep transfer/installation restore unqualified. No implicit identity/secret bootstrap. |
| Restore originals | Under live operator authority and the shared fence, create a new target-local job and enter RESTORING. Persist fresh target keys/intent per entry before PUT; target bucket/provider/purpose/generation come only from trusted configuration. Stage actual bytes and verify exact-version GET. Never overwrite/delete source objects; uncertain PUTs remain inspectable/quarantined. |
| Metadata commit | After all target receipts are durable/verified, derive an internal mapping from exact source row/ref digests to receipts. Recheck package, current operator, generation and every family guard in the same metadata transaction. The backup orchestrator applies mapping through PM reserved-ref admission during its approved table replacement, with audit and durable result in that transaction. Preserve IDs, scope, links, hashes/length/MIME and consumer lineage. Map every alias/tombstone or refuse the whole replacement; the original package remains unchanged. |
| Post-commit | Keep RESTORING through existing postpass; it must not rewrite mapped refs/statuses as legacy local files. Verify recorded target refs/content, then mark NEEDS_ADMISSION until all separately required restored-target checks pass. A lost response never replays replace-all. Failed read/postpass preserves committed evidence and reports degraded/recovery-required, not rollback/success. Restored/changed sessions require fresh authentication; old tokens/jobs are not grants. |

`importSnapshot` accepts the reserved namespace only for the matching internal
job/context and complete verified mapping; plain JSON refs or caller destination
maps remain refused. Generic delete/create must leave local journal, fence, jobs
and entry receipts intact. No fixture SQL or serialized bypass is an alternative.
DB/audit/result failure rolls back metadata, not previously staged S3 objects;
journal exact owned cleanup obligations and preserve uncertain outcomes. A fresh
authenticated operator can resolve durable results; the prior session cannot
authorize subsequent work merely because it started restore.

That durable, target-local, currently operator-authorized context is the **sole
internal reserved-ref import exception**, limited to package-bound rows after
every existing family guard passes. It cannot be invoked by uploaded flags/maps
or the Business-owner per-file confirm path. Restore reconstructs the incoming
FileAsset/ProjectFile versions exactly and records the ref transformation under
the target generation/job mapping audit in the same replacement transaction.
Do not synthesize per-file recovery audits/version increments for restored rows;
they are different actions. The new generation and binding checks invalidate
stale contexts without breaking snapshot consumer version references.

Operator download is session/authority-bound with no-store headers, no public
URL/raw spool path and explicit completion/digest receipt. Interrupted downloads
are not completed backups. Preview declares artifact expiry and owned-spool
cleanup; use the existing 24-hour private-byte ceiling, never indefinite payload
retention. Accounted read-only export spool can be discarded to release quota;
unknown restore PUTs remain separate custody. Source operation tokens/leases/
journals are never needed to attach a verified original on the target. Transfer
immutable data evidence only; create fresh local control state and refs.

### Activation gate and evidence

Do not enable ordinary recovery outside the disposable qualification lane until
the adopted transfer contract is
implemented and the normal operator workflow has a proven backup round trip
for reserved refs on the qualified profile. There is no exception flag permitting
temporary loss of full backup. Unsupported/malformed/unauthorized requests still
fail closed. Target configuration, metadata commit, bytes, postpass and admission
are separate outcomes; an incomplete component cannot be reported as full success.

To avoid a circular acceptance prerequisite, a separately selected source-bound
disposable TEST lane may exercise the actual product ingestion/recovery/transfer
path while qualifying the combined release. Bind it to owned isolated databases,
provider instances, exact image/profile and synthetic data, with explicit TEST
restore/provenance admission. Establish real persisted sessions and OWNER/operator
grants through supported provisioning. No fixture ref remap, invented Viewer,
disabled authority/CSRF/protected-family guard or assertion that a target is TEST
merely because a caller labels it so. Its evidence grants no ordinary/production
activation; all production restore/admission and broader release gates remain.

On disposable TEST targets, use product ingestion and per-file recovery, supported
export, new-target transfer restore and actual content/Asset/catalog reads. Prove
legacy no-recovery JSON and local-content behavior unchanged. Cover multiple
entries, both purposes, same-ref aliases/tombstones, missing/corrupt/extra/reordered
entries, path/link records, target binding changes and source-provider absence
after export. No unlisted row may be mapped, no required row lost. Exercise
prepare/export/import/cleanup in both race orders, quota/expiry, erasure refusal,
lost responses, crashes at each job/PUT/commit/postpass boundary, both conditional
PUT winner orders and unqualified-provider quarantine. Verify original objects
untouched, exact cleanup and new authentication/admission. Every applicable
Phase B/Marketing/pricing/secret refusal must remain a refusal, not a test bypass.

Bind evidence to exact source/package/manifest/image/provider/command/profile
identities and actual cases. Native/provider tests are NOT_RUN in this document
task. Bounded transfer acceptance does not qualify aggregate operatorRecovery,
all PostgreSQL installation restoration, off-host failure domains, AI, Knowledge
or production. Those gates remain separate and cannot be closed by a fixture.

## Canonical issuance candidate and acceptance

Propose **two standalone authored FR subjects, delivery planned**, under PM/File
Management ownership: per-file recovery and backup transfer. No FEAT membership
is issued; FEAT-001 links remain navigation only.
This matches the current add-only writer's standalone scope and avoids changing
FR-045's pinned local/SQLite subject. Select a fresh unreserved FR ID against
committed main only after design approval; this proposal allocates none.

Proposed statement text (no issued ID):

> Managed-blob operator recovery on a Compact PostgreSQL target lets a currently
> authorized Business owner prepare, preview, stage and explicitly confirm one
> existing active Asset/catalog FileAsset using exact persisted content evidence.
> The operation preserves identity, scope and consumer links while atomically
> committing one ref/version, durable result and redacted audit under current
> persisted-session and ownership fences. Durable operation custody distinguishes
> ambiguous external writes from failed writes; unqualified provider retries are
> refused, known cleanup is exact and scoped, and missing post-commit bytes fail
> closed as recovery-required. Installation restore, changed bytes, cross-scope
> moves and AI qualification are not conferred.

| Acceptance family | Required actual proof after separately selected implementation |
|---|---|
| Authority | Real persisted cookie sessions; direct/Tenant OWNER and negative RoleBinding/operator cases; every inventoried invalidation in both orders; expiry after wait; no stale pre-lock authorization. |
| Metadata | Expected complete tuple and live operation CAS; duplicate/lost response and delete/change races; audit/result failure rolls back; preserve Asset/catalog lineage. |
| Bytes/provider | Strict real-byte hashing/stream budgets; scope/purpose/config refusal; no current/latest/null-version shortcut; both delayed PUT winner orders with inventory/version evidence before retry admission. |
| Custody | Restart/crash at spool, intent, PUT, receipt, DB commit and cleanup boundaries; two PUT maximum; unknown quarantine without proof; expiry, result retention, erasure and cleanup/confirm races; no source/shared deletion. |
| Product boundary | Supported HTTP/UI path with CSRF, no-store and safe DTO/errors; no fixture SQL, injected Viewer authority, imported-plan or installation CLI writer. |
| Compatibility | Existing local FileAsset, snapshot/secret guards, Asset evidence and pricing-catalog consumers; fresh Compact PostgreSQL baseline plus canonical registry/reader/governance checks. |

Second proposed subject text (no issued ID):

> Managed-blob backup transfer preserves complete original-byte and metadata
> evidence for reserved recovery refs through a bounded operator export/preview/
> confirm workflow, excluding source runtime authority and control state. A
> validated package binds every FileAsset/ProjectFile ref and byte witness;
> target-local jobs derive verified immutable refs from trusted target selection
> and commit their mapping with the authorized metadata replacement, audit and
> durable result. Existing snapshot refusals remain enforced. Recovery activation
> requires this supported backup round trip; transfer does not grant per-Business
> authority or qualify whole-installation restore, AI or production.

Adoption must use the current [canonical authored-record workflow](../../migrations/document-reintegration/CANONICAL-FORMAT.md#additive-authored-records--approved-writer-scope-2026-10-05):
approved committed source, collision-free manifest, read-only plan, independent
candidate review, sanctioned apply/ID writer, generated exports and receipt.
Do not relabel this proposed note as approval evidence or hand-edit hashes to
make that writer accept it. Earlier reviewed draft commits remain provenance.

## OR0 disposition and next gate

This package selects concrete **proposed** routes/schema/retention and classifies
the runtime writer surface at its source revision. It replaces no source code,
does not assert a universal lock hierarchy and has run no native/provider test.
OR0 adoption remains OPEN pending contract decision, canonical issuance and
independent review of that exact composed migration. Actual authority/custody
and provider proofs remain implementation/enablement gates, not document checks.
The existing candidate plan stays candidate with implementation_authorized false.
No production, live LINE, Knowledge checkout or AI qualification is selected.

The owner-selected backup transfer prerequisite is now specified for review;
its implementation, normal-backup compatibility acceptance and target restore
admission are NOT_RUN/OPEN. Owner scope selection is not canonical adoption or
permission to activate either workflow.

## Version diff and parent/peer impact

0 → 0.1.0: initial proposed intake resolves technical transport, journal/lease,
retention/quota and writer-classification choices for review. It adds reserved
attachment admission and restore exclusion obligations discovered by source
review. No canonical ID, approval, implementation or test result is issued.
The candidate plan advances navigation only; FR-045/ADR-016's pinned local scope,
Identity grants, Files service/cohort ownership and existing immutable audit,
snapshot and credential boundaries remain authoritative. Implementation would
require PM/File Management, Identity, Asset/catalog consumers and installation
backup/erasure integration to honor this exact contract before activation.

0.1.0 → 0.2.0: records the owner's choice to preserve normal backup before
recovery activation; adds typed package/coverage, separate installation authority,
source/target jobs, exact-byte mapping and round-trip acceptance. The temporary
export refusal is fallback only. Two unissued standalone subjects are proposed;
the candidate plan, no-code mandate and all qualification boundaries remain.
