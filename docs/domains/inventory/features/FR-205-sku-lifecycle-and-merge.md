---
domain: inventory
feature: FR-205
module: inventory
source: v2-native
bundle: FEAT-031
requirements:
  - FR-205
version: "0.1.0"
status: building
---

# FR-205 — The SKU lifecycle, and the merge that never deletes

## Intent

A SKU had two states, ACTIVE and ARCHIVED, and nothing between. Archiving had
no guard: a counted SKU with 500 on hand left every default list while the 500
stayed in the ledger's sum. And once a duplicate existed (FR-202 is the guard
against creating one; nothing guarded what was already there) there was no way
to make two SKUs one without losing history. An ERP item has a phase-out state
and refuses to be blocked with stock on it; this FR gives the SKU the same.

## Decisions worth recording

**Three states, five actions.** `Product.status` is ACTIVE, PHASE_OUT or
ARCHIVED. `PHASE_OUT` refuses every receipt (`INVENTORY_PRODUCT_PHASED_OUT` from
`movementRule`, so a goods receipt and a recipe build refuse it too) while
issues, corrections and the sell-down continue, and replenishment never
suggests it. `ARCHIVE` is refused while a counted SKU has on-hand
(`INVENTORY_PRODUCT_HAS_STOCK`) or an ACTIVE reservation
(`INVENTORY_PRODUCT_HAS_RESERVATIONS`) — BR-040. `REACTIVATE` returns a
phased-out or archived SKU to ACTIVE; a merged duplicate never can
(`INVENTORY_PRODUCT_MERGED`). Every action records the caller's `reason`.

**MERGE moves stock through the ledger, or not at all.** `MERGE { into }` needs
the same Business, the same nature and an ACTIVE survivor. When the duplicate
has on-hand and both are TRACKED / NONE, the service writes an ISSUE on the
duplicate and a RECEIPT on the survivor in the same transaction, reason
`SKU_MERGE`, reference `MERGE:<duplicate code>`, so "why does this one say 0 and
that one 15" is answerable from two rows. A lot- or serial-tracked duplicate
with stock is refused (`INVENTORY_MERGE_REQUIRES_EMPTY_STOCK`): a merge cannot
decide which lot or which serial the units were, so a person empties it first.

**References move; conflicts refuse.** Active identifiers move to the survivor
(the unique key is per Tenant, so nothing collides). Unit conversions move
unless the survivor already declares that unit (then the duplicate's is
retired). Bundle items and recipe lines are re-pointed unless the survivor
already appears in that bundle or recipe — a quantity sum would change the
BOM's meaning — and recipes whose output is the duplicate are re-pointed unless
the survivor has one at that batch size. Any of those, or an open work order
naming the duplicate, refuses the whole merge with
`INVENTORY_MERGE_BLOCKED_BY_REFERENCES` and the list, before anything moves.

**The duplicate stays.** It ends ARCHIVED with `mergedIntoProductId` set. Sales
and purchase order lines that name it keep naming it — they are history — and
`resolve` (FR-203) follows the pointer to the survivor. `mergedIntoProductId`
is deliberately not a foreign key: a survivor may itself be merged later, and
the chain is walked, not joined.

**Two audit rows.** `PRODUCT_MERGED` on the duplicate (survivor, moved
quantity, what was re-pointed) and `PRODUCT_ABSORBED_MERGE` on the survivor.

## Delivered (local, 2026-09-13)

- `Product.mergedIntoProductId`, the PHASE_OUT status value (TEXT column, no
  CHECK), migration in both trees (**not applied**).
- `productLifecycleRule`, `archiveGuard`, `mergeRule` in
  `domain/inventory-governance.js`; `applyProductAction` with `mergeBlockers`
  and `repointReferences` in the catalogue service; the merge desk on
  `/inventory/hygiene`.
- Tests: AC-205.1 and AC-205.2 in
  `tests/integration/fr201-inventory-sku-governance.test.js`;
  `tests/unit/inventory-governance.test.js`.

## Not in this slice

Merging across Businesses; automatic merge from the hygiene report (the report
proposes, a person disposes); moving a lot- or serial-tracked duplicate's stock.
