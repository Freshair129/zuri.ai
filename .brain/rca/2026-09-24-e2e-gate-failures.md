---
version: "1.0.1b"
status: candidate
created_at: "2026-09-24T00:00:00+07:00,RWANG"
last_update: "2026-09-24T01:56:10+07:00,RWANG"
---

# Full E2E gate failures: SKU finding selection and signup source quota

## Symptom

The full browser run completed 220 tests, skipped 4, and failed three tests
after retry: one SKU Hygiene assertion and two Marketing independent-review
setups. The failures did not indicate a production authorization or catalog
calculation defect.

## Evidence

- `fr206-sku-hygiene.spec.js` selected the first row containing the counted SKU
  and expected the missing-identifier message. The received first row was the
  earlier `CARTON_DATA_MISSING` finding for the same SKU.
- The inventory domain emits separate findings for missing carton attributes
  and missing identifiers. The page renders one table row per finding.
- `marketing-content.spec.js` and `marketing-strategy.spec.js` created a fresh
  browser context and email but sent signup without a source header. The route
  therefore counted both attempts in the process-wide `unknown` bucket and
  returned 429 after the suite had consumed the 20-attempt window.
- `fr253-pricing-rules.spec.js` already isolates its independent signup with
  the reserved documentation address `192.0.2.253`.

## Root Cause

The SKU test treated row order as the identity of a finding even though one
SKU can legitimately produce multiple findings. The two Marketing fixtures
isolated account identity but not the existing per-source signup quota.

## Why the issue escaped detection

The SKU assertion passed while the report happened to contain only one matching
finding or a different ordering. The Marketing tests passed in shorter or
different suite runs because the shared `unknown` bucket had not reached its
fixed-window limit. A new request context does not create a new server-side
rate-limit source.

## Proposed prevention

Assert each SKU finding by its semantic message and expected row count rather
than `.first()`. Give independent E2E signup actors the reserved documentation
source address used by the existing pricing fixture. Do not reset the limiter,
sleep around it, weaken the 429 contract, or change production rate-limit
behavior.

Risk: LOW. The change is limited to E2E fixture identity and row selection.

## Verification

- Targeted E2E: 8 passed, 0 failed, 0 flaky (`fr206-sku-hygiene.spec.js`,
  `marketing-content.spec.js`, `marketing-strategy.spec.js`).
- Signup/rate-limit regression: 29 tests passed across the two signup unit
  suites and the credential rate-limit integration suite.
- Full E2E: 223 passed, 4 skipped, 0 failed/flaky out of 227 tests. The
  required warm-up covered 456 modules (127 GET, 329 OPTIONS) in 637 seconds.

The E2E gate is accepted for this test-only change. Production database
migration and deployment remain separate, explicitly gated operations.
