import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'

// @spec .brain/rca/2026-08-16-global-role-is-not-per-business-authority.md
// @tested tests/unit/viewer-factory-contract.test.js
//
// The factory is only worth anything if it stays tied to the real resolver.
// These tests run `resolveViewer` against the real database and compare shapes,
// so adding or renaming a viewer field breaks here first — instead of silently
// leaving every hand-built fixture one field behind, which is how three
// authorization holes stayed invisible.

async function seedPrincipal({ ownerOf = [], memberOf = [] } = {}) {
  const tenantId = randomUUID()
  const tag = tenantId.slice(0, 8)
  await prisma.tenant.create({
    data: {
      id: tenantId,
      code: `TEN-${tag}`,
      name: 'Factory Tenant',
      portfolio: { create: { id: randomUUID(), code: `PF-${tag}`, name: 'Factory Portfolio' } },
    },
  })
  const person = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-${tag}`, displayName: 'Factory Principal' },
  })
  const made = {}
  for (const [label, role] of [...ownerOf.map((l) => [l, 'OWNER']), ...memberOf.map((l) => [l, 'MEMBER'])]) {
    const business = await prisma.business.create({
      data: { id: randomUUID(), tenantId, code: `BUS-${label}-${tag}`, name: `Business ${label}` },
    })
    await prisma.membership.create({
      data: {
        id: randomUUID(), tenantId, businessId: business.id, personId: person.id,
        role, domainKeysJson: JSON.stringify(['projects']),
      },
    })
    made[label] = business.id
  }
  return { personId: person.id, businesses: made }
}

const keysOf = (o) => Object.keys(o).sort()

describe('the factory tracks the real resolver', () => {
  it('produces the same field set as a real membership-derived viewer', async () => {
    const { personId } = await seedPrincipal({ ownerOf: ['a'] })
    const real = await resolveViewer({ principalId: personId, db: prisma })
    expect(keysOf(makeViewer())).toEqual(keysOf(real))
  })

  it('produces the same field set as a real platform DEV viewer', async () => {
    const { personId } = await seedPrincipal({ memberOf: ['a'] })
    const real = await resolveViewer({ principalId: personId, platformGrant: true, db: prisma })
    expect(keysOf(makeDevViewer())).toEqual(keysOf(real))
    expect(real.ownedBusinessIds).toEqual([])
  })

  it('models the attacker shape the resolver genuinely produces', async () => {
    // OWNER of one Business, MEMBER of another — the shape that defeated
    // `role === 'OWNER'` plus a `visibleBusinessIds` check.
    const { personId, businesses } = await seedPrincipal({ ownerOf: ['a'], memberOf: ['b'] })
    const real = await resolveViewer({ principalId: personId, db: prisma })

    expect(real.role).toBe('OWNER')
    expect(real.visibleBusinessIds).toContain(businesses.b)
    expect(real.ownedBusinessIds).not.toContain(businesses.b)

    const fake = ownsElsewhere({ owns: businesses.a, sees: businesses.b })
    expect(keysOf(fake)).toEqual(keysOf(real))
    expect(fake.role).toBe(real.role)
    expect(fake.ownedBusinessIds.includes(businesses.b)).toBe(real.ownedBusinessIds.includes(businesses.b))
  })

  it('holds the subset invariant the resolver holds', async () => {
    const { personId } = await seedPrincipal({ ownerOf: ['a'], memberOf: ['b'] })
    const real = await resolveViewer({ principalId: personId, db: prisma })
    for (const id of real.ownedBusinessIds) expect(real.visibleBusinessIds).toContain(id)
  })
})

describe('the factory refuses shapes the resolver cannot produce', () => {
  it('rejects ownedBusinessIds outside visibleBusinessIds', () => {
    expect(() => makeViewer({ role: 'OWNER', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-2'] }))
      .toThrow(/not in visibleBusinessIds/)
  })

  it('rejects an owning DEV', () => {
    expect(() => makeViewer({ role: 'DEV', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] }))
      .toThrow(/DEV owns no Business/)
  })

  it('rejects the exact fixture that hid the holes: OWNER with nothing owned', () => {
    expect(() => makeViewer({ role: 'OWNER', visibleBusinessIds: ['b-1'], ownedBusinessIds: [] }))
      .toThrow(/use ownsElsewhere/)
  })

  it('rejects a MEMBER that owns something', () => {
    expect(() => makeViewer({ role: 'MEMBER', visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] }))
      .toThrow(/MEMBER cannot own/)
  })

  it('rejects a non-array where the resolver always returns an array', () => {
    expect(() => makeViewer({ visibleBusinessIds: 'b-1' })).toThrow(/must be an array/)
  })
})

describe('sane defaults', () => {
  it('defaults to a MEMBER that owns nothing', () => {
    const v = makeViewer()
    expect(v.role).toBe('MEMBER')
    expect(v.ownedBusinessIds).toEqual([])
    expect(v.isPlatform).toBe(false)
  })

  it('infers OWNER from what is owned', () => {
    expect(makeViewer({ ownedBusinessIds: ['b-1'] }).role).toBe('OWNER')
  })
})
