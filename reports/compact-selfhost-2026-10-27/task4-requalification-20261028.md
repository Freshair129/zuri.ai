---
doc_type: implementation-evidence
status: reviewed
version: "0.1.1"
recorded_at: "2026-10-28"
implementation_base: "d8362e9835a44e39c5c7f3d7abbf2306c3411747"
qualification_revision: "19f53c162faf57f706d230adf248b6eb6e8c79eb"
approved_plan_commit: "e5fcfd4b599d328c1b1210b310746e6a573f2c25"
---

# Task4 requalification: private Asset and catalog storage

This evidence snapshot checks the existing Task4 against [ADR-115 D6](../../docs/decisions/ADR-115-COMPACT-SELF-HOST-PROFILE.md)
and the approved [implementation plan](../../docs/plans/COMPACT-SELF-HOST-IMPLEMENTATION-20261027.md).
It does not change canonical requirements, membership, authority or lifecycle.
The original [Task4 report](task4-business-storage.md) and its observations remain
historical evidence. The owner selected this bounded requalification on a new
branch in the primary checkout, with tests and independent review; no worktree,
production, main-dev/UAT operation or provider migration is selected.

## Reconciled scope before the correction

The baseline implements private version-pinned Asset/catalog objects, explicit
configuration, purpose separation and current FileAsset scope checks. Fresh
baseline checks passed: nine consumer files /62 tests and seven actual-provider
tests, no skips. They use a newly owned TEST MinIO fixture and disposable SQLite;
they do not qualify PostgreSQL, a live extractor or a production provider.

Two gaps remain within the existing Task4 contract:

1. The actual-provider catalog case directly writes JSON/FileAsset metadata.
   It does not execute the real Commerce pricing-catalog admission consumer.
   Add approved pricing rules, Inventory ledger evidence, preview/admission,
   managed FileAsset read, durable queue assertions, replay and denied-authority
   checks through the configured S3 factory. No model or Knowledge worker runs.
   The observation must not claim full parity from the original seven cases.
2. S3 `readExact` computes SHA-256 and length, but the business bridge returns
   only bytes. FileAsset already owns hash/size metadata. Bind its new business
   S3 reads to those persisted values and refuse mismatched content before
   extraction/admission effects. Preserve the existing `put/get/remove` port,
   ref-only trusted cleanup and legacy Supabase/Knowledge behavior.

This applies the existing hash/version boundary in D6 alongside
[ZAI:SEC-024](../../docs/requirements/SEC-024.md),
[ZAI:FR-137](../../docs/features/FEAT-016/requirements/FR-137.md),
[ZAI:FR-173](../../docs/features/FEAT-013/requirements/FR-173.md) and
[ZAI:FR-253](../../docs/requirements/FR-253.md); it adds no new requirement.
The canonical FileAsset metadata contract permits a nullable SHA. Do not invent
a mandatory hash for legacy records: compare available persisted hash/size,
validate supplied integrity expectations before provider I/O, and state this
limit. New Asset evidence and pricing writers already persist both values.
Low-level trusted calls without metadata retain their exact-version semantics.

The reviewer found no untrusted route that directly reads/deletes a supplied
business ref without the current FileAsset authorization funnel. Requiring
scope fields on every trusted ref-only cleanup is therefore outside this
correction. No authority guard is relaxed.

## Evidence and gates

| Check | Executed result and boundary |
|---|---|
| Baseline consumer contracts | 9 files /62 passed, no skips |
| Baseline actual provider | 7 passed, no skips; original scope retained |
| Observation gate RED | Original seven completed cases returned PASS without the real pricing consumer; the new negative assertion failed |
| Integrity unit RED | Seven failures: gate, wrong hash/size and malformed expectations; 11 existing tests passed |
| Actual consumer RED | With a valid TEST extractor, wrong persisted hash still reached extraction and changed evidence to EXTRACTED;1 failed /8 passed |
| Corrected unit/consumer suite | 16 files /121 passed, no skips, including Supabase, Knowledge S3, FileAsset, Asset intake, catalog and authorization consumers |
| Source-bound actual provider | 9 passed, no skips on clean tracked source 19f53c16; all observation checks and owned cleanup PASS |
| Compact orchestration | 202 passed, no skips |
| Server build | Compilation, lint/types and 94 static pages passed with an explicitly disposable SQLite DB and ambient PostgreSQL aliases removed |
| Documentation readers | 146 passed, no skips |
| Serial graph/views and initial governance | Strict preflight 0 critical / 0 warning / 43 info; generated tracked views reconciled through their tooling |
| Independent review | GPT-6 Luna Max reviewed the runtime patch and reconciled the final source/provider evidence; no remaining code or evidence blocker. The reviewer ran no tests, generators or Docker |

