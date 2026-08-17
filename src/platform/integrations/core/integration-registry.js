import prisma from '@/lib/db'

// @req FR-074 — select the single binding-scoped active primary Phase 1 connection.
// @spec ADR-031 §D2, SDD-043, SEC-015 — trusted scope, DB uniqueness and fail-closed selection.
// @tested tests/unit/fr074-runtime-cutover.test.js

export const PHASE1_LINE_LLM_PURPOSE = 'PHASE1_LINE_LLM'

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}_REQUIRED`)
  return value
}

export function selectPhase1PrimaryConnection(connections, {
  tenantId,
  businessId,
  purpose = PHASE1_LINE_LLM_PURPOSE,
} = {}) {
  required(tenantId, 'TENANT_ID')
  required(businessId, 'BUSINESS_ID')
  const candidates = (connections ?? []).filter((connection) => (
    connection.tenantId === tenantId
    && connection.businessId === businessId
    && connection.purpose === purpose
    && connection.status === 'ACTIVE'
    && connection.role === 'PRIMARY'
  ))
  if (candidates.length === 0) throw new Error('PHASE1_CONNECTION_NOT_FOUND')
  if (candidates.length !== 1) throw new Error('PHASE1_CONNECTION_AMBIGUOUS')
  return candidates[0]
}

export async function resolvePhase1PrimaryConnection({
  db = prisma,
  tenantId,
  businessId,
  purpose = PHASE1_LINE_LLM_PURPOSE,
} = {}) {
  const rows = await db.integrationConnection.findMany({
    where: { tenantId, businessId, purpose, status: 'ACTIVE', role: 'PRIMARY' },
    include: { provider: true, credential: true },
  })
  return selectPhase1PrimaryConnection(rows, { tenantId, businessId, purpose })
}

export async function resolvePhase1PrimaryConnectionByQuery({
  queryFn,
  tenantId,
  businessId,
  purpose = PHASE1_LINE_LLM_PURPOSE,
} = {}) {
  if (typeof queryFn !== 'function') throw new Error('INTEGRATION_QUERY_FUNCTION_REQUIRED')
  const result = await queryFn(`
    select
      c.id,
      c.tenant_id,
      c.business_id,
      c.purpose,
      c.role,
      c.status,
      c.metadata_json,
      c.version,
      p.code as provider_code,
      cr.secret_ref,
      cr.status as credential_status,
      cr.expires_at as credential_expires_at
    from zuri_core.integration_connection c
    join zuri_core.integration_provider p on p.id = c.provider_id
    left join zuri_core.integration_credential cr on cr.connection_id = c.id
    where c.tenant_id = $1
      and c.business_id = $2
      and c.purpose = $3
      and c.status = 'ACTIVE'
      and c.role = 'PRIMARY'
      and (
        cr.connection_id is null
        or (cr.status = 'ACTIVE' and (cr.expires_at is null or cr.expires_at > now()))
      )
  `, [tenantId, businessId, purpose])
  const rows = (result.rows ?? []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    businessId: row.business_id,
    purpose: row.purpose,
    role: row.role,
    status: row.status,
    metadataJson: row.metadata_json,
    version: row.version,
    provider: { code: row.provider_code },
    credential: row.secret_ref ? {
      secretRef: row.secret_ref,
      status: row.credential_status,
      expiresAt: row.credential_expires_at,
    } : null,
  }))
  return selectPhase1PrimaryConnection(rows, { tenantId, businessId, purpose })
}

export async function createIntegrationConnection({
  tenantId,
  businessId = null,
  providerId,
  name,
  authorizationType = 'SECRET_MANAGER',
  externalAccountId = null,
  purpose = 'GENERAL',
  role = 'SECONDARY',
  status = 'DRAFT',
  metadata = {},
}, { db = prisma } = {}) {
  required(tenantId, 'TENANT_ID')
  required(providerId, 'PROVIDER_ID')
  required(name, 'CONNECTION_NAME')
  const provider = await db.integrationProvider.findUnique({ where: { id: providerId } })
  if (!provider) throw new Error('INTEGRATION_PROVIDER_NOT_FOUND')
  if (businessId) {
    const business = await db.business.findUnique({ where: { id: businessId } })
    if (!business || business.tenantId !== tenantId) throw new Error('BUSINESS_OUTSIDE_TENANT')
  }
  return db.integrationConnection.create({
    data: {
      tenantId,
      businessId,
      providerId,
      name,
      authorizationType,
      externalAccountId,
      purpose,
      role,
      status,
      metadataJson: JSON.stringify(metadata ?? {}),
    },
  })
}

export async function upsertIntegrationCredentialMetadata({
  tenantId,
  connectionId,
  secretRef,
  status = 'ACTIVE',
  expiresAt = null,
}, { db = prisma } = {}) {
  required(tenantId, 'TENANT_ID')
  required(connectionId, 'CONNECTION_ID')
  required(secretRef, 'SECRET_REF')
  const connection = await db.integrationConnection.findUnique({ where: { id: connectionId } })
  if (!connection || connection.tenantId !== tenantId) throw new Error('CONNECTION_OUTSIDE_TENANT')
  return db.integrationCredential.upsert({
    where: { connectionId },
    create: { connectionId, secretRef, status, expiresAt },
    update: { secretRef, status, expiresAt, rotatedAt: new Date(), version: { increment: 1 } },
  })
}

export async function promotePhase1PrimaryConnection({
  db = prisma,
  tenantId,
  businessId,
  connectionId,
  expectedVersion,
} = {}) {
  required(tenantId, 'TENANT_ID')
  required(businessId, 'BUSINESS_ID')
  required(connectionId, 'CONNECTION_ID')
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('EXPECTED_VERSION_REQUIRED')

  return db.$transaction(async (tx) => {
    const target = await tx.integrationConnection.findUnique({ where: { id: connectionId } })
    if (!target || target.tenantId !== tenantId || target.businessId !== businessId) {
      throw new Error('PHASE1_CONNECTION_NOT_FOUND')
    }
    if (target.purpose !== PHASE1_LINE_LLM_PURPOSE) throw new Error('PHASE1_CONNECTION_PURPOSE_INVALID')

    const demoted = await tx.integrationConnection.updateMany({
      where: {
        tenantId,
        businessId,
        purpose: PHASE1_LINE_LLM_PURPOSE,
        status: 'ACTIVE',
        role: 'PRIMARY',
        id: { not: connectionId },
      },
      data: { role: 'SECONDARY', version: { increment: 1 } },
    })
    const promoted = await tx.integrationConnection.updateMany({
      where: { id: connectionId, tenantId, businessId, version: expectedVersion },
      data: { status: 'ACTIVE', role: 'PRIMARY', version: { increment: 1 } },
    })
    if (promoted.count !== 1) throw new Error('PHASE1_CONNECTION_CAS_CONFLICT')
    return {
      connectionId,
      demotedCount: demoted.count,
      version: expectedVersion + 1,
    }
  })
}
