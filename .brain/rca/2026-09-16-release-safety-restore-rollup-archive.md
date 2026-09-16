---
version: "0.1.1b"
created_at: "2026-09-16T21:19:14+07:00,Luna Max,base 138db6630e650e3c695b81158eff3cecdad6d0a5"
last_update: "2026-09-16T22:30:36+07:00,RWANG"
status: candidate
superseded_by: null
attributes:
  domain: cross-domain-release-safety
  doc_type: root-cause-analysis
  scope: backup-restore-usage-rollup-chat-evidence-archive
relations:
  - type: references
    target: ZAI:ADR-093
  - type: references
    target: ZAI:ADR-095
  - type: references
    target: ZAI:FR-013
  - type: references
    target: ZAI:BR-008
  - type: references
    target: ZAI:FR-075
  - type: references
    target: ZAI:FR-197
  - type: references
    target: ZAI:FR-245
  - type: references
    target: ZAI:NFR-023
---

# RCA — release safety gaps in restore, usage rollup and archive storage

## Evidence boundary

This RCA is based on the clean release-safety worktree at commit
`138db6630e650e3c695b81158eff3cecdad6d0a5`, branch
`codex/release-safety-fixes-20260916`. The source and test paths were enumerated
with `git ls-files` before absence claims. Existing local baseline evidence was
five focused suites with 34/34 tests passing; that is local test evidence only,
not PostgreSQL or production evidence. No production database, archive mount,
credential, scheduler, migration, archive run, rollup run or KI17 run was used.

## Symptoms

### 1. A same-version legacy snapshot can erase live archive and rollup rows

`SNAPSHOT_MODELS` contains `customerArchiveKey`, `archiveManifest` and
`usageEventRollup`, so a current export includes those arrays. A legacy artifact
with the still-supported `schemaVersion: "1.0"` can predate those entries and
omit one or more `tables` members. The import preview counts an omitted member
as zero and remains valid. The confirmed import then uses `snapshot.tables[model]
|| []`, deletes the live table, and recreates no rows. A live archive key makes
retained evidence unreadable; a live manifest makes files undiscoverable; a
live rollup loses counts.

The related archive chain has a second restore hazard. `ArchiveManifest` has a
real self-referential `previousManifestId` foreign key. Export does not specify
an order for `findMany`, and import creates each row in the raw array order.
The restore can therefore fail on a child before its parent, or accept no safe
way to restore an invalid, missing-reference or cyclic chain before the
destructive wipe begins.

### 2. Rollup is a multi-step operation without an atomic concurrency boundary

`rollupUsageEvents` reads every stale raw row, groups in memory, performs a
`findUnique` followed by `update` or `create`, deletes the selected raw ids, and
creates the audit row as separate operations. A crash can leave a summary without
the corresponding raw deletion, or a deletion without its audit. Two workers can
read the same stale rows, both increment a summary, race the unique key, delete
the same ids and emit duplicate audits. The route's once-per-day `findFirst`
guard is outside the service transaction, so two requests can both observe no
audit row and start work.

### 3. Production archive writes default to OS temporary storage

`resolveArchiveBaseDir` returns an OS temporary directory when
`ZURI_ARCHIVE_DIR` is absent, regardless of `NODE_ENV`. The archive writer
resolves that fallback before minting a Customer key and writes a file after
that. A caller-supplied `baseDir` also bypasses the resolver. Retrieval has the
same default and reads through the resolver. Consequently a production process
with no approved archive path can create key material or archive files in
ephemeral local storage, while the approved ADR-093 `/archive` mount is not
proved or selected.

## Evidence

### Restore source and schema

* `apps/server/src/modules/project-manager/application/backup-service.js:204-209`
  lists `usageEvent` and `usageEventRollup`; `:330-349` lists
  `customerArchiveKey` and `archiveManifest` as included snapshot models.
* `backup-service.js:1114-1121` exports one array per model, but has no
  completeness marker for these later protected members.
* `backup-service.js:1155-1172` checks only the schema version and treats a
  missing model array as a zero count.
* `backup-service.js:1183-1225` has unavailable/live-row guards for billing,
  stocktake, marketing broadcast and LINE worker memory. It has no equivalent
  guard for the archive family or usage rollup.
* `backup-service.js:1268-1300` previews before opening the transaction, then
  deletes all snapshot models and recreates each row with
  `snapshot.tables[model] || []`. There is no commit-side live-row recheck.
* `apps/server/prisma/schema.prisma:2195-2218` defines the
  `ArchiveManifest.previousManifestId` self-FK and its `nextManifests` relation.
  `backup-service.js:346-348` describes restore order as a convention, but the
  database still enforces the self-FK.
