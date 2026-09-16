---
id: ZAI:PLAN-RELEASE-SAFETY-RESTORE-ROLLUP-ARCHIVE
title: Release safety repair specification — restore, usage rollup and archive storage
version: "0.1.2b"
status: candidate
created_at: "2026-09-16T21:19:14+07:00,Luna Max,base 138db6630e650e3c695b81158eff3cecdad6d0a5"
last_update: "2026-09-16T22:27:04+07:00,RWANG"
attributes:
  domain: cross-domain-release-safety
  scope: bounded-source-and-test-repair
  doc_type: implementation-plan
relations:
  - type: references
    target: ZAI:ADR-093
  - type: references
    target: ZAI:ADR-095
  - type: references
    target: ZAI:ADR-016
  - type: references
    target: ZAI:ADR-017
  - type: references
    target: ZAI:ADR-057
  - type: references
    target: ZAI:FR-013
  - type: references
    target: ZAI:BR-008
  - type: references
    target: ZAI:FR-075
  - type: references
    target: ZAI:FR-197
  - type: references
    target: ZAI:FR-230
  - type: references
    target: ZAI:FR-245
  - type: references
    target: ZAI:FR-248
  - type: references
    target: ZAI:FR-249
  - type: references
    target: ZAI:NFR-023
  - type: references
    target: ZAI:SDD-103
  - type: references
    target: ZAI:SEC-031
  - type: references
    target: ZAI:SEC-034
---

# Release safety repair specification — restore, usage rollup and archive storage

## Decision status and authorization

This is a candidate implementation contract written after inspecting the parent
requirements/ADRs, same-level domain charters and enumerated source/tests. The
user's 2026-09-16 instruction explicitly requests these three release-safety
repairs in parallel. The accepted parent contracts authorize conforming code:
ADR-093 D2-D4, ADR-095 D2-D3, FR-013, BR-008, FR-075 and FR-197. The code work
may proceed after this document, within the exact allowlist below; it must not be
described as archive activation or production readiness.

`HIGH / C-3` applies. The change crosses backup, platform-control and CRM
boundaries and protects installation-wide replacement, counts retention and
customer evidence. It is deliberately schema-free: the existing
`UsageEventRollup(date, kind, target)` unique key and existing `AuditEvent` and
archive models are sufficient for this bounded repair. A schema or migration
would leave this scope and requires a separate contract.

## Assumptions and evidence labels

* `VERIFIED` means observed in the isolated worktree at base
  `138db6630e650e3c695b81158eff3cecdad6d0a5`; it does not mean deployed.
* `NOT RUN` means a planned check has not run in this worktree. PostgreSQL
  concurrency and host mount topology are provider/deployment gates, not local
  SQLite evidence. The integrator's isolated PostgreSQL candidate proof is
  recorded outside this worktree at
  `pm-parallel-qa/20260916/postgres-final-candidate.json` for usage source SHA
  `8736a00774a5b30c7bc7ade491028ab26d2c0301f25975cb4e3ee38e1591fc46` (6/6);
  that gate is mandatory and must be rerun after any usage source change. The
  independent Linux storage receipt is recorded at
  `pm-parallel-qa/20260916/archive-linux-candidate.json` (8/8) for archive
  service SHA `dcde1b5744f9ac1a44d5d637b0bd4af5db52cbfcc436d1d4c55ae288925da25e`;
  it proves the injected mount and refusal cases only, not a host disk.
  Production key provisioning, scheduler activation and production database
  state remain `NOT RUN` / `UNKNOWN`.
* A same-version legacy `1.0` artifact may omit a table member added after it was
  exported. “Missing” means the `tables` object has no own property; a non-array
  value is malformed. An archive family is partial when exactly one of
  `customerArchiveKey` and `archiveManifest` is present as an array.
* A wholly omitted protected family on an empty target is allowed to remain
  explicitly `UNAVAILABLE` after confirmation for compatibility with the stocktake
  and broadcast recovery pattern. Any live row that the restore would erase
  changes that result to a refusal.
* The physical separate-disk property in ADR-093 D3 cannot be proven by an
  environment string. The app validates the configured root; a deployment gate
  separately proves the `/archive` bind mount and host disk.

## Applicable contracts

