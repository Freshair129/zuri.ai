import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'

import { createIngestionEnvelope } from './contracts'
import { ingestRawExternalRecord } from './raw-ingest-service'
import { createPrismaRawRecordRepository } from './raw-record-repository'
import { createIngestionRun } from './integration-registry'
import {
  DOCUMENT_INTAKE_CONTRACT_VERSION,
  DOCUMENT_INTAKE_ENTITY_TYPES,
  DOCUMENT_INTAKE_PROVIDER_CODE,
  DOCUMENT_INTAKE_PURPOSE,
  validateDocumentIntakeContract,
  summarizeDocumentIntakeContract,
} from './document-intake-contract'

// @req FR-071 — CloudSoTAgent is the server-side staging receiver for the
// SmartGift document contract. Scope comes from a preconfigured IntegrationConnection,
// never from tenant/business IDs in the document payload, and canonical rows are
// not written by this slice.
// @spec docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md,
// ADR-040 D2-D4, BR-001, SEC-001, SEC-008
// @tested tests/unit/platform/cloud-sot-agent.test.js

const DOMAIN_BY_ENTITY_TYPE = Object.freeze(Object.fromEntries(
  Object.entries(DOCUMENT_INTAKE_ENTITY_TYPES).map(([domain, entityType]) => [entityType, domain]),
))

function agentError(code, status = 400) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

function assertOperator(viewer) {
  if (!isInstallationOperator(viewer)) throw agentError('DOCUMENT_INGEST_OPERATOR_REQUIRED', 403)
}

function assertDocumentRead(viewer, businessId) {
  if (!isInstallationOperator(viewer) && !seesBusiness(viewer, businessId)) {
    throw agentError('DOCUMENT_INGEST_BUSINESS_NOT_VISIBLE', 404)
  }
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw agentError('DOCUMENT_INGEST_DATE_INVALID')
  return date
}

async function resolveDocumentIntakeConnection(db, connectionId) {
  if (typeof connectionId !== 'string' || !connectionId.trim()) {
    throw agentError('DOCUMENT_INGEST_CONNECTION_REQUIRED')
  }

  const connection = await db.integrationConnection.findUnique({
    where: { id: connectionId },
    include: { provider: true, business: true },
  })

  if (
    !connection
    || connection.status !== 'ACTIVE'
    || connection.role !== 'PRIMARY'
    || connection.purpose !== DOCUMENT_INTAKE_PURPOSE
    || connection.provider?.code !== DOCUMENT_INTAKE_PROVIDER_CODE
    || !connection.businessId
    || !connection.business
    || connection.business.id !== connection.businessId
    || connection.business.tenantId !== connection.tenantId
    || connection.business.status !== 'ACTIVE'
  ) {
    throw agentError('DOCUMENT_INGEST_CONNECTION_NOT_FOUND', 404)
  }

  return connection
}

async function resolveDocumentIntakeConnectionForBusiness(db, businessId) {
  if (typeof businessId !== 'string' || !businessId.trim()) {
    throw agentError('DOCUMENT_INGEST_BUSINESS_REQUIRED')
  }

  const connections = await db.integrationConnection.findMany({
    where: {
      businessId,
      status: 'ACTIVE',
      role: 'PRIMARY',
      purpose: DOCUMENT_INTAKE_PURPOSE,
      provider: { code: DOCUMENT_INTAKE_PROVIDER_CODE },
    },
    include: { provider: true, business: true },
  })

  if (connections.length > 1) {
    throw agentError('DOCUMENT_INGEST_CONNECTION_AMBIGUOUS', 409)
  }
  return connections[0] || null
}

function connectionSummary(connection) {
  if (!connection) return null
  return {
    id: connection.id,
    businessId: connection.businessId,
    provider: connection.provider?.code || null,
    purpose: connection.purpose,
    role: connection.role,
    status: connection.status,
    name: connection.name,
  }
}

export function buildDocumentIngestionEnvelope({ connection, connectionId, contract, receivedAt }) {
  const domain = contract.domain
  return createIngestionEnvelope({
    tenantId: connection.tenantId,
    businessId: connection.businessId,
    connectionId,
    provider: DOCUMENT_INTAKE_PROVIDER_CODE,
    lane: domain === 'customer' ? 'CUSTOMER' : 'PRODUCTION_SUPPLY',
    entityType: DOCUMENT_INTAKE_ENTITY_TYPES[domain],
    externalId: contract.document.documentId,
    sourceType: 'FILE',
    schemaVersion: DOCUMENT_INTAKE_CONTRACT_VERSION,
    payload: contract,
    sourceUri: contract.document.sourceRef,
    receivedAt: asDate(receivedAt),
  })
}

