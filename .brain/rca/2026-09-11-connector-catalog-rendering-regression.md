---
version: "0.1.0b"
created_at: "2026-09-11T00:57:25+07:00,RWANG,base b88c3817"
last_update: "2026-09-11T00:57:25+07:00,RWANG"
status: beta
---

# Connector catalog rendering regression during integration

Complexity C-1; risk LOW. This restores the existing FR-130 presentation
contract after the approved LINE settings consolidation; it adds no connector
or provider action.

## Symptom

The integrated browser suite fails the GitHub catalog test on both attempts.
The catalog renders the internal `NOT_CONNECTED` value and no explanation of
why the connector cannot be configured.

## Evidence

- `tests/e2e/fr130-connector-catalog.spec.js` requires `Not connected`, the
  existing Thai explanation, and no Connect button. Both attempts fail in the
  full integrated run; the adjacent read-model/filter test passes.
- `deriveConnectorStatus` still returns `NOT_CONNECTED` with
  `CONNECTOR_NOT_IMPLEMENTED` for GitHub, so the scope/read model is unchanged.
- Main `f320e888` rendered `CONNECTOR_STATE_LABEL`, `CONNECTOR_REASON_HINT`
  and `item.note`. Integrated OA commit `82396c73` dropped those render paths
  while condensing the Platform page. The browser failure screenshot also
  shows raw state values across the catalog rows.

## Root cause

The settings consolidation preserved connector derivation but omitted its
human-readable labels, reasons and notes. Existing evidence stopped reaching
the rendered surface.

## Why detection missed it

Focused OA/settings tests and the build passed without the existing connector
browser test. A correct DTO alone does not prove that the UI presents it.

## Prevention and repair

Restore only the removed presentation of the existing DTO. Retain the one
settings owner and no-action behavior. Keep the existing E2E assertions intact
and rerun both connector tests after the repair. Final integrated E2E remains
a delivery gate; a retry does not turn a failure into success.

## Verification

The repaired connector browser tests and the updated explicit-identity LINE
onboarding fixture pass 3/3 with retries disabled. The onboarding fixture now
proves missing destination is refused before supplying synthetic metadata; it
does not activate transport or use a real provider. The first full E2E run
remains recorded as 149 passed, four skipped and two failed. A final combined
run is still required after all lanes land.
