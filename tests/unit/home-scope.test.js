import { describe, expect, it } from 'vitest'
import { buildHomeScope } from '@/lib/home-scope'

const groups = [
  { id: 'group-a', name: 'Group A' },
  { id: 'group-b', name: 'Group B' },
]
const tenants = [
  { id: 'tenant-a', portfolioId: 'group-a' },
  { id: 'tenant-b', portfolioId: 'group-b' },
]
const businesses = [
  { id: 'business-a', tenantId: 'tenant-a', name: 'A' },
  { id: 'business-b', tenantId: 'tenant-b', name: 'B' },
]

describe('buildHomeScope', () => {
  it('never infers visibility from the inventory without a viewer grant', () => {
    expect(buildHomeScope({ portfolios: groups, tenants, businesses }).groups).toEqual([])
  })

  it('shows only the group and business explicitly granted to a member', () => {
    const home = buildHomeScope({
      viewer: { visibleBusinessIds: ['business-b'] },
      portfolios: groups,
      tenants,
      businesses,
    })
    expect(home.groups.map((group) => group.id)).toEqual(['group-b'])
    expect(home.activeGroup.id).toBe('group-b')
    expect(home.businesses.map((business) => business.id)).toEqual(['business-b'])
    expect(home.needsGroupChoice).toBe(false)
  })

  it('requires a group choice only when multiple granted groups have no selection', () => {
    const viewer = { visibleBusinessIds: ['business-a', 'business-b'] }
    expect(buildHomeScope({ viewer, portfolios: groups, tenants, businesses }).needsGroupChoice).toBe(true)
    const selected = buildHomeScope({
      viewer,
      portfolios: groups,
      tenants,
      businesses,
      selection: { portfolioId: 'group-a' },
    })
    expect(selected.businesses.map((business) => business.id)).toEqual(['business-a'])
  })
})
