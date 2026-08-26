import { describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../scripts/mint-api-access-key.mjs'

// @req FR-106 — the operator command that mints/revokes an Enterprise API key.
// @tested tests/unit/mint-api-access-key-cli.test.js

function mockDb() {
  return {
    tenant: { findUnique: vi.fn(async ({ where }) => ({ id: where.id })) },
    apiAccessKey: {
      create: vi.fn(async ({ data }) => ({ id: 'apik-1', ...data })),
      findUnique: vi.fn(async () => ({ id: 'apik-1', tenantId: 'tnt-1', label: 'erp', status: 'ACTIVE' })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
  }
}

describe('FR-106 mint-api-access-key CLI — parseArgs', () => {
  it('parses a mint invocation', () => {
    expect(parseArgs(['mint', '--label', 'erp-connector', '--tenant', 'tnt-1']))
      .toEqual({ operation: 'mint', label: 'erp-connector', tenant: 'tnt-1' })
  })

  it('parses a revoke invocation, reason optional', () => {
    expect(parseArgs(['revoke', '--id', 'apik-1'])).toEqual({ operation: 'revoke', id: 'apik-1' })
    expect(parseArgs(['revoke', '--id', 'apik-1', '--reason', 'rotated']))
      .toEqual({ operation: 'revoke', id: 'apik-1', reason: 'rotated' })
  })

  it('rejects an unknown operation', () => {
    expect(() => parseArgs(['delete', '--id', 'x'])).toThrow(/OPERATION_INVALID/)
  })

  it('rejects mint missing label or tenant', () => {
    expect(() => parseArgs(['mint', '--label', 'x'])).toThrow(/REQUIRES_LABEL_AND_TENANT/)
    expect(() => parseArgs(['mint', '--tenant', 'x'])).toThrow(/REQUIRES_LABEL_AND_TENANT/)
  })

  it('rejects revoke missing id', () => {
    expect(() => parseArgs(['revoke', '--reason', 'x'])).toThrow(/REQUIRES_ID/)
  })

  it('rejects an option not valid for the operation', () => {
    expect(() => parseArgs(['mint', '--id', 'x'])).toThrow(/OPTION_FORBIDDEN/)
  })
})

describe('FR-106 mint-api-access-key CLI — main', () => {
  it('mint prints the raw key exactly once and audits without token material', async () => {
    const db = mockDb()
    const log = vi.fn()
    const result = await main(['mint', '--label', 'erp-connector', '--tenant', 'tnt-1'], { db, log })
    expect(result.key.startsWith('apik_')).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain(result.key)
    expect(log.mock.calls[0][0]).toContain('only time')
    // The audit row carries no token material in any form.
    expect(db.auditEvent.create).toHaveBeenCalledTimes(1)
    const audited = JSON.stringify(db.auditEvent.create.mock.calls[0][0])
    expect(audited).toContain('API_ACCESS_KEY_MINTED')
    expect(audited).not.toContain(result.key)
  })

  it('revoke reports whether a row was actually revoked and never prints a key', async () => {
    const db = mockDb()
    const log = vi.fn()
    const result = await main(['revoke', '--id', 'apik-1'], { db, log })
    expect(result).toEqual({ id: 'apik-1', revoked: true })
    expect(db.apiAccessKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'apik-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'REVOKED', revokeReason: 'REVOKED_VIA_CLI' }),
    })
    expect(log.mock.calls[0][0]).not.toContain('apik_')
  })
})
