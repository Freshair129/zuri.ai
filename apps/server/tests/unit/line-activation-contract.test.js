import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import {
  LINE_ACTIVATION_RECEIPT_STATES,
  parseLineActivationInput,
  parseLineCanaryReceipt,
  parseLineRollbackInput,
} from '@/modules/agent/line-activation-contract'

// @req FR-055 — activation and receipt inputs are strict, versioned and redacted.
// @spec BR-014, SDD-028, SEC-012 — one correlation is bounded to exact scope and secret-free evidence.
// @tested tests/unit/line-activation-contract.test.js

const uuid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const sha256 = (letter) => letter.repeat(64)
const executionNow = '2026-08-14T02:30:00.000Z'

function compileSchema(file) {
  const schema = JSON.parse(readFileSync(new URL(`../../contracts/phase1-activation/${file}`, import.meta.url), 'utf8'))
  const ajv = new Ajv2020({ strict: true, useDefaults: true })
  addFormats(ajv)
  return { schema, validate: ajv.compile(schema) }
}

function activationInput(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    mode: 'DRY_RUN',
    correlationId: uuid('1'),
    scope: {
      projectRef: 'qcnmhyglarzcpudjorzc',
      tenantId: uuid('2'),
      businessId: uuid('3'),
      bindingId: uuid('4'),
    },
    expectation: {
      bindingVersion: 1,
      bindingStatus: 'PENDING',
      destinationHashPresent: false,
      credentialHashPresent: false,
      bindingCode: 'LINE-SMARTGIFT-OA',
      channelProvider: 'LINE',
      providerId: 'openai',
      modelId: 'gpt-5-mini',
    },
    evidence: {
      canaryPlanSha256: sha256('a'),
      goldenReportSha256: sha256('b'),
      isolationReportSha256: sha256('c'),
    },
    approval: {
      approvalRef: 'RC-2026-08-14-A1',
      notBefore: '2026-08-14T02:00:00.000Z',
      expiresAt: '2026-08-14T03:00:00.000Z',
    },
    bindingExpiresAt: '2026-08-14T02:45:00.000Z',
    ...overrides,
  }
}

function rollbackInput(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    mode: 'DRY_RUN',
    correlationId: uuid('6'),
    scope: {
      projectRef: 'qcnmhyglarzcpudjorzc',
      tenantId: uuid('2'),
      businessId: uuid('3'),
      bindingId: uuid('4'),
    },
    expectation: {
      bindingVersion: 2,
      bindingStatus: 'ACTIVE',
      destinationHashPresent: true,
      credentialHashPresent: true,
      bindingCode: 'LINE-SMARTGIFT-OA',
      channelProvider: 'LINE',
      providerId: 'openai',
      modelId: 'gpt-5-mini',
    },
    evidence: {
      canaryPlanSha256: sha256('a'),
      goldenReportSha256: sha256('b'),
      isolationReportSha256: sha256('c'),
    },
    approval: {
      approvalRef: 'RC-2026-08-14-R1',
      notBefore: '2026-08-14T02:00:00.000Z',
      expiresAt: '2026-08-14T03:00:00.000Z',
    },
    ...overrides,
  }
}

function receipt(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    eventId: uuid('5'),
    correlationId: uuid('1'),
    eventType: 'ACTIVATION',
    receiptState: 'EVIDENCE_VERIFIED',
    projectRef: 'qcnmhyglarzcpudjorzc',
    tenantId: uuid('2'),
    businessId: uuid('3'),
    bindingId: uuid('4'),
    bindingVersionBefore: 1,
    bindingVersionAfter: 2,
    canaryPlanSha256: sha256('a'),
    goldenReportSha256: sha256('b'),
    isolationReportSha256: sha256('c'),
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    approvalRef: 'RC-2026-08-14-A1',
    occurredAt: '2026-08-14T02:30:00.000Z',
    actorFingerprint: sha256('d'),
    ...overrides,
  }
}

