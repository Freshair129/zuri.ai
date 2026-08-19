import prisma from '@/lib/db'

// @req FR-079 — select the single binding-scoped active primary Phase 1 connection.
// @spec ADR-031 §D2, SDD-043, SEC-015 — trusted scope, DB uniqueness and fail-closed selection.
// @tested tests/unit/fr079-runtime-cutover.test.js

export const PHASE1_LINE_LLM_PURPOSE = 'PHASE1_LINE_LLM'

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label}_REQUIRED`)
  return value
}

async function loadConnectionInScope(db, { tenantId, businessId, connectionId }) {
  required(tenantId, 'TENANT_ID')
  required(connectionId, 'CONNECTION_ID')
  const connection = await db.integrationConnection.findUnique({ where: { id: connectionId } })
  if (!connection || connection.tenantId !== tenantId) throw new Error('CONNECTION_OUTSIDE_TENANT')
  if (businessId !== undefined && (connection.businessId ?? null) !== (businessId ?? null)) {
    throw new Error('CONNECTION_OUTSIDE_BUSINESS')
  }
  return connection
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
  accessTokenExpiresAt = null,
  refreshTokenExpiresAt = null,
}, { db = prisma } = {}) {
  required(tenantId, 'TENANT_ID')
  required(connectionId, 'CONNECTION_ID')
  required(secretRef, 'SECRET_REF')
  await loadConnectionInScope(db, { tenantId, connectionId })
  // `expiresAt` is the secret-manager reference expiry FR-079 fails closed on.
  // The token-pair columns describe an OAuth grant held *by* the provider and are
  // deliberately separate: a rotated access token does not invalidate the reference.
  const fields = { secretRef, status, expiresAt, accessTokenExpiresAt, refreshTokenExpiresAt }
  return db.integrationCredential.upsert({
    where: { connectionId },
    create: { connectionId, ...fields },
    update: { ...fields, rotatedAt: new Date(), version: { increment: 1 } },
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

// @req FR-081 — the LINE OA channel this ingress records evidence against.
// @spec BR-012, SEC-001 — the destination is matched inside the tenant the binding
//   already proved; a connection under another Business is a misconfiguration, not a
//   near-miss to fall back from.
//
// `@@unique([tenantId, providerId, externalAccountId])` makes at most one LINE_OA
// connection exist per (tenant, destination), so resolution is deterministic without
// an ambiguity tiebreak. `null` means this channel has no connection yet — evidence is
// not configured — which is a different answer from "misconfigured" and is why the two
// do not share a return value.
export const LINE_OA_PROVIDER_CODE = 'LINE_OA'

export async function resolveLineOaConnection({
  db = prisma,
  tenantId,
  businessId = null,
  destination,
} = {}) {
  required(tenantId, 'TENANT_ID')
  required(destination, 'LINE_DESTINATION')

  // ACTIVE is part of the lookup, not a check after it, so a connection being
  // prepared (`createIntegrationConnection` defaults to DRAFT) or deliberately
  // disabled reads as "this channel is not ingesting" rather than breaking a live
  // channel mid-provisioning. That state is still visible: every event in the
  // response carries `evidence: null`.
  const connection = await db.integrationConnection.findFirst({
    where: {
      tenantId,
      externalAccountId: destination,
      status: 'ACTIVE',
      provider: { code: LINE_OA_PROVIDER_CODE },
    },
    include: { provider: true },
  })
  if (!connection) return null
  // An ACTIVE connection for this destination under a different Business is a
  // mapping error, not an absence. Recording evidence under the wrong Business
  // would be the cross-scope write SEC-001 exists to stop, so it fails loudly.
  if ((connection.businessId ?? null) !== (businessId ?? null)) {
    throw new Error('LINE_OA_CONNECTION_OUTSIDE_BUSINESS')
  }
  return connection
}

// @req FR-081 — a provider row is the addressable identity an ingestion channel
// binds to; registering one is idempotent on its code.
export async function registerIntegrationProvider({
  code,
  name,
  status = 'ACTIVE',
  capabilities = {},
}, { db = prisma } = {}) {
  required(code, 'PROVIDER_CODE')
  required(name, 'PROVIDER_NAME')
  const capabilitiesJson = JSON.stringify(capabilities ?? {})
  return db.integrationProvider.upsert({
    where: { code },
    create: { code, name, status, capabilitiesJson },
    update: { name, status, capabilitiesJson },
  })
}

// @req FR-081 — a run is opened against a connection already proven in scope, and
// inherits that connection's tenant/business rather than trusting the caller's.
export async function createIngestionRun({
  tenantId,
  businessId = null,
  connectionId,
  lane,
  resourceType,
  runType = 'INCREMENTAL',
}, { db = prisma } = {}) {
  required(lane, 'INGESTION_LANE')
  required(resourceType, 'RESOURCE_TYPE')
  const connection = await loadConnectionInScope(db, { tenantId, businessId, connectionId })
  return db.ingestionRun.create({
    data: {
      tenantId: connection.tenantId,
      businessId: connection.businessId,
      connectionId: connection.id,
      lane,
      resourceType,
      runType,
    },
  })
}
