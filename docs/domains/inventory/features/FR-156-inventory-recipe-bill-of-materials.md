---
domain: inventory
feature: FR-156
module: inventory
source: v2-native
bundle: FEAT-020
requirements:
  - FR-156
version: "0.1.0"
status: building
---

# FR-156 — Recipe / bill of materials at a batch size (recipe_id)

## Intent

The owner's second instruction on the inventory system: the legacy product's
"Culinary" module — recipes with ingredient lots, FEFO deduction, a recipe per
class size — is not a cooking-school feature but a general **bill of
materials**: "the recipe for 10 seats and the recipe for 20 seats" is the same
thing as "the gift-box BOM at 10, 50, 100 and 500 sets". So the concept is
relabelled and brought into the Inventory domain, where a bundle (FR-154) was
already the special case "a kit at batch size 1".

## Decisions worth recording

**One recipe per (output SKU, batch size).** `ProductRecipe` names its output
`productId`, a `batchSize` and the `yieldQty` one batch produces; its lines
are component SKUs with `qty` per batch. A quantity to build picks the
largest batch size that fits (a 60-set order uses the 50-set BOM, scaled) and
the explosion multiplies every line by `quantity / batchSize` — except a
`fixed` line (tooling, one crate per batch), which does not scale. That is the
legacy "ingredients scale with confirmed students, equipment is per session"
rule, generalised.

**Whole units in the ledger.** Line quantities are floats (0.5 kg is a
sensible per-batch figure) but `StockMovement.quantity` counts whole units,
so a fractional requirement is issued as the next whole one (`issueQty`).
Define a component SKU's `unit` at the granularity you count (g, ml, piece).

**The build is atomic or nothing.** `POST /api/inventory/recipes/[id]/build`
explodes to `quantity`, refuses with `INVENTORY_RECIPE_SHORTAGE` and a
per-component list when any counted component is short, then in one
transaction issues every counted component (uncounted ones — a printed card,
a service — are skipped) and receives the output SKU when it is counted. A
LOT-tracked output needs `outputLotCode`; a SERIAL-tracked component or output
is refused, because a build cannot choose serial numbers.

**FEFO belongs to the ledger, not the recipe.** An issue of a LOT-tracked SKU
that names no lot is consumed first-expired-first-out across OPEN lots, one
ledger row per lot touched, whatever no lot holds last; an issue that names a
lot may not exceed that lot's on-hand. Recorded on FR-155 as an extension of
the ledger's statement, so a plain issue from the dashboard and a recipe
build consume the same way.

**Offers stay out.** The legacy `Package` / `PackageCourse` / price-tier
concepts are Commerce's (see [ONTOLOGY.md](../ONTOLOGY.md)); a recipe holds
goods and quantities only.

## Delivered (local, 2026-09-06)

- `ProductRecipe`, `ProductRecipeLine` in both schemas; migrations
  `prisma/migrations/20260906233000_inventory_recipe` and
  `supabase/migrations/20260906233000_inventory_recipe.sql` (**not applied**).
- `domain/inventory.js`: `pickRecipeForQuantity`, `explodeRecipe`,
  `recipeRequirements`, `maxBuildableQuantity`, `allocateFefo`.
- `application/inventory-recipe-service.js` — the only writer: create, list,
  get (exploded to a quantity against on-hand), `UPDATE` / `ARCHIVE`, build;
  `inventory-stock-service.js` gains `appendMovement` (transaction-scoped) and
  FEFO / per-lot checks.
- `GET/POST /api/inventory/recipes`, `GET/PATCH /api/inventory/recipes/[id]`,
  `POST /api/inventory/recipes/[id]/build`; snapshot coverage after `product`.
- Tests: `tests/integration/fr156-inventory-recipe.test.js` (AC-156.1–.5),
  FEFO in `tests/integration/fr155-inventory-stock.test.js` (AC-155.6), the
  calculators in `tests/unit/inventory-domain.test.js`.

## Not in this slice

A recipe editor on the dashboard; costing a recipe from component `baseCost`;
scrap / yield loss factors; multi-level explosion (a component that is itself
built from a recipe is issued as a unit, not exploded); production
application of the migration (ADR-057).
