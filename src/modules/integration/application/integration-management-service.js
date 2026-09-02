import { z } from 'zod'

import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'
import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'
import {
  LINE_OA_PROVIDER_CODE,
  PHASE1_LINE_LLM_PURPOSE,
} from '@/platform/integrations/core/integration-registry'
import {
  DEFAULT_STALE_AFTER_MS,
  evaluateConnectionHealth,
} from '@/platform/integrations/core/connection-health'
import { LINE_REGISTRY_TYPES } from './line-registry-service'

// @req FR-080 — owner-scoped Platform metadata management for the Phase 1
// connection; raw secret values never cross this service boundary. AC-075.3 also
// promises health on this read model — it is computed here from evidence the
// database already holds, never stored.
// @spec ADR-032 D1-D4, SEC-016, SDD-044
// @tested tests/unit/fr080-integration-management.test.js, tests/unit/connection-health.test.js
//
// The listing covers both connection kinds an operator has to reason about: the
// Phase 1 MODEL_PROVIDER connections this page creates, and the LINE_OA CHANNEL the
// ingress records evidence against (FR-081). They are one surface on purpose —
// "is LINE up?" and "is the model configured?" are the same question asked twice,
// and a separate LINE-only health page would be the second source of truth.

const PROVIDER_NAMES = Object.freeze({
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  groq: 'Groq',
})

const zCreate = z.object({
  businessId: z.string().trim().min(1).max(200),
  provider: z.string().trim().toLowerCase().refine((value) => PUBLIC_LINE_PROVIDERS.includes(value), 'Provider is not allowed for Phase 1 LINE'),
  name: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200),
  secretRef: z.string().trim().min(1).optional(),
}).strict()