| Contract | Binding behavior used by this repair |
|---|---|
| FR-013; BR-008; ADR-016 D10 | Snapshot export/import is installation-wide and follows preview then explicit confirmation; file metadata/content gaps remain visible. |
| FR-075; FR-197; ADR-017 D6 (as extended by ADR-079) | Both preview and restore require installation-operator authority; successful operator use remains audited inside the restore transaction. |
| ADR-093 D2-D4; FR-245; SDD-103; SEC-031; SEC-034 | Archive writes verify bytes before tombstone, use per-Customer encrypted keys and a per-Tenant manifest chain; archive storage is the approved local cold root. |
| ADR-095 D2-D3; FR-248; FR-249; NFR-023 | Raw usage rows retain person attribution for 90 days, then become daily route/action counts with no personId; reads stay operator-only. |
| ADR-057 | Any production migration/configuration/activation is an operator gate outside this code/test slice. |

## Invariants and observable result contract

1. A restore never silently treats an omitted protected array as an intentional
   empty array. Malformed or partial archive-family/rollup arrays refuse before
   destructive work. Wholly omitted legacy protected families report explicit
   `UNAVAILABLE`; with live rows they refuse.
2. The confirmed restore's transaction checks the protected-table state again
   before deleting `pluginInstallation`, mounts or any `SNAPSHOT_MODELS` row. A
   row inserted after the preview therefore causes a refusal and rollback; the
   old installation remains intact and no restore audit claims success.
3. Every accepted `ArchiveManifest` chain has unique ids, null or in-snapshot
   predecessor references, one predecessor per row, no self/cyclic links and a
   deterministic parent-before-child insertion order. Invalid/cyclic/missing
   references refuse before the first delete.
4. A rollup transaction contains the stale read, grouping, existing-key atomic
   upsert, raw-id deletion and completion audit. A failed operation rolls all of
   them back. Concurrent PostgreSQL callers count each raw id once and leave one
   summary increment per id; no PII enters a rollup or audit payload. The
   database's serializable conflict is the concurrency boundary; no process-local
   mutex or provider-specific advisory-lock branch is introduced.
5. `rollupUsageEvents` keeps a `oncePerDay` option. Direct/service callers default
   to `false`; the HTTP route passes `true`. With `true`, the UTC-day audit
   existence/claim is inside the same serializable transaction and a replay
   returns the prior result with `alreadyRanToday: true`.
6. Production archive read/write paths require a configured absolute canonical
   non-temp root before any key creation, file write, manifest/tombstone or
   archive retrieval. Local/test calls keep explicit `baseDir` and OS-temp
   ergonomics. A `baseDir` override cannot bypass the production check.

## Bounded implementation contract

### A. Backup restore safety — `backup-service.js`

Only `apps/server/src/modules/project-manager/application/backup-service.js`
may change for this part.

1. Keep `SNAPSHOT_MODELS` membership and the `schemaVersion: "1.0"` wire format
   unchanged. Current exports continue to emit arrays for
   `customerArchiveKey`, `archiveManifest` and `usageEventRollup`.
2. Add a small protected-table availability check used by `previewImport` and by
   the transaction-side guard. It must distinguish:
   * `present`: own property and an array;
   * `missing`: no own property (legacy compatibility state);
   * `malformed`: own property with a non-array value;
   * `partial archive family`: one archive array present and the other missing or
     malformed; this is a refusal, including on an empty target;
   * `unavailable family`: both archive arrays, or the rollup array, wholly absent.
   `malformed` and partial states return a stable refusal code/message before
   `confirm` can authorize a wipe. Unavailable states use an explicit recovery
   status/warning and refuse when the corresponding current count is nonzero.
   Do not make a missing array silently appear as count zero in the response.
3. Validate an available `archiveManifest` array before any restore mutation:
   reject duplicate/blank ids, non-object rows, missing required fields, a
   self predecessor, a `previousManifestId` absent from the same array, a
   predecessor from another Tenant, a mismatched `previousManifestHash`, a
   `manifestHash` that does not reproduce from the stored fields, multiple
   roots, branches and cycles. Require exactly one linear root-to-tail chain
   for every nonempty Tenant and preserve chronological `createdAt` order;
   equal timestamps follow the FK, never an arbitrary UUID sort. Produce a
   deterministic topological list (predecessors before children) and use that
   list only for `archiveManifest` creation. The persisted retrieval verifier
   follows the same strict FK chain and rejects rows with missing link fields;
   test fixtures must model the persisted schema. The global model order still
   restores all other FK parents before children. This is required because the
   Prisma self-FK at `schema.prisma:2217` is real even though Tenant/Customer
   are deliberately plain scope columns.
