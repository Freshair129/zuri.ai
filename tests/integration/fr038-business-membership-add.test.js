// @req FR-038 — `POST /api/platform/users/memberships` attaches an EXISTING
// Person to a Business the caller owns, as an ACTIVE MEMBER with a chosen
// subset of domain keys. Until this route existed, every Membership-creating
// path bound only the person performing it, so a colleague with an account had
// no way to receive a first Business-level grant from any surface
// (D3-identity-onboarding-forms-12).
// @spec SDD-017, SEC-001, SEC-003,
//   docs/domains/identity/features/FR-038-profile-and-permissions.md
// @tested tests/integration/fr038-business-membership-add.test.js
//
// Real database, real service, real route handler — only the session seam is
// doubled. The three things that can be wrong here are all persistence or
// authorization facts (did a row appear, in which Business, with which audit
// event), and a mocked Prisma client would answer every one of them with
// whatever the test handed it. That is exactly how the FR-062 read-scope defect
// survived a green unit suite.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { listUserPermissions } from '@/modules/identity/profile-permission-service'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { POST } = await import('@/app/api/platform/users/memberships/route')

const tag = () => randomUUID().slice(0, 8)

const makePerson = (label) => prisma.person.create({
  data: {
    id: randomUUID(),
    code: `PER-${label}-${tag()}`,
    displayName: `Person ${label}`,
    email: `${label}-${tag()}@example.test`,
  },
})

const post = (body) => POST(new Request('http://local/api/platform/users/memberships', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))

async function scope(label) {
  const suffix = `${label}-${tag()}`
  const portfolio = await createPortfolio({ name: `Add Member PF ${suffix}`, code: `PF-ADDMEM-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Add Member TNT ${suffix}`, code: `TNT-ADDMEM-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Add Member BUS ${suffix}`, code: `BUS-ADDMEM-${suffix}` })
  return { portfolio, tenant, business }
}

let world
beforeAll(async () => {
  // The caller owns one Business outright and is merely a MEMBER of a second in
  // the same Tenant — the shape that hid three authorization holes in this
  // repository, and the one an attach form is most likely to get wrong.
  const home = await scope('HOME')
  const side = await createBusiness({ tenantId: home.tenant.id, name: `Add Member SIDE ${tag()}`, code: `BUS-ADDSIDE-${tag()}` })

  const caller = await makePerson('caller')
  const memberOnly = await makePerson('memberonly')
  const newbieByCode = await makePerson('bycode')
  const newbieByEmail = await makePerson('byemail')
  const stranger = await makePerson('stranger')

  await prisma.membership.create({
    data: { personId: caller.id, tenantId: home.tenant.id, businessId: home.business.id, role: 'OWNER', status: 'ACTIVE' },
  })
  await prisma.membership.create({
    data: { personId: caller.id, tenantId: home.tenant.id, businessId: side.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: '["projects"]' },
  })
  await prisma.membership.create({
    data: { personId: memberOnly.id, tenantId: home.tenant.id, businessId: side.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: '["projects"]' },
  })

  const viewer = await resolveViewer({ principalId: caller.id, db: prisma })
  const memberViewer = await resolveViewer({ principalId: memberOnly.id, db: prisma })
  world = { home, side, caller, viewer, memberViewer, newbieByCode, newbieByEmail, stranger }
})

