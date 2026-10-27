---
doc_type: implementation-evidence
status: in-progress
version: "0.1.0"
recorded_at: "2026-10-28"
implementation_base: "d8362e9835a44e39c5c7f3d7abbf2306c3411747"
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

The new observation-gate regression failed as expected on the baseline: seven
generic provider cases incorrectly returned PASS without pricing admission.
Runtime regression, corrected checks, provider identities, independent review,
build and governance results will be recorded after execution. No unrun check
is PASS. Production/provider-license approval, Linux-host installation, complete
restore, release and selected AI profiles retain their separate gates.
