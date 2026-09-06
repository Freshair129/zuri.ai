# ERP module map — where each module the owner names lives

| Field | Value |
|-------|-------|
| **Version** | 1.0.0 |
| **Status** | Accepted — hand-maintained; every row must name a lane that exists or say "not chartered" |
| **Created** | 2026-09-07 |
| **Last Updated** | 2026-09-07 |
| **Relates to** | `docs/PRODUCT.md` §4, `docs/DOMAIN-MAP.md` (generated), `docs/FEATURES.md`, ADR-025, ADR-065, ADR-066 |

The owner names ERP modules in the vocabulary of an ERP taxonomy ("Supply
Chain Management: Warehouse, Inventory, Procurement, Order Management"); the
repository is organised by **domain lanes** (ADR-025 — one charter per
`src/modules/<d>`). This page is the bridge: for each module the owner names,
which lane answers it, under which FRs, and how much of the module that lane
actually delivers today. It declares no ids and owns nothing; the charters do.

Reading the state column:

- **built** — the lane exists, the FRs are implemented locally (the PRD row is
  the authority on what "implemented" covers), and the production migration
  state is whatever the PRD row says.
- **partial** — the lane covers the module's core and the named gaps are open.
- **deferred** — named in a charter's "not owned" or "later" table with an
  owner, no FR yet.
- **not chartered** — no lane claims it; the first step is a charter and an FR.

## Supply Chain Management (SCM)

Row named by the owner on 2026-09-07: *Warehouse, Inventory, Procurement,
Order Management*.

| ERP module | Lane (route key · charter) | FRs / FEAT | State | What is delivered | What is still open |
|---|---|---|---|---|---|
| Inventory | `inventory` · `docs/domains/inventory/CHARTER.md` (`DOM-INVENTORY`) | FR-154, FR-155, FR-156 · FEAT-020 | **built** | catalogue identity (category, family, factory, master, SKU, bundle), counted vs uncounted policy, the append-only ledger with lots (FEFO) and serial units, on-hand recomputed on read, recipes / BOM at a batch size and the atomic build | Excel / LINE stock intake, reservations, expiry alerts, costing and valuation |
| Warehouse | `inventory` (display label **Warehouse**) | FR-155 | **partial** | the ledger is one Business-wide stock position per SKU | warehouse locations and bins, transfers between locations, stocktake campaigns and reconciliation (the legacy `Warehouse`, `WarehouseStock`, `StockCount` shapes — ERD §21 row "Phase 5 shared/inventory"), putaway and picking |
| Procurement | `procurement` · `docs/domains/procurement/CHARTER.md` (`DOM-PROCUREMENT`) | FR-160, FR-161 · FEAT-023 · ADR-066 | **built** (2026-09-07) | suppliers, purchase orders with lines at the agreed cost, SEND / CLOSE / CANCEL, goods receipts posted line by line into the Inventory ledger with lot, expiry and serials, `receiptState` computed on read, the order RECEIVED by the receipt that completes it | purchase requests and approvals, RFQs and quotes, purchase returns and credit notes, supplier invoices and payables, landed cost, promotion of a Market Intelligence `SupplierCandidate` |
| Order Management | `commerce` · `docs/domains/commerce/CHARTER.md` (`DOM-COMMERCE`) | FR-158, FR-159 · FEAT-022 · ADR-065 | **partial** | sales orders with lines naming SKUs, DRAFT → CONFIRMED → COMPLETED, payments and refunds verified by a second hat, revenue from verified money, fulfilment that issues stock through the Inventory contract | fulfilment states (picking, packing, shipping, delivered), partial shipments and backorders, invoices and receipts, the offer / price catalogue, an order from a LINE chat, returns |

How the three lanes fit: Procurement is the **buy side**, Commerce the **sell
side**, and they meet only in Inventory's ledger — a goods receipt adds
(reference `PO:<code>/GRN:<code>`), a fulfilled sales order removes
(reference `ORDER:<code>`). Neither lane's role widens Inventory's write
authority (ADR-065 D4, ADR-066 D4).

## Adding a row

When the owner names another ERP module: find the lane in `docs/DOMAIN-MAP.md`
(generated) or the charter that lists the concept under "explicitly not
owned"; add one row here with the FRs the PRD declares; keep the state column
honest to the PRD row's evidence column. A module with no lane gets **not
chartered** and a pointer to the ADR that would create one — never a lane name
invented here.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | accepted | Created with the owner's SCM row: Inventory built (FEAT-020), Warehouse partial, Procurement built (FEAT-023, ADR-066), Order Management partial (FEAT-022) | working-tree | Claude Fable 5.1 |
