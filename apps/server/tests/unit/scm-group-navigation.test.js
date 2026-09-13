import { describe, expect, it } from 'vitest'
import {
  DOMAINS,
  DOMAIN_GROUPS,
  domainBarSlots,
  domainForPath,
  groupForDomainKey,
  sidebarDomainForPath,
} from '@/config/domains'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'

// @req FR-167 — SCM is one slot in the domain bar over Warehouse, Inventory,
//   Procurement and Order Management, and the four keep their own keys.
// @spec ADR-069
// @tested tests/unit/scm-group-navigation.test.js

const scm = () => DOMAIN_GROUPS.find((group) => group.key === 'scm')

describe('SCM groups the supply-chain domains without becoming one', () => {
  it('names the owner ERP row, in that order, and every child is a real domain', () => {
    expect(scm().childKeys).toEqual(['inventory', 'warehouse', 'procurement', 'commerce'])
    for (const key of scm().childKeys) {
      expect(DOMAINS.filter((domain) => domain.key === key), `${key} is not a domain`).toHaveLength(1)
    }
  })

  it('is a container, never a grant', () => {
    // The whole point of ADR-069 D2: a member's stored `domainKeysJson` names
    // the child they may use. If `scm` ever reached the registry it would
    // become grantable, appear in the permission checkboxes, and — worse — the
    // route guard would start asking about a key no Membership stores.
    expect(DOMAINS.some((domain) => domain.key === 'scm')).toBe(false)
    expect(VIEWER_DOMAINS).not.toContain('scm')
    for (const key of scm().childKeys) expect(VIEWER_DOMAINS).toContain(key)
  })

  it('leaves route ownership on the leaf, which is the key the guard checks', () => {
    expect(domainForPath('/inventory').key).toBe('inventory')
    expect(domainForPath('/procurement').key).toBe('procurement')
    expect(domainForPath('/procurement/purchase-orders').key).toBe('procurement')
    expect(domainForPath('/commerce/orders').key).toBe('commerce')
  })

  it('stands in the bar once, where its first child used to be', () => {
    const slots = domainBarSlots()
    // @req FR-172 — a second group (CRM, ADR-071) now shares the bar with SCM,
    // so this finds SCM's own slot rather than asserting there is only one.
    const scmSlot = slots.find((slot) => slot.kind === 'group' && slot.group.key === 'scm')
    expect(scmSlot.children.map((child) => child.key)).toEqual(scm().childKeys)

    // No child may also stand on its own, or the bar shows the same domain twice.
    const barKeys = slots.filter((slot) => slot.kind === 'domain').map((slot) => slot.domain.key)
    for (const key of scm().childKeys) expect(barKeys).not.toContain(key)

    // Every other domain still gets its own slot, and Business Home stays first.
    const ungrouped = DOMAINS.filter((domain) => !groupForDomainKey(domain.key)).map((d) => d.key)
    expect(barKeys).toEqual(ungrouped)
    expect(slots[0].kind).toBe('domain')
    expect(slots[0].domain.key).toBe('business-home')
  })

  it('lists the whole group in the sidebar, each child heading its own pages', () => {
    // A child reached from the bar must be able to reach its three siblings;
    // otherwise SCM is a one-way door into whichever child the bar linked to.
    for (const path of ['/inventory', '/procurement/purchase-orders', '/commerce']) {
      const sidebar = sidebarDomainForPath(path)
      expect(sidebar.key).toBe('scm')
      // @req FR-182/FR-184 — Inventory's console pages join the list. The row
      // count is not the point being pinned here; the ORDER is: each child's
      // own pages sit under that child, and no child's pages leak above it.
      expect(sidebar.sub.map((item) => item.path)).toEqual([
        '/inventory',
        '/inventory/locations',
        '/inventory/work-orders',
        '/inventory/reservations',
        '/inventory/stocktakes',
        '/inventory/hygiene',
        '/warehouse',
        '/procurement',
        '/procurement/purchase-orders',
        '/commerce',
        '/commerce/orders',
      ])
      expect([...new Set(sidebar.sub.map((item) => item.group))]).toEqual([
        'Inventory',
        'Warehouse',
        'Procurement',
        'Order Management',
      ])
      // Every domain's first sub-entry is named Dashboard, so a flattened group
      // would carry four links of that name. Each child's is renamed to the
      // child, which is what keeps the menu unambiguous.
      const labels = sidebar.sub.map((item) => item.label)
      expect(new Set(labels).size, `duplicate sidebar labels: ${labels.join(', ')}`).toBe(labels.length)
      expect(labels).not.toContain('Dashboard')
      expect(labels).toEqual(['Inventory', 'Locations', 'Work Orders', 'Reservations', 'Stocktake', 'SKU Hygiene', 'Warehouse', 'Procurement', 'Purchase Orders', 'Order Management', 'Orders'])
    }
  })

  it('marks the reserved sibling so the sidebar disables it instead of linking', () => {
    // `/warehouse` has no page. A link there is a 404; the item says so instead.
    const warehouse = sidebarDomainForPath('/inventory').sub.find((item) => item.path === '/warehouse')
    expect(warehouse.soon).toBe(true)
    expect(DOMAINS.find((domain) => domain.key === 'warehouse').soon).toBe(true)
    for (const key of ['inventory', 'procurement', 'commerce']) {
      expect(DOMAINS.find((domain) => domain.key === key).soon).not.toBe(true)
    }
  })

  it('leaves every ungrouped domain alone', () => {
    expect(groupForDomainKey('projects')).toBeNull()
    expect(sidebarDomainForPath('/projects').key).toBe('projects')
    expect(sidebarDomainForPath('/audit').key).toBe('platform')
  })
})