function receipt({ contractSummary, connection, connectionId, envelope, rawRecord, auditEventId = null, status }) {
  return {
    agent: 'CloudSoTAgent',
    contractVersion: DOCUMENT_INTAKE_CONTRACT_VERSION,
    status,
    scope: {
      tenantId: connection.tenantId,
      businessId: connection.businessId,
    },
    destination: {
      system: 'supabase',
      layer: 'application-staging',
      table: 'RawExternalRecord',
      canonicalWrite: false,
    },
    document: contractSummary,
    rawRecordId: rawRecord.id,
    ingestionRunId: rawRecord.ingestionRunId ?? null,
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    auditEventId,
    next: status === 'QUARANTINED' ? 'REVIEW_REQUIRED' : 'DOMAIN_VALIDATION',
  }
}

function isUniqueViolation(error) {
  return error?.code === 'P2002' || /unique constraint/i.test(error?.message || '')
}

function rawRecordSummary(row) {
  let payload = null
  try {
    payload = JSON.parse(row.payloadJson)
  } catch {
    // The monitor still returns the raw-record identity and processing state.
  }

  const document = payload?.document || {}
  const fields = Array.isArray(payload?.fields) ? payload.fields : []
  return {
    rawRecordId: row.id,
    ingestionRunId: row.ingestionRunId ?? null,
    domain: payload?.domain || DOMAIN_BY_ENTITY_TYPE[row.entityType] || null,
    documentId: document.documentId || row.externalId,
    artifactSha256: document.artifactSha256 || null,
    kind: document.kind || null,
    status: payload?.status || null,
    dataClassification: payload?.dataClassification || null,
    pipelineRunId: payload?.pipelineRunId || null,
    extractionRunId: payload?.extractionRunId || null,
    extractionMethods: Array.isArray(payload?.extraction?.methods) ? payload.extraction.methods : [],
    requiresVision: payload?.extraction?.requiresVision === true,
    fieldCount: fields.length,
    processingStatus: row.processingStatus,
    payloadHash: row.payloadHash,
    idempotencyKey: row.idempotencyKey,
    receivedAt: row.receivedAt instanceof Date ? row.receivedAt.toISOString() : row.receivedAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  }
}

export async function stageDocumentIntake({
  connectionId,
  contract: inputContract,
  viewer,
  db = prisma,
  now = () => new Date(),
} = {}) {
  assertOperator(viewer)
  const contract = validateDocumentIntakeContract(inputContract)
  const connection = await resolveDocumentIntakeConnection(db, connectionId)
  const receivedAt = asDate(now())
  const envelope = buildDocumentIngestionEnvelope({ connection, connectionId, contract, receivedAt })
  const contractSummary = summarizeDocumentIntakeContract(contract)

  const transact = async (tx) => {
    const existing = await tx.rawExternalRecord.findUnique({
      where: { idempotencyKey: envelope.idempotencyKey },
    })
    if (existing) {
      return receipt({
        contractSummary,
        connection,
        connectionId,
        envelope,
        rawRecord: existing,
        status: 'UNCHANGED',
      })
    }

    const run = await createIngestionRun({
      tenantId: connection.tenantId,
      businessId: connection.businessId,
      connectionId,
      lane: contract.domain === 'customer' ? 'CUSTOMER' : 'PRODUCTION_SUPPLY',
      resourceType: 'DOCUMENT_INTAKE',
      runType: 'INCREMENTAL',
    }, { db: tx })

    const repository = createPrismaRawRecordRepository(tx, {
      tenantId: connection.tenantId,
      businessId: connection.businessId,
      connectionId,
      provider: DOCUMENT_INTAKE_PROVIDER_CODE,
      ingestionRunId: run.id,
    })
    const ingested = await ingestRawExternalRecord({
      ...envelope,
      ingestionRunId: run.id,
    }, { repository, now: () => receivedAt })

    if (ingested.status !== 'CREATED') {
      return receipt({
        contractSummary,
        connection,
        connectionId,
        envelope,
        rawRecord: ingested.rawRecord,
        status: 'UNCHANGED',
      })
    }

    const quarantined = contract.status === 'QUARANTINED'
    const processingStatus = quarantined ? 'QUARANTINED' : 'STAGED'
    const rawRecord = await tx.rawExternalRecord.update({
      where: { id: ingested.rawRecord.id },
      data: { processingStatus },
    })
    await tx.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: quarantined ? 'PARTIAL' : 'SUCCEEDED',
        finishedAt: receivedAt,
        fetchedCount: 1,
        createdCount: quarantined ? 0 : 1,
        failedCount: quarantined ? 1 : 0,
        ...(quarantined
          ? {
              errorCode: 'LOCAL_QUARANTINE',
              errorMessage: 'document was quarantined by the local intake agent',
            }
          : {}),
      },
    })

    const audit = await recordAudit(tx, {
      entityType: 'RAW_EXTERNAL_RECORD',
      entityId: rawRecord.id,
      action: quarantined ? 'DOCUMENT_INTAKE_QUARANTINED' : 'DOCUMENT_INTAKE_STAGED',
      actorType: 'AGENT',
      actorId: viewer?.principal?.id || null,
      payload: {
        contractVersion: DOCUMENT_INTAKE_CONTRACT_VERSION,
        tenantId: connection.tenantId,
        businessId: connection.businessId,
        connectionId,
        provider: DOCUMENT_INTAKE_PROVIDER_CODE,
        entityType: DOCUMENT_INTAKE_ENTITY_TYPES[contract.domain],
        documentId: contract.document.documentId,
        artifactSha256: contract.document.artifactSha256,
        payloadHash: envelope.payloadHash,
        fieldCount: contract.fields.length,
        status: processingStatus,
      },
    })

    return receipt({
      contractSummary,
      connection,
      connectionId,
      envelope,
      rawRecord,
      auditEventId: audit.id,
      status: quarantined ? 'QUARANTINED' : 'STAGED',
    })
  }

  try {
    return await db.$transaction(transact)
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await db.rawExternalRecord.findUnique({
        where: { idempotencyKey: envelope.idempotencyKey },
      })
      if (existing) {
        return receipt({
          contractSummary,
          connection,
          connectionId,
          envelope,
          rawRecord: existing,
          status: 'UNCHANGED',
        })
      }
    }
    throw error
  }
}

