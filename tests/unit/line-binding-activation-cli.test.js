import { beforeAll, describe, expect, it, vi } from 'vitest'

let main
let parseArgs
let validateOperatorDatabaseUrl

beforeAll(() => import('../../scripts/manage-line-binding.mjs').then((module) => {
  main = module.main
  parseArgs = module.parseArgs
  validateOperatorDatabaseUrl = module.validateOperatorDatabaseUrl
}))

// @req FR-055 — expose activation only through a dry-run-default local operator CLI.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — no secrets in argv/output and no privileged DB role.
// @tested tests/unit/line-binding-activation-cli.test.js

function safeReceipt() {
  return {
    contractVersion: '1.0.0', eventId: '55555555-5555-4555-8555-555555555555',
    correlationId: '11111111-1111-4111-8111-111111111111', eventType: 'ACTIVATION', receiptState: 'EVIDENCE_VERIFIED',
    projectRef: 'qcnmhyglarzcpudjorzc', tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
    businessId: '834fa869-62f3-431c-a287-e9a95e91175b', bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
    bindingVersionBefore: 1, bindingVersionAfter: 2, canaryPlanSha256: 'a'.repeat(64),
    goldenReportSha256: 'b'.repeat(64), isolationReportSha256: 'c'.repeat(64), providerId: 'openai',
    modelId: 'gpt-5-mini', approvalRef: 'RC-055', occurredAt: '2026-08-14T02:30:01.000Z',
    actorFingerprint: 'd'.repeat(64),
  }
}

describe('FR-055 operator CLI', () => {
  it('accepts only artifact options and requires an explicit apply flag', () => {
    expect(parseArgs(['activate', '--input', 'input.json', '--canary-plan', 'a', '--golden-report', 'b', '--isolation-report', 'c']))
      .toMatchObject({ operation: 'activate', apply: false })
    expect(() => parseArgs(['activate', '--destination', 'secret'])).toThrow('LINE_ACTIVATION_CLI_OPTION_FORBIDDEN')
    expect(() => parseArgs(['send'])).toThrow('LINE_ACTIVATION_CLI_OPERATION_INVALID')
  })

  it('rejects every database username except the dedicated login', () => {
    expect(validateOperatorDatabaseUrl('postgresql://zuri_line_activation_login:x@localhost/db')).toContain('zuri_line_activation_login')
    for (const role of ['postgres', 'service_role', 'zuri_line_smartgift_login']) {
      expect(() => validateOperatorDatabaseUrl(`postgresql://${role}:x@localhost/db`)).toThrow('LINE_ACTIVATION_DATABASE_ROLE_FORBIDDEN')
    }
  })

  it('keeps dry run as a dual gate and emits only redacted JSON', async () => {
    const log = vi.fn()
    const activate = vi.fn(async () => ({ dryRun: true, preview: safeReceipt() }))
    const readFile = vi.fn(async () => JSON.stringify({ mode: 'DRY_RUN' }))
    await main([
      'activate', '--input', 'input.json', '--canary-plan', 'a', '--golden-report', 'b', '--isolation-report', 'c',
    ], {
      env: { ZURI_LINE_ACTIVATION_DB_URL: 'postgresql://zuri_line_activation_login:db-secret@localhost/db' },
      readFile, createService: () => ({ activate }), createPool: () => ({ end: vi.fn() }), log,
    })
    expect(activate.mock.calls[0][0].secrets).toBeUndefined()
    expect(JSON.stringify(log.mock.calls)).not.toContain('db-secret')
  })

  it('requires both contract APPLY and --apply plus environment-only activation secrets', async () => {
    const baseArgs = ['activate', '--apply', '--input', 'input.json', '--canary-plan', 'a', '--golden-report', 'b', '--isolation-report', 'c']
    const createPool = () => ({ end: vi.fn() })
    await expect(main(baseArgs, {
      env: { ZURI_LINE_ACTIVATION_DB_URL: 'postgresql://zuri_line_activation_login:x@localhost/db' },
      readFile: vi.fn(async () => JSON.stringify({ mode: 'DRY_RUN' })), createPool,
    })).rejects.toThrow('LINE_ACTIVATION_APPLY_CONTRACT_REQUIRED')

    await expect(main(baseArgs.filter((arg) => arg !== '--apply'), {
      env: { ZURI_LINE_ACTIVATION_DB_URL: 'postgresql://zuri_line_activation_login:x@localhost/db' },
      readFile: vi.fn(async () => JSON.stringify({ mode: 'APPLY' })), createPool,
    })).rejects.toThrow('LINE_ACTIVATION_APPLY_FLAG_REQUIRED')

    const activate = vi.fn(async () => ({ dryRun: false, receipt: safeReceipt() }))
    await main(baseArgs, {
      env: {
        ZURI_LINE_ACTIVATION_DB_URL: 'postgresql://zuri_line_activation_login:x@localhost/db',
        ZURI_LINE_BINDING_DESTINATION: 'destination-secret', ZURI_LINE_BINDING_BEARER: 'b'.repeat(32),
        ZURI_LINE_BINDING_PEPPER: 'p'.repeat(32),
      },
      readFile: vi.fn(async () => JSON.stringify({ mode: 'APPLY' })), createPool,
      createService: () => ({ activate }), log: vi.fn(),
    })
    expect(activate.mock.calls[0][0].secrets).toEqual({ destination: 'destination-secret', bearer: 'b'.repeat(32), pepper: 'p'.repeat(32) })
  })

  it('rejects privileged Supabase environment credentials before creating a pool', async () => {
    const createPool = vi.fn()
    await expect(main(['activate'], {
      env: { SUPABASE_SERVICE_ROLE_KEY: 'forbidden' }, createPool,
    })).rejects.toThrow('LINE_ACTIVATION_PRIVILEGED_CREDENTIAL_FORBIDDEN')
    expect(createPool).not.toHaveBeenCalled()
  })

  it('projects known wrapper keys and rejects a hostile nested receipt before output', async () => {
    const args = ['activate', '--input', 'input.json', '--canary-plan', 'a', '--golden-report', 'b', '--isolation-report', 'c']
    const env = { ZURI_LINE_ACTIVATION_DB_URL: 'postgresql://zuri_line_activation_login:x@localhost/db' }
    const readFile = vi.fn(async () => JSON.stringify({ mode: 'DRY_RUN' }))
    const log = vi.fn()
    const safePreview = safeReceipt()
    await main(args, {
      env, readFile, createPool: () => ({ end: vi.fn() }), log,
      createService: () => ({ activate: vi.fn(async () => ({ dryRun: true, replayed: false, preview: safePreview, destination: 'hostile' })) }),
    })
    expect(log.mock.calls[0][0]).not.toContain('hostile')

    await expect(main(args, {
      env, readFile, createPool: () => ({ end: vi.fn() }), log,
      createService: () => ({ activate: vi.fn(async () => ({ dryRun: true, preview: { ...safePreview, destination: 'hostile' } })) }),
    })).rejects.toThrow()
  })
})