4. For the protected archive and rollup families, replace the destructive
   loop's unconditional `snapshot.tables[model] || []` input with helpers that
   return only validated arrays, and use the topological archive-manifest rows.
   For a wholly unavailable family on an empty target, the helper may supply an
   intentional empty list only while carrying the explicit `UNAVAILABLE`
   recovery result/warning. Existing handling of other snapshot models remains
   outside this bounded repair.
5. Run the restore transaction at `isolationLevel: 'Serializable'` (with the
   existing `maxWait: 10_000` and `timeout: 120_000`). Immediately inside it,
   before the first delete, recheck each unavailable protected table with the
   transaction client. If any now has a live row, throw/return the same typed
   restore refusal as preview. The serializable transaction makes the
   protected-family predicate and the subsequent wipe one database snapshot;
   the check closes the preview/import TOCTOU window without claiming a global
   writer-quiescence lock for every unrelated installation table. The transaction
   must roll back all rows and must not write `SNAPSHOT` or `OPERATOR_ACTION`
   success audits on this path. The existing operator proof, confirmation
   requirement, remount checks, reverse deletion order, audit placement and file
   remount behavior stay intact.

### B. Atomic and idempotent usage rollup — service and route

Only these two source files may change:

* `apps/server/src/modules/platform-control/application/usage-events.js`
* `apps/server/src/app/api/platform/usage-events/rollup/route.js`

1. Keep `cutoffDays` default 90 and the strict `occurredAt < cutoff` predicate.
   Keep UTC-midnight grouping, `PAGE_VIEW → route`, `ACTION → actionName`,
   `UsageEventRollup` composite key and count-only payload. Select only the
   current fields; never copy `personId`, body or arbitrary request data.
2. Add a database transaction wrapper with `isolationLevel: 'Serializable'`
   and bounded `maxWait`/`timeout`. Inside it, read stale rows, group them, and
   use `usageEventRollup.upsert` with `count: { increment: group.count }` on the
   existing composite key. Delete exactly the selected raw ids and create the
   completion audit in the same transaction. No in-process mutex and no
   provider-specific advisory lock is a safety mechanism: the PostgreSQL proof
   must be able to force two clients through the same read and show that the
   serializable conflict/retry prevents double counting.
3. Implement bounded retries only for provider serialization/unique conflict
   codes (`P2034` and the existing `P2002` race where the provider reports it,
   plus SQLite busy/locked forms where the client reports them). A retry starts a
   new transaction and rereads the database; it never retries inside a failed
   transaction or emits a second audit for a committed run.
4. Add `oncePerDay = false` to the service options. When true, calculate the
   UTC `[start,end)` day and check for the existing
   `USAGE_EVENT_ROLLUP/USAGE_EVENT_ROLLUP_COMPLETED` audit inside the serializable
   transaction. The route must no longer perform a separate preflight
   `findFirst`. The in-transaction predicate plus serializable retry is the
   database-backed daily guard; keep normal `recordAudit` UUID/id semantics and
   do not add a schema column or deterministic primary-key convention. A replay
   returns the stored counts and `alreadyRanToday: true`; the winning run returns
   `false`.
5. Preserve the route's bearer check and 401/503 shapes. It calls
   `rollupUsageEvents(prisma, { now, oncePerDay: true })` and returns the service
   result. A conflict retry or a replay is not an error. An injected aggregate,
   delete or audit failure is a 503 at the route and leaves all three data
   surfaces unchanged.

### C. Production archive storage readiness — writer and retrieval

Only these source files may change:

* `apps/server/src/modules/crm/chat-evidence-archive-service.js`
* `apps/server/src/modules/crm/chat-evidence-retrieval-service.js`

1. Keep `resolveArchiveBaseDir`'s OS-temp fallback when `NODE_ENV` is not
   `production`, preserving explicit `baseDir` test fixtures. In production,
   require `ZURI_ARCHIVE_DIR` to be nonblank, absolute and canonicalized, reject
   OS-temp roots and reject a relative path. The approved Linux container
   contract is `/archive`; before any archive operation the selected root must
   exist as a real directory, must not resolve through a symlink/reparse escape,
   and must be present in `/proc/self/mountinfo` as the mounted archive boundary
   (or the app must fail closed when that proof is unavailable). The app guard
   still cannot prove that the backing mount is a separate physical disk.
