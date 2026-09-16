# Commerce pricing production release preparation

Owner instruction: `commit/deploy migrate production` on 2026-09-17.
Complexity C-3; risk HIGH (pricing, application authorization and additive schema).

## Exact composition

- Original tested pricing implementation: `2c3949e2`.
- Published `main` `9ad61f8a` claimed FR-252/ADR-097 for Project Feature authority first. Pricing is now **FR-253 / ADR-098**. The sanctioned ledger writer records the branch renumber; published main retains its identities. Historical `fr252` evidence filenames describe the prior local candidate and are deliberately retained.
- Live web/LINE worker source is `11675e598fb601fa09ba9ed33bc080650cd41217`, image `zuri-ai-web:release-11675e59`. It contains CRM legal-hold behavior not yet in main. Release composition `10ef641f` retains that exact deployed implementation; the newer, unmerged PR442 branch is not imported.
- Pricing adds two models and six API paths/seven operations. Including the retained live CRM route, the composed API has 296 paths/395 operations and the Prisma schema has 171 models.
- No synthetic fixture, default pricing approval, live catalog ingestion or business-policy activation is part of deployment. An OWNER must approve an effective pricing rule before the new authoritative quote path can calculate prices; missing rules fail closed.

## Production preflight and rollback dry-run

Verified target: Supabase project `qcnmhyglarzcpudjorzc`; schema `public`; migration authority `postgres`.
Migration `20260917030000_commerce_pricing_rules` creates only `PricingRuleSet` and `PricingCalculation`; no data backfill or deletion.

The exact SQL body was executed inside an explicit transaction after removing its outer BEGIN/COMMIT and was rolled back. Validation passed: 36 columns, 8 indexes, 6 foreign keys, forced RLS on both tables, runtime grants including inherited restore DELETE, and no access for anon/authenticated/service_role. Both tables were absent again after rollback. Sanitized receipts are retained outside git in the release QA directory; no credential or connection URL is recorded here.

The live image, LINE overlay, credential mount, environment fingerprint and rollback image were inventoried. Promotion must preserve their identities and verify local/public health and the LINE worker. Additive pricing tables remain after image rollback; rollback never drops evidence.

## Existing release limitations

The live application DATABASE_URL currently authenticates as `postgres` with `rolbypassrls=true`. This is a confirmed pre-existing condition already recorded in the PM release RCA. Catalog RLS/grant checks do not prove that application's queries are subject to the intended non-bypass runtime role. This task has not changed credentials, roles, passwords or grants outside the reviewed migration. Runtime-role remediation needs its own verified connection rollout; do not claim production security readiness from the table checks.

The exact-live CRM backup implementation also allows old snapshots omitting CustomerLegalHold to remove holds; this is inherited behavior, not changed by pricing. The new pricing snapshot omission/lineage guards remain enforced. Record this finding separately rather than silently modifying the already-live CRM lifecycle in a pricing release.

## Verification status

- Original pricing tree: 6,136 tests passed; 32 existing skips; browser 201 passed/4 skips/0 flaky; build passed; native regression 36/36 and final computed-price 1/1 passed.
- Composed release: governance and focused/full verification IN_PROGRESS; hosted CI NOT_RUN; image build NOT_RUN.
- Production migration: DRY_RUN_PASSED / NOT_APPLIED.
- Production deployment: NOT_DEPLOYED.

Version diff: register pricing FR-253/ADR-098, PRD 1.236.0b → 1.237.0b; retain the published PM subjects and the exact live CRM baseline.