* `apps/server/prisma/schema.prisma:5310-5319` provides the existing unique
  `(date, kind, target)` key for `UsageEventRollup`; no migration is needed for
  the repair. `schema.prisma:2268-2305` shows that `AuditEvent` has no unique
  once-per-day key.

### Rollup source and route

* `apps/server/src/modules/platform-control/application/usage-events.js:46-64`
  performs stale-row read, in-memory grouping, read/modify/write summary updates
  and raw deletion without a transaction.
* `usage-events.js:65-69` creates the audit only after the deletion and returns
  its id; a failure at either boundary leaves an incomplete run.
* `apps/server/src/app/api/platform/usage-events/rollup/route.js:27-43`
  performs the daily `AuditEvent.findFirst` before calling the service. This
  check and the service work do not share a serializable transaction or a
  database-backed claim.
* `apps/server/prisma/schema.prisma:5298-5319` confirms the rollup is a
  person-free daily count and has the composite uniqueness needed for an atomic
  upsert. The raw `UsageEvent` fields at `:5286-5295` retain person identity
  only before the cutoff.

### Archive source and retrieval

* `apps/server/src/modules/crm/chat-evidence-archive-service.js:25-31` says the
  production mount is deferred, while `:78-82` unconditionally falls back to
  `path.join(os.tmpdir(), 'zuri-chat-evidence-archive')` when the variable is
  unset. The repair must prove an existing real `/archive` mount boundary (or
  fail closed); an absolute env value by itself is not that proof.
* `chat-evidence-archive-service.js:153-162` can mint and persist a Customer
  archive key; `:290-321` resolves the directory, gets the key and writes the
  archive file in that order. A production path guard must precede all three.
* `apps/server/src/modules/crm/chat-evidence-retrieval-service.js:113-116`
  resolves the same fallback for retrieval, and `:167-185` verifies and reads
  files below that root. The production guard must apply to this read boundary
  too, without changing the deliberate local/test override.
* `docs/decisions/ADR-093-SWEPT-CHAT-CONTENT-MOVES-TO-AN-ENCRYPTED-LOCAL-COLD-ARCHIVE.md:50-62`
  requires write, flush/read/hash verification before tombstone and names the
  dedicated `/archive` mount; D3 also requires a separate host disk.
  `docs/PRD-SDD-v1.0.md:808` carries the same SDD-103 file and mount contract.

### Test coverage that escaped the defects

* `apps/server/tests/integration/backup.test.js:296-349` creates archive key and
  manifest rows and asserts several current snapshot arrays, but does not assert
  `usageEventRollup` and does not feed a same-version artifact with omitted
  protected arrays. Its round-trip assertions at `:465-490` cannot expose a
  legacy omission because the test exports the current model list.
* `apps/server/tests/unit/usage-events.test.js:102-130` proves the 90-day
  grouping and a serial second call with a hand-built fake database. It has no
  transaction-failure or two-client PostgreSQL race case; the fake cannot model
  row locks or serializable conflicts.
* `apps/server/tests/integration/crm-chat-evidence-archive.test.js:72-195` and
  `crm-chat-evidence-retrieval.test.js:93-231` pass an explicit temporary
  `baseDir` for local isolation. They do not exercise production with the
  directory unset or verify that a missing production root prevents key/file
  writes.

### Full-suite fixture failure found by the new guard

The first full candidate run reported 5,950 passing tests, six failures and
32 skips. Five failures were otherwise-valid restore tests; the sixth compared
a stale bundled readiness projection with regenerated canonical data.

The focused reproduction retained at
`pm-parallel-qa/20260916/release-safety-fixture-errors-20260916.log` reports the
actual restore errors: an archive manifest is not self-consistent, its root
has a predecessor hash, and its Tenant has two roots. The row came from
`apps/server/tests/integration/crm-chat-evidence-retrieval.test.js`'s deliberate
chain-corruption case: it updates `previousManifestHash` and sets
`previousManifestId` to null, while the old cleanup removes only temporary
files. `tests/global-setup.js` provisions one SQLite database per run, shared
by serial files, so later exports include this deliberately corrupted row.
The new import guard correctly refuses that snapshot. Cleaning only the archive
writer fixture did not resolve the five failures in the focused reproduction.

The bounded prevention is to remove each archive/retrieval file's own manifest
and key rows after its assertions, deleting children before parents. The
refusal checks and original authorization assertions stay intact. This fixture
repair does not relax the production validator. The integrator also regenerates
and retains `apps/server/runtime/domain-state.json`; it must not be reset to the
old committed projection after governance runs.

