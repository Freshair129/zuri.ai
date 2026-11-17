// @req FR-170 — one source of truth for each module's in-canvas tab list, so
// the Dashboard page and its sibling pages (Purchase Orders, Orders) render
// the identical tab strip rather than two hand-kept copies that could drift.
// `path` is the real route each tab is `<ModuleTabs>`'s `Link`, so no route
// moves and no existing test's URL assertion changes.
// @spec ADR-069, ADR-074
// @tested tests/unit/module-tabs.test.js

// @req FR-156, FR-182 — Inventory's recipe editor and SCM operations console
//   use FR-170's in-canvas tabs, with each view linked to its real route.
export const INVENTORY_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/inventory' },
  { key: 'locations', label: 'Locations', path: '/inventory/locations' },
  { key: 'work-orders', label: 'Work Orders', path: '/inventory/work-orders' },
  { key: 'recipes', label: 'Recipes', path: '/inventory/recipes' },
  { key: 'reservations', label: 'Reservations', path: '/inventory/reservations' },
  { key: 'stocktakes', label: 'Stocktake', path: '/inventory/stocktakes' },
  // @req FR-206 — the catalogue hygiene report and the merge desk (ADR-083 D6).
  { key: 'hygiene', label: 'SKU Hygiene', path: '/inventory/hygiene' },
  // @req FR-209 — catalogue intake: Excel / JSON preview and commit (ADR-084 D3).
  { key: 'catalog-intake', label: 'Import', path: '/inventory/catalog-intake' },
]

export const PROCUREMENT_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/procurement' },
  { key: 'purchase-orders', label: 'Purchase Orders', path: '/procurement/purchase-orders' },
  // @req FR-164, FR-154 — supplier cost-sheet intake maps factory SKUs to Inventory Products.
  // @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053
  { key: 'cost-sheets', label: 'Cost Sheets', path: '/procurement/cost-sheets' },
  { key: 'receipts', label: 'Goods Receipts', path: '/procurement/receipts' },
]

export const COMMERCE_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/commerce' },
  { key: 'orders', label: 'Orders', path: '/commerce/orders' },
  { key: 'billing', label: 'Billing', path: '/commerce/invoices' },
  { key: 'pos', label: 'POS', path: '/commerce/pos' },
]