The [redacted observation](task4-requalification-observation-20261028.json)
binds 15 source/config/lockfile hashes and the source tree to qualification commit
`19f53c162faf57f706d230adf248b6eb6e8c79eb`. Later documentation closeout does
not relabel the tested executable source. This is host-executed port/consumer
evidence, not a newly packaged or rebuilt Compact release artifact.

The actual provider is cached TEST image
`sha256:ca499c729f62921367079f685d29e03e262b2d1be31e0af9fa6f6b564dc8850f`,
with command `server /data --address :9000 --quiet`. Run
`0caa371b-8d11-41cc-ad93-08a8f94a5168` created its own labeled container,
volume, network and random loopback endpoint; bootstrap-only authority created
versioned buckets and distinct purpose-scoped app credentials. The app ports
used those restricted credentials. No real or persistent credential appears
in the observation or this report. Provider/license approval for production
is not inferred from this cached MinIO fixture.

Pricing acceptance executes the actual approved-rule/Inventory-ledger preview
and admission path without an injected storage port. Its positive provider GET
assertion is made before the test's separate readback, so a vacuous version
check cannot substitute for admission reading the object. Replaying after a
ledger change keeps the FileAsset/calculation identities and performs no second
PUT. A non-owner request causes neither provider I/O nor DB/audit writes.
The three durable jobs remain QUEUED with no execution run: worker/model/native
Knowledge and publication are not tested or qualified here.

Integrity assertions cover wrong persisted hash, wrong size, nullable hash with
wrong size, matching metadata and nullable hash with correct size. Refusal
precedes the extractor call, evidence state mutation and audit writes. Malformed
expectations, including trailing CR/LF and Unicode separators, cause no provider
I/O. No endpoint, digest, provider exception or credential is returned in an
integrity-error payload. Trusted ref-only reads remain version-checked without
an additional metadata expectation; legacy ports ignore the extra optional
arguments. This does not impose a new mandatory FileAsset SHA contract.

## First failures and resource observations

All RED results are retained. The first provider regression used an incomplete
extractor double and reached it before throwing; it was corrected to return a
valid candidate, then the stronger RED demonstrated a successful extraction and
state change despite the mismatched hash. The original seven-case observation could
still say PASS while the added integrity case failed. That historical output is
retained, not reclassified as nine-case acceptance; the new aggregator requires
both integrity and real pricing assertions before reporting full parity.

The private build helper initially stopped before Next with `__dirname` missing
when loading the existing Vitest setup from bare Node. A helper-only compatibility
shim supplied the fixture's existing path; the application was unchanged. The
successful build created and removed only its owned test database. The first
setup failure remains alongside the passing build log.

Before/after inventories match container IDs/names/states, volume names and all
named application-network IDs/names. The built-in default `bridge` network ID
changed during the overall interval; its cause is undetermined. No engine or
default-bridge mutation was issued by this task, and no repair was attempted.
Do not report all network identities as unchanged. Each provider run separately
verified ownership and removed only its captured TEST resources; the qualified
run's cleanup passed. Images, checkpoints, backups and the separate Visual
Office repository remain retained.

Hosted CI, PR/merge, E2E/core installation, PostgreSQL application parity,
production-provider/license approval, Linux-host installation, complete restore,
release and production activation are NOT_RUN by this requalification. Optional
AI profiles and later tasks retain their separate gates. The original Task4 and
Task3 exact-artifact observations are not replaced by this source-bound report.

Version diff 0.1.0 → 0.1.1: records the bounded integrity correction, actual pricing
consumer evidence, source/provider bindings, retained first failures and resource
comparison limits. No canonical statement, membership, lifecycle, role or schema
changes.
