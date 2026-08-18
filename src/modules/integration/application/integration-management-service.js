import { z } from 'zod'

import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'
import { isSupabaseVaultSecretRef } from '@/platform/integrations/core/secret-manager'
import { PHASE1_LINE_LLM_PURPOSE } from '@/platform/integrations/core/integration-registry'

// @req FR-080 — owner-scoped Platform metadata management for the Phase 1
// connection; raw secret values never cross this service boundary.
// @spec ADR-032 D1-D4, SEC-016, SDD-044
// @tested tests/unit/fr080-integration-management.test.js

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

function toMetadata(connection) {
  const metadata = metadataJson(connection)
  const credential = connection.credential
  return {
    id: connection.id,
    tenantId: connection.tenantId,
    businessId: connection.businessId,
    name: connection.name,
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
  }
}

export async function listPhase1Integrations({ db = prisma, resolve, businessId = null } = {}) {
  const viewer = await resolve()
  const ownedBusinessIds = Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds.filter(Boolean) : []
  if (businessId) assertOwned(viewer, businessId)
  const scopedBusinessIds = businessId ? [businessId] : ownedBusinessIds
  if (scopedBusinessIds.length === 0) return []

  const rows = await db.integrationConnection.findMany({
    where: { purpose: PHASE1_LINE_LLM_PURPOSE, businessId: { in: scopedBusinessIds } },
    orderBy: { updatedAt: 'desc' },
    include: { provider: true, credential: true },
  })
  return rows.map(toMetadata)
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
