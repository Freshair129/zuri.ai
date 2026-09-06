// @req FR-107 — the revoke CLI parses strictly, refuses the last ACTIVE
// OPERATOR grant unless --allow-last is passed, surfaces service refusals,
// and prints no credential material.
// @spec SEC-014
// @tested tests/unit/revoke-operator-grant-cli.test.js
import { describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../scripts/revoke-operator-grant.mjs'

describe('parseArgs', () => {
  it('requires --id', () => {
    expect(() => parseArgs([])).toThrow('OPERATOR_REVOKE_CLI_REQUIRES_ID')
    expect(parseArgs(['--id', 'grant-1'])).toEqual({ id: 'grant-1' })
  })

  it('accepts --reason and --allow-last', () => {
    expect(parseArgs(['--id', 'grant-1', '--reason', 'no longer staff', '--allow-last']))
      .toEqual({ id: 'grant-1', reason: 'no longer staff', allowLast: true })
    expect(parseArgs(['--allow-last', '--id', 'grant-1']))
      .toEqual({ id: 'grant-1', allowLast: true })
  })

  it('refuses unknown options and dangling values', () => {
    expect(() => parseArgs(['--id', 'grant-1', '--force', 'x'])).toThrow('OPERATOR_REVOKE_CLI_USAGE')
    expect(() => parseArgs(['--id'])).toThrow('OPERATOR_REVOKE_CLI_USAGE')
  })
})

function db({ grant, activeCount = 2 } = {}) {
  return {
    platformGrant: {
      findUnique: vi.fn(async () => grant),
      count: vi.fn(async () => activeCount),
      updateMany: vi.fn(async ({ where, data }) => {
        if (!grant || grant.status !== 'ACTIVE' || where.id !== grant.id) return { count: 0 }
        grant.status = data.status
        return { count: 1 }
      }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
  }
}

describe('main', () => {
  it('revokes through the service and logs the result once, no secrets printed', async () => {
    const log = vi.fn()
    const grant = { id: 'grant-1', personId: 'per-1', capability: 'OPERATOR', status: 'ACTIVE', person: { code: 'PER-1' } }

    await main(['--id', 'grant-1'], { db: db({ grant }), log })

    expect(log).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(log.mock.calls[0][0])
    expect(printed).toMatchObject({ id: 'grant-1', personId: 'per-1', personCode: 'PER-1', revoked: true, status: 'REVOKED' })
    expect(log.mock.calls[0][0]).not.toMatch(/scrypt\$/)
  })

  it('surfaces the last-active-operator refusal instead of proceeding', async () => {
    const grant = { id: 'grant-1', personId: 'per-1', capability: 'OPERATOR', status: 'ACTIVE', person: { code: 'PER-1' } }
    await expect(main(['--id', 'grant-1'], { db: db({ grant, activeCount: 1 }), log: vi.fn() }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('OPERATOR_GRANT_REFUSED_LAST_ACTIVE_OPERATOR') })
  })

  it('--allow-last overrides the last-active-operator refusal', async () => {
    const log = vi.fn()
    const grant = { id: 'grant-1', personId: 'per-1', capability: 'OPERATOR', status: 'ACTIVE', person: { code: 'PER-1' } }
    await main(['--id', 'grant-1', '--allow-last'], { db: db({ grant, activeCount: 1 }), log })
    const printed = JSON.parse(log.mock.calls[0][0])
    expect(printed).toMatchObject({ revoked: true, status: 'REVOKED' })
  })
})
