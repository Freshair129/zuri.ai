---
version: "1.0.0"
created_at: "2026-09-10T16:00:00+07:00,Claude Opus 5"
last_update: "2026-09-10T16:00:00+07:00,Claude Opus 5"
status: "accepted"
superseded_by: null
attributes:
  domain: "inventory"
  doc_type: "architecture-decision"
  scope: "the located stock ledger (warehouse locations on every movement), the two WIP work orders (customization and kitting), landed cost absorbed in satang, the shelf-life storage guard, Available-to-Promise with quote reservations, and the SmartGift agent tool surface over all of it"
---

# ADR-074 — The Located Stock Ledger, WIP Work Orders and Absorbed Landed Cost

**Status:** Accepted. Implemented by FR-174…FR-181 (FEAT-025) in the same change.
**Date:** 2026-09-10
**Decided by:** Boss (instruction of 2026-09-10: implement the SmartGift Inventory, WIP Kitting
and LLM Agent subsystem in `apps/server` under the SCM parent domain, on a separate branch)
**Relates to:** [ADR-069](ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md) (D3),
[ADR-066](ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md) (D4),
[ADR-065](ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md) (D2 — the money rule),
[ADR-045](ADR-045-CANONICAL-IDENTITY-AND-ACCESS-MANAGEMENT.md), ADR-007 §P6–P7 (the agent's read and write tool registries),
FR-154, FR-155, FR-156, FR-164, FR-165, FR-166, FR-168, BR-002, SEC-001,
`docs/domains/inventory/CHARTER.md`, `docs/ERP-MODULE-MAP.md`.

**Originating business specification (prior art, not a lift):** SmartGift (`TN001B01`,
Business 01) — `SPEC-SMARTGIFT-INVENTORY-REQUIREMENTS-FOR-ZURI-AI-2026-09-10`,
`SPEC-SMARTGIFT-LLM-AGENT-INVENTORY-2026-09-10` and its `ADR-009` (B2B pricing, single-drop
logistics and the FlowAccount SKU pattern). Those documents live in the SmartGift repository and
state one Business's requirements; this ADR states what zuri-ai builds, which is the general
capability that answers them. Their `FR-INV-xxx` / `BR-INV-xxx` ids are **that** document's keys
and are never used as zuri-ai ids — the mapping table below is the bridge (AGENTS.md §18).

## Context

Inventory (FR-154 / FR-155 / FR-156) answers *what a Business holds and how many*. Every number
is recomputed from an append-only ledger, and a recipe can explode a bill of materials and build
it atomically. Four things it cannot answer came due at once, and all four are the same class of
question — *where, in what state, at what cost*:

| Question the ledger could not answer | Why it could not |
|---|---|
| Where are these 500 tumblers — on a vessel, at customs, in the raw warehouse, on the laser bench, or in a finished box? | one Business-wide on-hand per SKU; no location on a movement. `docs/domains/inventory/CHARTER.md` said so explicitly: "Warehouse locations / bins — not modelled in this slice" |
| What did this unit actually cost us, landed? | `ProductMaster.baseCost` is a catalogue attribute, and a movement carried no cost at all |
| These 502 tumblers are engraved with one client's logo — may they be sold to anyone else? | nothing distinguished a branded unit from a blank one, so nothing could refuse |
| We promised 500 sets to a quote yesterday; how many can we still promise today? | on-hand is a physical count; nothing subtracted what is already spoken for |

A fifth is a safety question rather than an accounting one: a lithium-polymer power bank
degrades in warehouse storage and must be recharged periodically, so a lot that is *physically
present* may still not be *dispatchable*. On-hand alone cannot say that either.

The FR-156 recipe build is the closest existing shape — it issues components and receives an
output in one transaction — but it models a build as an instant. A gift set is not built in an
instant: raw stock leaves the shelf, sits on a laser bench for two days, comes back as something
that is no longer the same catalogue item, and only then is assembled. The units in between are
work in progress, and a build with no durable record of them cannot report scrap, cannot say who
the branded output belongs to, and cannot survive the machine misaligning halfway through.

## Decision

### D1 — A movement gains a source and a target location; the location table lives in the Inventory lane

`WarehouseLocation` is a Business-scoped row with a `code` unique per Tenant (BR-002), a name, one
of nine `InventoryLocationType` values (`CN_FACTORY`, `INTL_SEA_TRANSIT`, `TH_PORT_CUSTOMS`,
`TH_CENTRAL_RAW`, `TH_WIP_CUSTOMIZATION`, `TH_WIP_ASSEMBLY`, `TH_FINISHED_GOODS`,
`TH_QUARANTINE_SCRAP`, `CUSTOMER_SITE`) and an `isVirtual` flag for the places that are not
premises the Business holds — a partner factory, a container at sea. `StockMovement` gains
`sourceLocationId` and `targetLocationId`, both nullable, so every row already written stays
valid and readable.

The vocabulary is deliberately the physical supply chain of an importing manufacturer, not a
generic `WAREHOUSE | TRANSIT | OTHER`. A type is what makes a location *answerable*: "how much is
still at sea" and "how much failed QC" are the questions an importer actually asks, and a free-text
label cannot be aggregated. The type is an attribute of the location, never a second key.

**The table lives in the Inventory lane** (`docs/domains/inventory/CHARTER.md` claims it), not in
a new Warehouse module. ADR-069 D3 reserved a `warehouse` **bar slot** for "locations, bins,
transfers and stocktake" and that reservation stands for the *navigation* slot and the *UI* those
words describe. The model is a different question: the location columns are attributes of
`StockMovement`, which Inventory owns and is the only lane allowed to write, and splitting the
table from the columns would put a foreign key across a charter boundary and give a second lane a
reason to write the ledger — the exact coupling ADR-066 D4 exists to prevent. So: Inventory owns
`WarehouseLocation`; the `warehouse` bar slot stays `soon: true` until its bins-and-stocktake
console is built; ADR-069 D3 is amended in wording, not overturned.

### D2 — A transfer is one movement pair in one transaction, and it is the only way stock changes place

`transferStock` issues at the source and receives at the target inside a single transaction,
through Inventory's own `appendMovement` — so both halves obey every FR-155 rule (a lot-tracked
issue is consumed FEFO, an issue that would take on-hand below zero is refused, one audit row per
half). Business-wide on-hand is unchanged by a transfer, by construction: the two rows sum to
zero. What changes is *where* the stock is, which is what a location bucket is for.

