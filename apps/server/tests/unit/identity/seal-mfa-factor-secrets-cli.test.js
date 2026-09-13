import { describe, expect, it, vi } from 'vitest'
import { exitCodeFor, main, parseArgs } from '../../../scripts/seal-mfa-factor-secrets.mjs'
import { openMfaSecret, sealMfaSecret } from '@/modules/identity/mfa-secret-seal'
import { generateTotpSecret } from '@/modules/identity/totp'

// @req FR-094, FR-095 — the operator sweep that seals MFA factor secrets at rest
// @spec SEC-029, SDD-096, ADR-088 D4
// @tested tests/unit/identity/seal-mfa-factor-secrets-cli.test.js

const KEY_1 = 'c3'.repeat(32)
const KEY_2 = 'd4'.repeat(32)
const v1 = { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_1 }
const rotated = { NODE_ENV: 'production', ZURI_MFA_SECRET_KEY: KEY_2, ZURI_MFA_SECRET_KEY_VERSION: '2', ZURI_MFA_SECRET_KEY_V1: KEY_1 }

function mockDb(rows) {
  const table = rows.map(row => ({ ...row }))
  return {
    table,
    mfaFactor: {
      findMany: vi.fn(async () => table.map(row => ({ ...row }))),
      updateMany: vi.fn(async ({ where, data }) => {
        const row = table.find(r => r.id === where.id && r.secret === where.secret)
        if (!row) return { count: 0 }
        Object.assign(row, data)
        return { count: 1 }
      }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
  }
}

describe('SEC-029 seal-mfa-factor-secrets CLI', () => {
  it('accepts only --write', () => {
    expect(parseArgs([])).toEqual({ write: false })
    expect(parseArgs(['--write'])).toEqual({ write: true })
    expect(() => parseArgs(['--force'])).toThrow(/MFA_SECRET_SEAL_CLI_OPTION_FORBIDDEN/)
  })

  it('reports without writing, and exits 1 while plaintext remains', async () => {
    const legacy = generateTotpSecret()
    const db = mockDb([{ id: 'f-1', personId: 'p-1', status: 'ACTIVE', secret: legacy }])
    const log = vi.fn()

    const { report, exitCode } = await main([], { db, env: v1, log })

    expect(exitCode).toBe(1)
    expect(report.pending).toEqual([{ factorId: 'f-1', personId: 'p-1', status: 'ACTIVE', from: 'LEGACY_PLAINTEXT', fromKeyVersion: null }])
    expect(db.mfaFactor.updateMany).not.toHaveBeenCalled()
    expect(db.table[0].secret).toBe(legacy)
    expect(log.mock.calls.flat().join('\n')).not.toContain(legacy)
  })

  it('--write seals plaintext and stale rows, audits without secrets, and is idempotent', async () => {
    const legacySecret = generateTotpSecret()
    const staleSecret = generateTotpSecret()
    const currentSecret = generateTotpSecret()
    const db = mockDb([
      { id: 'f-legacy', personId: 'p-1', status: 'PENDING', secret: legacySecret },
      { id: 'f-stale', personId: 'p-2', status: 'ACTIVE', secret: sealMfaSecret(staleSecret, { personId: 'p-2', factorId: 'f-stale' }, v1) },
      { id: 'f-current', personId: 'p-3', status: 'ACTIVE', secret: sealMfaSecret(currentSecret, { personId: 'p-3', factorId: 'f-current' }, rotated) },
      { id: 'f-garbage', personId: 'p-4', status: 'REVOKED', secret: 'not a secret' },
    ])
    const log = vi.fn()

    const first = await main(['--write'], { db, env: rotated, log })

    expect(first.report.resealed).toEqual(['f-legacy', 'f-stale'])
    expect(first.report.alreadyCurrent).toBe(1)
    expect(first.report.unreadable).toEqual([{ factorId: 'f-garbage', personId: 'p-4', status: 'REVOKED', reason: 'UNRECOGNIZED' }])
    expect(first.exitCode).toBe(1)

    const [legacyRow, staleRow] = db.table
    expect(legacyRow.secret.startsWith('mfa.v2.')).toBe(true)
    expect(legacyRow.secret).not.toContain(legacySecret)
    expect(openMfaSecret(legacyRow.secret, { personId: 'p-1', factorId: 'f-legacy' }, rotated)).toBe(legacySecret)
    expect(staleRow.secret.startsWith('mfa.v2.')).toBe(true)
    expect(openMfaSecret(staleRow.secret, { personId: 'p-2', factorId: 'f-stale' }, rotated)).toBe(staleSecret)

    const audits = db.auditEvent.create.mock.calls.map(([{ data }]) => data)
    expect(audits.map(a => [a.entityType, a.entityId, a.action])).toEqual([
      ['MFA_FACTOR', 'f-legacy', 'SECRET_RESEALED'],
      ['MFA_FACTOR', 'f-stale', 'SECRET_RESEALED'],
    ])
    const written = JSON.stringify(audits) + log.mock.calls.flat().join('\n')
    for (const secret of [legacySecret, staleSecret, currentSecret]) expect(written).not.toContain(secret)

    db.table.pop()
    const second = await main(['--write'], { db, env: rotated, log })
    expect(second.report.resealed).toEqual([])
    expect(second.report.alreadyCurrent).toBe(3)
    expect(second.exitCode).toBe(0)
  })

  it('skips a row that changed under it instead of overwriting', async () => {
    const db = mockDb([{ id: 'f-1', personId: 'p-1', status: 'ACTIVE', secret: generateTotpSecret() }])
    db.mfaFactor.updateMany.mockResolvedValueOnce({ count: 0 })

    const { report, exitCode } = await main(['--write'], { db, env: v1, log: vi.fn() })

    expect(report.changedConcurrently).toEqual(['f-1'])
    expect(report.resealed).toEqual([])
    expect(db.auditEvent.create).not.toHaveBeenCalled()
    expect(exitCode).toBe(1)
  })

  it('refuses before reading a row when production has no key', async () => {
    const db = mockDb([])
    await expect(main(['--write'], { db, env: { NODE_ENV: 'production' }, log: vi.fn() }))
      .rejects.toMatchObject({ code: 'MFA_SECRET_KEY_REQUIRED' })
    expect(db.mfaFactor.findMany).not.toHaveBeenCalled()
  })

  it('exit code is 0 for a clean report', () => {
    expect(exitCodeFor({ write: false, pending: [], unreadable: [], changedConcurrently: [] })).toBe(0)
  })
})
