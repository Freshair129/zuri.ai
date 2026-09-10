# ERP module map — where each module the owner names lives

| Field | Value |
|-------|-------|
| **Version** | 1.1.0 |
| **Status** | Accepted — hand-maintained; every row must name a lane that exists or say "not chartered" |
| **Created** | 2026-09-07 |
| **Last Updated** | 2026-09-08 |
| **Relates to** | `docs/PRODUCT.md` §4, `docs/DOMAIN-MAP.md` (generated), `docs/FEATURES.md`, ADR-025, ADR-065, ADR-066, ADR-069, ADR-071 |

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

**This row is now the navigation, not only a table.** Since FR-167
([ADR-069](decisions/ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md))
the domain bar holds one **SCM** slot and the sidebar lists all four modules
beneath it, in this order. Each keeps its own route key, because that is what a
member's stored grant names — the group is a container and is never granted.
Warehouse is listed and disabled — but what is missing narrowed on 2026-09-10.
[ADR-074](decisions/ADR-074-LOCATED-STOCK-LEDGER-WIP-WORK-ORDERS-AND-LANDED-COST.md)
D1 put **locations and transfers in the Inventory lane**, because the location
columns are attributes of `StockMovement`, which only that lane may write, and
splitting the table from the columns would have put a foreign key across a
charter boundary. The `warehouse` slot stays reserved for what remains its own:
bins, putaway and picking, and stocktake campaigns.

| ERP module | Lane (route key · charter) | FRs / FEAT | State | What is delivered | What is still open |
|---|---|---|---|---|---|
| Inventory | `inventory` · `docs/domains/inventory/CHARTER.md` (`DOM-INVENTORY`) | FR-154, FR-155, FR-156, FR-174..FR-181 · FEAT-020, FEAT-025 · ADR-074 | **built** | catalogue identity (category, family, factory, master, SKU, bundle), the three natures, the append-only ledger with lots (FEFO) and serial units, on-hand recomputed on read, recipes / BOM at a batch size and the atomic build; since ADR-074 also warehouse locations and atomic transfers, landed cost in integer satang with the flat single-drop truck absorbed, the customization and kitting work orders with a declared scrap allowance and an irreversible customer lock, de-kitting, the shelf-life storage guard, Available-to-Promise with two-tier reservations, and six agent tools on the existing Gate E / Gate F registries | Excel / LINE stock intake, HTTP routes and console pages for locations, work orders and reservations, FlowAccount catalogue and stock synchronisation, cycle counting |
| Warehouse | `warehouse` — a reserved slot under SCM since FR-167; the stock it reports on, and now its locations too, live in `inventory` | FR-155, FR-174 | **partial** | the ledger is a located stock position per SKU: nine typed locations, atomic transfers, and on-hand per location reported beside the Business-wide total (ADR-074 D1/D2) | bins and their putaway/picking rules, stocktake campaigns and reconciliation (the legacy `StockCount` shape — ERD §22 row "Phase 5 shared/inventory"), and a Warehouse console of its own |
| Procurement | `procurement` · `docs/domains/procurement/CHARTER.md` (`DOM-PROCUREMENT`) | FR-164, FR-165 · FEAT-024 · ADR-066 | **built** (2026-09-07) | suppliers, purchase orders with lines at the agreed cost, SEND / CLOSE / CANCEL, goods receipts posted line by line into the Inventory ledger with lot, expiry and serials, `receiptState` computed on read, the order RECEIVED by the receipt that completes it | purchase requests and approvals, RFQs and quotes, purchase returns and credit notes, supplier invoices and payables, landed cost, promotion of a Market Intelligence `SupplierCandidate` |
| Order Management | `commerce` · `docs/domains/commerce/CHARTER.md` (`DOM-COMMERCE`) | FR-162, FR-163 · FEAT-023 · ADR-065 | **partial** | sales orders with lines naming SKUs, DRAFT → CONFIRMED → COMPLETED, payments and refunds verified by a second hat, revenue from verified money, fulfilment that issues stock through the Inventory contract | fulfilment states (picking, packing, shipping, delivered), partial shipments and backorders, invoices and receipts, the offer / price catalogue, an order from a LINE chat, returns |

