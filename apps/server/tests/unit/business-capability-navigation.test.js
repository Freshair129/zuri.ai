import { describe, expect, it } from 'vitest'
import { DOMAINS, domainBarSlots, groupChildren, isDomainAllowedForBusiness, sidebarDomainForPath } from '@/config/domains'

// @req FR-169 — Warehouse is hidden from every menu, not merely disabled, when
//   the Business has turned `physicalStock` off. This is a different question
//   from `isDomainVisible` (who may open a module the Business already has).
// @spec ADR-069
// @tested tests/unit/business-capability-navigation.test.js

const on = { capabilitiesJson: '{"physicalStock": true}' }
const off = { capabilitiesJson: '{"physicalStock": false}' }
const unset = { capabilitiesJson: '{}' }
const warehouse = () => DOMAINS.find((d) => d.key === 'warehouse')

describe('the Warehouse slot is capability-gated on top of being a domain', () => {
  it('is declared with the physicalStock capability, and nothing else in the registry is', () => {
    expect(warehouse().capability).toBe('physicalStock')
    expect(DOMAINS.filter((d) => d.capability)).toEqual([warehouse()])
  })

  it('isDomainAllowedForBusiness reads the capability directly', () => {
    expect(isDomainAllowedForBusiness(warehouse(), on)).toBe(true)
    expect(isDomainAllowedForBusiness(warehouse(), off)).toBe(false)
    expect(isDomainAllowedForBusiness(warehouse(), unset)).toBe(true) // default on
    expect(isDomainAllowedForBusiness(warehouse(), undefined)).toBe(true) // not loaded yet
    // A domain with no `capability` field is always allowed.
    const inventory = DOMAINS.find((d) => d.key === 'inventory')
    expect(isDomainAllowedForBusiness(inventory, off)).toBe(true)
  })

  it('drops out of the SCM group children entirely when the capability is off', () => {
    const group = { childKeys: ['inventory', 'warehouse', 'procurement', 'commerce'] }
    expect(groupChildren(group, on).map((d) => d.key)).toContain('warehouse')
    expect(groupChildren(group, off).map((d) => d.key)).not.toContain('warehouse')
    // Every other child is unaffected.
    expect(groupChildren(group, off).map((d) => d.key)).toEqual(['inventory', 'procurement', 'commerce'])
    // Omitting `business` entirely keeps the old, unfiltered behaviour — every
    // caller that predates FR-169 (and every test fixture) still sees Warehouse.
    expect(groupChildren(group).map((d) => d.key)).toContain('warehouse')
  })

  it('domainBarSlots drops the SCM group members list to three when off', () => {
    const slots = domainBarSlots(off)
    const scmSlot = slots.find((s) => s.kind === 'group' && s.group.key === 'scm')
    expect(scmSlot.children.map((c) => c.key)).toEqual(['inventory', 'procurement', 'commerce'])
    expect(domainBarSlots(on).find((s) => s.group?.key === 'scm').children.map((c) => c.key)).toContain('warehouse')
  })

  it('sidebarDomainForPath drops the Warehouse row from the SCM sidebar when off', () => {
    const sidebarOn = sidebarDomainForPath('/inventory', on)
    const sidebarOff = sidebarDomainForPath('/inventory', off)
    expect(sidebarOn.sub.map((item) => item.path)).toContain('/warehouse')
    expect(sidebarOff.sub.map((item) => item.path)).not.toContain('/warehouse')
    // Every other entry is unaffected: Inventory and its console pages
    // (FR-182/FR-184), Procurement, Purchase Orders, Order Management, Orders. The
    // capability hides Warehouse and nothing else — which is the claim.
    expect(sidebarOff.sub.map((item) => item.path)).toEqual([
      '/inventory',
      '/inventory/locations',
      '/inventory/work-orders',
      '/inventory/reservations',
      '/inventory/stocktakes',
      '/procurement',
      '/procurement/purchase-orders',
      '/commerce',
      '/commerce/orders',
    ])
  })

  it('a Business that has never set the capability sees Warehouse exactly as before FR-169', () => {
    expect(sidebarDomainForPath('/inventory', unset).sub.map((item) => item.path)).toContain('/warehouse')
    expect(domainBarSlots(unset).find((s) => s.group?.key === 'scm').children.map((c) => c.key)).toContain('warehouse')
  })
})
