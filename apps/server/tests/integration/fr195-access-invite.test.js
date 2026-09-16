// @req FR-195 — AccessInvite against a real database: PORTFOLIO scope keeps
//   FR-067's exact WorkspaceMembership behaviour; TENANT/BUSINESS scope mints
//   a token that becomes a real Membership on acceptance, bound to the
//   accepting SESSION rather than the invited email; role is refused at OWNER
//   for every scope; revocation and decline both fail closed with the generic
//   refusal.
// @spec BR-016, SEC-014, SDD-094, ADR-077 D8, ADR-079
// @tested tests/integration/fr195-access-invite.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  acceptAccessInvite,
  declineAccessInvite,
  mintAccessInvite,
  revokeAccessInvite,
} from '@/modules/identity/access-invite-service'

let portfolio, tenant, business, tenantOwner, businessOwner, outsider, acceptor, otherPerson

describe('FR-195 AccessInvite', () => {
  beforeAll(async () => {
    portfolio = await createPortfolio({ name: 'Invite Group', code: 'PF-INV' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Invite Tenant', code: 'TNT-INV' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านเชิญ', code: 'BUS-INV' })

    const ownerPerson = await prisma.person.create({ data: { code: 'PER-INV-OWNER', displayName: 'Owner' } })
    tenantOwner = makeViewer({
      role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
      ownedTenantIds: [tenant.id], principal: { id: ownerPerson.id, code: ownerPerson.code, displayName: ownerPerson.displayName },
    })
    businessOwner = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
      principal: { id: ownerPerson.id, code: ownerPerson.code, displayName: ownerPerson.displayName },
    })
    outsider = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

    const acceptorPerson = await prisma.person.create({ data: { code: 'PER-INV-ACCEPT', displayName: 'Acceptor', email: 'acceptor@example.com' } })
    acceptor = acceptorPerson.id
    const otherPersonRow = await prisma.person.create({ data: { code: 'PER-INV-OTHER', displayName: 'Other', email: 'other@example.com' } })
    otherPerson = otherPersonRow.id
  })

  it('mints a TENANT-scope invite under ownsTenant, refuses OWNER role, and refuses a non-owner with 404', async () => {
    await expect(
      mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, role: 'OWNER', invitedEmail: 'x@example.com' }),
    ).rejects.toMatchObject({ status: 400, message: 'INVITE_ROLE_NOT_ALLOWED' })

    await expect(
      mintAccessInvite({ viewer: outsider, scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'x@example.com' }),
    ).rejects.toMatchObject({ status: 404, message: 'Tenant not found' })

    const minted = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'acceptor@example.com' })
    expect(minted).toMatchObject({ scopeType: 'TENANT', tenantId: tenant.id, businessId: null, role: 'MEMBER' })
    expect(minted.inviteToken).toMatch(/^[a-f0-9]{64}$/)
  })

  it('accepting a TENANT invite binds the Membership to the ACCEPTING session, not the invited email', async () => {
    const minted = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'other@example.com' })
    // `otherPerson` holds the invited email, but `acceptor` is the session
    // that presents the token — the grant must bind to acceptor, never to
    // whichever account currently owns that email address.
    const result = await acceptAccessInvite({ token: minted.inviteToken, personId: acceptor })
    expect(result).toMatchObject({ status: 'ACCEPTED', scopeType: 'TENANT', tenantId: tenant.id })

    const membership = await prisma.membership.findUnique({ where: { id: result.membershipId } })
    expect(membership).toMatchObject({ personId: acceptor, tenantId: tenant.id, businessId: null, scopeType: 'TENANT', role: 'MEMBER', status: 'ACTIVE', grantSource: 'INVITE' })
    expect(await prisma.membership.findFirst({ where: { personId: otherPerson, tenantId: tenant.id } })).toBeNull()

    const invite = await prisma.accessInvite.findUnique({ where: { id: minted.inviteId } })
    expect(invite).toMatchObject({ status: 'ACCEPTED', acceptedByPersonId: acceptor, acceptedMembershipId: result.membershipId })

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'ACCESS_INVITE', entityId: minted.inviteId } })
    expect(audits.map((a) => a.action)).toEqual(['ACCESS_INVITE_MINTED', 'ACCESS_INVITE_ACCEPTED'])
    const grantAudit = await prisma.auditEvent.findFirst({ where: { entityType: 'MEMBERSHIP', entityId: result.membershipId } })
    expect(grantAudit).toMatchObject({ action: 'MEMBERSHIP_GRANTED' })
  })

  it('mints a BUSINESS-scope invite under ownsBusiness, and acceptance grants a Business Membership', async () => {
    await expect(
      mintAccessInvite({ viewer: outsider, scopeType: 'BUSINESS', businessId: business.id, invitedEmail: 'x@example.com' }),
    ).rejects.toMatchObject({ status: 404, message: 'Business not found' })

    const secondAcceptor = await prisma.person.create({ data: { code: 'PER-INV-ACCEPT2', displayName: 'Acceptor Two' } })
    const minted = await mintAccessInvite({
      viewer: businessOwner, scopeType: 'BUSINESS', businessId: business.id, targetPersonId: secondAcceptor.id, domainKeys: ['projects', 'not-a-real-domain'],
    })
    expect(minted).toMatchObject({ scopeType: 'BUSINESS', tenantId: tenant.id, businessId: business.id })

    const result = await acceptAccessInvite({ token: minted.inviteToken, personId: secondAcceptor.id })
    const membership = await prisma.membership.findUnique({ where: { id: result.membershipId } })
    expect(membership).toMatchObject({ personId: secondAcceptor.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', grantSource: 'INVITE' })
    expect(JSON.parse(membership.domainKeysJson)).toEqual(['projects'])
  })

  it('fails closed with the one generic refusal: unknown, expired, revoked, and wrong target', async () => {
    await expect(acceptAccessInvite({ token: 'nope', personId: acceptor })).rejects.toMatchObject({ status: 400, message: 'INVALID_OR_EXPIRED_INVITE' })

    const expired = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'exp@example.com' })
    await prisma.accessInvite.update({ where: { id: expired.inviteId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expect(acceptAccessInvite({ token: expired.inviteToken, personId: acceptor })).rejects.toMatchObject({ status: 400, message: 'INVALID_OR_EXPIRED_INVITE' })

    const targeted = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, targetPersonId: acceptor })
    await expect(acceptAccessInvite({ token: targeted.inviteToken, personId: otherPerson })).rejects.toMatchObject({ status: 400, message: 'INVALID_OR_EXPIRED_INVITE' })

    const revokable = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, invitedEmail: 'rev@example.com' })
    await revokeAccessInvite({ viewer: tenantOwner, inviteId: revokable.inviteId })
    await expect(acceptAccessInvite({ token: revokable.inviteToken, personId: acceptor })).rejects.toMatchObject({ status: 400, message: 'INVALID_OR_EXPIRED_INVITE' })
    await expect(revokeAccessInvite({ viewer: tenantOwner, inviteId: revokable.inviteId })).rejects.toMatchObject({ status: 409, message: 'INVITE_NOT_PENDING' })
  })

  it('a targeted invite can be declined by its addressee, and stays refused afterward', async () => {
    const minted = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'TENANT', tenantId: tenant.id, targetPersonId: acceptor })
    const declined = await declineAccessInvite({ token: minted.inviteToken, personId: acceptor })
    expect(declined).toMatchObject({ status: 'DECLINED' })
    await expect(acceptAccessInvite({ token: minted.inviteToken, personId: acceptor })).rejects.toMatchObject({ status: 400, message: 'INVALID_OR_EXPIRED_INVITE' })
  })

  it('PORTFOLIO scope delegates to the FR-067 WorkspaceMembership path unchanged', async () => {
    const minted = await mintAccessInvite({ viewer: tenantOwner, scopeType: 'PORTFOLIO', portfolioId: portfolio.id, invitedEmail: 'ws@example.com' })
    expect(minted).toMatchObject({ scopeType: 'PORTFOLIO', portfolioId: portfolio.id, tenantId: null, businessId: null })
    const result = await acceptAccessInvite({ token: minted.inviteToken, personId: acceptor })
    expect(result).toMatchObject({ portfolioId: portfolio.id, status: 'ACTIVE' })
    const wm = await prisma.workspaceMembership.findUnique({ where: { id: result.membershipId } })
    expect(wm).toMatchObject({ portfolioId: portfolio.id, personId: acceptor, status: 'ACTIVE' })
  })
})