/**
 * Codex worker entry point: resolve the active document connection from the
 * server-owned PipelineRun instead of accepting a destination connection from
 * the local outbox.
 */
export async function stageDocumentIntakeForPipeline({
  executionRunId,
  contract,
  viewer,
  db = prisma,
  now = () => new Date(),
} = {}) {
  assertOperator(viewer)
  if (typeof executionRunId !== 'string' || !executionRunId.trim()) {
    throw agentError('DOCUMENT_INGEST_EXECUTION_RUN_REQUIRED')
  }
  const run = await db.pipelineRun.findUnique({
    where: { executionRunId },
    select: { businessId: true },
  })
  if (!run?.businessId) throw agentError('DOCUMENT_INGEST_PIPELINE_RUN_NOT_FOUND', 404)

  const expectedContractRunId = `run_${executionRunId}`
  if (contract?.pipelineRunId !== expectedContractRunId) {
    throw agentError('DOCUMENT_INGEST_PIPELINE_RUN_MISMATCH', 409)
  }
  const connection = await resolveDocumentIntakeConnectionForBusiness(db, run.businessId)
  if (!connection) throw agentError('DOCUMENT_INGEST_CONNECTION_NOT_CONFIGURED', 409)
  return stageDocumentIntake({
    connectionId: connection.id,
    contract,
    viewer,
    db,
    now,
  })
}

export async function listDocumentIntakeRecords({
  connectionId,
  businessId = null,
  rawRecordId = null,
  domain = null,
  limit = 25,
  viewer,
  db = prisma,
} = {}) {
  const requestedBusinessId = typeof businessId === 'string' && businessId.trim() ? businessId.trim() : null
  if (!connectionId && !requestedBusinessId) {
    throw agentError('DOCUMENT_INGEST_CONNECTION_OR_BUSINESS_REQUIRED')
  }

  const connection = connectionId
    ? await resolveDocumentIntakeConnection(db, connectionId)
    : await resolveDocumentIntakeConnectionForBusiness(db, requestedBusinessId)

  assertDocumentRead(viewer, connection?.businessId || requestedBusinessId)
  const numericLimit = Number(limit)
  if (!Number.isInteger(numericLimit) || numericLimit < 1 || numericLimit > 100) {
    throw agentError('DOCUMENT_INGEST_LIMIT_INVALID')
  }
  if (domain != null && !Object.hasOwn(DOCUMENT_INTAKE_ENTITY_TYPES, domain)) {
    throw agentError('DOCUMENT_INGEST_DOMAIN_INVALID')
  }

  if (!connection) {
    return {
      agent: 'CloudSoTAgent',
      contractVersion: DOCUMENT_INTAKE_CONTRACT_VERSION,
      configured: false,
      connection: null,
      scope: { businessId: requestedBusinessId },
      privacy: { rawPayload: false, restrictedFields: false },
      records: [],
    }
  }

  const where = {
    tenantId: connection.tenantId,
    businessId: connection.businessId,
    connectionId: connection.id,
    schemaVersion: DOCUMENT_INTAKE_CONTRACT_VERSION,
    ...(rawRecordId ? { id: rawRecordId } : {}),
    ...(domain ? { entityType: DOCUMENT_INTAKE_ENTITY_TYPES[domain] } : {}),
  }
  const rows = await db.rawExternalRecord.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: numericLimit,
  })
  if (rawRecordId && rows.length === 0) throw agentError('DOCUMENT_INGEST_RECORD_NOT_FOUND', 404)

  return {
    agent: 'CloudSoTAgent',
    contractVersion: DOCUMENT_INTAKE_CONTRACT_VERSION,
    configured: true,
    connection: connectionSummary(connection),
    privacy: { rawPayload: false, restrictedFields: false },
    scope: { tenantId: connection.tenantId, businessId: connection.businessId },
    records: rows.map(rawRecordSummary),
  }
}

export {
  resolveDocumentIntakeConnection,
  resolveDocumentIntakeConnectionForBusiness,
  rawRecordSummary,
}
