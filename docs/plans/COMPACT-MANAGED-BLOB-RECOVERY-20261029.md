---
id: ZAI:COMPACT-MANAGED-BLOB-RECOVERY-PLAN-20261029
title: Compact managed-blob operator restore and rebind plan
doc_type: implementation-plan
status: candidate
version: "0.1.0"
source_revision: "5b5131a0f5bf8706baf52b9dd0ec8b786df00972"
planning_scope_selected_on: "2026-10-29"
implementation_authorized: false
relations:
  - type: references
    target: ZAI:ADR-115
  - type: references
    target: ZAI:FR-045
  - type: references
    target: ZAI:FR-072
  - type: references
    target: ZAI:FR-075
  - type: references
    target: ZAI:SEC-030
---

# Compact managed-blob operator restore/rebind implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` after the contract
> and implementation scope are approved. This task authorizes assessment and
> planning only. No application code, route, schema, migration or runtime action
> is authorized by this candidate document.

**Goal:** Make exact Asset/catalog bytes recoverable and their FileAsset refs
rebindable through a supported, audited operator procedure on an owned Compact
target, without treating the TEST fixture as product authority.

**Architecture:** File Management remains the FileAsset writer. Existing private
S3 ports remain byte transports. An authenticated application workflow prepares,
previews and confirms one existing FileAsset at a time; a durable operation
record separates provider staging from the metadata/audit transaction.

**Tech stack:** Existing Server, Prisma/PostgreSQL, injected storage ports,
Vitest/Node tests and Playwright. No new service, model/provider stack or CLI
database writer is proposed.

