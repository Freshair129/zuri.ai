import { z } from 'zod'
import { ACTIVATION_RECEIPT_STATES } from './activation-readiness-contract.js'

// @req FR-054 — validate exact canary prerequisites and produce a dry-run plan.
// @spec BR-013, SDD-027, SEC-011 — readiness fails closed without binding mutation or LINE transport.
// @tested tests/unit/line-canary-preflight.test.js

const zSha256 = z.string().regex(/^[a-f0-9]{64}$/)
const zUuid = z.string().uuid()

const zExpected = z.object({
  projectRef: z.string().min(1),
  tenantId: zUuid,
  businessId: zUuid,
  bindingId: zUuid,
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  goldenReportSha256: zSha256,
  isolationReportSha256: zSha256,
}).strict()

const zBinding = z.object({
  id: zUuid,
  projectRef: z.string().min(1),
  tenantId: zUuid,
  businessId: zUuid,
  status: z.string().min(1),
  routingEnabled: z.boolean(),
  destinationHashPresent: z.boolean(),
  credentialHashPresent: z.boolean(),
}).strict()

const zProvider = z.object({
  id: z.string().min(1),
  modelId: z.string().min(1),
  approvalStatus: z.string().min(1),
  credentialAvailable: z.boolean(),
}).strict()

const zGoldenReport = z.object({
  sha256: zSha256,
  status: z.string().min(1),
  passedAssertions: z.number().int().nonnegative(),
  totalAssertions: z.number().int().min(20),
  unsupportedNumericClaims: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
}).strict()

const zIsolationReport = z.object({
  sha256: zSha256,
  status: z.string().min(1),
  expiresAt: z.string().datetime(),
}).strict()

const zInput = z.object({
  mode: z.literal('DRY_RUN').default('DRY_RUN'),
  expected: zExpected,
  binding: zBinding,
  provider: zProvider,
  goldenReport: zGoldenReport,
  isolationReport: zIsolationReport,
}).strict()

export const CANARY_RECEIPT_STATES = ACTIVATION_RECEIPT_STATES

const pass = (id) => ({ id, status: 'PASS' })
const check = (checks, condition, id, failureCode) => {
  checks.push(condition ? pass(id) : { id, status: 'FAIL', failureCode })
}

export function createCanaryPreflightPlan(rawInput, options = {}) {
  const input = zInput.parse(rawInput)
  const now = new Date(options.now ?? Date.now())
  if (Number.isNaN(now.getTime())) throw new Error('CANARY_PREFLIGHT_INVALID_NOW')

  const checks = []
  check(checks, input.binding.id === input.expected.bindingId, 'binding-id', 'BINDING_MISMATCH')
  check(checks, input.binding.projectRef === input.expected.projectRef, 'project-ref', 'PROJECT_MISMATCH')
  check(checks, input.binding.tenantId === input.expected.tenantId, 'tenant-id', 'TENANT_MISMATCH')
  check(checks, input.binding.businessId === input.expected.businessId, 'business-id', 'BUSINESS_MISMATCH')
  check(checks, input.binding.status === 'PENDING', 'binding-status', 'BINDING_NOT_PENDING')
  check(checks, input.binding.routingEnabled === false, 'routing-disabled', 'ROUTING_ALREADY_ENABLED')
  check(
    checks,
    input.binding.destinationHashPresent === false && input.binding.credentialHashPresent === false,
    'binding-hashes-absent',
    'BINDING_HASHES_PRESENT',
  )
  check(checks, input.provider.id === input.expected.providerId, 'provider-id', 'PROVIDER_MISMATCH')
  check(checks, input.provider.modelId === input.expected.modelId, 'model-id', 'MODEL_MISMATCH')
  check(checks, input.provider.approvalStatus === 'APPROVED', 'provider-approved', 'PROVIDER_NOT_APPROVED')
  check(checks, input.provider.credentialAvailable, 'provider-credential', 'PROVIDER_CREDENTIAL_MISSING')
  check(
    checks,
    input.goldenReport.sha256 === input.expected.goldenReportSha256,
    'golden-report-hash',
    'GOLDEN_REPORT_MISMATCH',
  )
  check(
    checks,
    input.goldenReport.status === 'PASS' &&
      input.goldenReport.passedAssertions === input.goldenReport.totalAssertions &&
      input.goldenReport.unsupportedNumericClaims === 0,
    'golden-report-result',
    'GOLDEN_REPORT_FAILED',
  )
  check(checks, new Date(input.goldenReport.expiresAt) > now, 'golden-report-fresh', 'GOLDEN_REPORT_STALE')
  check(checks, input.isolationReport.status === 'PASS', 'isolation-report-result', 'ISOLATION_REPORT_FAILED')
  check(
    checks,
    input.isolationReport.sha256 === input.expected.isolationReportSha256,
    'isolation-report-hash',
    'ISOLATION_REPORT_MISMATCH',
  )
  check(checks, new Date(input.isolationReport.expiresAt) > now, 'isolation-report-fresh', 'ISOLATION_REPORT_STALE')

  const failures = checks.filter((item) => item.status === 'FAIL')
  if (failures.length) {
    const error = new Error(`CANARY_PREFLIGHT_FAILED:${failures.map((item) => item.failureCode).join(',')}`)
    error.code = 'CANARY_PREFLIGHT_FAILED'
    error.failures = failures.map((item) => item.failureCode)
    throw error
  }

  return Object.freeze({
    contractVersion: '1.0.0',
    mode: 'DRY_RUN',
    ready: true,
    receiptState: 'EVIDENCE_VERIFIED',
    scope: Object.freeze({ ...input.expected }),
    evidence: Object.freeze({
      goldenReportSha256: input.goldenReport.sha256,
      isolationReportSha256: input.isolationReport.sha256,
    }),
    checks: Object.freeze(checks),
    capabilities: Object.freeze({ canActivateBinding: false, canSendLine: false }),
    failureGuidance: Object.freeze([
      'Disable routing first and keep the binding PENDING.',
      'Preserve migrated knowledge and source data while investigating.',
      'Record the failed receipt state; display and read remain unknown.',
    ]),
  })
}
