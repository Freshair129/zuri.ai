// @req FR-106 — `GET /api/platform/api-access-keys` lists the keys the caller
// may already govern, scoped by exactly the authority that mints and revokes
// them, and carrying metadata only. Before it existed, `revokeApiAccessKey` was
// reachable only from an id somebody had written down at mint time: a key could
// be created and then never withdrawn from any surface
// (D2-domain-identity-22).
// @spec SEC-006, SEC-001, SEC-008, ADR-047
// @tested tests/integration/fr106-api-access-key-listing.test.js
//
// Real database, real service, real route handlers — only the session seam is
// doubled. The claim under test is that a raw secret never comes back and that
// the scope of the listing matches the scope of the write; both are facts about
// a Prisma `select` and a `where`, which a mocked client cannot disprove.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

import prisma from '@/lib/db'
import { createPortfolio, createTenant } from '../factories/scope'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { mintApiAccessKey } from '@/modules/identity/api-access-auth'
import { makeOperatorViewer } from '../factories/viewer'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { GET: LIST, POST: MINT } = await import('@/app/api/platform/api-access-keys/route')
const { DELETE: REVOKE } = await import('@/app/api/platform/api-access-keys/[id]/route')

const tag = () => randomUUID().slice(0, 8)
const operator = () => makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

const list = () => LIST(new Request('http://local/api/platform/api-access-keys'))
const mint = (body) => MINT(new Request('http://local/api/platform/api-access-keys', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const revoke = (id) => REVOKE(new Request(`http://local/api/platform/api-access-keys/${id}`, {
  method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'ROTATED' }),
}), { params: { id } })

async function tenant(label) {
  const suffix = `${label}-${tag()}`
  const portfolio = await createPortfolio({ name: `Key PF ${suffix}`, code: `PF-KEYS-${suffix}` })
  return createTenant({ portfolioId: portfolio.id, name: `Key TNT ${suffix}`, code: `TNT-KEYS-${suffix}` })
}

let world
beforeAll(async () => {
  const home = await tenant('HOME')
  const foreign = await tenant('FOREIGN')

  const owner = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-KEYOWNER-${tag()}`, displayName: 'Key Owner' },
  })
  const outsider = await prisma.person.create({
    data: { id: randomUUID(), code: `PER-KEYOUT-${tag()}`, displayName: 'Key Outsider' },
  })
  // Tenant-wide OWNER (`businessId: null`) — the FR-074(b) grant `ownsTenant`
  // reads, and the only Membership shape that satisfies the key authority.
  await prisma.membership.create({
    data: { personId: owner.id, tenantId: home.id, role: 'OWNER', status: 'ACTIVE' },
  })
  await prisma.membership.create({
    data: { personId: outsider.id, tenantId: foreign.id, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: '["projects"]' },
  })

  const ownerViewer = await resolveViewer({ principalId: owner.id, db: prisma })
  const outsiderViewer = await resolveViewer({ principalId: outsider.id, db: prisma })

  const homeKey = await mintApiAccessKey({ label: 'home-erp', tenantId: home.id, viewer: operator() })
  const foreignKey = await mintApiAccessKey({ label: 'foreign-erp', tenantId: foreign.id, viewer: operator() })

  world = { home, foreign, ownerViewer, outsiderViewer, homeKey, foreignKey }
})

describe('GET /api/platform/api-access-keys', () => {
  it('lists the keys of the Tenants the caller owns, and nothing else', async () => {
    resolveRequestViewer.mockResolvedValue(world.ownerViewer)
    const res = await list()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tenants.map((row) => row.id)).toEqual([world.home.id])
    expect(body.keys.map((row) => row.id)).toContain(world.homeKey.id)
    expect(body.keys.map((row) => row.id)).not.toContain(world.foreignKey.id)
    expect(body.keys.every((row) => row.tenantId === world.home.id)).toBe(true)
  })

  // The whole design of FR-106 rests on the raw key existing exactly once, in
  // the mint response. A list endpoint that leaked it would undo that silently,
  // on a page an owner leaves open.
  it('never returns key material in any form', async () => {
    resolveRequestViewer.mockResolvedValue(world.ownerViewer)
    const text = await (await list()).text()
    expect(text).not.toContain(world.homeKey.key)
    expect(text).not.toContain('keyHash')
    const row = JSON.parse(text).keys.find((entry) => entry.id === world.homeKey.id)
    expect(row.key).toBeUndefined()
    expect(row.keyHash).toBeUndefined()
    // The display prefix IS returned, deliberately: 8 characters of a 24-byte
    // random secret, which is what makes a key identifiable in this listing
    // without being useful toward guessing it (the trade FR-102 already made).
    expect(world.homeKey.key.startsWith(row.keyPrefix)).toBe(true)
    expect(row.keyPrefix.length).toBeLessThan(world.homeKey.key.length)
    expect(row).toMatchObject({ label: 'home-erp', status: 'ACTIVE', revokedAt: null })
  })

  it('is empty — not a refusal — for a caller who governs no Tenant', async () => {
    resolveRequestViewer.mockResolvedValue(world.outsiderViewer)
    const res = await list()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tenants: [], keys: [] })
  })

  it('shows the installation operator both Tenants', async () => {
    resolveRequestViewer.mockResolvedValue(operator())
    const body = await (await list()).json()
    const tenantIds = body.tenants.map((row) => row.id)
    expect(tenantIds).toEqual(expect.arrayContaining([world.home.id, world.foreign.id]))
    expect(body.keys.map((row) => row.id)).toEqual(expect.arrayContaining([world.homeKey.id, world.foreignKey.id]))
  })

  it('refuses an unauthenticated caller before reading anything', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))
    expect((await list()).status).toBe(401)
  })
})

describe('mint → list → revoke, from the panel a Tenant owner sees', () => {
  it('completes the loop the console needs: a minted key becomes revocable from the list alone', async () => {
    resolveRequestViewer.mockResolvedValue(world.ownerViewer)

    const minted = await (await mint({ label: 'console-key', tenantId: world.home.id })).json()
    expect(minted.key).toMatch(/^apik_/)

    const listed = (await (await list()).json()).keys.find((row) => row.id === minted.id)
    expect(listed).toMatchObject({ label: 'console-key', status: 'ACTIVE' })

    // The point of the listing: the id needed to revoke is recoverable without
    // anybody having written it down at mint time.
    const revoked = await (await revoke(listed.id)).json()
    expect(revoked).toEqual({ id: minted.id, revoked: true })

    const after = (await (await list()).json()).keys.find((row) => row.id === minted.id)
    expect(after.status).toBe('REVOKED')
    expect(after.revokedAt).toBeTruthy()

    const events = await prisma.auditEvent.findMany({ where: { entityType: 'API_ACCESS_KEY', entityId: minted.id } })
    expect(events.map((event) => event.action).sort()).toEqual(['API_ACCESS_KEY_MINTED', 'API_ACCESS_KEY_REVOKED'])
    expect(events.some((event) => event.payloadJson.includes(minted.key))).toBe(false)
  })

  it('refuses to revoke a key in a Tenant the caller does not govern, 404-shaped', async () => {
    resolveRequestViewer.mockResolvedValue(world.ownerViewer)
    const res = await revoke(world.foreignKey.id)
    expect(res.status).toBe(404)
    const row = await prisma.apiAccessKey.findUnique({ where: { id: world.foreignKey.id } })
    expect(row.status).toBe('ACTIVE')
  })
})
