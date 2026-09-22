---
id: ZAI:PM-PHASE-B-RECOVERY-ERASURE-DECISION
title: Phase B recovery and reviewed text erasure decision
version: "0.3.6b"
status: beta
created_at: "2026-09-17T04:15:00+07:00,RWANG,bd99651f"
last_update: "2026-09-22T00:00:00+07:00,Claude Sonnet 5"
attributes:
  domain: project-manager
  doc_type: architecture-decision
  complexity: C-3
  risk: HIGH
relations:
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:FR-252-P1
  - type: references
    target: ZAI:FR-075
  - type: references
    target: ZAI:FR-022
  - type: references
    target: ZAI:PM-PHASE-B-W1-RLS-POLICY
---

# Phase B: approved protected recovery and text erasure

**Owner approved both decisions on 2026-09-17.** The approved v0.2.1b packet
has SHA-256 `DD666532E88B6D3C59A1D999ADB9621FC0669A4CF071209407DD6E0513407865`;
independent Luna Max review passed before owner selection. Version 0.3.0b
records approval without changing either selected behavior. W2 local
implementation and isolated verification may proceed. The original packet
requires complete protected recovery and audited erasure, but does not define
a maintenance execution capability or how shared Feature text relates to a
data subject. W1 schema and P2 Identity work remain independently authorized.
This decision changes neither the six-record identity nor the 14 Feature/CSRF
operations. Production credentials and live recovery remain outside this approval.

## Evidence

The current `backup-service.js` restores by deleting and reinserting every
snapshot family through the application client. The accepted database policy
allows only SELECT/INSERT on GovernanceSnapshot and mutation receipts. The
operator viewer check grants no additional database privilege. Generic export
also has no Phase B scope binding, so RLS-hidden rows could look like empty
families. An empty response is not evidence that no protected rows exist.

Feature title/problem/outcome and contribution responsibility have no subject
mapping. A receipt actor or last editor may write information about someone
else. Adding author columns would not identify the person whose data must be
erased. Existing Identity orchestration remains the owner of erasure.

## Approved decision A: separate recovery from normal runtime

1. Keep ordinary runtime append-only privileges exactly as policy25 specifies.
   Do not add DELETE, maintenance credentials or role switching to web/worker.
2. Extend protected-family export/preview validation for all six Phase B
   records. Require evidence that export saw the complete family. An unbound
   RLS query cannot supply a zero-row proof; return an explicit unavailable
   result before publishing a snapshot if completeness cannot be established.
3. Confirmed web restore refuses before any delete when existing or incoming
   Phase B evidence needs protected recovery. The existing restore-result
   envelope carries `restored: false`, `valid: false` and
   `errorCode: PHASE_B_RECOVERY_MAINTENANCE_REQUIRED`; protected and unrelated
   rows stay unchanged and no successful restore audit is written.
4. Implement a separately invoked, operator-controlled offline recovery command
   for a **verified empty target database**. It validates the exact input digest,
   complete families and parent chains, inserts in dependency order in one
   transaction, and verifies IDs/versions/hashes/counts. It performs no DELETE,
   TRUNCATE or in-place replacement. A nonempty or unverifiable target refuses.
5. Maintenance database access is supplied to that invocation only, through an
   operator-controlled secret input; it is never accepted over HTTP, stored in
   a snapshot or made available to ordinary runtime. The command identifies its
   maintenance context separately from non-bypass runtime isolation evidence.
   Code and isolated tests do not authorize running it on a live database.
6. Existing archive/rollup recovery semantics are preserved. The Phase B guard
   applies to this new family; it does not impose new authority on unrelated
   already-approved recovery. Reconcile the concurrent CustomerLegalHold release
   before composing any deployable backup change.

This selects clean-target recovery for Phase B instead of extending the web
importer's in-place replacement power. An in-place protected recovery would
need a separate reviewed maintenance capability and is not included.

## Approved decision B: reviewed field targets for PM text erasure

