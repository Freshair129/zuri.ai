import { describe, expect, it, vi } from 'vitest'
import { makeOperatorViewer, makeViewer, ownsElsewhere } from '../factories/viewer'
import {
  PASSWORD_RESET_TTL_MS,
  hashPasswordResetToken,
  mintPasswordReset,
  resetPassword,
  verifyPassword,
} from '@/modules/identity/auth-service'

// @req FR-104 — mint is authority-gated and hash-bound; consume is single-use,
// expiring, generic-on-failure, and evicts every live session.
// @spec SDD-054, SEC-008, SEC-014

const TARGET = { id: 'per-target', code: 'PER-TARGET', displayName: 'Staff' }

function mintDb({ membership = { id: 'mem-1' } } = {}) {
  const created = []
  return {
    created,
    person: { findUnique: vi.fn().mockResolvedValue(TARGET) },
    membership: { findFirst: vi.fn().mockResolvedValue(membership) },
    passwordResetToken: {
      create: vi.fn(async ({ data }) => { created.push(data); return { id: 'prt-1', ...data } }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
  }
}

describe('mintPasswordReset authority', () => {
  it('lets an owner of a Business the target belongs to mint, and stores only the hash', async () => {
    const db = mintDb()
    const viewer = makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'] })

    const result = await mintPasswordReset({ targetPersonId: TARGET.id, viewer, db })

    expect(result.resetToken).toMatch(/^[a-f0-9]{64}$/)
    // The stored column carries the digest, never the raw secret (SEC-014).
    expect(db.created[0].token).toBe(hashPasswordResetToken(result.resetToken))
    expect(db.created[0].token).not.toBe(result.resetToken)
    expect(db.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { personId: TARGET.id, businessId: { in: ['b-1'] } },
    }))
  })

  it('lets the installation operator mint without a membership lookup', async () => {
    const db = mintDb({ membership: null })
    const result = await mintPasswordReset({ targetPersonId: TARGET.id, viewer: makeOperatorViewer(), db })
    expect(result.resetToken).toBeTruthy()
    expect(db.membership.findFirst).not.toHaveBeenCalled()
  })

  it('refuses an owner of somewhere else — the global OWNER label is not authority here', async () => {
    const db = mintDb({ membership: null })
    await expect(
      mintPasswordReset({ targetPersonId: TARGET.id, viewer: ownsElsewhere(), db }),
    ).rejects.toMatchObject({ status: 403 })
    expect(db.passwordResetToken.create).not.toHaveBeenCalled()
  })

  it('refuses a plain member', async () => {
    const db = mintDb()
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: [] })
    await expect(
      mintPasswordReset({ targetPersonId: TARGET.id, viewer, db }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('404s an unknown target before any authority reasoning', async () => {
    const db = mintDb()
    db.person.findUnique.mockResolvedValue(null)
    await expect(
      mintPasswordReset({ targetPersonId: 'nope', viewer: makeOperatorViewer(), db }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('audits who minted for whom, with no token material in any form', async () => {
    const db = mintDb()
    const viewer = makeViewer({ ownedBusinessIds: ['b-1'], visibleBusinessIds: ['b-1'], principal: { id: 'per-owner' } })
    const result = await mintPasswordReset({ targetPersonId: TARGET.id, viewer, db })

    const audit = db.auditEvent.create.mock.calls[0][0].data
    expect(audit.action).toBe('PASSWORD_RESET_MINTED')
    expect(audit.actorId).toBe('per-owner')
    expect(audit.payloadJson).not.toContain(result.resetToken)
    expect(audit.payloadJson).not.toContain(hashPasswordResetToken(result.resetToken))
  })
})

function consumeDb(record) {
  const state = { credential: null, used: null, revoked: 0 }
  const tx = {
    personCredential: {
      upsert: vi.fn(async ({ update, create }) => { state.credential = update.passwordHash || create.passwordHash }),
    },
    passwordResetToken: {
      update: vi.fn(async ({ data }) => { state.used = data.usedAt }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-2', ...data })) },
  }
  return {
    state,
    tx,
    passwordResetToken: { findUnique: vi.fn().mockResolvedValue(record) },
    $transaction: vi.fn(async (fn) => fn(tx)),
    session: {
      updateMany: vi.fn(async () => { state.revoked = 2; return { count: 2 } }),
    },
  }
}

const liveRecord = () => ({
  id: 'prt-1', personId: TARGET.id, usedAt: null, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
})

describe('resetPassword consumption', () => {
  it('sets the credential, burns the token, and revokes every active session', async () => {
    const db = consumeDb(liveRecord())
    const result = await resetPassword({ token: 'raw-token', newPassword: 'a-new-password', db })

    expect(result.success).toBe(true)
    expect(verifyPassword('a-new-password', db.state.credential)).toBe(true)
    expect(db.state.used).toBeInstanceOf(Date)
    // A stolen session must not survive the reset that exists to evict it.
    expect(db.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { personId: TARGET.id, status: 'ACTIVE' },
      data: expect.objectContaining({ revokeReason: 'PASSWORD_RESET' }),
    }))
  })

  it('looks the token up by digest, so the raw value never reaches a query', async () => {
    const db = consumeDb(liveRecord())
    await resetPassword({ token: 'raw-token', newPassword: 'a-new-password', db })
    expect(db.passwordResetToken.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { token: hashPasswordResetToken('raw-token') },
    }))
  })

  it.each([
    ['unknown', null],
    ['already used', { ...liveRecord(), usedAt: new Date() }],
    ['expired', { ...liveRecord(), expiresAt: new Date(Date.now() - 1000) }],
  ])('answers a %s token with the one generic failure', async (_label, record) => {
    const db = consumeDb(record)
    const result = await resetPassword({ token: 'raw-token', newPassword: 'a-new-password', db })
    expect(result).toEqual({ success: false, error: 'INVALID_OR_EXPIRED_TOKEN' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a weak password before touching the database', async () => {
    const db = consumeDb(liveRecord())
    const result = await resetPassword({ token: 'raw-token', newPassword: 'short', db })
    expect(result).toEqual({ success: false, error: 'PASSWORD_INVALID' })
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled()
  })
})
