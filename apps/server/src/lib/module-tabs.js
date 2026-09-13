// @req FR-170 — one source of truth for each module's in-canvas tab list, so
// the Dashboard page and its sibling pages (Purchase Orders, Orders) render
// the identical tab strip rather than two hand-kept copies that could drift.
// `path` is the real route each tab is `<ModuleTabs>`'s `Link`, so no route
// moves and no existing test's URL assertion changes.
// @spec ADR-069, ADR-074
// @tested tests/unit/module-tabs.test.js

// @req FR-182 — Inventory crosses one page into four with the SCM operations
// console, so FR-170's rule applies to it for the first time: the views live in
// the canvas and switch by clicking a tab.
export const INVENTORY_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/inventory' },
  { key: 'locations', label: 'Locations', path: '/inventory/locations' },
  { key: 'work-orders', label: 'Work Orders', path: '/inventory/work-orders' },
  { key: 'reservations', label: 'Reservations', path: '/inventory/reservations' },
  { key: 'stocktakes', label: 'Stocktake', path: '/inventory/stocktakes' },
  // @req FR-206 — the catalogue hygiene report and the merge desk (ADR-083 D6).
  { key: 'hygiene', label: 'SKU Hygiene', path: '/inventory/hygiene' },
]

export const PROCUREMENT_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/procurement' },
  { key: 'purchase-orders', label: 'Purchase Orders', path: '/procurement/purchase-orders' },
  { key: 'receipts', label: 'Goods Receipts', path: '/procurement/receipts' },
]

export const COMMERCE_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/commerce' },
  { key: 'orders', label: 'Orders', path: '/commerce/orders' },
  { key: 'billing', label: 'Billing', path: '/commerce/invoices' },
  { key: 'pos', label: 'POS', path: '/commerce/pos' },
]