1. Do not infer a subject from authorship, receipt actors, names or text search.
   Add no author columns or seventh Phase B model.
2. Identity receives a server-reviewed manifest within the existing erasure
   authority. Each entry names the Project, record type/id, field and expected
   version. The allowlist is ProjectFeature.title/problem/outcome and
   FeatureContribution.responsibility. Review explicitly confirms that clearing
   the named whole field is appropriate, including effects on shared text.
3. The trusted manifest also binds tenant, Business, subject Person, reviewer,
   reason reference and request identity. Existing Identity erasure authority
   must cover every target. An HTTP client cannot grant itself review status or
   select a privileged database client by submitting those fields.
4. A PM-owned transaction port applies only those reviewed targets, using the
   server's fixed `[erased]` value. It rechecks full hierarchy and exact version,
   locks affected Projects in deterministic ID order, increments each changed
   row's version, and preserves identity, lifecycle and deletion cohorts.
   Mutable scope rebinding in a multi-Project Identity transaction must have a
   separately tested adapter boundary; one request's proof is never reused.
5. Missing subject-to-field mapping is `UNMAPPED`, pending review is `PENDING`,
   and stale/foreign targets refuse atomically. These outcomes never claim
   complete PM erasure. Unrelated fields and immutable snapshots/receipts/audit
   evidence remain unchanged.
6. Reuse the existing immutable erasure AuditEvent for the manifest digest,
   reviewed target identities/fields, reviewer and resulting counts. Do not
   persist original text, replacement content or secret material in that audit.
   A repeated request is compared to its reviewed manifest before any effect;
   a changed manifest cannot masquerade as a successful replay.
7. Identity remains transaction orchestrator. A failed PM application rolls back
   the composed change and creates no success audit. Preserve current CRM legal
   hold and external pending-erasure semantics independently.

The reviewed manifest is an internal authority boundary. Existing public erase
requests cannot become arbitrary Feature-edit endpoints. A dedicated review UI
or general retention-policy editor is outside this change.

## Concrete recovery contract

### Offline command and visibility proof

The command is `node apps/server/scripts/phase-b-clean-target-restore.mjs`.
It accepts `--snapshot <absolute-path>`, `--snapshot-sha256 <lowercase-hex-64>`,
`--confirm-empty-target PHASE_B_EMPTY_TARGET`, and optional `--report <absolute-path>`.
Without the confirmation it performs preflight only. The connection comes only
from `ZURI_PHASE_B_RECOVERY_DATABASE_URL` in the operator's process environment.
There is no fallback to the application's DATABASE_URL, HTTP entry point, role
creation, SET ROLE, credential logging or credential persistence.

Run these offline commands from the selected operator checkout with its complete
Server dependencies installed from the lockfile, including development tools.
The CLI bridge uses the explicitly pinned esbuild development dependency to
compose the existing backup service and its validation/redaction rules. It
injects the recovery transaction and replaces the ambient application database
import; it cannot silently connect through the application's database client.
The ordinary web/runtime does not import this operator script. A production
image installed with development dependencies omitted is not the recovery
toolkit. Help remains usable without a recovery connection; an unavailable
composition or validation boundary refuses recovery.

The SHA-256 is over the exact file bytes before JSON parsing, not reserialized
JSON. A mismatch refuses before any database write. The importer retains the
bytes read for the whole run and never rereads a changed file after validation.

The target must have the already-migrated selected schema. The reviewed table
inventory includes **all application models**, including snapshot exclusions;
every family must be empty. The PostgreSQL catalog is reconciled with that
inventory, including mapped table names. Missing or unexpected application
tables refuse; only the schema's explicitly enumerated migration bookkeeping
tables are outside the emptiness claim. This inventory is frozen with W1's
schema hash before implementation. Peer CustomerLegalHold reconciliation updates
the inventory before any deployable recovery artifact is accepted.