How the three lanes fit: Procurement is the **buy side**, Commerce the **sell
side**, and they meet only in Inventory's ledger — a goods receipt adds
(reference `PO:<code>/GRN:<code>`), a fulfilled sales order removes
(reference `ORDER:<code>`). Neither lane's role widens Inventory's write
authority (ADR-065 D4, ADR-066 D4).

## Customer Relationship Management (CRM)

Row named by the owner on 2026-09-07/08: *top nav bar ตามหลัก ERP* (the top
nav bar should read as ERP domains), applied to the rest of the bar the same
way [ADR-069](decisions/ADR-069-SCM-IS-A-PARENT-DOMAIN-OVER-WAREHOUSE-INVENTORY-PROCUREMENT-AND-ORDER-MANAGEMENT.md)
answered it for SCM.

**This row is also the navigation, not only a table.** Since FR-172
([ADR-071](decisions/ADR-071-CRM-IS-A-PARENT-DOMAIN-OVER-CUSTOMER-AND-MARKET-INTELLIGENCE.md))
the domain bar holds one **CRM** slot and the sidebar lists both modules
beneath it. Each keeps its own route key; `customer`'s bar label moved from
"CRM" to "Customer" so the group and the leaf do not both read "CRM" — the
same relabel class ADR-069 D4 used for Inventory/Warehouse.

| ERP module | Lane (route key · charter) | FRs / FEAT | State | What is delivered | What is still open |
|---|---|---|---|---|---|
| Customer | `customer` · `docs/domains/crm/CHARTER.md` (`DOM-CRM`) | FR-091, FR-093, FR-103, FR-127, FR-161 | **built** | conversation inbox (read-only per BR-011), LINE reply delivery receipt, PDPA consent attestation, sales tasks (follow-ups a salesperson owes a customer), conversation intelligence analysis (schema + consent-gated persistence, no LLM producer yet) | a full sales pipeline (leads, opportunities, quotes), an order from a LINE chat, the analysis producer/UI |
| Market Intelligence | `market` · `docs/domains/market-intelligence/CHARTER.md` | FR-061, FR-092 | **partial** | market translation core (RawExternalRecord → provider-neutral MarketObservation) | a dashboard beyond the one Dashboard entry, a public API, promotion of a `SupplierCandidate` into Procurement |

Why these two and not Marketing: CRM taxonomy in every suite the owner would
recognise (Salesforce, HubSpot, SAP C/4HANA, Odoo) treats market/customer
intelligence as a CRM analytics function, but offers Marketing as its own
top-level application, not a CRM child — Odoo ships them as separate apps.
Marketing already has five sub-pages and its own FRs (FR-157, FR-159, FR-160,
FR-162); nesting it here would misrepresent the taxonomy this row exists to
follow, not honour it. [ADR-071](decisions/ADR-071-CRM-IS-A-PARENT-DOMAIN-OVER-CUSTOMER-AND-MARKET-INTELLIGENCE.md)'s
Context table records the same check against every other remaining domain
(Marketing, Operations, HR/People, Development, Asset Management, LINE OA
Studio, Platform) — each already stands as one complete ERP-recognised module
with no sibling to consolidate.

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
| 1.0.0 | 2026-09-07 | accepted | Created with the owner's SCM row: Inventory built (FEAT-020), Warehouse partial, Procurement built (FEAT-024, ADR-066), Order Management partial (FEAT-023) | working-tree | Claude Fable 5.1 |
| 1.1.0 | 2026-09-08 | accepted | Added the CRM row (FR-172, ADR-071): Customer built (FR-091/093/103/127/161), Market Intelligence partial (FR-092) | working-tree | Claude Sonnet 5 |