2. Add one shared readiness assertion (or equivalent single source of truth)
   applied to the selected `baseDir` after resolving an override and before:
   `getOrCreateCustomerArchiveKeyDek`, `writeArchiveFile`, manifest/tombstone
   work, or retrieval file access. A production `baseDir` override that is
   missing, relative, temporary, outside the configured canonical root, not an
   existing directory, symlink/reparse-unsafe, or absent from the mountinfo
   boundary refuses with a stable storage-unavailable code. No key row, archive
   file, manifest or message tombstone is created on refusal.
3. Fix retrieval's default argument evaluation so the caller-supplied `env` is
   used by the same readiness check; do not let a default `process.env` resolver
   run before the function can validate its context. Keep existing OWNER/AAL2,
   case-reference, manifest/hash verification and missing-file reporting.
4. Do not edit `chat-evidence-archive-crypto.js`, mount overlays, `.env`, KEK
   provisioning, retention terms, legal-hold handling or scheduler activation.
   Crypto and retention behavior remain the existing ADR-093 contract.

## Exact implementation and test allowlist

### Source allowlist

* `apps/server/src/modules/project-manager/application/backup-service.js`
* `apps/server/src/modules/platform-control/application/usage-events.js`
* `apps/server/src/app/api/platform/usage-events/rollup/route.js`
* `apps/server/src/modules/crm/chat-evidence-archive-service.js`
* `apps/server/src/modules/crm/chat-evidence-retrieval-service.js`

No Prisma schema, migration, registry, ledger, `.env`, compose, crypto,
retention, worker/scheduler, route outside this list or production resource may
change. Generated views are never edited by hand; the integrator's required
governance regeneration is the sole exception for derived output.

### Test allowlist and focused cases

Existing files may be extended only for these cases:

* `apps/server/tests/integration/release-safety-backup.test.js`: the independent
  restore regression packet covers confirmed legacy import on an empty target,
  partial/malformed arrays on empty targets, archive/rollup inserts after preview
  and before transaction start, and tampered, branched, cyclic or cross-Tenant
  manifest refusal. Valid archive key, manifest and rollup sentinels must survive
  refusal unchanged, without success audits or unrelated Project loss. A real
  confirmed import covers child-before-parent input with equal timestamps.
  These are SQLite transaction-boundary checks, not PostgreSQL restore
  concurrency evidence.

* `apps/server/tests/integration/backup.test.js`: current export asserts all
  three protected arrays; same-version legacy wholly omitted families warn as
  `UNAVAILABLE` on an empty target; live archive key/manifest/rollup rows make
  preview and confirmed import refuse; one-sided archive arrays and non-array
  values refuse; an invalid/missing/cyclic manifest chain refuses before any
  delete; a valid child-before-parent input restores parent-first; a row added
  after preview is caught by the in-transaction recheck and remains present.
* `apps/server/tests/unit/fr045-backup-contract.test.js`: retain the
  preview/confirm and no-silent-overwrite assertions if a small contract-level
  assertion belongs there; do not weaken existing FR-045 file/remount coverage.
* `apps/server/tests/unit/usage-events.test.js`: 90-day boundary (`<`, exact
  cutoff retained), UTC/date/kind/target grouping, person-free result and audit,
  same-day replay with `oncePerDay`, injected transaction failure rollback and
  bounded conflict retry using a transaction-capable fake.
* PostgreSQL rollup proof is a mandatory release gate, delivered in the
  integrator's isolated `pm-parallel-qa/20260916/verify-rollup-postgres.cjs`
  harness rather than a new `tests/integration/usage-events-rollup.test.js`.
  Seed synthetic rows, force two clients through the same
  stale read, run them concurrently on PostgreSQL, and assert one count per
  raw id, one composite rollup increment, one daily completion audit, and
  unchanged state after aggregate/delete/audit failure. Assert raw rows at
  exactly 90 days remain and rollup/audit payloads contain no person id or PII.
  The final candidate receipt above is provider evidence for the current usage
  source; the test remains mandatory for every changed candidate.
* `apps/server/tests/unit/archive-storage-readiness.test.js`: assert production
  missing/relative/temp roots refuse, explicit `/archive`-style absolute root is
  accepted only with injected existing-directory and mount-info proofs, and
  test/development fallback still resolves to OS temp.
