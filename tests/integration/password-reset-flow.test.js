import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  authenticateUser,
  hashPassword,
  hashPasswordResetToken,
  mintPasswordReset,
  resetPassword,
} from '@/modules/identity/auth-service'

// @req FR-104 — the whole cycle against the real database: an owner mints for a
// member, the member's old password dies, the new one logs in, the token burns,
// and the live session from before the reset is revoked.
// @spec SDD-054, SEC-008, SEC-014

const secretEnv = { ZURI_SESSION_SECRET: 'integration-reset-secret-0123456789abcdef' }

let business, ownerViewer, staff

describe('password reset flow (FR-104)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Reset Group', code: 'PF-RESET' })
    const tenant = await createTenant({ portfolioId: pf.id, name: 'Reset Tenant', code: 'TNT-RESET' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านรีเซ็ต', code: 'BUS-RESET' })

    const owner = await prisma.person.create({
      data: { id: randomUUID(), code: `PER-RESET-OWNER-${randomUUID().slice(0, 6)}`, displayName: 'Owner' },
    })
    staff = await prisma.person.create({
      data: {
        id: randomUUID(),
        code: `PER-RESET-STAFF-${randomUUID().slice(0, 6)}`,
        displayName: 'Staff',
        credential: { create: { passwordHash: hashPassword('the-old-password') } },
      },
    })
    await prisma.membership.create({
      data: { id: randomUUID(), tenantId: tenant.id, businessId: business.id, personId: staff.id, role: 'MEMBER', domainKeysJson: '[]' },
    })

    ownerViewer = makeViewer({
      ownedBusinessIds: [business.id],
      visibleBusinessIds: [business.id],
      principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
    })
  })

  it('runs the whole cycle: mint → old password dies → new password logs in → token burns → sessions revoked', async () => {
    // A session from before the reset — the thing a reset exists to evict.
    const before = await authenticateUser({ username: staff.code, password: 'the-old-password', env: secretEnv })
    expect(before.success).toBe(true)

    const minted = await mintPasswordReset({ targetPersonId: staff.id, viewer: ownerViewer })
    expect(minted.resetToken).toMatch(/^[a-f0-9]{64}$/)

    // Stored hash-bound: the raw token is nowhere in the database.
    const stored = await prisma.passwordResetToken.findUnique({ where: { token: hashPasswordResetToken(minted.resetToken) } })
    expect(stored).toBeTruthy()
    expect(await prisma.passwordResetToken.findFirst({ where: { token: minted.resetToken } })).toBeNull()

    const reset = await resetPassword({ token: minted.resetToken, newPassword: 'a-brand-new-password' })
    expect(reset.success).toBe(true)

    const oldLogin = await authenticateUser({ username: staff.code, password: 'the-old-password', env: secretEnv })
    expect(oldLogin.success).toBe(false)
    const newLogin = await authenticateUser({ username: staff.code, password: 'a-brand-new-password', env: secretEnv })
    expect(newLogin.success).toBe(true)

    // Single-use: the same token answers with the generic failure now.
    const replay = await resetPassword({ token: minted.resetToken, newPassword: 'yet-another-password' })
    expect(replay).toEqual({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN' })

    // The pre-reset session is revoked; the post-reset login's session is not.
    const preSession = await prisma.session.findUnique({ where: { id: before.sessionId } })
    expect(preSession.status).toBe('REVOKED')
    expect(preSession.revokeReason).toBe('PASSWORD_RESET')
    const postSession = await prisma.session.findUnique({ where: { id: newLogin.sessionId } })
    expect(postSession.status).toBe('ACTIVE')

    // The audit stream answers who minted for whom — and holds no token material.
    const audits = await prisma.auditEvent.findMany({
      where: { entityType: 'PERSON', entityId: staff.id, action: { in: ['PASSWORD_RESET_MINTED', 'PASSWORD_RESET_COMPLETED'] } },
      orderBy: { occurredAt: 'asc' },
    })
    expect(audits.map((event) => event.action)).toEqual(['PASSWORD_RESET_MINTED', 'PASSWORD_RESET_COMPLETED'])
    expect(audits[0].actorId).toBe(ownerViewer.principal.id)
    for (const event of audits) {
      expect(event.payloadJson).not.toContain(minted.resetToken)
      expect(event.payloadJson).not.toContain(hashPasswordResetToken(minted.resetToken))
    }
  })

  it('an owner with no authority over the member cannot mint', async () => {
    const strangerBusiness = await createBusiness({ tenantId: business.tenantId, name: 'ร้านอื่น', code: `BUS-RESET-X-${randomUUID().slice(0, 6)}` })
    const stranger = makeViewer({
      ownedBusinessIds: [strangerBusiness.id],
      visibleBusinessIds: [strangerBusiness.id],
      principal: { id: randomUUID(), code: 'PER-STRANGER', displayName: 'Stranger' },
    })
    await expect(
      mintPasswordReset({ targetPersonId: staff.id, viewer: stranger }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
