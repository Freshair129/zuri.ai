# RCA — Route and recovery assertions lagged approved Inventory and Marketing surfaces

Version: 1.0.0b; Date: 2026-09-11; Status: beta.

## Symptom

The final focused test run failed four Inventory navigation/warm-up assertions
and two OpenAPI assertions after the approved FR-184 and FR-185 surfaces were
integrated. The failures expected the pre-stocktake Inventory path list, while
the approved surface included `/inventory/stocktakes`; the OpenAPI inventory
also had not yet listed four FR-185 handlers. A follow-up recovery review found
that a declared stocktake snapshot accepted only the JSON shape of committed
movement evidence, so tampered movement IDs and result balances were not
reconciled to the exported ledger rows.

## Evidence

The source of truth already contained the new path:

- `apps/server/src/lib/module-tabs.js` includes `/inventory/stocktakes` in
  `INVENTORY_TABS`.
- `apps/server/src/config/domains.js` includes the same path in the Inventory
  sidebar.
- `apps/server/src/app/(pm)/inventory/stocktakes/page.jsx` is the delivered
  page, and the FR-184 browser proof reaches it.

The failing assertions were in `tests/unit/scm-console-routes.test.js`,
`tests/unit/scm-group-navigation.test.js`,
`tests/unit/business-capability-navigation.test.js`, and
`tests/unit/e2e-warmup.test.js` (the latter reports the missing hand-listed
  warm-up path from `tests/e2e/warmup-routes.js`). The OpenAPI assertions were in
  `tests/integration/openapi-docs.test.js`; `CURRENT_API_ROUTE_INVENTORY` lacked
  `/api/growth/ask-marketing`, `/api/growth/broadcast-intents`,
`/api/growth/broadcast-intents/{id}`, and `/api/growth/paid-media`.

The recovery gap was in `src/modules/project-manager/application/backup-service.js`.
The existing backup round-trip covered valid rows and missing-manifest safety,
but did not mutate `resultJson` or compare its movement IDs, scope, kind,
reference, quantities, and per-line post-count balances with
`tables.stockMovement`. It also iterated truthy non-array line fields directly,
which could throw instead of returning an invalid preview.

## Root cause

The navigation tests pinned literal pre-FR-184 path arrays and a hand-listed
warm-up route set. FR-184 extended the existing Inventory console and its
tab/sidebar source, but the literals were not updated with the approved path.
The OpenAPI route inventory is a second hand-maintained mirror of the App
Router tree; FR-185 added four handler paths without adding them to that
mirror, and the fixed count assertion also remained at the preceding revision.
The stocktake recovery validator treated committed `movementIds`,
`movementCount`, `varianceTotal`, and `lineBalances` as self-authenticating JSON.
Those references are not database foreign keys inside a portable snapshot, so
the validator could not establish that a committed result described the
exported `ADJUSTMENT` rows for the same Tenant, Business, stocktake reference,
and line identity. A malformed `requestLines` or `lines` object could also reach
a `for...of` loop and throw before preview returned its validation result.

## Why the issue escaped detection

The Stocktake-specific integration and browser tests covered the new page and
API directly. The broader navigation tests exercised their own historical
fixtures and therefore failed only when the full suite compared the complete
path lists. Marketing's focused tests covered their handlers, but no route
inventory test was run against the updated OpenAPI source until the full suite.
The backup test only exported and restored an untampered snapshot, so it did
not exercise the acceptance boundary for hostile or incomplete committed
evidence. No test used a valid multi-line result whose aggregate variance was
larger than one Int32 value.

## Prevention

Keep the tab/sidebar equality assertion, warm-up registry coverage check, and
OpenAPI path/method parity assertion. When an approved page or handler extends
an existing module, update each explicit route mirror in the same change and
retain exact-order/count assertions. The OpenAPI inventory now includes the
four FR-185 handlers and reports 238 paths and 327 operations. Recovery now
guards line arrays, validates closed status and numeric bounds, reconciles every
committed movement ID to an exported same-scope `ADJUSTMENT` with the exact
stocktake reference, and checks movement quantities and result lines. Later
ledger movements remain valid because reconciliation follows only the committed
row's referenced movement IDs. Per-line values remain Int32 while the aggregate
variance bound is the approved 500-line safe-integer range.

Version diff: recorded the FR-184 navigation and FR-185 OpenAPI route
assertion drift and the FR-184 recovery acceptance hole; updated the four stale
Inventory/warm-up expectations, added the four FR-185 OpenAPI inventory entries,
refreshed the exact counts, and added malformed, missing, wrong-scope, wrong-kind,
wrong-reference, duplicate/count, result-balance, and multi-line aggregate
recovery regressions.

The first combined rerun exposed an isolation defect in the new backup test:
an installation-wide export also contains rows from earlier suites. Selecting
the first COMMITTED row could pick an existing two-movement result, so setting
movementCount to 2 did not corrupt it. The validator correctly accepted that
unchanged evidence. Tests now select their own committed/pending preview UUIDs;
the negative cases no longer depend on suite order or another Business's rows.
