// @req FR-107 — the list CLI parses strictly, defaults to ACTIVE OPERATOR
// grants, and prints no credential material.
// @spec SEC-008
// @tested tests/unit/list-operator-grants-cli.test.js
import { describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../scripts/list-operator-grants.mjs'

describe('parseArgs', () => {
  it('accepts no arguments', () => {
    expect(parseArgs([])).toEqual({})
  })

  it('accepts a known --status value', () => {
    expect(parseArgs(['--status', 'ALL'])).toEqual({ status: 'ALL' })
    expect(parseArgs(['--status', 'REVOKED'])).toEqual({ status: 'REVOKED' })
  })

  it('rejects an unknown --status value and unknown options', () => {
    expect(() => parseArgs(['--status', 'BOGUS'])).toThrow('OPERATOR_LIST_CLI_USAGE')
    expect(() => parseArgs(['--foo', 'bar'])).toThrow('OPERATOR_LIST_CLI_USAGE')
  })
})

describe('main', () => {
  it('lists ACTIVE grants by default and logs the result once, no secrets printed', async () => {
    const log = vi.fn()
    const findMany = vi.fn(async () => [
      { id: 'grant-1', personId: 'per-1', status: 'ACTIVE', createdAt: new Date(0), revokedAt: null, revokeReason: null, grantedByPersonId: null, person: { code: 'PER-1', displayName: 'One' } },
    ])
    const db = { platformGrant: { findMany } }

    await main([], { db, log })

    expect(findMany.mock.calls[0][0].where).toMatchObject({ capability: 'OPERATOR', status: 'ACTIVE' })
    expect(log).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(log.mock.calls[0][0])
    expect(printed).toEqual([{ id: 'grant-1', personId: 'per-1', personCode: 'PER-1', displayName: 'One', status: 'ACTIVE', createdAt: '1970-01-01T00:00:00.000Z', revokedAt: null, revokeReason: null, grantedByPersonId: null }])
    expect(log.mock.calls[0][0]).not.toMatch(/scrypt\$/)
  })

  it('--status ALL removes the status filter', async () => {
    const findMany = vi.fn(async () => [])
    const db = { platformGrant: { findMany } }
    await main(['--status', 'ALL'], { db, log: vi.fn() })
    expect(findMany.mock.calls[0][0].where).toEqual({ capability: 'OPERATOR' })
  })
})