describe('POST /api/platform/users/memberships — the owner path', () => {
  it('attaches an existing Person by code as an ACTIVE MEMBER with the chosen domains', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const res = await post({
      businessId: world.home.business.id,
      identifier: world.newbieByCode.code,
      domainKeys: ['projects', 'people'],
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ role: 'MEMBER', status: 'ACTIVE', manageable: true })
    expect(body.domainKeys).toEqual(['projects', 'people'])

    const row = await prisma.membership.findUnique({ where: { id: body.id } })
    expect(row).toMatchObject({
      personId: world.newbieByCode.id,
      businessId: world.home.business.id,
      tenantId: world.home.tenant.id,
      role: 'MEMBER',
      status: 'ACTIVE',
    })
    expect(JSON.parse(row.domainKeysJson)).toEqual(['projects', 'people'])
  })

  it('records one audit event naming the actor, and never the target email', async () => {
    const membership = await prisma.membership.findFirst({
      where: { personId: world.newbieByCode.id, businessId: world.home.business.id },
    })
    const events = await prisma.auditEvent.findMany({ where: { entityType: 'MEMBERSHIP', entityId: membership.id } })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'MEMBERSHIP_ADDED', actorId: world.caller.id })
    expect(events[0].payloadJson).not.toContain('@example.test')
  })

  it('is immediately visible to the resolver and to the roster it was added from', async () => {
    const granted = await resolveViewer({ principalId: world.newbieByCode.id, db: prisma })
    expect(granted.role).toBe('MEMBER')
    expect(granted.visibleBusinessIds).toContain(world.home.business.id)
    expect(granted.ownedBusinessIds).not.toContain(world.home.business.id)
    expect(granted.domainsByBusinessId[world.home.business.id]).toEqual(['people', 'projects'])

    const rows = await listUserPermissions({ db: prisma, resolve: async () => world.viewer })
    const added = rows.find((row) => row.person.id === world.newbieByCode.id)
    expect(added).toMatchObject({ personId: world.newbieByCode.id, manageable: true, role: 'MEMBER' })
  })

  it('matches an email exactly, and defaults to no domain grant at all', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const res = await post({ businessId: world.home.business.id, identifier: world.newbieByEmail.email })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.person.id).toBe(world.newbieByEmail.id)
    // MEMBER is deny-by-default: an omitted list is an empty allow-list, not an
    // implicit "everything".
    expect(body.domainKeys).toEqual([])
    const granted = await resolveViewer({ principalId: world.newbieByEmail.id, db: prisma })
    expect(granted.domainsByBusinessId[world.home.business.id]).toEqual([])
  })

  it('never returns the target email, which the roster deliberately omits', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const res = await post({ businessId: world.home.business.id, identifier: world.stranger.code })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain(world.stranger.email)
  })
})

describe('POST /api/platform/users/memberships — refusals', () => {
  it('refuses a second Membership for the same Person and Business with 409', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const res = await post({ businessId: world.home.business.id, identifier: world.newbieByCode.code, domainKeys: [] })
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'MEMBERSHIP_ALREADY_EXISTS' })
    const rows = await prisma.membership.findMany({
      where: { personId: world.newbieByCode.id, businessId: world.home.business.id },
    })
    expect(rows).toHaveLength(1)
  })

  // The escalation shape: global role is OWNER (of `home`), `side` is visible
  // through a MEMBER Membership, and `side` is NOT owned. Composing "role is
  // OWNER" with "the Business is visible" is precisely the check that let a
  // caller self-promote in this service before.
  it('refuses a Business the caller only sees, 404-shaped and writing nothing', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const before = await prisma.membership.count({ where: { businessId: world.side.id } })
    const res = await post({ businessId: world.side.id, identifier: world.stranger.code })
    expect(res.status).toBe(404)
    expect(await prisma.membership.count({ where: { businessId: world.side.id } })).toBe(before)
  })

  it('answers an unknown Business id identically to one it may not touch', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const unowned = await post({ businessId: world.side.id, identifier: world.stranger.code })
    const missing = await post({ businessId: randomUUID(), identifier: world.stranger.code })
    expect(missing.status).toBe(unowned.status)
    await expect(missing.json()).resolves.toEqual(await unowned.json())
  })

  it('refuses an identifier that matches nothing, and creates no Person', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const before = await prisma.person.count()
    const res = await post({ businessId: world.home.business.id, identifier: 'nobody@nowhere.invalid' })
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'PERSON_NOT_FOUND' })
    expect(await prisma.person.count()).toBe(before)
  })

  it('matches exactly — a prefix of a real code is not a hit', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const res = await post({ businessId: world.home.business.id, identifier: world.stranger.code.slice(0, 6) })
    expect(res.status).toBe(404)
  })

  it('refuses a caller who owns no Business at all', async () => {
    resolveRequestViewer.mockResolvedValue(world.memberViewer)
    const res = await post({ businessId: world.home.business.id, identifier: world.stranger.code })
    expect(res.status).toBe(403)
  })

  it('never reaches the service for an unauthenticated caller', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    const before = await prisma.membership.count()
    const res = await post({ businessId: world.home.business.id, identifier: world.stranger.code })
    expect(res.status).toBe(401)
    expect(await prisma.membership.count()).toBe(before)
  })

  it('rejects a malformed body with 400 before touching the database', async () => {
    resolveRequestViewer.mockResolvedValue(world.viewer)
    const res = await post({ businessId: world.home.business.id })
    expect(res.status).toBe(400)
  })
})