**Spec:** [ADR-115](../decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md),
[parent Task7](COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md#task7-installrestartrecovery-matrix-and-release-handoff),
and [source assessment](../../reports/compact-selfhost-2026-10-27/operator-restore-rebind-assessment-20261029.md).

## Selected scope, alternatives and authority

The owner selected managed-blob Asset/catalog recovery first on 2026-10-29.
PostgreSQL installation restore remains a separately reviewed prerequisite when
the target's metadata came from a restored database. This selection approves the
planning scope, not a new canonical behavior or implementation.

| Approach | Decision and tradeoff |
|---|---|
| Supported per-file application workflow | Proposed. Reuses trusted request identity and File Management ownership; needs a reviewed operation contract and durable recovery/cleanup protocol. |
| Extend legacy `/api/backup/import` | Excluded. Installation-wide replacement and protected-family rules exceed the selected managed-blob scope. |
| Promote fixture SQL to a host CLI | Excluded. Bootstrap database authority and a fabricated Viewer cannot substitute for product authorization, CAS and supported audit/retry behavior. |

The term **operator** here means the human running the recovery procedure with
current Business write authority. Use the existing `ownsBusiness` predicate on
a trusted, freshly resolved Viewer; never `viewer.role`, visibility or an
installation-operator flag as a Business write grant. An installation operator
without that Business authority is refused. Asset intake-specific write grants
are not automatically recovery grants. FR-075's installation-wide authority is
unchanged. The exact transport and persistence contracts must be reviewed in OR0;
this plan declares no public route, Prisma model or new permission.

FR-045/ADR-016's local-file/SQLite authority remains unchanged. OR0 must name the
Compact PostgreSQL metadata target for this managed-blob contract explicitly;
an imported historical ownership snapshot is not current write authority.

## Global constraints and admitted selection

- Existing, undeleted `MANAGED_BLOB` FileAsset with trusted current Tenant,
  Business, `ACTIVE` state, non-null SHA256 and exact size. Missing metadata,
  tombstones, quarantine and changed content are refused, never reconstructed.
- Only the configured `s3-business://asset/` and `s3-business://catalog/` purposes
  are admitted. Native Knowledge `s3://`, Supabase refs, local files, external
  URLs, other purposes and cross-Tenant/Business moves remain excluded.
- Target provider/bucket/namespace come from reviewed server configuration and
  the selected target, never from an uploaded endpoint, credential or raw ref.
  Source ref metadata is untrusted matching evidence, not a routing instruction.
- Preserve FileAsset ID/code, Tenant/Business, Project/WorkItem, FileLinks,
  AssetEvidence, MIME, size, content hash and consumer lineage. One successful
  rebind increments FileAsset version exactly once and records an immutable audit.
- Restore writes a new immutable object/key/version. It never overwrites an
  existing version, deletes the old source object or selects `latest`.
- One file per operation/confirmation in v1. Proposed transport budgets are
  64 KiB descriptor metadata and 32 MiB bytes, additionally constrained by the
  owning content policy (Asset evidence currently caps at 20 MiB). These are
  proposed recovery-lane bounds, not changes to general file-upload limits or
  supported minimum hardware; OR0 must freeze and review them.
- Authenticated application workflow is proposed for operator use. The bare
  Compact installation CLI does not acquire a new product principal or direct
  FileAsset SQL mutation. No route path or wire schema is issued in this plan.
- No credential/envelope/KEK family enters the artifact. Treat business bytes as
  private data; hashes are not proof that bytes are secret-free. No real backup,
  bytes, paths, refs, tokens or raw provider errors enter public CI observations.
- No generic PostgreSQL import, schema rollback, target reset, startup migration,
  production operation, off-host recovery, Knowledge re-admission or live LINE.
  AI profiles stay `NOT_QUALIFIED` overall and unselected in the core manifest.

## Proposed operation contract — not adopted

OR0 must turn these clauses into a reviewed product contract through the existing
canonical record-migration workflow. Allocate an appropriate new subject/ID only
there; do not repurpose FR-045, FR-013 or FR-075 or hand-edit ledger/row hashes.

1. **Prepare source evidence:** authorize before reading any file bytes or
   disclosing metadata. The supported preparation path exports one bounded
   descriptor plus exact bytes from the current authorized FileAsset. Bind source
   file ID/version, persisted old-ref digest, content hash/size and purpose. The
   operator may also supply already held bytes, but claimed scope/authority is
   never trusted. Do not add a generic archive extractor or arbitrary host-path
   reader. Export retention/erasure and private staging policy belong to OR0.
2. **Preview:** authenticate/authorize before FileAsset metadata disclosure or
   provider IO. Derive target scope from the persisted row, compare the entire
   expected tuple and hash actual supplied bytes. Refuse changed/deleted/foreign
   files, missing hash, wrong purpose and invalid provider selection. Show bounded
   file identity, expected version, hash/size and intended purpose; never raw
   storage refs, credentials or SQL. Preview grants no future permission.
3. **Stage:** server generates an opaque operation identity and fresh target key
   under the persisted scope. Verify current configuration generation, immutable
   put result and exact-version read/hash/length. Target refs are internal results
   from the configured port, never caller-selected values. Keep provider IO out
   of long metadata transactions.
4. **Confirm/apply:** the caller supplies only the reviewed opaque operation
   identity and confirmation binding, not a raw destination ref. Re-resolve
   current authority and revalidate scope, state, expected version/ref/hash/size,
   staging identity/expiry and target configuration. The metadata CAS, operation
   result and redacted audit commit atomically. An audit failure rolls back the
   metadata write. Current grant/revocation ordering requires the explicit native
   authority fence described below, not a second call on an old Viewer.
5. **Retry:** a durable, scope/actor-bound operation result proves whether commit
   happened. A committed retry is returned only after current authorization and
   after checking that its recorded target tuple still matches; no extra object
   put, FileAsset version or audit event. Reused identity with different input,
   expired preview or a newer FileAsset version is refused. Do not call a stale
   committed receipt current recovery success.
6. **Ambiguous PUT recovery:** persist the scoped intent and unique target key
   before provider IO. Reuse shared S3 `recoverImmutable()` through a reviewed
   private-business operation adapter, with current authorization, exact
   purpose/configuration/scope and the durable expected hash/size. HEAD discovers
   a candidate only; verify a non-null immutable version with exact-version GET
   and actual bytes/hash/size before recording its internal ref. Do not accept a
   caller key/ref, a provider's current value alone or a different config
   generation. A 404/null result is not success. The operation fence cannot
   cancel a first PUT still in flight after timeout. A same-intent retry is
   permitted only after the selected provider's atomic conditional no-upsert
   behavior for concurrent/late writes has been qualified; the current sequential
   duplicate probe does not prove it. Under that prerequisite, retry under the
   operation fence and repeat exact recovery on conflict. Otherwise quarantine
   without another PUT. A late first PUT and retries must not manufacture
   multiple accepted versions or receipts. Unknown/unverifiable outcomes remain
   explicit inspectable quarantine, with bounded custody and an authorized safe
   next action; do not attach lineage or retry/erase blindly.
7. **Failure and cleanup:** clean only a known exact version created by this
   operation and proven unreferenced. Never delete a source object, another
   operation's version or an unknown provider outcome. PUT timeout before an
   exact receipt is durable is `UNKNOWN`, not success. OR0 must adopt the scoped
   recovery and quarantine/inspection/abandon protocol above, including ownership,
   retention and safe next actions. Until accepted and tested, it is a closure
   blocker. A cleanup failure remains visible and is not reported as
   fully complete; no global prune or automatic broad erase.
8. **External loss:** PostgreSQL and S3 have no shared atomic commit. Record which
   exact bytes were verified and when. If the post-commit read fails, report a
   degraded/recovery-required operation, preserve committed evidence and fail
   content reads closed; do not silently roll back to an old ref or report full
   success. Later provider deletion is not an availability guarantee this gate
   can grant.

### Contract decisions that block implementation

| ID | Required before code | Evidence/owner |
|---|---|---|
| MBR-CONTRACT | Reviewed behavior, purpose/authority, descriptor and operator transport contract; sanctioned canonical record migration | PM/File Management owns metadata; Identity reviews grant semantics; Asset/Knowledge/Commerce review consumer impact. |
| MBR-AUTHORITY-FENCE | Document exact persisted authority inputs, current re-resolution and native lock/version/serialization order shared with relevant revocation writers | `ownsBusiness()` checks a resolved list; it does not itself query/fence live grants. An invented global lock or operator bypass is not acceptable. |
| MBR-DURABILITY | Approve operation/result/staging custody, timeout/expiry, unknown PUT outcome and exact cleanup protocol, including schema ownership if required | A new journal cannot be smuggled into AuditEvent or another domain's import receipt. |
| MBR-PROVIDER-CONDITIONAL | Verify atomic conditional no-upsert for a delayed first PUT racing retries on the same generated key, on the selected image/platform/command | The existing provider probe proves a sequential duplicate refusal only. Without this separate recovery-specific evidence, 404 is not permission to retry PUT. |
| MBR-DB-PREREQUISITE | For metadata restored from PostgreSQL, identify the separately approved restore provenance and current authorization/erasure fences | This plan does not implement or qualify installation database restore. Without it, qualify only an existing trusted target. |

The first four must be addressed in the adopted design and qualification plan
before their dependent implementation/enablement. MBR-PROVIDER-CONDITIONAL must
have actual provider evidence before the retry path is enabled. Keep that
recovery-specific evidence separate from the current strict four-check storage
qualification payload; do not insert an unapproved fifth field into its schema.
The database prerequisite limits the claim and remains external to this slice.

## Review focus and acceptance matrix

Every test uses factory Viewers, never fabricated authority. Negative authority
cases assert zero provider IO and no metadata/operation-result disclosure.

| Case | Required result | Task |
|---|---|---|
| Visible member, owner elsewhere, operator-only, forged body scope or unauthenticated caller | Same disclosure family as nonexistent target; no object read/write or file change | OR1/OR2/OR3 |
| Revoke ownership after preview, during staging or racing confirm; both observed orders | Native authority decision has a documented serialization point; no stale preview/Viewer permits a later unauthorized write | OR2/OR5 |
| Cross-purpose/bucket/Business/ref alias, invalid/null version, traversal, oversize bytes, wrong hash/length or corrupt descriptor | Typed refusal before unsafe IO; no fallback, arbitrary fetch or staging escape | OR1/OR2 |
| Concurrent confirms, response loss, duplicate identity, concurrent delete/change and newer file version | At most one metadata version/audit commit; authorized retry or conflict, no resurrection | OR2/OR5 |
| PUT failure/unknown response, DB failure, audit failure, exact cleanup failure and crash at each boundary | Explicit durable outcome and supported next action; no false PASS, shared-version erase or lost original ref | OR2/OR5 |
| Delayed original PUT arrives before/after a retry for the same operation key | Qualified provider conditionality permits only one winning immutable object; loser reconciles exact bytes/version without duplicate commit. Unqualified selection remains quarantined with zero retry PUT | OR2/OR5 |
| Object disappears after staged verification or after commit | Content fails closed; operation cannot claim verified availability it did not observe | OR2/OR5 |
| Asset evidence, catalog/pricing lineage and all linked metadata | Same identity/content/links and decisions; owner read succeeds, foreign read denies before IO; no re-admission, publication or AI invocation | OR4/OR5 |

## Implementation tasks — gated on OR0 adoption

### OR0 — Adopt the missing contract and freeze the validation envelope

**Files:** candidate review material under `docs/change-requests/project-manager/`;
canonical records/migration artifacts only through their reviewed writer; update
this plan and the parent Task7 links after adoption. These are future outputs,
not approved records created by this planning task.

- [ ] Review the assessment and proposed contract with PM/File Management,
  Identity and affected consumer ownership; settle all MBR prerequisites.
- [ ] Freeze supported source/target selection, authority fence, one-file budgets,
  preview binding, durable idempotency/outcome custody and unknown-outcome policy.
- [ ] Freeze the provider concurrency probe and its separate evidence contract;
  sequential conditional-write evidence is insufficient for timeout retries.
- [ ] Review the minimal wire/API and persistence contract before fixing public
  route/model names. Preserve existing native ports and snapshot refusal guards.
- [ ] Adopt the sanctioned canonical record migration and regenerate/check
  registry, graph and views. Obtain independent review before application code.

### OR1 — Pure descriptor/protocol and supported preparation path

**Proposed implementation files:** PM `application/managed-blob-recovery-contract.js`
and `application/managed-blob-recovery-service.js`; corresponding
`tests/unit/managed-blob-recovery-contract.test.js` and
`tests/integration/managed-blob-recovery.test.js` under Server.

**Consumes:** the OR0-approved protocol, persisted FileAsset scope and injected
configured storage ports. **Produces:** bounded validated recovery input and
server-owned operation identity, not an authority grant.

- [ ] Write and observe RED for malformed/oversize/untrusted descriptors, source
  mismatches, noneligible states and unauthorized preparation; use real exact
  bytes for hash/length assertions.
- [ ] Implement strict parsing and the authorized preparation flow. Keep bytes
  private, scope derived from rows and all storage access behind existing ports.
- [ ] Run the targeted protocol/preparation regressions and independent review
  of the delivered boundary; no live provider or existing installation mutation.

### OR2 — PM-owned stage/confirm/result/cleanup with native authority ordering

**Proposed files:** extend the OR1 service; add a PM-owned operation repository
adapter only as approved by OR0. If a model is adopted, canonical Prisma,
PostgreSQL generation and fresh Compact baseline inputs change together; never
alter an existing target or issued migration to make a fixture pass.
Extend the private-business port only through the OR0-approved scoped adapter
for the existing S3 recovery helper. Preserve canonical purpose/key/version
validation and sanitized errors; raw provider exceptions must not escape the
business boundary. No new remote API or unscoped provider listing is assumed.

**Consumes:** authorized input/current actor, expected row tuple, reviewed
operation custody and exact provider receipt. **Produces:** transactional rebind,
safe repeat result or explicit recoverable refusal/unknown state.

- [ ] RED: CAS conflict, owner revoke, double confirm, metadata/audit rollback,
  response loss, crash boundaries, unknown provider result and cleanup failure.
- [ ] Implement the OR0 authority fence and single FileAsset CAS/audit/result
  transaction. Preserve all unrelated FileAsset fields and linked domain data.
- [ ] Implement exact owned cleanup, durable ambiguity handling and authorized
  inspection/retry. No raw provider cause, bytes or refs in returned diagnostics.
- [ ] GREEN: SQLite service regressions and two independent native PostgreSQL
  sessions for both race orders, runtime-role/RLS/ACL and crash postconditions.

### OR3 — Supported operator application workflow

**Files:** File Manager UI and thin server request handlers selected/frozen by
OR0; existing `components/ManagedFilesPanel.jsx` and File API are integration
seams, not permission to extend legacy relink to arbitrary managed refs.

- [ ] RED: non-owner preview/confirm, missing trusted viewer/CSRF, stale preview,
  replay and body-supplied destination ref; assert no provider IO on denial.
- [ ] Implement approved request resolution and private input/staging, bounded
  preview, explicit confirmation, inspect/retry and truthful partial-failure UX.
- [ ] Run real browser/API tests through the same operator surface that the
  runbook instructs; do not inject a Viewer, ref setter or direct DB writer.

### OR4 — Asset/catalog consumer and secret/erasure regressions

**Files:** tests at Asset evidence storage/extraction seams, SmartGift catalog
upload/reader and Commerce pricing-catalog lineage seams; changes to consumers
only when needed to preserve their approved contracts.

- [ ] Verify ID/link/hash/size/MIME and evidence-review lineage preservation after
  rebind and current authorized exact-byte reads. Refuse foreign/revoked reads.
- [ ] Verify catalog/pricing lineage and current authorization without invoking
  models, native Knowledge admission or publication. Do not manufacture new
  READY/verified facts from the recovery result.
- [ ] Verify deleted/quarantined/missing-hash and protected/unknown input families
  refuse; no credential/envelope/KEK or historical grants are imported. Preserve
  existing FR-223 re-entry and legacy snapshot protected-family refusals.

### OR5 — Exact-artifact operator qualification and gate decision

**Files:** a new owned operator-recovery test lane under Server and a sanitized
evidence report; amend the Compact runbook after the supported interface exists.
The existing synthetic recovery test stays distinct and retains its historical
`operatorRecovery: NOT_QUALIFIED` meaning; do not turn it green by relabelling it.

- [ ] Build a new clean committed package and prepared inputs at one source SHA;
  preserve actual image labels/digests, baseline, CLI, manifest and inventory.
- [ ] On disposable TEST targets, use real product ingestion/preparation and the
  supported operator entrypoint to recover missing Asset/catalog bytes into new
  immutable versions. No fixture-only SQL remap or bootstrap authority for the
  operation. Seed any metadata prerequisite through an explicitly identified
  accepted path; do not claim a fixture seed qualifies PostgreSQL restore.
- [ ] Exercise same-selection restart, stale/foreign/corrupt inputs, two-session
  races, lost responses, every crash boundary and the accepted ambiguity policy.
  Verify current reads, domain links, exact cleanup and remaining custody.
- [ ] Delay the first provider PUT beyond client timeout and race a conditional
  retry in both winner orders. Verify the exact resulting version/bytes and one
  metadata/audit result; without qualified conditionality assert quarantine and
  zero retry PUT. Record the actual selected provider identity with this proof.
- [ ] Run scoped unit/integration/native/browser checks, Core contracts, relevant
  build/type/lint, governance/document readers and exact-head hosted CI under
  VERIFICATION-POLICY. Preserve first failures; zero-test or flaky is not PASS.
- [ ] Independent GPT-6 Luna Max review checks the same patch/artifact/evidence.
  Record actual cases, source/platform/provider selection and remaining limits.

## Gate closure rule and handoff

The **managed-blob operation subgate** may pass only after OR0–OR5 and all
admitted positive/negative cases have actual, source-bound evidence. This first
selection covers an existing trusted target's Asset/catalog managed blobs only.
Do not label full `operatorRecovery` qualified while database-restore provenance,
current authorization/erasure after restored metadata or another applicable
dependency is unqualified. Those dependencies are not closed by an ORM fixture.

Off-host failure-domain recovery, general host support, hardware minimum,
provider/legal release selection, AI profiles and production/release remain
separate. This candidate plan and the existing 5b core/synthetic recovery PASS
close none of them. The next authorized step is OR0 contract review/adoption;
application code follows only the reviewed contract and selected implementation.
