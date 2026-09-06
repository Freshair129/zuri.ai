import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { listUserPermissions, updateUserPermissions } from '@/modules/identity/profile-permission-service'

// @req FR-062 — the Users & Permissions list is scoped by the same authority
// the write enforces, and a nullable `businessId` is never included unscoped.
// @spec SDD-035, BR-001, SEC-001,
//   docs/domains/identity/features/FR-062-permissions-read-scope.md
// @tested tests/unit/fr062-permissions-read-scope.test.js
//
// These run against the real database with the real service on purpose. The
// defect lived in a Prisma `where` clause, and a mocked `findMany` returns
// whatever the test hands it — it cannot tell a scoped query from an unscoped
// one, which is exactly how a bare `OR` on a nullable column survived.

const tag = () => randomUUID().slice(0, 8)

async function makeTenant(label) {
  const tenantId = randomUUID()
  const t = tag()
  await prisma.tenant.create({
    data: {
      id: tenantId, code: `TEN-${label}-${t}`, name: `Tenant ${label}`,
      portfolio: { create: { id: randomUUID(), code: `PF-${label}-${t}`, name: `PF ${label}` } },
    },
  })
  return tenantId
}

const makeBusiness = (tenantId, label) => prisma.business.create({
  data: { id: randomUUID(), tenantId, code: `BUS-${label}-${tag()}`, name: `Business ${label}` },
})

const makePerson = (label) => prisma.person.create({
  data: { id: randomUUID(), code: `PER-${label}-${tag()}`, displayName: `Person ${label}`, email: `${label}@secret.example` },
})

const grant = (data) => prisma.membership.create({
  data: { id: randomUUID(), domainKeysJson: '["projects"]', ...data },
})

/**
 * The world the probe used: the caller owns one Business, is merely a MEMBER of
 * a second in the same tenant, and has no relationship at all to a third tenant
 * which contains a tenant-wide Membership.
 */
let world
beforeAll(async () => {
  const homeTenant = await makeTenant('HOME')
  const otherTenant = await makeTenant('OTHER')
  const owned = await makeBusiness(homeTenant, 'OWNED')
  const sideBusiness = await makeBusiness(homeTenant, 'SIDE')
  const otherBusiness = await makeBusiness(otherTenant, 'OTHER')

  const caller = await makePerson('caller')
  const colleague = await makePerson('colleague')
  const stranger = await makePerson('stranger')

  const ownerRow = await grant({ tenantId: homeTenant, businessId: owned.id, personId: caller.id, role: 'OWNER' })
  const sideRow = await grant({ tenantId: homeTenant, businessId: sideBusiness.id, personId: caller.id, role: 'MEMBER' })
  await grant({ tenantId: homeTenant, businessId: sideBusiness.id, personId: colleague.id, role: 'MEMBER' })
  const homeTenantWide = await grant({ tenantId: homeTenant, businessId: null, personId: colleague.id, role: 'MEMBER' })
  const foreignTenantWide = await grant({ tenantId: otherTenant, businessId: null, personId: stranger.id, role: 'OWNER' })
  const foreignBusinessRow = await grant({ tenantId: otherTenant, businessId: otherBusiness.id, personId: stranger.id, role: 'OWNER' })

  const viewer = await resolveViewer({ principalId: caller.id, db: prisma })
  const rows = await listUserPermissions({ db: prisma, resolve: async () => viewer })

  world = {
    viewer, rows, owned, sideBusiness, otherTenant, stranger,
    ids: {
      ownerRow: ownerRow.id, sideRow: sideRow.id, homeTenantWide: homeTenantWide.id,
      foreignTenantWide: foreignTenantWide.id, foreignBusinessRow: foreignBusinessRow.id,
    },
  }
})

const idsOf = (rows) => rows.map((row) => row.id)

describe('the leak', () => {
  it('returns no Membership from a tenant the caller has no relationship with', () => {
    // The proven defect: `{ businessId: null }` was an unconditional OR, so
    // every tenant-wide Membership in the database came back — with an email.
    expect(idsOf(world.rows)).not.toContain(world.ids.foreignTenantWide)
    expect(idsOf(world.rows)).not.toContain(world.ids.foreignBusinessRow)
  })

  it('returns nothing belonging to a foreign tenant at all', () => {
    const foreign = world.rows.filter((row) => row.tenantId === world.otherTenant)
    expect(foreign).toEqual([])
  })

  it('never carries a person email, which the surface does not display', () => {
    for (const row of world.rows) {
      expect(row.person).not.toHaveProperty('email')
    }
    expect(JSON.stringify(world.rows)).not.toContain('secret.example')
  })
})

describe('the read scope is the write scope', () => {
  it('lists nothing whose Business is visible but not owned', () => {
    // The caller is a MEMBER of the side Business, so it is in
    // visibleBusinessIds — the field the list used to filter on.
    expect(world.viewer.visibleBusinessIds).toContain(world.sideBusiness.id)
    expect(world.viewer.ownedBusinessIds).not.toContain(world.sideBusiness.id)
    expect(idsOf(world.rows)).not.toContain(world.ids.sideRow)
    expect(world.rows.some((row) => row.businessId === world.sideBusiness.id)).toBe(false)
  })

  it('marks every Business-scoped row it does return as manageable', () => {
    const scoped = world.rows.filter((row) => row.businessId)
    expect(scoped.length).toBeGreaterThan(0)
    for (const row of scoped) {
      expect(world.viewer.ownedBusinessIds).toContain(row.businessId)
      expect(row.manageable).toBe(true)
    }
  })

  it('accepts a write for every row it reported as manageable — no listed row can 404', async () => {
    // The property the FR is actually about: what the list shows and what the
    // write allows are the same set, not two checks that happen to agree.
    for (const row of world.rows.filter((r) => r.manageable)) {
      await expect(
        updateUserPermissions(
          { membershipId: row.id, role: row.role, domainKeys: row.domainKeys },
          { db: prisma, resolve: async () => world.viewer },
        ),
      ).resolves.toMatchObject({ id: row.id })
    }
  })
})

describe('tenant-wide rows', () => {
  it('are shown for a tenant the caller owns into, rather than hidden', () => {
    // A hidden grant is worse than an unmanageable one on the page an OWNER
    // visits to find out who has access.
    expect(idsOf(world.rows)).toContain(world.ids.homeTenantWide)
  })

  it('are reported as not manageable by the server, not inferred by the client', () => {
    const row = world.rows.find((candidate) => candidate.id === world.ids.homeTenantWide)
    expect(row.manageable).toBe(false)
  })

  it('are refused by the write, so the flag and the authority agree', async () => {
    await expect(
      updateUserPermissions(
        { membershipId: world.ids.homeTenantWide, role: 'MEMBER', domainKeys: [] },
        { db: prisma, resolve: async () => world.viewer },
      ),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('the surface reports what it does', () => {
  const page = readFileSync('src/app/(pm)/platform/users/page.jsx', 'utf8')

  it('surfaces a failed save instead of restoring the button and saying nothing', () => {
    // `try { … } finally { setBusy(false) }` with no catch is why three of four
    // rows failed on every save and the page looked fine.
    expect(page).toMatch(/catch\s*\(/)
    expect(page).toContain('setError')
  })

  it('renders a row the server did not mark manageable as read-only', () => {
    expect(page).toContain('membership.manageable')
  })
})