`targetSchemaSha256` is lower-case SHA-256 of UTF-8 JSON with exactly these
top-level keys in order: `schemaSha256`, `applicationTables`. `schemaSha256`
binds the exact bytes of the frozen canonical Prisma schema. The historical W1
binding is `e5d6fb4d1f915d5ea78b10a0c6a14ff22f39f995d4e4d7d99790c7eb1056b2db`.
`applicationTables` contains every application model, sorted by modelName,
schemaName and tableName using ordinal comparison. Each object has those three
keys in that order, with no whitespace in the serialized JSON. The current
W1 isolated schema had 174 models; this is not a production inventory claim.
Inventory/schema changes require a new reviewed binding. A catalog or binding
mismatch is `TARGET_SCHEMA_UNVERIFIED` before insertion.

The historical W2 CRM composition at 052821a7 had 175 application models:
`schemaSha256` `9bc8c777e00f7716b94b99a6a771e1453b9d667d887bcb2ed0118779ca0ec2be`,
`targetSchemaSha256` `617b091c8b94ff306f9b98989676f631360b23f4a7faac0f1e57d16743999f5b`.
Its independent review and actual CLI proof remain evidence for that version.

The current composed schema adds `KnowledgeArtifactOperation` and
`KnowledgeArtifactStorage` to the previously pinned 177-model binding, giving
**179 application models** in [the frozen inventory](contracts/phase-b/target-schema.inventory.json).
The canonical LF schema has `schemaSha256`
`ad87b4bc9244f1fdbd055d138bd02c9bd315498d57c51c22efdf56084cdd089f`;
`targetSchemaSha256` is
`ee7a379237b5e8cbebd7607deb1d28cc400009e54076c60c87fb2dddb3873198`.
Independent Luna Max review recomputed both hashes, model mappings, ordinal
serialization and SQLite/PostgreSQL parity and passed on 2026-09-17.
The loader and all executable adapters enforce this exact binding.
Historical 175-bound snapshots refuse; no automatic cross-schema artifact
rewrite is authorized by this decision. The composed actual CLI proof remains
a separate gate from static inventory review.

That executable gate now passes on the composed 179-model source: 22 positive
and 15 adversarial checks, with thirteen executable/schema inputs frozen during
the run. Its populated six PM and two Pricing families restore into fresh
synthetic targets. The [integration report](../../../.brain/reports/2026-09-17-project-feature-phase-b.md)
retains the exact proof; this does not establish production role or migration
readiness.

Version diff 0.3.5b → 0.3.6b (2026-09-22): rebind the frozen recovery inventory
to the composed 186-model schema after FR-268's `BusinessKeyResult`/
`BusinessKeyResultCheckIn` models landed (ADR-101 D6 Phase 1), on top of
ADR-102's already-merged `ProjectExecutionRun`/`ProjectExecutionStep` models.
schemaSha256 `479172f2ba9a81a29fd08d061689cb875cd70e98125710fc0c847d098ef36e15`.

Version diff 0.3.4b → 0.3.5b: rebind the frozen recovery inventory to the composed
179-model schema after adding the two Knowledge artifact storage models; the
177-model binding remains historical and refuses cross-schema recovery.

Version diff 0.3.3b → 0.3.4b: record the successful composed executable recovery
gate without changing approved recovery or erasure authority.

Version diff 0.3.2b → 0.3.3b: bind the independently reviewed 177-model
composition and preserve Pricing validation and parent-first offline insertion.
Recovery and erasure authority are unchanged.

Version diff 0.3.0b → 0.3.1b: bind the mandatory peer-composed inventory;
the approved recovery and erasure decisions are unchanged.

Preflight and apply use an explicit transaction on the supplied connection.
Set `row_security = off` locally and count every application table. This setting
does not grant a bypass: a query that would be filtered by RLS must fail. Such a
failure is `TARGET_EMPTY_UNVERIFIED`, never a zero-row proof. The actual supplied
maintenance connection must demonstrate complete visibility and the required
read/insert/table-lock capabilities. It may be privileged; that fact is recorded
as maintenance evidence and can never satisfy the ordinary runtime isolation gate.

