import { describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../scripts/mint-sot-data-plane-key.mjs'

// @req FR-102 — the operator command that mints/revokes a SoT data-plane key.
// @tested tests/unit/mint-sot-data-plane-key-cli.test.js

describe('FR-102 mint-sot-data-plane-key CLI — parseArgs', () => {
  it('parses a mint invocation', () => {
    expect(parseArgs(['mint', '--label', 'smartgift-connector', '--tenant', 'tnt-1']))
      .toEqual({ operation: 'mint', label: 'smartgift-connector', tenant: 'tnt-1' })
  })

  it('parses a revoke invocation, reason optional', () => {
    expect(parseArgs(['revoke', '--id', 'sdpk-1'])).toEqual({ operation: 'revoke', id: 'sdpk-1' })
    expect(parseArgs(['revoke', '--id', 'sdpk-1', '--reason', 'rotated']))
      .toEqual({ operation: 'revoke', id: 'sdpk-1', reason: 'rotated' })
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

describe('FR-102 mint-sot-data-plane-key CLI — main', () => {
  it('mint prints the raw key exactly once and never logs it again on revoke', async () => {
    const created = { id: 'sdpk-1', label: 'smartgift-connector', tenantId: 'tnt-1' }
    const db = {
      sotDataPlaneKey: {
        create: vi.fn(async ({ data }) => ({ ...created, keyHash: data.keyHash, keyPrefix: data.keyPrefix })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const log = vi.fn()
    const result = await main(['mint', '--label', 'smartgift-connector', '--tenant', 'tnt-1'], { db, log })
    expect(result.key.startsWith('sdpk_')).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain(result.key)
    expect(log.mock.calls[0][0]).toContain('only time')
  })

  it('revoke reports whether a row was actually revoked', async () => {
    const db = { sotDataPlaneKey: { updateMany: vi.fn(async () => ({ count: 1 })) } }
    const log = vi.fn()
    const result = await main(['revoke', '--id', 'sdpk-1'], { db, log })
    expect(result).toEqual({ id: 'sdpk-1', revoked: true })
    expect(db.sotDataPlaneKey.updateMany).toHaveBeenCalledWith({
      where: { id: 'sdpk-1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'REVOKED', revokeReason: 'REVOKED_VIA_CLI' }),
    })
  })
})
