import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { isSotDataPlaneFor, ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'

// @req FR-059, FR-038, FR-036 — one predicate for "may this viewer act here".
// @spec SEC-001, SEC-008
// @tested tests/unit/viewer-authority.test.js
//
// This predicate had been written three times, once per call site, and the
// question it answers is the one this repository has got wrong more than any
// other. So it is pinned against the REAL resolver, not against literals: what
// matters is not that the function reads an array, but that the array it reads
// is the one `resolveViewer` actually produces.

const tag = () => randomUUID().slice(0, 8)

async function attackerViewer() {
  const t = tag()
  const tenantId = randomUUID()
  await prisma.tenant.create({
    data: {
      id: tenantId, code: `TEN-${t}`, name: 'T',
      portfolio: { create: { id: randomUUID(), code: `PF-${t}`, name: 'PF' } },
    },
  })
  const owned = await prisma.business.create({ data: { id: randomUUID(), tenantId, code: `BUS-O-${t}`, name: 'Owned' } })
  const seen = await prisma.business.create({ data: { id: randomUUID(), tenantId, code: `BUS-S-${t}`, name: 'Seen' } })
  const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-${t}`, displayName: 'P' } })
  await prisma.membership.create({
    data: { id: randomUUID(), tenantId, businessId: owned.id, personId: person.id, role: 'OWNER', domainKeysJson: '[]' },
  })
  await prisma.membership.create({
    data: { id: randomUUID(), tenantId, businessId: seen.id, personId: person.id, role: 'MEMBER', domainKeysJson: '[]' },
  })
  return { viewer: await resolveViewer({ principalId: person.id, db: prisma }), owned, seen }
}

describe('ownsBusiness answers "may I write here"', () => {
  it('separates a Business that is owned from one that is merely visible', async () => {
    const { viewer, owned, seen } = await attackerViewer()

    // The shape that defeated "role === OWNER plus the Business is visible".
    expect(viewer.role).toBe('OWNER')
    expect(viewer.visibleBusinessIds).toContain(seen.id)

    expect(ownsBusiness(viewer, owned.id)).toBe(true)
    expect(ownsBusiness(viewer, seen.id)).toBe(false)
    expect(seesBusiness(viewer, seen.id)).toBe(true)
  })

  it('is never satisfied by the global role label', async () => {
    const { viewer, seen } = await attackerViewer()
    // Stated as an assertion rather than a comment: if someone reimplements
    // this predicate in terms of `role`, this line is what fails.
    expect(ownsBusiness({ role: 'OWNER' }, seen.id)).toBe(false)
    expect(ownsBusiness({ role: 'OWNER', visibleBusinessIds: [seen.id] }, seen.id)).toBe(false)
  })
})

describe('both predicates fail closed', () => {
  const cases = [
    ['no viewer', undefined],
    ['null viewer', null],
    ['viewer with no grant fields', {}],
    ['grant is not an array', { ownedBusinessIds: 'b-1', visibleBusinessIds: 'b-1' }],
    ['grant is null', { ownedBusinessIds: null, visibleBusinessIds: null }],
  ]
  for (const [label, viewer] of cases) {
    it(`refuses when ${label}`, () => {
      expect(ownsBusiness(viewer, 'b-1')).toBe(false)
      expect(seesBusiness(viewer, 'b-1')).toBe(false)
    })
  }

  it('refuses a missing or non-string business id', () => {
    const viewer = { ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'] }
    for (const bad of [undefined, null, '', 0, {}, ['b-1']]) {
      expect(ownsBusiness(viewer, bad)).toBe(false)
      expect(seesBusiness(viewer, bad)).toBe(false)
    }
  })
})

describe('a platform DEV writes nothing', () => {
  it('sees every Business and owns none', async () => {
    const t = tag()
    const person = await prisma.person.create({ data: { id: randomUUID(), code: `PER-DEV-${t}`, displayName: 'Dev' } })
    const viewer = await resolveViewer({ principalId: person.id, platformGrant: true, db: prisma })
    const some = viewer.visibleBusinessIds[0]
    expect(some).toBeTruthy()
    expect(seesBusiness(viewer, some)).toBe(true)
    expect(ownsBusiness(viewer, some)).toBe(false)
  })
})

// @req FR-102 — the SoT data-plane service-account viewer is a distinct
// identity shape from resolveViewer's Person-based one (no ownedBusinessIds,
// no role): a service account is not a person acting on their own behalf, and
// giving it that shape would let it accidentally satisfy ownsBusiness/
// isInstallationOperator through fields it never intentionally set.
describe('isSotDataPlaneFor answers "is this the SoT data plane, for this Tenant"', () => {
  const dataPlaneViewer = (tenantId) => ({ isSotDataPlane: true, tenantId, serviceAccountId: 'sdpk-1' })

  it('is satisfied only when the key\'s bound tenant matches the request\'s tenant', () => {
    expect(isSotDataPlaneFor(dataPlaneViewer('t-1'), 't-1')).toBe(true)
    expect(isSotDataPlaneFor(dataPlaneViewer('t-1'), 't-2')).toBe(false)
  })

  it('is never satisfied by an ordinary Person viewer, however privileged', () => {
    expect(isSotDataPlaneFor({ isOperator: true, role: 'DEV' }, 't-1')).toBe(false)
    expect(isSotDataPlaneFor({ role: 'OWNER', ownedBusinessIds: ['t-1'] }, 't-1')).toBe(false)
  })

  it('fails closed', () => {
    for (const viewer of [undefined, null, {}, { isSotDataPlane: false, tenantId: 't-1' }]) {
      expect(isSotDataPlaneFor(viewer, 't-1')).toBe(false)
    }
    expect(isSotDataPlaneFor(dataPlaneViewer('t-1'), undefined)).toBe(false)
  })
})