function metadataJson(connection) {
  try {
    const parsed = JSON.parse(connection.metadataJson ?? '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function maskSecretRef(secretRef) {
  if (!isSupabaseVaultSecretRef(secretRef)) return null
  const id = secretRef.slice('supabase-vault:'.length)
  return `supabase-vault:${id.slice(0, 8)}…${id.slice(-4)}`
}

function assertOwned(viewer, businessId) {
  if (!ownsBusiness(viewer, businessId)) {
    const error = new Error('Integration is outside your owned scope')
    error.status = 404
    throw error
  }
}

const connectionKind = (connection) => (
  connection.provider?.code === LINE_OA_PROVIDER_CODE ? 'CHANNEL' : 'MODEL_PROVIDER'
)

function toMetadata(connection, { lastEventAt = null, now = new Date(), staleAfterMs } = {}) {
  const metadata = metadataJson(connection)
  const credential = connection.credential
  const kind = connectionKind(connection)
  const health = evaluateConnectionHealth({
    connection,
    credential,
    lastEventAt,
    kind,
    now,
    ...(staleAfterMs === undefined ? {} : { staleAfterMs }),
  })
  return {
    id: connection.id,
    tenantId: connection.tenantId,
    businessId: connection.businessId,
    name: connection.name,
    kind,
    provider: connection.provider?.code ?? null,
    providerName: connection.provider?.name ?? null,
    model: metadata.model ?? null,
    purpose: connection.purpose,
    role: connection.role,
    status: connection.status,
    version: connection.version,
    secretConfigured: Boolean(credential),
    secretStatus: credential?.status ?? 'MISSING',
    secretRefMasked: maskSecretRef(credential?.secretRef),
    credentialVersion: credential?.version ?? null,
    expiresAt: credential?.expiresAt ?? null,
    updatedAt: connection.updatedAt ?? null,
    // AC-075.3 health field. `reasons` is the whole finding list, not just the one
    // the state is named after, so a disabled *and* misconfigured row says both.
    health,
  }
}

/**
 * Newest inbound evidence per connection, in one query rather than one per row.
 *
 * `RawExternalRecord` is the only durable record that a connection actually
 * carried traffic (FR-081), which makes it the honest input to channel health —
 * an operator asking "is LINE up?" is asking when we last heard from it.
 */
async function lastEventByConnection(db, connectionIds) {
  if (connectionIds.length === 0) return new Map()
  const rows = await db.rawExternalRecord.groupBy({
    by: ['connectionId'],
    where: { connectionId: { in: connectionIds } },
    _max: { receivedAt: true },
  })
  return new Map(rows.map((row) => [row.connectionId, row._max.receivedAt ?? null]))
}

export async function listPhase1Integrations({
  db = prisma,
  resolve,
  businessId = null,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
} = {}) {
  const viewer = await resolve()
  const ownedBusinessIds = Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds.filter(Boolean) : []
  if (businessId) assertOwned(viewer, businessId)
  const scopedBusinessIds = businessId ? [businessId] : ownedBusinessIds
  if (scopedBusinessIds.length === 0) return []

  const rows = await db.integrationConnection.findMany({
    where: {
      businessId: { in: scopedBusinessIds },
      // Both kinds an operator has to reason about: the Phase 1 model providers this
      // page creates, and the LINE OA channel the ingress records evidence against.
      OR: [
        { purpose: PHASE1_LINE_LLM_PURPOSE },
        { provider: { code: LINE_OA_PROVIDER_CODE } },
      ],
      // …and nothing else that happens to sit under the same provider. LINE
      // Registry rows (FR-080 group/contact metadata) are neither a channel nor
      // a model connection: they carry no credential and no ingress evidence, so
      // health cannot be computed for them and they would read as permanently
      // unhealthy on this surface (D3-integration-knowledge-document-intake-17).
      NOT: { purpose: { in: [LINE_REGISTRY_TYPES.GROUP, LINE_REGISTRY_TYPES.USER] } },
    },
    orderBy: { updatedAt: 'desc' },
    include: { provider: true, credential: true },
  })

  const lastEvents = await lastEventByConnection(
    db,
    rows.filter((row) => connectionKind(row) === 'CHANNEL').map((row) => row.id),
  )
  return rows.map((row) => toMetadata(row, {
    lastEventAt: lastEvents.get(row.id) ?? null,
    now,
    staleAfterMs,
  }))
}

export async function createPhase1Integration(input, { db = prisma, resolve } = {}) {
  const data = zCreate.parse(input)
  const viewer = await resolve()
  assertOwned(viewer, data.businessId)
  if (data.secretRef && !isSupabaseVaultSecretRef(data.secretRef)) {
    throw new Error('SECRET_REF_MUST_BE_SUPABASE_VAULT_OPAQUE_REFERENCE')
  }

  return db.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { id: data.businessId },
      select: { id: true, tenantId: true },
    })
    if (!business) {
      const error = new Error('BUSINESS_NOT_FOUND')
      error.status = 404
      throw error
    }

    const provider = await tx.integrationProvider.upsert({
      where: { code: data.provider },
      update: { name: PROVIDER_NAMES[data.provider], status: 'ACTIVE' },
      create: {
        code: data.provider,
        name: PROVIDER_NAMES[data.provider],
        capabilitiesJson: JSON.stringify({ phase1Line: true }),
      },
    })
    const connection = await tx.integrationConnection.create({
      data: {
        tenantId: business.tenantId,
        businessId: business.id,
        providerId: provider.id,
        name: data.name,
        authorizationType: 'SECRET_MANAGER',
        purpose: PHASE1_LINE_LLM_PURPOSE,
        role: 'SECONDARY',
        status: 'DRAFT',
        metadataJson: JSON.stringify({ model: data.model }),
      },
    })
    const credential = data.secretRef
      ? await tx.integrationCredential.create({
        data: { connectionId: connection.id, secretRef: data.secretRef, status: 'ACTIVE' },
      })
      : null

    await recordAudit(tx, {
      entityType: 'INTEGRATION_CONNECTION',
      entityId: connection.id,
      action: 'PHASE1_METADATA_CREATED',
      actorId: viewer.principal?.id ?? null,
      payload: {
        businessId: business.id,
        provider: data.provider,
        model: data.model,
        purpose: PHASE1_LINE_LLM_PURPOSE,
        status: 'DRAFT',
        secretConfigured: Boolean(credential),
      },
    })
    return toMetadata({ ...connection, provider, credential })
  })
}
