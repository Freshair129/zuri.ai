// @req FR-170 — one source of truth for each module's in-canvas tab list, so
// the Dashboard page and its sibling pages (Purchase Orders, Orders) render
// the identical tab strip rather than two hand-kept copies that could drift.
// `path` is the real route each tab is `<ModuleTabs>`'s `Link`, so no route
// moves and no existing test's URL assertion changes.
// @spec ADR-069
// @tested tests/unit/module-tabs.test.js

export const PROCUREMENT_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/procurement' },
  { key: 'purchase-orders', label: 'Purchase Orders', path: '/procurement/purchase-orders' },
]

export const COMMERCE_TABS = [
  { key: 'dashboard', label: 'Dashboard', path: '/commerce' },
  { key: 'orders', label: 'Orders', path: '/commerce/orders' },
]
