---
version: "1.0.0"
created_at: "2026-09-17T23:00:00+07:00,RWANG"
last_update: "2026-09-17T23:00:00+07:00,RWANG"
status: active
attributes:
  domain: commerce
  requirement: FR-252
  spec: ADR-097
---

# Landed ledger cost boundary

## Symptom

The migrated Agent quote added the configured 2,500 THB truck charge to a ledger cost that already represented landed inventory. Partial unknown receipt costs could produce an apparently complete quote, and Number arithmetic could round a weighted receipt cost down. An explicit workshop override accepted a non-NONE technique with zero positions.

## Evidence

- `apps/server/src/modules/inventory/domain/inventory-costing.js`, `landedUnitCostSatang`: inbound truck is amortized into `unitCostSatang`; its contract explains that this is why standard customer freight is zero.
- `apps/server/src/modules/commerce/application/pricing-inventory-service.js`, pre-fix `priceLandedInventoryQuote`: absent `inboundTruckSatang` defaulted to `rules.logistics.domesticSingleDropThb`, then added it to `baseCostSatang`.
- `apps/server/src/modules/agent/tools/smartgift-inventory-tools.js`, pre-fix `unitCostOf`: delegated to permissive `weightedAverageUnitCostSatang`, which skips unknown costs and uses Number products/sums. A subsequent null check covered only positive-quantity unknown costs, leaving invalid quantities and exact arithmetic unresolved.
- The former AC-181.3 fixture expected ledger base 41,046 satang plus another 500 satang per unit truck allowance. It verified the duplicate instead of checking the receipt-to-quote cost boundary.
- The override branch multiplied setup/run rates by positions after accepting zero for every technique.

## Root cause

The factory-cost simulation default was reused at an already-landed ledger boundary without preserving its cost basis. The quote adapter reused a tolerant inventory arithmetic helper despite requiring complete authoritative cost evidence. Validation did not distinguish absent branding from active branding when workshop rates were explicit.

## Why the issue escaped detection

Quote tests began at arbitrary receipt costs and independently expected the configured truck addition. They did not create a receipt with `landedUnitCostSatang`, test mixed known/unknown receipts, or use an aggregate above Number's exact integer range. Zero-position branding was not exercised with explicit rates.

## Proposed prevention and implemented correction

- Landed quotes default to zero **additional** delivery. Only an explicitly supplied legacy `inboundTruckSatang` adds an order delivery amount, including an explicit zero; a warning states this meaning. Factory simulation retains its configured domestic freight behavior.
- Return `freightCostBasis` as `INCLUDED_IN_LEDGER` or `ADDITIONAL_DELIVERY`. `embeddedFreightSatang: null` preserves the unknown original breakdown. `freightAbsorbedSatang` measures only the additional override; customer `freightSatang` remains zero.
- Require every receipt quantity to be a positive safe integer and every cost to be a nonnegative safe integer. Compute weighted sums and ceiling division with BigInt; convert only a checked final satang integer. Reject partial unknown evidence instead of selecting its known subset.
- Require positive positions for every non-NONE customization, including explicit rates. Keep legitimate explicit zero rates valid and visible as overrides.
- Regression tests cover an actual landed-cost receipt, positive and zero additional delivery overrides, partial and invalid ledger evidence, exact weighted ceiling above safe aggregate range, and zero-position branding.

## Validation

Focused integration and engine regression tests are executed by the implementation task; final results are recorded in the task evidence rather than claiming production validation here.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---------|------|--------|---------|-------------|-------|
| 1.0.0 | 2026-09-17 | active | Record ledger boundary RCA and regression prevention | uncommitted | RWANG |
