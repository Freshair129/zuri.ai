---
domain: inventory
feature: FR-202
module: inventory
source: v2-native
bundle: FEAT-031
requirements:
  - FR-202
version: "0.1.0"
status: building
---

# FR-202 — Variant identity: one physical variant is one SKU

## Intent

The only identity guard the catalogue had was `code` unique per Tenant. That is
no guard against how item masters bloat: the same colour-and-size entered twice
under different codes, a case of twelve created beside the single, a name typed
three ways. This FR gives a master the vocabulary to say what makes its SKUs
different from each other, and refuses a second SKU that is not different.

## Decisions worth recording

**Axes on the master, values on the SKU, the key derived.** `variantAxes` is an
ordered list of lower-case identifiers (`["color","size"]`, at most eight,
fixed at creation). Each SKU carries `variant` — one value per declared axis;
a missing axis is refused (`INVENTORY_VARIANT_AXES_INCOMPLETE`), an undeclared
one too (`INVENTORY_VARIANT_AXIS_UNKNOWN`). `variantKey` is computed, never
typed: `color=black|size=m`, each value passed through one normalization.

**One normalization for every identity comparison.** `normalizeToken` is NFC,
lower-case, and every character that is not a letter, a combining mark or a
digit removed. `Tumbler  Black`, `tumbler-black` and `TUMBLER BLACK` are one
token; Thai tone marks are marks and survive. It is deliberately not fuzzy: a
fuzzy guard refuses real variants and gets switched off.

**Unique by index, archived or not.** `@@unique([productMasterId,
variantKey])`. A second SKU for a combination that exists is refused with
`INVENTORY_PRODUCT_VARIANT_EXISTS` naming the first, its code and its status —
and when the first is archived the answer is `REACTIVATE` (FR-205), not a new
row. The index tolerates NULL, so every SKU written before this FR keeps a
NULL key and nothing existing collides.

**The legacy columns feed a same-named axis.** A master that declares
`["color"]` accepts the SKUs that were already being written with `color`; the
`variant` map wins when it names the axis, the column stands in when it does
not.

**No axes, no key — and the lookalike guard instead.** A master that declares
nothing enforces nothing by key (the hygiene report says so:
`MASTER_WITHOUT_AXES`). For every master the service additionally refuses a new
SKU whose normalized name, colour, material and variant key exactly match a
live SKU under the same master (`INVENTORY_PRODUCT_LOOKALIKE`), unless the
caller passes `allowLookalike: true` — recorded in the audit row with the SKU
it looked like. An empty description (no name, no colour, no material, no
variant) says nothing and never matches.

**A corrected variant is re-keyed and re-checked.** `UPDATE` may carry
`variant`; the key is recomputed against the master, checked for collision and
lookalike, and the audit row keeps the before and after.

## Delivered (local, 2026-09-13)

- `ProductMaster.variantAxesJson`, `Product.variantJson`, `Product.variantKey`
  and the unique index (both trees; migration **not applied**).
- `variantValues`, `variantKeyFor`, `lookalikeFingerprint`, `normalizeToken`,
  `parseVariantAxes`, `parseVariant` in `domain/inventory-governance.js`;
  `createProduct` and the UPDATE path in the catalogue service; one field per
  axis on the console's SKU form.
- Tests: AC-202.1 and AC-202.2 in
  `tests/integration/fr201-inventory-sku-governance.test.js`;
  `tests/unit/inventory-governance.test.js`.

## Not in this slice

Fuzzy matching; adding an axis to a master that already has SKUs (the axes are
fixed at creation, as the nature is); a Tenant-wide attribute dictionary.
