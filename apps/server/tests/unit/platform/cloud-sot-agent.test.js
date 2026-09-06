import { describe, expect, it } from 'vitest'

import {
  listDocumentIntakeRecords,
  stageDocumentIntake,
  stageDocumentIntakeForPipeline,
} from '@/platform/integrations/core/cloud-sot-agent'
import { makeOperatorViewer, makeViewer } from '../../factories/viewer'

// @req FR-071 — the CloudSoTAgent staging boundary is idempotent, scope-bound,
// auditable without raw field values and refuses non-operator writes.
// @spec BR-001, SEC-001, SEC-008
// @tested tests/unit/platform/cloud-sot-agent.test.js

const CONNECTION = {
  id: 'conn-smartgift-docs',
  tenantId: 'tenant-smartgift',
  businessId: 'business-smartgift',
  status: 'ACTIVE',
  role: 'PRIMARY',
  purpose: 'DATA_DOCUMENT_INGESTION',
  provider: { code: 'SMARTGIFT_DOCUMENT_INTAKE' },
  business: {
    id: 'business-smartgift',
    tenantId: 'tenant-smartgift',
    status: 'ACTIVE',
  },
}

function contract(overrides = {}) {
  const artifactSha256 = overrides.document?.artifactSha256 || 'a'.repeat(64)
  const document = {
    documentId: `doc_${artifactSha256.slice(0, 32)}`,
    sourceRef: 'inbox/product-catalog.xlsx',
    fileName: 'product-catalog.xlsx',
    kind: 'excel',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    sizeBytes: 2048,
    artifactSha256,
    ...overrides.document,
  }
  const extraction = {
    methods: ['spreadsheet_parser'],
    requiresVision: false,
    requiredMethods: [],
    embeddedImageCount: 0,
    ...overrides.extraction,
  }
  return {
    contractVersion: 'smartgift.document-intake.v1',
    document,
    domain: 'product',
    language: 'th-TH',
    pipelineRunId: 'run_001',
    extractionRunId: 'extract_001',
    extraction,
    fields: [{
      path: 'product.sku',
      value: 'SG-001',
      confidence: 0.98,
      method: 'spreadsheet_parser',
      evidence: { sheet: 'สินค้า', cell: 'A2' },
    }],
    status: 'READY_FOR_VALIDATION',
    dataClassification: 'internal',
    warnings: [],
    createdAt: '2026-08-21T00:00:00.000Z',
    target: {
      system: 'supabase',
      mode: 'STAGING_ONLY',
      table: 'product_import_staging',
    },
    promotion: {
      canonicalWrite: 'cloud-agent-only',
      requiresValidation: true,
      requiresEvidence: true,
    },
    ...overrides,
    document,
    extraction,
  }
}

function fakeDb({ connections = [CONNECTION] } = {}) {
  const state = {
    raw: [],
    runs: [],
    audits: [],
    rawFindManyWhere: [],
  }
  let rawSequence = 0
  let runSequence = 0
  let auditSequence = 0

  const db = {
    state,
    integrationConnection: {
      findUnique: async () => CONNECTION,
      findMany: async () => connections,
    },
    business: {
      findUnique: async ({ where }) => (
        where.id === CONNECTION.businessId ? CONNECTION.business : null
      ),
    },
    pipelineRun: {
      findUnique: async ({ where }) => (
        where.executionRunId === 'execution-run-smartgift'
          ? { businessId: CONNECTION.businessId }
          : null
      ),
    },
    rawExternalRecord: {
      findUnique: async ({ where }) => {
        if (where.idempotencyKey) return state.raw.find((row) => row.idempotencyKey === where.idempotencyKey) || null
        if (where.id) return state.raw.find((row) => row.id === where.id) || null
        return null
      },
      findFirst: async ({ where }) => state.raw.find((row) => (
        row.idempotencyKey === where.idempotencyKey
        && row.tenantId === where.tenantId
        && row.connectionId === where.connectionId
      )) || null,
      create: async ({ data }) => {
        if (state.raw.some((row) => row.idempotencyKey === data.idempotencyKey)) {
          const error = new Error('unique constraint')
          error.code = 'P2002'
          throw error
        }
        const row = {
          id: `raw-${++rawSequence}`,
          createdAt: new Date('2026-08-21T00:00:01.000Z'),
          updatedAt: new Date('2026-08-21T00:00:01.000Z'),
          ...data,
        }
        state.raw.push(row)
        return row
      },
      update: async ({ where, data }) => {
        const row = state.raw.find((candidate) => candidate.id === where.id)
        Object.assign(row, data)
        return row
      },
      findMany: async ({ where, take }) => {
        state.rawFindManyWhere.push(where)
        return state.raw
          .filter((row) => Object.entries(where).every(([key, value]) => {
            if (key === 'id') return row.id === value
            return row[key] === value
          }))
          .slice(0, take)
      },
    },
    ingestionRun: {
      create: async ({ data }) => {
        const row = {
          id: `run-${++runSequence}`,
          ...data,
        }
        state.runs.push(row)
        return row
      },
      findUnique: async ({ where }) => state.runs.find((row) => row.id === where.id) || null,
      update: async ({ where, data }) => {
        const row = state.runs.find((candidate) => candidate.id === where.id)
        Object.assign(row, data)
        return row
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        const row = { id: `audit-${++auditSequence}`, ...data }
        state.audits.push(row)
        return row
      },
    },
    async $transaction(callback) {
      return callback(db)
    },
  }
  return db
}