There is no "move" movement kind and there never will be. `INVENTORY_MOVEMENT_KINDS` stays
`RECEIPT | ISSUE | ADJUSTMENT`, because a third kind would need its own sign convention and every
existing reader that sums `quantity` would silently start counting a transfer twice.

### D3 — Money on the ledger is integer satang, and domestic single-drop freight is absorbed into it

`StockMovement.costSatang` is the **unit** landed cost of that row in satang (THB × 100), the same
integer-money rule ADR-065 D2 fixed for Commerce. Landed cost is computed, not typed:

```text
landedUnitCostSatang =
    factoryCostSatang                    (EXW/FOB, converted at the rate locked at clearance)
  + ceil(seaFreightSatang   / batchQty)
  + ceil(importDutySatang   / batchQty)
  + ceil(inboundTruckSatang / batchQty)  ← the flat single-drop truck, 2,500 THB by default
  + customizationPerUnitSatang           ← added by a customization work order (D4)
  + kittingPerUnitSatang                 ← added by a kitting work order (D5)
```

Each shared cost is divided by the batch and rounded **up** to the satang, so a batch is never
valued below what it cost; the remainder is a rounding gain of at most one satang per unit and is
never redistributed, because a valuation that depends on iteration order is not reproducible.

The commercial consequence is the point (SmartGift ADR-009 D2): because the truck is *in* the unit
cost, a standard single-drop quote shows delivery as **0.00 THB** and must never carry a separate
freight line. A second drop or an island crossing is a different service and does get its own
line — the Commerce lane's, not this one's.

