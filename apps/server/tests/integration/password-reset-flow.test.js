import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import {
  PASSWORD_RESET_TTL_MS,
  authenticateUser,
  hashPassword,
  hashPasswordResetToken,
  hashSessionToken,
  mintPasswordReset,
  resetPassword,
  verifyPassword,
} from '@/modules/identity/auth-service'

// @req FR-104 — the whole cycle against the real database: an owner mints for a
// member, the member's old password dies, the new one logs in, the token burns,
// and the live session from before the reset is revoked.
// @spec SDD-054, SEC-008, SEC-014
// @tested tests/integration/password-reset-flow.test.js

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

  it('allows only one of eight concurrent reset attempts to claim a token', async () => {
    let person
    let attemptsPromise
    let releasePrechecks = () => {}

    try {
      const suffix = randomUUID()
      person = await prisma.person.create({
        data: {
          id: randomUUID(),
          code: `PER-RESET-RACE-${suffix.slice(0, 8)}`,
          displayName: 'Concurrent Reset User',
          credential: { create: { passwordHash: hashPassword('the-original-password') } },
        },
      })
      const sessionId = randomUUID()
      await prisma.session.create({
        data: {
          id: sessionId,
          personId: person.id,
          tokenHash: hashSessionToken(randomUUID()),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      })
      const before = await prisma.session.findUnique({ where: { id: sessionId } })
      expect(before.status).toBe('ACTIVE')
      const resetToken = randomUUID()
      await prisma.passwordResetToken.create({
        data: {
          personId: person.id,
          token: hashPasswordResetToken(resetToken),
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        },
      })
      const passwords = Array.from({ length: 8 }, (_, index) => `concurrent-reset-password-${index}`)

      // Hold every real SQLite pre-check until all eight calls have read the live
      // token. This forces the stale-read race even if SQLite serializes writers.
      let prechecksReached = 0
      const allPrechecksReady = new Promise((resolve) => { releasePrechecks = resolve })
      let sessionRevocationCalls = 0
      // Eight real SQLite writers contending for one file lock time out on a slow
      // runner (Prisma's 5 s socket and interactive-transaction limits), which is
      // lock-manager behaviour and not what this test proves. The stale-read gate
      // above is what recreates the race: all eight calls hold a stale "unused"
      // view, so only the database-evaluated conditional claim can pick one
      // winner. Queue the writes so SQLite sees them one at a time, exactly as it
      // would serialize them, without changing which statements run.
      let writeQueue = Promise.resolve()
      const serialized = (operation) => {
        const run = writeQueue.then(operation)
        writeQueue = run.catch(() => {})
        return run
      }
      const db = {
        passwordResetToken: {
          findUnique: async (args) => {
            let record
            try {
              record = await prisma.passwordResetToken.findUnique(args)
            } finally {
              prechecksReached += 1
              if (prechecksReached === passwords.length) releasePrechecks()
              await allPrechecksReady
            }
            return record
          },
          updateMany: (args) => serialized(() => prisma.passwordResetToken.updateMany(args)),
        },
        $transaction: (callback) => serialized(() => prisma.$transaction(callback)),
        session: {
          updateMany: (args) => {
            sessionRevocationCalls += 1
            return serialized(() => prisma.session.updateMany(args))
          },
        },
      }

      attemptsPromise = Promise.allSettled(passwords.map((newPassword) => resetPassword({
        token: resetToken,
        newPassword,
        db,
      })))
      const attemptOutcomes = await attemptsPromise
      expect(attemptOutcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([])
      const results = attemptOutcomes.map((outcome) => outcome.value)

      const winners = results.flatMap((result, index) => result.success ? [index] : [])
      expect(winners).toHaveLength(1)
      expect(results[winners[0]]).toEqual({ success: true })
      expect(results.filter((result) => !result.success)).toEqual(
        Array.from({ length: passwords.length - 1 }, () => ({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN' })),
      )

      const storedCredential = await prisma.personCredential.findUnique({ where: { personId: person.id } })
      expect(passwords.map((password) => verifyPassword(password, storedCredential.passwordHash))).toEqual(
        passwords.map((_, index) => index === winners[0]),
      )

      const completedAudits = await prisma.auditEvent.findMany({
        where: { entityType: 'PERSON', entityId: person.id, action: 'PASSWORD_RESET_COMPLETED' },
      })
      expect(completedAudits).toHaveLength(1)

      const revokedSession = await prisma.session.findUnique({ where: { id: before.id } })
      expect(revokedSession.status).toBe('REVOKED')
      expect(revokedSession.revokeReason).toBe('PASSWORD_RESET')
      expect(sessionRevocationCalls).toBe(1)

      // The same token remains rejected after its winning concurrent use.
      const secondUse = await resetPassword({ token: resetToken, newPassword: 'sequential-second-use-password', db })
      expect(secondUse).toEqual({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN' })
      expect(sessionRevocationCalls).toBe(1)
    } finally {
      releasePrechecks()
      if (attemptsPromise) await attemptsPromise
      if (person) {
        try {
          await prisma.auditEvent.deleteMany({ where: { entityType: 'PERSON', entityId: person.id } })
        } finally {
          await prisma.person.deleteMany({ where: { id: person.id } })
        }
      }
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