describe('CloudSoTAgent document staging', () => {
  it('stages through the server-resolved connection and never publishes canonical data', async () => {
    const db = fakeDb()
    const result = await stageDocumentIntake({
      connectionId: CONNECTION.id,
      contract: contract(),
      viewer: makeOperatorViewer(),
      db,
      now: () => new Date('2026-08-21T00:00:00.000Z'),
    })

    expect(result).toMatchObject({
      agent: 'CloudSoTAgent',
      status: 'STAGED',
      rawRecordId: 'raw-1',
      ingestionRunId: 'run-1',
      destination: { table: 'RawExternalRecord', canonicalWrite: false },
      scope: { tenantId: CONNECTION.tenantId, businessId: CONNECTION.businessId },
    })
    expect(db.state.raw).toHaveLength(1)
    expect(db.state.raw[0].processingStatus).toBe('STAGED')
    expect(db.state.runs[0]).toMatchObject({ status: 'SUCCEEDED', createdCount: 1, failedCount: 0 })
    expect(db.state.audits).toHaveLength(1)
    expect(db.state.audits[0].payloadJson).not.toContain('SG-001')
  })

  it('resolves the staging connection from the PipelineRun and rejects a mismatched document run id', async () => {
    const db = fakeDb()
    const result = await stageDocumentIntakeForPipeline({
      executionRunId: 'execution-run-smartgift',
      contract: contract({ pipelineRunId: 'run_execution-run-smartgift' }),
      viewer: makeOperatorViewer(),
      db,
      now: () => new Date('2026-08-21T00:00:00.000Z'),
    })
    expect(result.status).toBe('STAGED')
    expect(db.state.raw).toHaveLength(1)

    await expect(stageDocumentIntakeForPipeline({
      executionRunId: 'execution-run-smartgift',
      contract: contract({ pipelineRunId: 'run_other-execution' }),
      viewer: makeOperatorViewer(),
      db,
    })).rejects.toMatchObject({ code: 'DOCUMENT_INGEST_PIPELINE_RUN_MISMATCH', status: 409 })
  })

  it('returns UNCHANGED on an exact replay and does not create a second run', async () => {
    const db = fakeDb()
    const input = {
      connectionId: CONNECTION.id,
      contract: contract(),
      viewer: makeOperatorViewer(),
      db,
      now: () => new Date('2026-08-21T00:00:00.000Z'),
    }

    const first = await stageDocumentIntake(input)
    const replay = await stageDocumentIntake(input)

    expect(first.status).toBe('STAGED')
    expect(replay).toMatchObject({ status: 'UNCHANGED', rawRecordId: first.rawRecordId })
    expect(db.state.raw).toHaveLength(1)
    expect(db.state.runs).toHaveLength(1)
    expect(db.state.audits).toHaveLength(1)
  })

  it('refuses a disallowed field before touching the staging database', async () => {
    const db = fakeDb()
    await expect(stageDocumentIntake({
      connectionId: CONNECTION.id,
      contract: contract({ fields: [{
        path: 'product.price',
        value: 99,
        confidence: 1,
        method: 'spreadsheet_parser',
        evidence: { sheet: 'สินค้า', cell: 'B2' },
      }] }),
      viewer: makeOperatorViewer(),
      db,
    })).rejects.toMatchObject({ code: 'FIELD_NOT_ALLOWED', status: 422 })
    expect(db.state.raw).toHaveLength(0)
    expect(db.state.runs).toHaveLength(0)
  })

  it('requires restricted classification for Customer documents', async () => {
    const db = fakeDb()
    await expect(stageDocumentIntake({
      connectionId: CONNECTION.id,
      contract: contract({
        domain: 'customer',
        dataClassification: 'internal',
        target: { system: 'supabase', mode: 'STAGING_ONLY', table: 'customer_import_staging' },
        fields: [{
          path: 'customer.name',
          value: 'Example',
          confidence: 0.9,
          method: 'spreadsheet_parser',
          evidence: { sheet: 'ลูกค้า', cell: 'A2' },
        }],
      }),
      viewer: makeOperatorViewer(),
      db,
    })).rejects.toMatchObject({ code: 'CUSTOMER_CLASSIFICATION_REQUIRED', status: 422 })
  })

  it('refuses a non-operator even when the request carries a valid contract', async () => {
    const db = fakeDb()
    await expect(stageDocumentIntake({
      connectionId: CONNECTION.id,
      contract: contract(),
      viewer: makeViewer({ role: 'MEMBER', isOperator: false }),
      db,
    })).rejects.toMatchObject({ code: 'DOCUMENT_INGEST_OPERATOR_REQUIRED', status: 403 })
    expect(db.state.raw).toHaveLength(0)
  })

  it('lists redacted monitor metadata and never returns extracted field values', async () => {
    const db = fakeDb()
    await stageDocumentIntake({
      connectionId: CONNECTION.id,
      contract: contract(),
      viewer: makeOperatorViewer(),
      db,
    })

    const result = await listDocumentIntakeRecords({
      connectionId: CONNECTION.id,
      viewer: makeOperatorViewer(),
      db,
    })
    expect(result.privacy).toEqual({ rawPayload: false, restrictedFields: false })
    expect(result.records[0]).toMatchObject({
      documentId: expect.stringMatching(/^doc_/),
      artifactSha256: 'a'.repeat(64),
      fieldCount: 1,
      processingStatus: 'STAGED',
    })
    expect(JSON.stringify(result)).not.toContain('SG-001')
  })

  it('allows a visible Business owner to read monitor metadata without a connection id', async () => {
    const db = fakeDb()
    await stageDocumentIntake({
      connectionId: CONNECTION.id,
      contract: contract(),
      viewer: makeOperatorViewer(),
      db,
    })

    const result = await listDocumentIntakeRecords({
      businessId: CONNECTION.businessId,
      viewer: makeViewer({
        role: 'OWNER',
        visibleBusinessIds: [CONNECTION.businessId],
        ownedBusinessIds: [CONNECTION.businessId],
      }),
      db,
    })

    expect(result).toMatchObject({
      configured: true,
      connection: { id: CONNECTION.id, businessId: CONNECTION.businessId },
    })
    expect(db.state.rawFindManyWhere.at(-1)).toMatchObject({ connectionId: CONNECTION.id })
    expect(JSON.stringify(result)).not.toContain('SG-001')
  })

  it('returns an explicit not-configured state for a visible Business with no active receiver', async () => {
    const result = await listDocumentIntakeRecords({
      businessId: CONNECTION.businessId,
      viewer: makeViewer({
        role: 'MEMBER',
        visibleBusinessIds: [CONNECTION.businessId],
        ownedBusinessIds: [],
      }),
      db: fakeDb({ connections: [] }),
    })

    expect(result).toMatchObject({
      configured: false,
      connection: null,
      scope: { businessId: CONNECTION.businessId },
      records: [],
    })
  })

  it('does not disclose a Business monitor to a viewer outside that Business', async () => {
    await expect(listDocumentIntakeRecords({
      businessId: CONNECTION.businessId,
      viewer: makeViewer({
        role: 'OWNER',
        visibleBusinessIds: ['business-other'],
        ownedBusinessIds: ['business-other'],
      }),
      db: fakeDb(),
    })).rejects.toMatchObject({ code: 'DOCUMENT_INGEST_BUSINESS_NOT_VISIBLE', status: 404 })
  })
})