Valuation across receipts is **moving weighted average**: a new receipt blends into the running
average at the moment it lands. WAVG rather than FIFO because the ledger is append-only and lot
selection is already FEFO for dispatch — running a second, cost-ordered queue over the same rows
would give the same physical unit two different costs depending on which engine asked.

### D4 — A customization work order is the durable record of branded WIP, and branding is irreversible

`CustomizationWorkOrder` (`CWO-YYYYMMDD-NNN`) records one raw SKU going to one technique
(`LASER_ENGRAVING`, `SILK_SCREEN`, `UV_DIGITAL_PRINT`, `HOT_STAMP_FOIL`, `EMBOSSING`) for one
customer and one sales order: planned quantity, the artwork and Pantone colours, setup and run
cost in satang, and — as it runs — issued, completed and scrapped quantities. Its lifecycle is
`DRAFT → RELEASED → IN_PROGRESS → COMPLETED | CANCELLED`, with `BLOCKED_SHORTAGE` as the state a
scrap overrun lands in.

Completing it does **not** return the raw SKU to stock. It receives a *different* product — one
whose `itemKind` is `CUSTOM_COMPONENT` and whose `dedicatedCustomerId` / `dedicatedSalesOrderId`
are set — and the domain refuses, by code, to issue that product to any other customer, to
transfer it back into `TH_CENTRAL_RAW`, or to consume it in a kitting order for a different
order. A logo is not a reversible attribute of a tumbler; it is a new thing that happens to have
been a tumbler. The only exit is an explicit `ADJUSTMENT` write-off with a stated reason —
which is a decision a person makes and the audit records, not a transfer a service performs.

### D5 — A kitting work order explodes the BOM with a declared scrap allowance

`KittingWorkOrder` (`KWO-YYYYMMDD-NNN`) assembles one `FINISHED_SET` from one `ProductRecipe`.
`ProductRecipe` gains `scrapAllowanceFactor` (a fraction in `[0, 0.20]`, default 0), and the gross
issue for a net requirement is `ceil(net × (1 + factor))` — the buffer is issued up front,
because a line that stops halfway to fetch three more boxes is a line that has already lost the
morning. What the buffer did not consume is reconciled at completion and stays where it is; what
it did not cover is a shortage the work order reports rather than a build that half-happened.

A recipe with `scrapAllowanceFactor` 0 explodes exactly as it did before this change, so every
existing recipe and every existing FR-156 build is untouched.

The output must carry a FlowAccount item code matching `^[A-Z0-9]+-[0-9]+\([A-Z0-9_-]+\)$` —
model, item count, package code, e.g. `TMS06-4(P-16)` — and a kitting run is refused without one.

**That code is not `Product.code`, and cannot be.** FR-154's code pattern allows letters, digits,
dot, dash and underscore; a FlowAccount set code carries parentheses. The temptation is to widen
the pattern. The right reading is the opposite one: `TMS06-4(P-16)` is *FlowAccount's* identifier
for our product, not ours for it, so BR-002's rule applies — an external system's id is an
attribute, never a key, and never overwrites our `code`.

**And it is not an `ExternalRef` row either, which is where this first put it.** That table — the
one that maps a customer's SAP id onto our UUID — is unique on `(system, value)` across the whole
installation and carries no `tenantId` at all, because it was built for a single installation's
plan import. Two Tenants importing from the same Chinese factory will both call their four-item
set `TMS06-4(P-16)`, and neither is wrong; `ExternalRef` would have let only the first one say so.
Three suites collided on exactly that the first time they ran together, which is the whole
argument: the general external-id mechanism is not general across Tenants.

So: **one nullable `Product.flowAccountSku` column, unique per `(tenantId, flowAccountSku)`**,
written only by `createProduct` and `setFlowAccountSku`, both of which validate the pattern — so
the column can never hold a code FlowAccount would reject. The agent's tools resolve a customer's
`TMS06-4(P-16)` through it first and fall back to our own `code`, which is what an internal
operator types.