describe('FR-055 LINE activation contracts', () => {
  it('accepts an exact dry-run activation input and defaults omitted mode to DRY_RUN', () => {
    expect(parseLineActivationInput(activationInput(), { now: executionNow }).mode).toBe('DRY_RUN')
    const withoutMode = activationInput()
    delete withoutMode.mode
    expect(parseLineActivationInput(withoutMode, { now: executionNow }).mode).toBe('DRY_RUN')
  })

  it('fails closed on non-PENDING, pre-populated hashes, malformed evidence, and invalid windows', () => {
    expect(() => parseLineActivationInput(activationInput({
      expectation: { ...activationInput().expectation, bindingStatus: 'ACTIVE' },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineActivationInput(activationInput({
      expectation: { ...activationInput().expectation, destinationHashPresent: true },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineActivationInput(activationInput({
      evidence: { ...activationInput().evidence, canaryPlanSha256: 'not-a-hash' },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineActivationInput(activationInput({
      approval: {
        ...activationInput().approval,
        notBefore: '2026-08-14T04:00:00.000Z',
      },
    }), { now: executionNow })).toThrow(/approval window/i)
  })

  it('pins activation to the exact reserved binding code and LINE channel provider', () => {
    expect(() => parseLineActivationInput(activationInput({
      expectation: { ...activationInput().expectation, bindingCode: 'OTHER' },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineActivationInput(activationInput({
      expectation: { ...activationInput().expectation, channelProvider: 'OTHER' },
    }), { now: executionNow })).toThrow()
  })

  it('rejects impossible binding version and stale or approval-exceeding binding expiry', () => {
    expect(() => parseLineActivationInput(activationInput({
      expectation: { ...activationInput().expectation, bindingVersion: 0 },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineActivationInput(activationInput({
      bindingExpiresAt: '2026-08-14T02:20:00.000Z',
    }), { now: executionNow })).toThrow(/binding.expiry/i)
    expect(() => parseLineActivationInput(activationInput({
      bindingExpiresAt: '2026-08-14T03:30:00.000Z',
    }), { now: executionNow })).toThrow(/binding.expiry/i)
  })

  it.each(['destination', 'bearer', 'pepper', 'authorization', 'replyToken', 'messageContent', 'customerEmail'])(
    'rejects forbidden secret or PII field %s',
    (field) => {
      expect(() => parseLineActivationInput(
        { ...activationInput(), [field]: 'sensitive' },
        { now: executionNow },
      )).toThrow()
      expect(() => parseLineCanaryReceipt({ ...receipt(), [field]: 'sensitive' })).toThrow()
    },
  )

  it('preserves the five truthful receipt states and validates a redacted evidence receipt', () => {
    expect(LINE_ACTIVATION_RECEIPT_STATES).toEqual([
      'GENERATED',
      'EVIDENCE_VERIFIED',
      'ACCEPTED_BY_LINE',
      'DISPLAYED_UNKNOWN',
      'READ_UNKNOWN',
    ])
    expect(parseLineCanaryReceipt(receipt()).receiptState).toBe('EVIDENCE_VERIFIED')
  })

  it('requires a redacted transport hash and HTTP acceptance class for LINE-accepted evidence', () => {
    expect(() => parseLineCanaryReceipt(receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'ACCEPTED_BY_LINE',
      bindingVersionAfter: 1,
    }))).toThrow(/transport/i)
    expect(parseLineCanaryReceipt(receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'ACCEPTED_BY_LINE',
      bindingVersionAfter: 1,
      transportArtifactSha256: sha256('e'),
      lineAcceptanceClass: 'HTTP_2XX',
    })).lineAcceptanceClass).toBe('HTTP_2XX')
  })

  it('rejects impossible version movement for activation events', () => {
    expect(() => parseLineCanaryReceipt(receipt({ bindingVersionAfter: 3 }))).toThrow(/version/i)
    expect(() => parseLineCanaryReceipt(receipt({ bindingVersionBefore: 0, bindingVersionAfter: 1 }))).toThrow()
  })

  it('enforces event ownership of receipt states', () => {
    expect(() => parseLineCanaryReceipt(receipt({
      receiptState: 'ACCEPTED_BY_LINE',
      transportArtifactSha256: sha256('e'),
      lineAcceptanceClass: 'HTTP_2XX',
    }))).toThrow(/event.*state/i)
    expect(() => parseLineCanaryReceipt(receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'EVIDENCE_VERIFIED',
      bindingVersionAfter: 1,
    }))).toThrow(/event.*state/i)
    expect(parseLineCanaryReceipt(receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'GENERATED',
      bindingVersionAfter: 1,
    })).receiptState).toBe('GENERATED')
    expect(parseLineCanaryReceipt(receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'GENERATED',
      bindingVersionAfter: 1,
      transportArtifactSha256: sha256('e'),
    })).transportArtifactSha256).toBe(sha256('e'))
    expect(() => parseLineCanaryReceipt(receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'GENERATED',
      bindingVersionAfter: 1,
      lineAcceptanceClass: 'HTTP_2XX',
    }))).toThrow(/acceptance.*generated/i)
  })

  it('validates shared structural fixtures through Draft 2020-12 JSON Schema and Zod', () => {
    const activation = compileSchema('line-activation-input.schema.json')
    const receiptSchema = compileSchema('line-canary-receipt.schema.json')
    const invalidActivation = activationInput({
      expectation: { ...activationInput().expectation, bindingVersion: 0 },
    })
    const invalidReceipt = receipt({
      receiptState: 'ACCEPTED_BY_LINE',
      transportArtifactSha256: sha256('e'),
      lineAcceptanceClass: 'HTTP_2XX',
    })
    const invalidGeneratedReceipt = receipt({
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'GENERATED',
      bindingVersionAfter: 1,
      lineAcceptanceClass: 'HTTP_2XX',
    })

    expect(activation.validate(activationInput())).toBe(true)
    expect(() => parseLineActivationInput(activationInput(), { now: executionNow })).not.toThrow()
    expect(activation.validate(invalidActivation)).toBe(false)
    expect(() => parseLineActivationInput(invalidActivation, { now: executionNow })).toThrow()
    expect(receiptSchema.validate(receipt())).toBe(true)
    expect(() => parseLineCanaryReceipt(receipt())).not.toThrow()
    expect(receiptSchema.validate(invalidReceipt)).toBe(false)
    expect(() => parseLineCanaryReceipt(invalidReceipt)).toThrow()
    expect(receiptSchema.validate(invalidGeneratedReceipt)).toBe(false)
    expect(() => parseLineCanaryReceipt(invalidGeneratedReceipt)).toThrow()
  })

  it('uses RFC3339 date-time validation in both Draft 2020-12 and Zod', () => {
    const activation = compileSchema('line-activation-input.schema.json')
    const dateOnlyActivation = activationInput({
      approval: { ...activationInput().approval, notBefore: '2026-08-14' },
    })
    expect(activation.validate(dateOnlyActivation)).toBe(false)
    expect(() => parseLineActivationInput(dateOnlyActivation, { now: executionNow })).toThrow()
  })

  it('accepts RFC3339 timezone offsets in activation and receipt dates', () => {
    const withOffset = activationInput({
      approval: {
        ...activationInput().approval,
        notBefore: '2026-08-14T09:00:00+07:00',
        expiresAt: '2026-08-14T10:00:00+07:00',
      },
      bindingExpiresAt: '2026-08-14T09:45:00+07:00',
    })
    expect(compileSchema('line-activation-input.schema.json').validate(withOffset)).toBe(true)
    expect(parseLineActivationInput(withOffset, { now: '2026-08-14T09:30:00+07:00' }).mode).toBe('DRY_RUN')
    expect(parseLineCanaryReceipt(receipt({ occurredAt: '2026-08-14T09:30:00+07:00' })).occurredAt)
      .toBe('2026-08-14T09:30:00+07:00')
    const rollbackWithOffset = rollbackInput({
      approval: {
        ...rollbackInput().approval,
        notBefore: '2026-08-14T09:00:00+07:00',
        expiresAt: '2026-08-14T10:00:00+07:00',
      },
    })
    expect(compileSchema('line-rollback-input.schema.json').validate(rollbackWithOffset)).toBe(true)
    expect(parseLineRollbackInput(rollbackWithOffset, { now: '2026-08-14T09:30:00+07:00' }).mode)
      .toBe('DRY_RUN')
  })

  it('validates strict rollback fixtures through Draft 2020-12 and Zod with the same default', () => {
    const rollback = compileSchema('line-rollback-input.schema.json')
    const valid = rollbackInput()
    delete valid.mode
    expect(rollback.validate(valid)).toBe(true)
    expect(valid.mode).toBe('DRY_RUN')
    expect(parseLineRollbackInput(rollbackInput({ mode: undefined }), { now: executionNow }).mode)
      .toBe(valid.mode)

    const invalid = rollbackInput({
      expectation: { ...rollbackInput().expectation, bindingStatus: 'PENDING' },
    })
    expect(rollback.validate(invalid)).toBe(false)
    expect(() => parseLineRollbackInput(invalid, { now: executionNow })).toThrow()
  })

  it('fails rollback closed on wrong identity, absent hashes, inactive approval or raw fields', () => {
    expect(() => parseLineRollbackInput(rollbackInput({
      expectation: { ...rollbackInput().expectation, bindingCode: 'OTHER' },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineRollbackInput(rollbackInput({
      expectation: { ...rollbackInput().expectation, credentialHashPresent: false },
    }), { now: executionNow })).toThrow()
    expect(() => parseLineRollbackInput(rollbackInput(), { now: '2026-08-14T04:00:00.000Z' }))
      .toThrow(/approval.window/i)
    expect(() => parseLineRollbackInput({ ...rollbackInput(), destination: 'secret' }, { now: executionNow }))
      .toThrow()
  })

  it('materializes the same DRY_RUN default through Draft 2020-12 and Zod', () => {
    const activation = compileSchema('line-activation-input.schema.json')
    const defaultedActivation = activationInput()
    delete defaultedActivation.mode
    expect(activation.validate(defaultedActivation)).toBe(true)
    expect(defaultedActivation.mode).toBe('DRY_RUN')
    expect(parseLineActivationInput(
      activationInput({ mode: undefined }),
      { now: executionNow },
    ).mode).toBe(defaultedActivation.mode)
  })

  it('publishes strict JSON Schemas with no forbidden raw fields', () => {
    for (const file of [
      'line-activation-input.schema.json',
      'line-canary-receipt.schema.json',
      'line-rollback-input.schema.json',
    ]) {
      const raw = readFileSync(new URL(`../../contracts/phase1-activation/${file}`, import.meta.url), 'utf8')
      const schema = JSON.parse(raw)
      expect(schema.additionalProperties).toBe(false)
      expect(schema.properties.contractVersion.const).toBe('1.0.0')
      expect(raw).not.toMatch(/"(destination|bearer|pepper|authorization|replyToken|messageContent|customerEmail)"\s*:/)
    }
  })
})
