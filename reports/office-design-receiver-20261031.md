---
doc_type: verification-evidence
status: local-evidence
version: "0.1.0"
---

# Office design receiver: local verification, 31 October 2026

This is evidence for [FR-294](../docs/requirements/FR-294.md) on the isolated
`codex/office-handoff-receiver` branch, based on Zuri `5f73c1d88db7c338ae41f7d94776acfe015e0e4d`.
The actual owner request is pinned in scope checkpoint `f3abb4df9894aa065ab6697ad69e9463443f67b9`;
it authorizes implementation/testing, not production acceptance. The immutable
record-migration mandate copy remains at version 0.1.0; the live note's 0.1.1
technical corrections do not manufacture another approval.

## Observed behavior

The actual Visual Office main export, producer commit
`b4e2d8edec9d8dbad32573d860cff3a6a27efbbd`, passes through authenticated
Next HTTP, Identity CSRF, the pinned offline verifier and a real DB transaction.
It registers 1,655 internal visual-design mappings, including 15 floors and 60
agent-design slots, with 17 GLB revisions. A producer-built revision containing
a measured external Kenney rounded-back CC0 chair registers 1,658 mappings and
18 GLB revisions while preserving existing internal identities. The stock ZIP
SHA-256 is `9c21ab58ae3ca1e0c27f65f2437858443f6ac96ea7dcf05943dc077b8b227933`.

Tests disconnect/reopen the DB, read committed manifests/mappings and exact GLB
bytes, replay the original receipt, reject stale or changed-key commands, and
exercise simultaneous initial imports and competing revisions. A deliberately
failed final audit write rolls back identities, bytes, revision, receipt and CAS.
Cross-Business/Tenant, revoked Membership/session, missing CSRF, invalid package,
actor replacement and forged custom measurements are refused. Existing
BusinessAgentConfig and AgentApprovalRequest counts do not increase; business
fixture setup itself creates its normal BusinessAgentConfig before import.

## Executed checks

| Check | Actual result |
|---|---|
| Existing Identity/session/import baseline, 3 files | 33 passed before implementation. |
| Final scoped SQLite suite, 10 files, start 12:22:45 +07 | 83 passed, 1 existing POSIX-remount test skipped on Windows; no failures. This is not the whole Server suite. |
| Disposable PostgreSQL suite, 3 files, start 12:18:22 +07 | 12 passed: the 10-case HTTP-handler/DB lifecycle, additive SQL constraints/bytea test, and actual built standalone HTTP journey. |
| Actual loopback Next dev HTTP journey | 1 passed after fixing real route/Origin/worker packaging failures. |
| Production standalone build | Completed successfully, including compile, lint/type checks, page collection and file tracing. Native worker, graph preflight and pinned bundle are present in the standalone output. |
| Canonical registry/graph/views, govern and corpus | Govern passed with 0 critical/0 warning; 556 records, 96 views and the generated corpus checked. Final report/index reconciliation is checked again before delivery. |
| Independent Luna Max source review | No remaining confirmed Critical/Important finding after fixes; the reviewer ran no tests and issued no GitHub approval. |

The scoped SQLite command selects `office-design-registration`,
`office-design-package`, `office-design-backup`, `office-design-http`,
`office-design-provenance`, existing `backup`, `viewer-authority`,
`fr046-session-port`, `import-target-authorization` and
`identity/api-write-csrf` tests through the repository's nonzero-test wrapper.
PostgreSQL command:

```powershell
$env:OFFICE_HTTP_STANDALONE='1'
node scripts/assert-tests-ran.mjs vitest run --config vitest.office-design-postgres.config.js
```

The PostgreSQL setup creates an owned embedded loopback cluster and accepts no
shared DB URL. The standalone test boots the built app against that DB with an
actual persisted session and `/api/auth/csrf` token. All owned test servers and
clusters stop afterward. No primary-checkout DB, Supabase, production migration,
account or shared runtime is changed.

Local evidence is retained under `apps/server/.local/`: final scoped logs,
`qualification/sqlite-83-frozen.json`, `qualification/postgres-12-standalone.json`
and a source fingerprint. These are machine-local locators, not portable tracked
artifacts. No raw GPU trace or sealed Visual Office QA archive is included in
this patch. The two bounded compressed design packages are test fixtures with
null initial Business/Agent bindings and explicit digest/provenance records.

## Review corrections and retained failed evidence

The real Next journey exposed a dynamic slug collision with the existing `[id]`
tree, localhost normalization that defeated an ad hoc Origin comparison, and
webpack rewriting of a native validation worker. The composed implementation
uses the existing route tree, Identity's configured-origin/session CSRF seam and
an explicitly traced native worker. Failed runs remain in local logs.

Independent review led to a fixed actor digest, a linear fixed-catalog work
preflight, intake reservation before buffering, and case-insensitive Office
snapshot refusal. A negative actor test first reproduced acceptance of a
rehashed actor replacement, then passed after pinning. The first documentation
v1 addition attempt would have shifted historical authored export order; it was
replaced with the sanctioned authored-v2 migration without weakening history
checks or changing old identities. A PostgreSQL test initially mistook the
non-destructive `ON DELETE RESTRICT` clause for a DELETE statement; the check now
rejects destructive statement starts, and the actual migration/constraints pass.

## Remaining limits

- This registers visual design custody. It creates no canonical runtime Agent,
  Membership, domain, permission, approval, action execution or business workflow.
  The canonical requirement delivery row remains planned and existing Visual
  Office phase/task acceptance is unchanged.
- The separate Office UI still exports/downloads the handoff. It has not been
  enrolled or wired to post to this receiver; no CORS/public-client grant or live
  user Business import was performed. The observed writes use isolated real DBs
  with explicitly synthetic scope records.
- Legacy JSON export/restore refuses nonempty Office registry custody with
  `OFFICE_DESIGN_RECOVERY_UNAVAILABLE`; portable design recovery and cloud blob
  storage/retention are not qualified. Consistent whole-database custody is
  required rather than silently omitting IDs or bytes.
- The producer/catalog/actor are pinned. New producer revisions and rigged
  custom models require a new reviewed compatibility contract. Two upload slots
  are per process/instance, not a cluster rate limit; heap/time bounds do not
  promise a resident-memory or multi-tenant load SLA.
- Full Server/Edge/Runtime suites, hosted exact-head CI, deployed migration,
  production role/RLS acceptance and production deployment were not run. No
  earlier Office GPU/FPS result is relabelled as a Zuri receiver measurement.
