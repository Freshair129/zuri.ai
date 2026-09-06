// @req FR-107 — the bootstrap CLI parses strictly, prints the initial password
// exactly once via its injected logger, and surfaces service refusals.
// @spec SEC-014
// @tested tests/unit/bootstrap-operator-cli.test.js
import { describe, expect, it, vi } from 'vitest'
import { main, parseArgs } from '../../scripts/bootstrap-operator.mjs'

describe('parseArgs', () => {
  it('requires --email and --name', () => {
    expect(() => parseArgs([])).toThrow('OPERATOR_BOOTSTRAP_CLI_REQUIRES_EMAIL_AND_NAME')
    expect(() => parseArgs(['--email', 'a@b.c'])).toThrow('OPERATOR_BOOTSTRAP_CLI_REQUIRES_EMAIL_AND_NAME')
    expect(parseArgs(['--email', 'a@b.c', '--name', 'Boss'])).toEqual({ email: 'a@b.c', name: 'Boss' })
  })

  it('refuses unknown options and dangling values', () => {
    expect(() => parseArgs(['--email', 'a@b.c', '--force', 'x'])).toThrow('OPERATOR_BOOTSTRAP_CLI_USAGE')
    expect(() => parseArgs(['--email'])).toThrow('OPERATOR_BOOTSTRAP_CLI_USAGE')
  })

  it('accepts --grant-only with --email alone — the target Person already exists, no name is needed', () => {
    expect(parseArgs(['--email', 'a@b.c', '--grant-only'])).toEqual({ email: 'a@b.c', grantOnly: true })
    expect(parseArgs(['--grant-only', '--email', 'a@b.c'])).toEqual({ email: 'a@b.c', grantOnly: true })
    expect(() => parseArgs(['--grant-only'])).toThrow('OPERATOR_BOOTSTRAP_CLI_REQUIRES_EMAIL_AND_NAME')
  })
})

describe('main', () => {
  it('bootstraps through the service and logs the result once', async () => {
    const log = vi.fn()
    const db = {
      platformGrant: { findFirst: vi.fn(async () => null) },
      person: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (run) => run({
        person: { create: vi.fn(async ({ data }) => ({ id: 'per-1', code: data.code, displayName: data.displayName })) },
        personCredential: { create: vi.fn(async () => ({ id: 'cred-1' })) },
        platformGrant: { create: vi.fn(async () => ({ id: 'grant-1' })) },
        auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
      })),
    }

    await main(['--email', 'boss@example.com', '--name', 'Boss'], { db, log })

    expect(log).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(log.mock.calls[0][0])
    expect(printed).toMatchObject({ personId: 'per-1', grantId: 'grant-1' })
    expect(printed.initialPassword).toHaveLength(16)
  })

  it('surfaces the standing-operator refusal instead of proceeding', async () => {
    const db = { platformGrant: { findFirst: vi.fn(async () => ({ id: 'grant-x' })) } }
    await expect(main(['--email', 'a@b.c', '--name', 'X'], { db, log: vi.fn() }))
      .rejects.toMatchObject({ status: 409 })
  })

  it('--grant-only issues the grant for an existing credentialed Person and prints no initialPassword', async () => {
    const log = vi.fn()
    const credentialCreate = vi.fn(async () => ({ id: 'cred-never' }))
    const db = {
      platformGrant: { findFirst: vi.fn(async () => null) },
      person: {
        findFirst: vi.fn(async () => ({ id: 'per-1', code: 'PER-BOSS', displayName: 'Boss', credential: { id: 'cred-1' } })),
        findUnique: vi.fn(async () => null),
      },
      $transaction: vi.fn(async (run) => run({
        person: { create: vi.fn() },
        personCredential: { create: credentialCreate },
        platformGrant: { create: vi.fn(async () => ({ id: 'grant-1' })) },
        auditEvent: { create: vi.fn(async ({ data }) => ({ id: 'audit-1', ...data })) },
      })),
    }

    await main(['--email', 'boss@example.com', '--grant-only'], { db, log })

    expect(credentialCreate).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledTimes(1)
    const printed = JSON.parse(log.mock.calls[0][0])
    expect(printed).toMatchObject({ personId: 'per-1', personCode: 'PER-BOSS', grantId: 'grant-1' })
    expect(printed).not.toHaveProperty('initialPassword')
  })
})
