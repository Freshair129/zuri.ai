import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { afterEach, describe, expect, it } from 'vitest'
import { parseLineCanaryReceipt } from '@/modules/agent/line-activation-contract'
import { adaptZuriCliCanaryReceiptFile } from '@/modules/agent/zuri-cli-canary-receipt'

// @req FR-055 — import one strict, redacted zuri-cli transport artifact.
// @spec BR-014, SDD-028, SEC-012 — hash-pin transport evidence without accepting raw LINE data.
// @tested tests/unit/zuri-cli-canary-receipt.test.js

const uuid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
const sha256 = (letter) => letter.repeat(64)
const temporaryDirectories = []
const approvedScope = Object.freeze({
  projectRef: 'qcnmhyglarzcpudjorzc',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
})

function artifact(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    eventId: uuid('1'),
    correlationId: uuid('2'),
    ...approvedScope,
    bindingVersion: 7,
    canaryPlanSha256: sha256('a'),
    goldenReportSha256: sha256('b'),
    isolationReportSha256: sha256('c'),
    transportSourceSha256: sha256('d'),
    transportConfigSha256: sha256('e'),
    providerId: 'openai',
    modelId: 'gpt-5-mini',
    approvalRef: 'APR-FR055-001',
    occurredAt: '2026-08-14T10:30:00+07:00',
    actorFingerprint: sha256('f'),
    ...overrides,
  }
}

function writeArtifact(value, { raw } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'zuri-fr055-w3-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'transport-artifact.json')
  writeFileSync(filePath, raw ?? JSON.stringify(value, null, 2), 'utf8')
  return filePath
}

function compileSchema() {
  const schema = JSON.parse(readFileSync(
    new URL('../../contracts/phase1-activation/zuri-cli-transport-artifact.schema.json', import.meta.url),
    'utf8',
  ))
  const ajv = new Ajv2020({ strict: true })
  addFormats(ajv)
  return { schema, validate: ajv.compile(schema) }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true })
  }
})

describe('zuri-cli canary receipt adapter', () => {
  it('loads through direct Node ESM resolution without the Vitest alias', () => {
    const moduleUrl = new URL('../../src/modules/agent/zuri-cli-canary-receipt.js', import.meta.url).href
    const output = execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(moduleUrl)}); console.log('DIRECT_IMPORT_OK')`,
    ], { encoding: 'utf8' })
    expect(output.trim()).toBe('DIRECT_IMPORT_OK')
  })

  it('hashes the exact generated artifact bytes and emits a W1A-valid GENERATED receipt', () => {
    const filePath = writeArtifact(artifact())
    const expectedHash = createHash('sha256').update(readFileSync(filePath)).digest('hex')

    const receipt = adaptZuriCliCanaryReceiptFile(filePath)

    expect(receipt).toMatchObject({
      contractVersion: '1.0.0',
      eventType: 'CANARY_TRANSPORT',
      receiptState: 'GENERATED',
      bindingVersionBefore: 7,
      bindingVersionAfter: 7,
      transportArtifactSha256: expectedHash,
    })
    expect(receipt).not.toHaveProperty('lineAcceptanceClass')
    expect(() => parseLineCanaryReceipt(receipt)).not.toThrow()
  })

  it('emits ACCEPTED_BY_LINE only for a bounded HTTP 2xx observation', () => {
    const receipt = adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({
      httpObservation: {
        statusCode: 202,
        occurredAt: '2026-08-14T10:30:01+07:00',
      },
    })))

    expect(receipt.receiptState).toBe('ACCEPTED_BY_LINE')
    expect(receipt.lineAcceptanceClass).toBe('HTTP_2XX')
    expect(receipt.receiptState).not.toMatch(/DISPLAY|READ/)
    expect(() => parseLineCanaryReceipt(receipt)).not.toThrow()
  })

  it.each([100, 199, 300, 404, 500, 599])(
    'does not promote HTTP %i to LINE acceptance',
    (statusCode) => {
      const receipt = adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({
        httpObservation: {
          statusCode,
          occurredAt: '2026-08-14T10:30:01+07:00',
        },
      })))
      expect(receipt.receiptState).toBe('GENERATED')
      expect(receipt).not.toHaveProperty('lineAcceptanceClass')
    },
  )

  it.each([
    ['destination', 'U-secret'],
    ['authorization', 'Bearer secret'],
    ['bearer', 'secret'],
    ['replyToken', 'secret'],
    ['messageText', 'hello'],
    ['body', { text: 'hello' }],
    ['headers', { authorization: 'secret' }],
    ['customerId', 'customer-1'],
    ['payload', { any: 'value' }],
  ])('rejects forbidden or free-form field %s', (field, value) => {
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({ [field]: value })))).toThrow()
  })

  it('rejects forbidden or free-form fields nested in the HTTP observation', () => {
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({
      httpObservation: {
        statusCode: 200,
        occurredAt: '2026-08-14T10:30:01+07:00',
        headers: { authorization: 'secret' },
      },
    })))).toThrow()
  })

  it.each([99, 600, 200.5])('rejects out-of-contract HTTP status %s', (statusCode) => {
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({
      httpObservation: {
        statusCode,
        occurredAt: '2026-08-14T10:30:01+07:00',
      },
    })))).toThrow()
  })

  it('rejects malformed JSON, hashes, timestamps and binding versions', () => {
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact({}, { raw: '{invalid' }))).toThrow()
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({ transportSourceSha256: 'bad' })))).toThrow()
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({ occurredAt: '2026-08-14' })))).toThrow()
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({ bindingVersion: 0 })))).toThrow()
  })

  it('publishes a strict Draft 2020-12 schema aligned with adapter acceptance', () => {
    const { schema, validate } = compileSchema()
    const valid = artifact({
      httpObservation: {
        statusCode: 200,
        occurredAt: '2026-08-14T10:30:01+07:00',
      },
    })
    const invalid = artifact({ payload: { text: 'secret' } })

    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.httpObservation.additionalProperties).toBe(false)
    expect(validate(valid)).toBe(true)
    expect(validate(invalid)).toBe(false)
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(valid))).not.toThrow()
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(invalid))).toThrow()
  })

  it.each([
    ['projectRef', 'other-project'],
    ['tenantId', uuid('3')],
    ['businessId', uuid('4')],
    ['bindingId', uuid('5')],
  ])('rejects artifact scope outside the approved FR-055 slice: %s', (field, value) => {
    const outsideScope = artifact({ [field]: value })
    const { validate } = compileSchema()
    expect(validate(outsideScope)).toBe(false)
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(outsideScope))).toThrow()
  })

  it('rejects an HTTP observation timestamp before artifact creation', () => {
    const outOfOrder = artifact({
      httpObservation: {
        statusCode: 200,
        occurredAt: '2026-08-14T10:29:59+07:00',
      },
    })
    expect(compileSchema().validate(outOfOrder)).toBe(true)
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(outOfOrder))).toThrow(/observation.*time/i)
  })

  it('does not accept a caller-supplied artifact hash', () => {
    expect(() => adaptZuriCliCanaryReceiptFile(writeArtifact(artifact({
      transportArtifactSha256: sha256('9'),
    })))).toThrow()
  })
})