## Root cause

1. The backup list is current-version metadata, but the import boundary assumes
   every same-version artifact has every later list member. `Array.isArray(...)
   ? length : 0` and `|| []` convert “not present in this artifact” into “an
   intentional empty table”. The feature-specific recovery guards were added one
   feature at a time and do not cover the archive/rollup family. The import
   preview is also outside the destructive transaction, so a row can appear
   after preview and before the wipe with no guard at the commit boundary.
2. Rollup has no transaction around its read, aggregate, delete and audit units;
   its `findUnique` plus `update/create` is a read-modify-write race. The daily
   route check is a separate, non-unique read and therefore cannot claim a run
   under concurrency. SQLite's serial local test execution does not establish
   PostgreSQL behavior.
3. The archive resolver was intentionally ergonomic for development and tests,
   but the same fallback is reachable in production and explicit `baseDir`
   bypasses the resolver. The code has no production suitability assertion and
   no distinction between an app-level configured root and proof that the host
   mounted a separate physical disk.

## Why detection escaped

* Existing green backup tests exercised the present export shape, not older
  artifacts or a live row appearing between preview and import. They also did
  not exercise the self-FK with child-before-parent ordering or invalid chains.
* Existing rollup tests were serial and used an in-memory fake. No test injected
  a delete/audit failure, forced two clients through the same stale read, or
  called the HTTP route concurrently. No PostgreSQL proof was part of the
  baseline.
* Archive tests deliberately passed a temporary test root and therefore proved
  file integrity, not production storage readiness. The OS-temp fallback was
  documented as a test/dev convenience and had no negative production test.
* The repository's governance checks can verify annotations and model-list
  coverage, but they cannot infer an omitted member in a legacy JSON artifact,
  transaction atomicity, database isolation, or physical mount topology.

## Prevention

1. Treat `customerArchiveKey`, `archiveManifest` and `usageEventRollup` as
   protected restore tables. Distinguish present arrays, malformed arrays,
   partial archive-family arrays and wholly omitted legacy arrays. Refuse
   malformed/partial data before any mutation. When a whole protected family is
   unavailable, keep an explicit `UNAVAILABLE` result; permit a confirmed empty
   target only with that warning, and refuse when live rows exist. Recheck the
   live protected counts inside the restore transaction before the first delete.
   Validate archive manifest references, cycles and parent-before-child order
   before the transaction and create parents before children.
2. Run rollup read, aggregate upsert, raw deletion and audit creation in one
   serializable transaction. Use the database's serializable conflict handling,
   the existing composite rollup key for atomic upsert, and bounded retries for
   serializable/unique conflicts. The route passes an explicit once-per-day mode
   whose audit existence check is inside that same transaction; no in-memory
   mutex or preflight-only guard is sufficient. Keep the cutoff, UTC keys,
   counts-only payload and 90-day person boundary unchanged.
3. Keep OS-temp fallback for local/test operation only. In production, require a
   configured absolute canonical non-temp root that exists as a real directory
   and is present in the Linux mountinfo boundary (the approved container value
   is `/archive`) before reading/writing archive storage or minting a key. Reject
   symlink/reparse escapes. Treat the app check and the host's separate-disk
   proof as separate release gates. Test the production refusal before any key,
   file or tombstone mutation.
4. Add focused regression tests to the existing allowlist and make PostgreSQL
   concurrency/rollback evidence a release gate. Mark all unrun production,
   mount and scheduler evidence as `NOT RUN` or `UNKNOWN`; never promote local
   green tests to activation evidence.

## Containment and status

The bounded repair is HIGH risk / C-3 because it protects an installation-wide
destructive restore, an append-only operational audit and encrypted customer
evidence. It is intended to be schema-free and additive at the behavior boundary.
No migration, registry, credential, mount, scheduler, production database
mutation or archive/rollup activation is part of this RCA. Root's governance
regeneration retains the derived runtime test edges. The companion plan
defines the exact code and test allowlist. The proposed repair is candidate
documentation pending the integrator's review of implementation and PostgreSQL
proof.

## Version diff

`0.1.1b` adds the full-suite fixture diagnosis and the generated-projection
repair to the initial release-safety RCA. No requirement, ADR, schema or
registry ID is renumbered or reworded.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Evidence-backed RCA for legacy restore data loss, non-atomic usage rollup and production archive temp fallback | base 138db6630e650e3c695b81158eff3cecdad6d0a5 | Luna Max |
| 0.1.1b | 2026-09-16 | candidate | Record reproduced retrieval fixture leakage and required generated-projection refresh without weakening restore validation | pending | RWANG |
