import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { resolveLineIdentity, revokeLineIdentity } from '@/modules/identity/resolve-line-identity'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'

// @req FR-022 — account linking: a LINE subject binds to an EXISTING Person via a
// single-use, expiring token; idempotent, revoke-reactivating, and (opt-in) merging.

let tenant, business

async function staffPerson(code, name = 'Staff') {
  const person = await prisma.person.create({ data: { code, displayName: name } })
  await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, role: 'OWNER' } })
  return person
}

describe('account linking (FR-022)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Link Group', code: 'PF-LNK' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Link Tenant', code: 'TNT-LNK' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Link Business', code: 'BUS-LNK' })
  })

  it('binds a fresh LINE subject to an existing Person (no new principal minted)', async () => {
    const person = await staffPerson('PSN-lnk-1')
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    const r = await redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ulnk-1' })
    expect(r.linked).toBe(true)
    expect(r.personId).toBe(person.id)
    // The binding now drives resolution — no separate auto-minted person.
    const resolved = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Ulnk-1' })
    expect(resolved.personId).toBe(person.id)
    expect(resolved.created).toBe(false)
  })

  it('a token is single-use', async () => {
    const person = await staffPerson('PSN-lnk-2')
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ulnk-2' })
    await expect(redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ulnk-2' })).rejects.toThrow(/already been used/)
  })

  it('re-linking the same subject to the same person is an idempotent confirm', async () => {
    const person = await staffPerson('PSN-lnk-3')
    const t1 = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({ tenantId: tenant.id, token: t1.token, lineUserId: 'Ulnk-3' })
    const t2 = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    const r = await redeemLinkToken({ tenantId: tenant.id, token: t2.token, lineUserId: 'Ulnk-3' })
    expect(r.linked).toBe(false)
    expect(r.merged).toBe(false)
    expect(r.personId).toBe(person.id)
    const n = await prisma.externalIdentity.count({ where: { tenantId: tenant.id, providerSubject: 'Ulnk-3' } })
    expect(n).toBe(1)
  })

  it('reactivates a revoked binding on re-link', async () => {
    const person = await staffPerson('PSN-lnk-4')
    const t1 = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({ tenantId: tenant.id, token: t1.token, lineUserId: 'Ulnk-4' })
    await revokeLineIdentity(tenant.id, 'Ulnk-4')
    const t2 = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    const r = await redeemLinkToken({ tenantId: tenant.id, token: t2.token, lineUserId: 'Ulnk-4' })
    expect(r.reactivated).toBe(true)
    const resolved = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Ulnk-4' })
    expect(resolved.personId).toBe(person.id)
  })

  it('rejects an expired token', async () => {
    const person = await staffPerson('PSN-lnk-5')
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await prisma.identityLinkToken.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ulnk-5' })).rejects.toThrow(/expired/)
  })

  it('rejects an unknown token', async () => {
    await expect(redeemLinkToken({ tenantId: tenant.id, token: 'not-a-real-token', lineUserId: 'Ulnk-x' })).rejects.toThrow(/Invalid link token/)
  })

  it('refuses to re-home a subject already linked to another principal without merge', async () => {
    const auto = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Ulnk-6' }) // auto-minted principal
    const canonical = await staffPerson('PSN-lnk-6')
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: canonical.id })
    await expect(redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ulnk-6' })).rejects.toThrow(/different principal/)
    // and the original binding is untouched
    const resolved = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Ulnk-6' })
    expect(resolved.personId).toBe(auto.personId)
  })

  it('merges an auto-minted principal into the canonical one, carrying the Customer', async () => {
    // Customer chats first (auto-mint + customer), then proves they are an existing person.
    const ingest = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ulnk-7', threadId: 'T-lnk-7', text: 'hello' })
    const canonical = await staffPerson('PSN-lnk-7', 'Khun A')
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: canonical.id })
    const r = await redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ulnk-7', merge: true })
    expect(r.merged).toBe(true)
    expect(r.fromPersonId).toBe(ingest.personId)
    expect(r.personId).toBe(canonical.id)
    // resolution now points at the canonical person
    const resolved = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Ulnk-7' })
    expect(resolved.personId).toBe(canonical.id)
    // and the conversation history follows: the Customer was re-pointed
    const customer = await prisma.customer.findUnique({ where: { id: ingest.customerId } })
    expect(customer.personId).toBe(canonical.id)
  })
})