Validated where a set is *produced*, not where a product is created: components and packaging are
never synchronised to FlowAccount at all, so requiring a ref for one would assert a row that will
never exist there.

### D6 — De-kitting is a work order run backwards, and it cannot launder branded stock

Disassembly issues the finished set and receives its components, in one transaction, at a stated
location. A component that was branded returns as its `CUSTOM_COMPONENT` identity with its
customer lock intact, or goes to `TH_QUARANTINE_SCRAP` — never as generic raw stock. Packaging
that disassembly destroys (a die-cut foam, a torn box) is written off in the same transaction
rather than optimistically returned.

### D7 — Shelf life is a storage property of the product, and the guard is FEFO's second question

`Product` gains `maintenanceIntervalDays` and `maxStorageDays`, both nullable; `ProductLot` gains
`lastMaintainedAt`. A product with neither interval behaves exactly as it always has. For a
product that has them, a lot's age is measured from `lastMaintainedAt ?? manufacturedAt`, and:

- at `maintenanceIntervalDays` the lot is **due** — surfaced as a maintenance task, never blocked;
- past `maxStorageDays` the lot is **refused** for issue and for kitting until a maintenance is
  recorded, which resets the clock.

Generalising past "battery" is deliberate: the rule is *a stored unit that ages and can be
restored by an operation*, which is as true of a rechargeable cell as of a calibrated instrument.
Naming the column `batteryChargedAt` would have made the second case unrepresentable for no gain.

### D8 — Available-to-Promise subtracts what is already spoken for, in two tiers

`StockReservation` holds one product's quantity for one purpose: `QUOTE` (soft, expiring —
7 days by default) or `ORDER` (committed, on a confirmed sales order). Then

```text
ATP = onHand − Σ committed − Σ live quote reservations
```

A quote reservation carries `expiresAt` and is *never deleted*: it moves to `RELEASED`,
`CONVERTED` or `EXPIRED`, so "why could we not promise those 500 on Tuesday" stays answerable.
Expiry is evaluated on read against the clock rather than by a sweeper, so an ATP figure is
correct even if no worker has run — a sweeper may later mark rows for reporting, and marking a row
the reader already ignores changes no number.

Reservations do **not** write the ledger. A reservation is a promise; the ledger records physical
fact, and mixing the two would make on-hand disagree with a shelf.

### D9 — The agent's SmartGift tools are thin adapters over these services, on the existing gates

Six tools, in the two registries ADR-007 §P6/§P7 already defines, with **no new gate and no
bypass**:

| Tool | Registry | Why there |
|---|---|---|
| `check_inventory_atp` | Gate E (read-only) | reads ATP and max buildable sets; writes nothing |
| `calculate_smartgift_quote` | Gate E (read-only) | pure pricing arithmetic over catalogue and tier inputs |
| `audit_battery_lots` | Gate E (read-only) | reports lots due or past their storage limit |
| `create_quote_stock_reservation` | Gate F (write, LOW) | creates a soft reservation; reversible, expiring |
| `dispatch_customization_work_order` | Gate F (write, HIGH) | issues real stock and dedicates it irreversibly (D4) |
| `dispatch_kitting_work_order` | Gate F (write, HIGH) | consumes components and produces finished goods |

Every tool calls the same application service a human surface would call, with the same viewer and
therefore the same authority ladder (FR-072 refusals, `INVENTORY_MANAGER` or Business OWNER for
every write). A tool never queries Prisma directly, never widens scope, and never carries a
Business id the caller did not already prove. The two irreversible dispatches are `HIGH`
sensitivity, so the action gate demands step-up: an agent that mis-parses "500" as "5000" should
meet a human before 4,500 tumblers are engraved.

The system prompts SmartGift's agent spec supplies are that Business's operating instructions, not
zuri-ai code. They belong in the Business's own agent configuration; this change ships the tools
they call.

## Mapping to the originating specification