* `apps/server/tests/unit/crm-chat-evidence-archive-crypto.test.js`: persisted
  manifest fixtures must contain their real `previousManifestId` links; verify
  equal timestamps and reverse query order by following those links. Preserve
  crypto, corruption and missing-file assertions.
* `apps/server/tests/integration/crm-chat-evidence-archive.test.js`: production
  missing/invalid root refuses before key creation, archive file write or
  tombstone; existing explicit temp-root success, chain and failure tests stay.
  Any cleanup removes only this file's fixture rows in valid FK order.
* `apps/server/tests/integration/crm-chat-evidence-retrieval.test.js`:
  production missing/invalid root refuses before file read; existing OWNER/AAL2,
  hash and missing-file behavior stays. Deliberately corrupted chain fixtures
  must be cleaned up before another file exports the shared test database;
  restore validation must not be weakened to accept that corruption.

The baseline five focused suites (34/34) passed before this repair. The new RED
cases are expected to fail against that baseline and then pass after the bounded
implementation; exact counts and PostgreSQL proof belong to the integrator's QA
receipt.

## Acceptance and negative criteria

| Area | Acceptance | Negative / rollback proof |
|---|---|---|
| Restore arrays | Current exports contain protected arrays; legacy unavailable state is explicit and empty-target-only. | Missing live protected data, malformed/partial arrays or TOCTOU row causes refusal before wipe; counts/rows/audits remain unchanged. |
| Manifest chain | Valid rows restore in predecessor order. | Missing predecessor, duplicate/self link or cycle refuses before first delete; FK remains satisfied. |
| Rollup | Atomic serializable read → upsert → delete → audit; route replay is one result per UTC day. | Two PostgreSQL callers do not double-count; injected failure leaves raw, rollup and audit unchanged; 90-day boundary and no-PII shape remain. |
| Archive root | Local/test ergonomics survive; production uses explicit absolute canonical root. | Missing/relative/temp production root fails before key/file/manifest/tombstone/read; no mount proof is claimed from the env value. |

## Deployment, rollback and limitations

* This plan authorizes source/tests only. It does not configure
  `ZURI_ARCHIVE_KEK`, `ZURI_ARCHIVE_DIR`, rollup bearer credentials, a scheduler,
  a compose overlay or a host mount; it does not apply migrations or execute
  production DB mutations, archive sweeps, rollups or KI17.
* ADR-093 D3's actual dedicated host disk and `/archive` bind mount remain a
  deployment evidence gate. ADR-095's route is not active until its deployment
  token and scheduler are separately authorized. Local tests cannot establish
  either condition.
* Rollback is application rollback to the exact previously approved image/SHA
  after CI and isolated checks. No schema rollback is defined because this
  slice adds no migration. If a future activation has already created archive,
  rollup or audit rows, an owner-led data review is required; an image rollback
  does not erase those rows or reconstruct lost legacy evidence.
* The mandatory PostgreSQL final-candidate receipt above proves the current usage
  implementation's serializable conflict/retry and rollback behavior in an
  isolated provider harness; it is not production evidence and must be rerun
  when that source changes. Physical storage separation and production
  readiness remain `UNKNOWN` until their own deployment receipts exist.

## Risk and complexity

Overall `HIGH / C-3`. The code delta is intended to be small and schema-free,
but a restore can delete the entire installation, a rollup can erase raw
person-attributed events after the retention boundary, and archive storage holds
customer evidence. The risk is controlled by pre-mutation refusal, one
transaction, database-backed concurrency, focused negative tests and separate
deployment gates. No optional feature or adjacent cleanup is included.

## Version diff

`0.1.2b` is the current repair plan at this path. It adds no requirement,
ADR, schema, migration, registry or ledger change. Root runs governance and
retains the derived `apps/server/runtime/domain-state.json` test edges/counts;
workers do not hand-edit that generated output. The source
and tests listed above are the complete proposed diff; implementation evidence
will be recorded by the integrator after the code and provider-real checks.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Bounded repair specification with exact source/test allowlist, acceptance, rollback and deployment limits | base 138db6630e650e3c695b81158eff3cecdad6d0a5 | Luna Max |
| 0.1.1b | 2026-09-16 | candidate | Tightened manifest/hash-chain, PostgreSQL release-gate and mount-info evidence contract after candidate review | pending | Luna Max |
| 0.1.2b | 2026-09-16 | candidate | Bind final Linux source proof, include independent restore regressions and distinguish root-generated governance output | pending | RWANG |