The machine result contains `schemaVisibility: FULL | UNVERIFIED` and
`applicationTableCount`. Emit FULL only after the inventory and complete counts
and the selected command's privileges are proven on that same connection:
read/insert/lock for recovery, read for protected export. A filtered/unreadable
table is UNVERIFIED and returns `TARGET_EMPTY_UNVERIFIED` for empty-target
proof; a role name or assumed bypass privilege is never sufficient evidence.

During apply, acquire table locks in sorted schema/table order before counting,
hold them through validation and insertion, and use a bounded lock timeout.
Refuse on a lock/privilege error. Recheck that every application table is empty
on that same connection before the first insert. This prevents a concurrent row
from invalidating an earlier preview. Insert the existing complete snapshot and
the six new families in validated dependency order, then reconcile IDs, versions,
hashes and counts before commit. Do not modify the existing rows or roles.

Output is one redacted JSON result:

```text
{ status: READY | RESTORED | REFUSED | ROLLED_BACK,
  errorCode: null | bounded code,
  snapshotSha256, targetSchemaSha256,
  schemaVisibility: FULL | UNVERIFIED, applicationTableCount,
  targetCounts, incomingCounts, insertedCounts: counts | null }
```

Codes are `TARGET_CONNECTION_UNAVAILABLE`, `TARGET_SCHEMA_UNVERIFIED`,
`TARGET_EMPTY_UNVERIFIED`, `TARGET_NOT_EMPTY`, `TARGET_PRIVILEGE_UNAVAILABLE`,
`TARGET_LOCK_UNAVAILABLE`, `SNAPSHOT_DIGEST_MISMATCH`,
`PHASE_B_SNAPSHOT_INCOMPLETE`, `PHASE_B_SNAPSHOT_INVALID`,
`PHASE_B_SCOPE_INVALID`, `PHASE_B_RECEIPT_INVALID`, and
`PHASE_B_WRITE_ROLLED_BACK`. Refusal/rollback uses nonzero exit status and no
committed inserts. Successful evidence records digest, schema, counts and the
operator command's control result; no source text or connection string.

### Complete protected export

To avoid making protected recovery depend on an unavailable web export, provide
the companion local command
`node apps/server/scripts/phase-b-protected-export.mjs --output <absolute-path>`
with optional `--report <absolute-path>`. It uses the same process-only recovery
connection boundary and never accepts a database URL as an argument. Refuse an
existing output path so the operation cannot overwrite a prior backup.

Within one repeatable-read transaction, establish complete visibility with local
`row_security=off`, validate table inventory, extract every included snapshot
family and reconcile counts with the same transaction snapshot. Preserve all
existing exclusion/redaction rules and required archive/rollup manifests. It
creates no source-database row and does not change roles or credentials. If any
family is unavailable or invalid, publish no completed snapshot. Write the
validated artifact atomically, compute its exact byte digest, and return only
its output path, schema/digest/counts and `EXPORTED` or a bounded refusal.
The snapshot itself retains the same confidential-data classification as the
existing backup format; reports contain no row payloads. This supplies an
explicit full-family artifact for the clean-target restore command.

### Family descriptors and restore matrix

| Delegate | Ordinary runtime | Restore dependency |
|---|---|---|
| governanceSnapshot | SELECT / INSERT | Tenant, Business, Project, Workspace, Repository, ProjectRepository |
| projectFeature | Scoped mutable | Project and optional GovernanceSnapshot |
| featureContribution | Scoped mutable | ProjectFeature |
| featureWorkLink | Scoped mutable | ProjectFeature, WorkItem and Workstream |
| requirementBinding | Scoped mutable | ProjectFeature and GovernanceSnapshot |
| projectFeatureMutationReceipt | SELECT / INSERT | Project, typed resource and AuditEvent |

The six arrays form one complete family. Validate the selected data contract,
including cross-family keys, same-Project scope, deletion batches, hashes and
receipt tuples. Missing, present-empty and unreadable remain distinct states.

