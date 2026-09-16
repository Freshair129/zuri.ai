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

// @req FR-172 — CRM is one slot in the domain bar over Customer and Market
//   Intelligence, and both keep their own keys.
// @spec ADR-071
// @tested tests/unit/crm-group-navigation.test.js

const crm = () => DOMAIN_GROUPS.find((group) => group.key === 'crm')

describe('CRM groups the customer-facing domains without becoming one', () => {
  it('names the owner ERP row, in that order, and every child is a real domain', () => {
    expect(crm().childKeys).toEqual(['customer', 'market'])
    for (const key of crm().childKeys) {
      expect(DOMAINS.filter((domain) => domain.key === key), `${key} is not a domain`).toHaveLength(1)
    }
  })

  it('is a container, never a grant', () => {
    // The same guarantee ADR-069 D2 gave SCM: a member's stored `domainKeysJson`
    // names the child they may use, never the group.
    expect(DOMAINS.some((domain) => domain.key === 'crm')).toBe(false)
    expect(VIEWER_DOMAINS).not.toContain('crm')
    for (const key of crm().childKeys) expect(VIEWER_DOMAINS).toContain(key)
  })

  it('leaves route ownership on the leaf, which is the key the guard checks', () => {
    expect(domainForPath('/customer').key).toBe('customer')
    expect(domainForPath('/customer/conversations').key).toBe('customer')
    expect(domainForPath('/customer/sales-tasks').key).toBe('customer')
    expect(domainForPath('/market').key).toBe('market')
  })

  it('relabels the leaf that used to read "CRM" so the group and the leaf never collide', () => {
    // ADR-071 D2 — the same relabel class as ADR-069 D4 (Inventory/Warehouse).
    expect(DOMAINS.find((domain) => domain.key === 'customer').label).toBe('Customer')
    expect(crm().label).toBe('CRM')
  })

  it('stands in the bar once, beside SCM, where its first child used to be', () => {
    const slots = domainBarSlots()
    const crmSlot = slots.find((slot) => slot.kind === 'group' && slot.group.key === 'crm')
    expect(crmSlot.children.map((child) => child.key)).toEqual(crm().childKeys)

    // No child may also stand on its own, or the bar shows the same domain twice.
    const barKeys = slots.filter((slot) => slot.kind === 'domain').map((slot) => slot.domain.key)
    for (const key of crm().childKeys) expect(barKeys).not.toContain(key)

    // Every ungrouped domain (across BOTH groups) still gets its own slot.
    const ungrouped = DOMAINS.filter((domain) => !groupForDomainKey(domain.key)).map((d) => d.key)
    expect(barKeys).toEqual(ungrouped)
  })

  it('lists the whole group in the sidebar, each child heading its own pages', () => {
    // A child reached from the bar must be able to reach its sibling.
    for (const path of ['/customer', '/customer/sales-tasks', '/market']) {
      const sidebar = sidebarDomainForPath(path)
      expect(sidebar.key).toBe('crm')
      expect(sidebar.sub.map((item) => item.path)).toEqual([
        '/customer',
        '/customer/conversations',
        '/customer/sales-tasks',
        '/market',
      ])
      expect([...new Set(sidebar.sub.map((item) => item.group))]).toEqual(['Customer', 'Market Intelligence'])
      // Every domain's first sub-entry is named Dashboard, so a flattened
      // group would carry two links of that name. Each child's is renamed to
      // the child — only the Dashboard entry, not Inbox or Sales Tasks.
      const labels = sidebar.sub.map((item) => item.label)
      expect(new Set(labels).size, `duplicate sidebar labels: ${labels.join(', ')}`).toBe(labels.length)
      expect(labels).not.toContain('Dashboard')
      expect(labels).toEqual(['Customer', 'Inbox', 'Sales Tasks', 'Market Intelligence'])
    }
  })

  it('leaves every domain the ADR considered and rejected for grouping alone', () => {
    // ADR-071's Context table: Marketing, Operations, HR/People, Development,
    // Asset Management, LINE OA Studio and Platform each stay their own slot.
    for (const key of ['growth', 'operations', 'people', 'projects', 'assets', 'line-oa', 'platform']) {
      expect(groupForDomainKey(key)).toBeNull()
    }
    expect(sidebarDomainForPath('/growth').key).toBe('growth')
  })
})