| SmartGift id | zuri-ai id | Note |
|---|---|---|
| `FR-INV-001` multi-location & in-transit | **FR-174** | nine location types, located movements, atomic transfer |
| `FR-INV-002` goods receipt & AQL QC | — | already FR-165; asymmetric accept/reject lands via two located receipts |
| `FR-INV-003` landed cost & freight amortisation | **FR-175** | satang, absorbed single-drop truck |
| `FR-INV-004` customization work order | **FR-176** | + the irreversibility guard (`BR-INV-002` → BR-028) |
| `FR-INV-005` kitting work order | **FR-177** | + scrap allowance (`BR-INV-004` → BR-029) and the FlowAccount set code as a per-Tenant attribute (`BR-INV-001` → BR-032) |
| `FR-INV-006` de-kitting | **FR-178** | |
| `FR-INV-007` ATP & quote reservation | **FR-180** | (`BR-INV-007` → BR-031) |
| `FR-INV-008` FlowAccount sync | — | **not in this change**; the Integration lane's, and it needs a FlowAccount credential story first |
| `FR-INV-009` cycle counting | — | **not in this change**; a stocktake campaign is the reserved `warehouse` console's (ADR-069 D3) |
| `BR-INV-005` append-only ledger | — | already FR-155's invariant, unchanged and re-proven by this change's tests |
| `BR-INV-006` battery FEFO | **FR-179** / BR-030 | generalised to shelf life (D7) |
| Agent tool specs | **FR-181** | six tools on the existing two gates (D9) |

## Consequences

**Positive.** Stock becomes locatable, costed and promisable without a second system: the same
append-only ledger answers "where", "what did it cost" and "what can we still sell", and every one
of those is still recomputed rather than stored. Branded stock cannot be silently resold. A work
order survives the machine misaligning. The agent gets real capability with no new trust surface —
its dangerous verbs are the ones a human already needs step-up for.

**Costs and guards.**

1. **Six new columns on `StockMovement`, one of them money.** Every one is nullable or defaulted,
   and no existing reader changes. But `costSatang` on a movement is the first valuation number in
   this repository, and valuation is Finance's when Finance exists — this is an inventory
   valuation, not a book entry, and the charter says so.
2. **Location is optional on a movement, so the two can disagree.** A pre-ADR-074 row has no
   location, and a located sum over a Business that started locating halfway is not the
   Business-wide sum. Located on-hand is therefore reported as its own figure, next to the total,
   never instead of it.
3. **`itemKind` is a fifth product classification** beside `stockPolicy`, `trackingMode`, status
   and category. It is not a nature (FR-168) and does not gate the ledger; it says what *role* an
   item plays in a kit, which is what makes `CUSTOM_COMPONENT` refusable.
4. **The reserved `warehouse` slot now has a model in another lane.** A reader who takes ADR-069
   D3 literally will look for `WarehouseLocation` in a Warehouse module and not find it. D1 states
   why; `docs/ERP-MODULE-MAP.md`'s SCM row is updated in the same change so the map is not the
   thing that misleads.
5. **No HTTP surface in this slice.** These are services, domain calculators and agent tools. The
   console pages and `/api/inventory/**` routes for locations, work orders and reservations are a
   following change — deliberately, so this one lands without a route that no page reaches.
6. **The FlowAccount code is a second identity for one product**, and a reader who expects it in
   `Product.code` will not find it there. D5 states why; `setFlowAccountSku` and
   `productByFlowAccountSku` are the only two functions that need to know, and the tools' SKU
   resolution tries the external code first precisely because a customer will always say that one.
   It is also a second uniqueness constraint on `Product` — `(tenantId, flowAccountSku)` beside
   `(tenantId, code)` — which is the price of not widening the `code` pattern for one integration.
7. **`ExternalRef` is now known to be installation-scoped**, which this change works around rather
   than fixes. Giving it a `tenantId` would be the general repair and would touch a model another
   charter owns, plus a backfill; that is its own change, not this one. Until then, no lane should
   reach for `ExternalRef` to hold a code that is only unique per Tenant.
8. **Production migration is not applied by this change** (ADR-057). `20260910120000_smartgift_scm_wip.sql`
   is written and additive; applying it is an owner-instructed operator step.