| Incoming family | Authoritative current family | Web replacement | Clean-target command |
|---|---|---|---|
| Any | Completeness unavailable | Maintenance refusal | Empty-target proof refusal |
| Malformed or partial | Any | Invalid snapshot refusal | Invalid snapshot refusal |
| All six missing from an explicitly legacy snapshot | All six proven empty | Preserve legacy behavior; no Phase B insert/delete | Incomplete snapshot refusal |
| All six present-empty and valid | All six proven empty | Preserve legacy behavior; no Phase B insert/delete | Ready only if every application table is proven empty |
| Missing or present-empty | Any current row | Maintenance refusal | Target-not-empty refusal |
| Complete valid nonempty | Any | Maintenance refusal | Insert only into a fully verified empty target |
| Invalid row/scope/hash/receipt | Any | Invalid snapshot refusal | Specific validation refusal |

An unbound ordinary PostgreSQL client cannot establish global zero counts for
the new forced-RLS families, even if a query returns zero. Export must refuse
with `PHASE_B_EXPORT_COMPLETENESS_UNAVAILABLE` before producing an artifact in
that case. SQLite's unfiltered transactional extraction or a separately supplied
maintenance connection may prove complete counts; an HTTP caller cannot select
that privileged connection. An offline recovery consumes an artifact whose full
family provenance has already been validated; it does not fetch provider data.

`assertPhaseBWebRestoreSafe(tx, snapshot, preview)` runs inside the existing
import transaction, after the archive/rollup safety check and **before the first
delete of any table**, including pluginInstallation and localWorkspaceMount.
It repeats current-family proof instead of trusting preview counts. Refusals use
the existing envelope (`restored:false`, `valid:false`, bounded `errorCode`).
The ordinary delete/insert loops always skip the six new tables; empty immutable
tables still have no runtime DELETE privilege. A nonempty incoming family is
never ignored while unrelated tables are replaced.

## Concrete Identity-to-PM erasure contract

The internal manifest has fixed version `pm-erasure.v1`, tenantId, businessId,
subjectPersonId, reviewerPersonId, requestId, reasonRef, targets and
manifestSha256. Each target contains projectId, recordType, recordId, field and
expectedVersion. The allowlist is exactly:

- ProjectFeature: title, problem, outcome.
- FeatureContribution: responsibility.

Sort targets by projectId, recordType, recordId and field; reject duplicates and
inconsistent versions for one record. Hash UTF-8 JSON with the above binding keys
in that fixed order and target keys in the listed order, excluding the digest
itself. All IDs, positive integer versions and field names have strict schemas.
There is no original text or replacement input. The reason is a bounded internal
reference, not free-form personal data.

`status: REVIEWED` is not an authorization token. Identity passes a separately
resolved trusted reviewer/viewer and its already-authorized subject/Business
context; PM validates that context against the manifest. Reviewer identity must
match, and existing erasure authority must cover the Business and every target.
The public erase request schema stays unchanged and cannot carry a manifest,
reviewer, database client or authority flag. The internal review integration must
explicitly record whole-field approval; missing approval returns PENDING.

```text
applyReviewedProjectFeatureErasure(tx, manifest, { authority, now })
  -> { status: APPLIED | REPLAYED | UNMAPPED | PENDING,
       manifestSha256, changedRowCount, changedFieldCount }

erasePrincipal(input, { db = prisma, reviewedPmContext = null })
eraseCustomerPrincipal(customerId, input,
  { viewer, db = prisma, reviewedPmContext = null })
```

These are internal service signatures, not new public API operations.
eraseCustomerPrincipal forwards the same db to erasePrincipal. A root client
opens one transaction; an explicit transaction client is reused without nesting.
All CRM, Integration and PM effects and the existing audit use that transaction.

The PM port locks the subject for request/replay serialization and locks affected
Projects in deterministic order. It verifies current authority, hierarchy and all
expected versions before updating. PostgreSQL scope changes occur only within a
tested erasure adapter that restores the prior local scope after each bounded
Project callback; this exception cannot be used by the ordinary one-Project
Feature repository. Any nonempty unrecognized initial scope refuses.

