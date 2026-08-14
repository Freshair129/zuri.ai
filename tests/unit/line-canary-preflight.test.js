import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CANARY_RECEIPT_STATES,
  createCanaryPreflightPlan,
} from '@/modules/agent/canary-preflight'

// @req FR-054 — produce a mutation-free, dry-run LINE canary readiness plan.
// @spec BR-013, SDD-027, SEC-011 — readiness fails closed and is not activation or delivery proof.
// @tested tests/unit/line-canary-preflight.test.js

const NOW = '2026-08-14T08:00:00.000Z'

function validInput() {
  return {
    expected: {
      projectRef: 'qcnmhyglarzcpudjorzc',
      tenantId: '11111111-1111-4111-8111-111111111111',
      businessId: '22222222-2222-4222-8222-222222222222',
      bindingId: '33333333-3333-4333-8333-333333333333',
      providerId: 'openai',
      modelId: 'gpt-5-mini',
      goldenReportSha256: 'a'.repeat(64),
      isolationReportSha256: 'b'.repeat(64),
    },
    binding: {
      id: '33333333-3333-4333-8333-333333333333',
      projectRef: 'qcnmhyglarzcpudjorzc',
      tenantId: '11111111-1111-4111-8111-111111111111',
      businessId: '22222222-2222-4222-8222-222222222222',
      status: 'PENDING',
      routingEnabled: false,
      destinationHashPresent: false,
      credentialHashPresent: false,
    },
    provider: {
      id: 'openai',
      modelId: 'gpt-5-mini',
      approvalStatus: 'APPROVED',
      credentialAvailable: true,
    },
    goldenReport: {
      sha256: 'a'.repeat(64),
      status: 'PASS',
      passedAssertions: 20,
      totalAssertions: 20,
      unsupportedNumericClaims: 0,
      expiresAt: '2026-08-15T08:00:00.000Z',
    },
    isolationReport: {
      sha256: 'b'.repeat(64),
      status: 'PASS',
      expiresAt: '2026-08-15T08:00:00.000Z',
    },
  }
}

describe('LINE canary preflight', () => {
  it('publishes a dry-run-only result artifact contract', () => {
    const schema = JSON.parse(readFileSync('contracts/phase1-activation/canary-plan.schema.json', 'utf8'))
    expect(schema.required).toEqual(expect.arrayContaining(['mode', 'ready', 'receiptState', 'capabilities']))
    expect(schema.properties.mode.const).toBe('DRY_RUN')
    expect(schema.properties.capabilities.properties.canActivateBinding.const).toBe(false)
    expect(schema.properties.capabilities.properties.canSendLine.const).toBe(false)
  })

  it('creates only a dry-run plan when every exact prerequisite passes', () => {
    const plan = createCanaryPreflightPlan(validInput(), { now: NOW })

    expect(plan.mode).toBe('DRY_RUN')
    expect(plan.ready).toBe(true)
    expect(plan.receiptState).toBe('EVIDENCE_VERIFIED')
    expect(plan.checks.every((check) => check.status === 'PASS')).toBe(true)
    expect(plan.capabilities).toEqual({ canActivateBinding: false, canSendLine: false })
  })

  it.each([
    ['missing provider credential', (input) => { input.provider.credentialAvailable = false }, 'PROVIDER_CREDENTIAL_MISSING'],
    ['stale golden report', (input) => { input.goldenReport.expiresAt = NOW }, 'GOLDEN_REPORT_STALE'],
    ['stale isolation report', (input) => { input.isolationReport.expiresAt = NOW }, 'ISOLATION_REPORT_STALE'],
    ['mismatched Business', (input) => { input.binding.businessId = '44444444-4444-4444-8444-444444444444' }, 'BUSINESS_MISMATCH'],
    ['mismatched provider', (input) => { input.provider.id = 'anthropic' }, 'PROVIDER_MISMATCH'],
    ['mismatched golden report hash', (input) => { input.goldenReport.sha256 = 'c'.repeat(64) }, 'GOLDEN_REPORT_MISMATCH'],
    ['non-pending binding', (input) => { input.binding.status = 'ACTIVE' }, 'BINDING_NOT_PENDING'],
    ['preinstalled hashes', (input) => { input.binding.destinationHashPresent = true }, 'BINDING_HASHES_PRESENT'],
    ['failed golden report', (input) => { input.goldenReport.unsupportedNumericClaims = 1 }, 'GOLDEN_REPORT_FAILED'],
  ])('refuses %s', (_label, mutate, code) => {
    const input = validInput()
    mutate(input)

    expect(() => createCanaryPreflightPlan(input, { now: NOW })).toThrow(code)
  })

  it('rejects missing prerequisites and activation-shaped fields', () => {
    const input = validInput()
    delete input.isolationReport
    expect(() => createCanaryPreflightPlan(input, { now: NOW })).toThrow()
    expect(() => createCanaryPreflightPlan({ ...validInput(), mode: 'ACTIVATE' }, { now: NOW })).toThrow()
  })

  it('keeps LINE acceptance separate from display and read state', () => {
    expect(CANARY_RECEIPT_STATES).toEqual([
      'GENERATED',
      'EVIDENCE_VERIFIED',
      'ACCEPTED_BY_LINE',
      'DISPLAYED_UNKNOWN',
      'READ_UNKNOWN',
    ])
  })

  it('provides rollback-first guidance without destructive data instructions', () => {
    const plan = createCanaryPreflightPlan(validInput(), { now: NOW })
    expect(plan.failureGuidance[0]).toMatch(/disable routing/i)
    expect(plan.failureGuidance.join(' ')).toMatch(/preserve.*knowledge.*source/i)
    expect(plan.failureGuidance.join(' ')).not.toMatch(/delete|truncate|drop/i)
  })

  it('contains no binding mutation or LINE transport capability', () => {
    const source = readFileSync('src/modules/agent/canary-preflight.js', 'utf8')
    expect(source).not.toMatch(/fetch\s*\(|axios|replyMessage|pushMessage|updateBinding|activateBinding/)
  })
})