Update each targeted row once with `[erased]`, increment its version once, and
increment each affected parent Feature aggregate version once when a Contribution
changes. Preserve all IDs, lifecycle, tombstones and deletion batches. A stale,
foreign or invalid target throws a typed refusal so Identity rolls back every
composed effect; returning a status without rollback is insufficient.

Under the same subject lock, compare request identity and manifest digest to the
existing immutable PRINCIPAL/ERASED audit. A matching prior PM effect replays with
no new PM update; a changed digest refuses. Identity appends its normal audit only
after successful composition, with PM digest/reviewer/target identities/fields
and counts. No seventh model or new audit mutation is introduced. Absent mapping
or review is surfaced as UNMAPPED/PENDING in the erasure result and audit; a
generic success message must not claim all PM text has been erased.

## Verification required before accepting implementation

| Area | Required evidence |
|---|---|
| Export | RLS-hidden populated family refuses instead of exporting empty; valid scoped/maintenance extraction reconciles complete family counts. |
| Web restore | Positive target/snapshot sentinels and a row introduced after preview trigger refusal before the first destructive statement; legacy unaffected cases retain behavior. |
| Offline recovery | Empty target succeeds atomically; nonempty target, missing/partial families, bad scope, wrong digest, receipt tuple mismatch and failed insert leave the target unchanged. |
| Runtime privileges | Actual non-bypass runtime login cannot update/delete immutable evidence; maintenance evidence is labeled separately. |
| Erasure | Review targets, subject, scope, field allowlist and versions are enforced; stale/foreign/changed replay leaves all records unchanged. |
| Shared text | Only reviewed fields are redacted; other-authored/unknown/unreviewed text is retained with explicit pending status; no actor inference. |
| Composition | Identity/CRM/PM rollback and current legal-hold behavior pass together; manifest audit contains no original user text. |

## Approval and version diff

Both decisions above are approved by the owner's latest "Approve". Difference from the
original Phase B plan: protected recovery uses a separate clean-target offline
path, and PM text erasure requires explicit reviewed field targets. Neither
capability is implemented by this document alone. Root updates the
selected contract, phase handoffs and tests under that approval; production rollout
still requires its existing independent and real-role gates.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.3.5b | 2026-09-19 | beta | Rebind Phase B recovery to the composed 179-model schema after the two Knowledge artifact storage models landed; preserve the historical 177-model binding | working-tree | RWANG |
| 0.3.4b | 2026-09-17 | beta | Close the separate executable 177-model recovery gate with 22 positive and 15 adversarial frozen-source checks | 052821a7 + 892f23f3 | RWANG |
| 0.3.3b | 2026-09-17 | beta | Bind reviewed Pricing/PM 177-model schema and complete snapshot coverage; require fresh executable proof and preserve obsolete-binding refusal | 052821a7 + 892f23f3 | RWANG |
| 0.3.2b | 2026-09-17 | beta | Document the implemented operator-checkout dependency boundary and unavailable-validator refusal; selected behaviors unchanged | bd99651f | RWANG |
| 0.3.1b | 2026-09-17 | beta | Bind the peer-composed 175-model inventory and record independent inventory review; selected recovery and erasure behavior unchanged | bd99651f | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record owner approval of both frozen v0.2.1b decisions and authorize bounded W2 local implementation | bd99651f | RWANG |
| 0.2.1b | 2026-09-17 | candidate | Pin schema-inventory hash bytes and explicit full-visibility attestation after independent owner-selection PASS | bd99651f | RWANG |
| 0.2.0b | 2026-09-17 | candidate | Define offline command, actual visibility and locking proof, family matrix and Identity transaction/replay seam | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | candidate | Propose bounded clean-target recovery and reviewed PM erasure targets to close source-audited W2 authority gaps | bd99651f | RWANG |
