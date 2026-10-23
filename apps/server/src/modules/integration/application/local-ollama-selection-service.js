import { z } from 'zod'

import { httpError } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { MODEL_ID_PATTERN, MODEL_PROVIDER_PURPOSE } from '@/lib/validation/enums'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'
import {
  assertMainDevLocalOllamaScope,
  listInstalledMainDevLocalOllamaModels,
  readMainDevLocalOllamaProfile,
} from '@/modules/agent/main-dev-local-ollama'
import {
  createIntegrationConnection,
  PHASE1_LINE_LLM_PURPOSE,
  promotePhase1PrimaryConnection,
} from '@/platform/integrations/core/integration-registry'

// @req FR-079, FR-080 — a Business owner may select one installed local model
//   for the explicitly allowlisted main-dev LINE OA profile.
// @spec ADR-100 D5, D9; SEC-001, SEC-030 — owner-derived scope, the actual main-dev
//   database, and model metadata only; no public catalogue or credential path.
// @tested tests/unit/local-ollama-selection-service.test.js

const LOCAL_PROVIDER_CODE = 'ollama'
const LOCAL_PROVIDER_NAME = 'Main-dev local Ollama (TEST ONLY)'
const LOCAL_PROVIDER_CAPABILITIES = Object.freeze({
  phase1Line: true,
  localOnly: true,
  mainDevLocalOllama: true,
})
const LOCAL_SELECTION_NAME = 'Main-dev local Ollama (TEST ONLY)'

const zSelection = z.object({
  modelId: z.string().trim().regex(MODEL_ID_PATTERN),
}).strict()

function notFound() {
  throw httpError(404, 'Business not found')
}

function conflict(code) {
  throw httpError(409, code)
}

function profileFor(env) {
  try {
    const profile = readMainDevLocalOllamaProfile(env)
    if (!profile) notFound()
    // These process-wide switches make the test-only profile unavailable. The
    // runtime also rejects memory-enabled setup, and per-job opt-ins are checked
    // at resolution time; this guard keeps the owner surface closed as well.
    if (env.ZURI_MSP_THREAD_MEMORY_ENABLED === 'true' || env.ZURI_MSP_EPISODIC_MEMORY_ENABLED === 'true') {
      notFound()
    }
    return profile
  } catch (error) {
    if (Number(error?.status) === 404) throw error
    notFound()
  }
}

/** Route preflight so a disabled main-dev endpoint answers 404 before body parsing. */
export function assertMainDevLocalOllamaAvailable({ env = process.env } = {}) {
  return profileFor(env)
}

function profileErrorAsNotFound(error) {
  if (String(error?.code ?? error?.message ?? '').startsWith('MAIN_DEV_LOCAL_OLLAMA_')) notFound()
  throw httpError(503, 'LOCAL_OLLAMA_UNAVAILABLE')
}

function isEligibleAccount(row, profile) {
  return Boolean(row)
    && profile.allowedTenantIds.includes(row.tenantId)
    && profile.allowedBusinessIds.includes(row.businessId)
    && profile.allowedLineOaAccountIds.includes(row.id)
    && row.status === 'CONNECTED'
    && row.serverEnabled === true
    && row.executionMode === 'SERVER'
    && row.runtimeOwner === 'SERVER'
    && row.knowledgeGrounding === 'BUSINESS_KNOWLEDGE'
    && row.knowledgeGroundingShadow === false
    && (row.memoryPolicy ?? 'OFF') === 'OFF'
    && row.memoryProjectId == null
}

async function loadOwnedContext({ viewer, db, profile }) {
  const businesses = await db.business.findMany({
    where: {
      id: { in: profile.allowedBusinessIds },
      tenantId: { in: profile.allowedTenantIds },
    },
    select: { id: true, tenantId: true },
  })
  const owned = businesses.filter((business) => (
    profile.allowedTenantIds.includes(business.tenantId)
    && profile.allowedBusinessIds.includes(business.id)
    && ownsBusiness(viewer, business.id)
    && seesBusiness(viewer, business.id)
  ))
  if (owned.length !== 1) notFound()

  const business = owned[0]
  try {
    assertDomainVisible(viewer, business.id, 'line-oa')
  } catch {
    notFound()
  }

  const rows = await db.lineOaAccount.findMany({
    where: {
      id: { in: profile.allowedLineOaAccountIds },
      tenantId: business.tenantId,
      businessId: business.id,
    },
    select: {
      id: true,
      tenantId: true,
      businessId: true,
      displayName: true,
      status: true,
      serverEnabled: true,
      executionMode: true,
      runtimeOwner: true,
      knowledgeGrounding: true,
      knowledgeGroundingShadow: true,
      memoryPolicy: true,
      memoryProjectId: true,
    },
  })
  const accounts = rows.filter((row) => isEligibleAccount(row, profile))
  if (accounts.length !== 1) notFound()
  return { business, account: accounts[0] }
}

async function assertActualProfileScope({ profile, db, business, account }) {
  try {
    return await assertMainDevLocalOllamaScope({
      profile,
      db,
      tenantId: business.tenantId,
      businessId: business.id,
      accountId: account.id,
    })
  } catch (error) {
    profileErrorAsNotFound(error)
  }
}

/** Refuse a Business-scoped API key without resolving or reading its secret. */
async function assertNoBusinessModelKey({ db, tenantId, businessId }) {
  const rows = await db.integrationConnection.findMany({
    where: { tenantId, businessId, purpose: MODEL_PROVIDER_PURPOSE },
    select: { id: true, credential: { select: { id: true } } },
  })
  if (rows.some((row) => row.credential)) conflict('BUSINESS_MODEL_PROVIDER_KEY_PRESENT')
}

function parseModelId(connection) {
  try {
    const metadata = JSON.parse(connection?.metadataJson ?? '{}')
    return typeof metadata?.model === 'string' && MODEL_ID_PATTERN.test(metadata.model)
      ? metadata.model
      : null
  } catch {
    return null
  }
}

async function readCurrentPrimary({ db, tenantId, businessId }) {
  const rows = await db.integrationConnection.findMany({
    where: {
      tenantId,
      businessId,
      purpose: PHASE1_LINE_LLM_PURPOSE,
      status: 'ACTIVE',
      role: 'PRIMARY',
    },
    include: { provider: true, credential: { select: { id: true } } },
  })
  if (rows.length > 1) conflict('PHASE1_CONNECTION_AMBIGUOUS')
  const primary = rows[0] ?? null
  if (primary?.provider?.code === LOCAL_PROVIDER_CODE && primary.credential) {
    conflict('LOCAL_OLLAMA_CREDENTIAL_PRESENT')
  }
  return primary
}

async function readModelList({ profile, db, business, account, fetchFn }) {
  try {
    return await listInstalledMainDevLocalOllamaModels({
      profile,
      db,
      tenantId: business.tenantId,
      businessId: business.id,
      accountId: account.id,
      fetchFn,
    })
  } catch (error) {
    profileErrorAsNotFound(error)
  }
}

/**
 * Read the installed-model selector for the unique owner-authorized allowlisted
 * Business/OA pair. Neither Business nor account scope comes from the request.
 */
export async function listMainDevLocalOllamaModels({
  viewer,
  db = prisma,
  env = process.env,
  fetchFn = fetch,
} = {}) {
  const profile = profileFor(env)
  const context = await loadOwnedContext({ viewer, db, profile })
  const scope = await assertActualProfileScope({ profile, db, ...context })
  await assertNoBusinessModelKey({ db, tenantId: scope.tenantId, businessId: scope.businessId })
  const models = await readModelList({ profile, db, ...context, fetchFn })
  const primary = await readCurrentPrimary({ db, ...scope })
  return {
    businessId: scope.businessId,
    accountId: scope.accountId,
    accountName: context.account.displayName,
    models,
    selectedModelId: primary?.provider?.code === LOCAL_PROVIDER_CODE ? parseModelId(primary) : null,
  }
}

async function ensureLocalOllamaProvider(tx) {
  const existing = await tx.integrationProvider.findUnique({ where: { code: LOCAL_PROVIDER_CODE } })
  if (existing) {
    let capabilities
    try {
      capabilities = JSON.parse(existing.capabilitiesJson ?? '{}')
    } catch {
      capabilities = null
    }
    const expectedCapabilityKeys = Object.keys(LOCAL_PROVIDER_CAPABILITIES)
    const capabilitiesMatch = Boolean(capabilities)
      && Object.keys(capabilities).length === expectedCapabilityKeys.length
      && expectedCapabilityKeys.every((key) => capabilities[key] === LOCAL_PROVIDER_CAPABILITIES[key])
    if (
      existing.status !== 'ACTIVE'
      || existing.name !== LOCAL_PROVIDER_NAME
      || !capabilitiesMatch
    ) conflict('LOCAL_OLLAMA_PROVIDER_MISCONFIGURED')
    return existing
  }

  try {
    return await tx.integrationProvider.create({
      data: {
        code: LOCAL_PROVIDER_CODE,
        name: LOCAL_PROVIDER_NAME,
        status: 'ACTIVE',
        capabilitiesJson: JSON.stringify(LOCAL_PROVIDER_CAPABILITIES),
      },
    })
  } catch (error) {
    if (error?.code === 'P2002') conflict('LOCAL_OLLAMA_PROVIDER_CREATE_CONFLICT')
    throw error
  }
}

async function prepareLocalConnection({ tx, scope, provider, modelId }) {
  const currentRows = await tx.integrationConnection.findMany({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      purpose: PHASE1_LINE_LLM_PURPOSE,
      status: 'ACTIVE',
      role: 'PRIMARY',
    },
    include: { provider: true, credential: { select: { id: true } } },
  })
  if (currentRows.length > 1) conflict('PHASE1_CONNECTION_AMBIGUOUS')
  const current = currentRows[0] ?? null
  if (current?.provider?.code === LOCAL_PROVIDER_CODE && current.credential) {
    conflict('LOCAL_OLLAMA_CREDENTIAL_PRESENT')
  }
  if (current?.provider?.code === LOCAL_PROVIDER_CODE && parseModelId(current) === modelId) {
    return { connection: current, changed: false }
  }

  const candidates = await tx.integrationConnection.findMany({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      purpose: PHASE1_LINE_LLM_PURPOSE,
      providerId: provider.id,
    },
    orderBy: { updatedAt: 'desc' },
    include: { credential: { select: { id: true } } },
  })
  if (candidates.some((row) => row.credential)) conflict('LOCAL_OLLAMA_CREDENTIAL_PRESENT')
  const reusable = candidates.filter((row) => row.id !== current?.id && row.role !== 'PRIMARY'
    && ['DRAFT', 'ACTIVE'].includes(row.status))
  if (reusable.length > 1) conflict('LOCAL_OLLAMA_CONNECTION_AMBIGUOUS')

  if (reusable.length === 1) {
    const candidate = reusable[0]
    const updated = await tx.integrationConnection.updateMany({
      where: {
        id: candidate.id,
        tenantId: scope.tenantId,
        businessId: scope.businessId,
        purpose: PHASE1_LINE_LLM_PURPOSE,
        version: candidate.version,
        role: { not: 'PRIMARY' },
      },
      data: { metadataJson: JSON.stringify({ model: modelId }), version: { increment: 1 } },
    })
    if (updated.count !== 1) conflict('LOCAL_OLLAMA_SELECTION_CONFLICT')
    return {
      connection: await tx.integrationConnection.findUnique({ where: { id: candidate.id } }),
      changed: true,
    }
  }

  const connection = await createIntegrationConnection({
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    providerId: provider.id,
    name: LOCAL_SELECTION_NAME,
    authorizationType: 'NONE',
    purpose: PHASE1_LINE_LLM_PURPOSE,
    role: 'SECONDARY',
    status: 'DRAFT',
    metadata: { model: modelId },
  }, { db: tx })
  return { connection, changed: true }
}

/** Store a strict, installed model ID and promote it through the existing CAS gate. */
export async function selectMainDevLocalOllamaModel(input, {
  viewer,
  db = prisma,
  env = process.env,
  fetchFn = fetch,
} = {}) {
  const profile = profileFor(env)
  const context = await loadOwnedContext({ viewer, db, profile })
  const scope = await assertActualProfileScope({ profile, db, ...context })
  const { modelId } = zSelection.parse(input)
  await assertNoBusinessModelKey({ db, tenantId: scope.tenantId, businessId: scope.businessId })

  // This is a fresh, server-side inventory on every write; the browser never
  // chooses an origin and cannot submit an ID that was only shown earlier.
  const models = await readModelList({ profile, db, ...context, fetchFn })
  if (!models.includes(modelId)) throw httpError(400, 'OLLAMA_MODEL_NOT_INSTALLED')

  let prepared
  try {
    prepared = await db.$transaction(async (tx) => {
      const txContext = await loadOwnedContext({ viewer, db: tx, profile })
      if (txContext.business.id !== scope.businessId || txContext.account.id !== scope.accountId) notFound()
      const txScope = await assertActualProfileScope({ profile, db: tx, ...txContext })
      await assertNoBusinessModelKey({ db: tx, tenantId: txScope.tenantId, businessId: txScope.businessId })
      const provider = await ensureLocalOllamaProvider(tx)
      return { scope: txScope, ...(await prepareLocalConnection({ tx, scope: txScope, provider, modelId })) }
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (Number(error?.status)) throw error
    if (error?.code === 'P2002' || error?.code === 'P2034') conflict('LOCAL_OLLAMA_SELECTION_CONFLICT')
    throw error
  }

  if (!prepared.changed) {
    return {
      businessId: prepared.scope.businessId,
      accountId: prepared.scope.accountId,
      modelId,
      selected: true,
    }
  }

  let promoted
  try {
    promoted = await promotePhase1PrimaryConnection({
      db,
      tenantId: prepared.scope.tenantId,
      businessId: prepared.scope.businessId,
      connectionId: prepared.connection.id,
      expectedVersion: prepared.connection.version,
    })
  } catch (error) {
    if (error?.message === 'PHASE1_CONNECTION_CAS_CONFLICT' || error?.code === 'P2034' || error?.code === 'P2002') {
      conflict('LOCAL_OLLAMA_SELECTION_CONFLICT')
    }
    if (error?.message === 'PHASE1_CONNECTION_NOT_FOUND') notFound()
    throw error
  }

  await recordAudit(db, {
    entityType: 'INTEGRATION_CONNECTION',
    entityId: promoted.connectionId,
    action: 'LOCAL_OLLAMA_SELECTED',
    actorType: 'LOCAL_USER',
    actorId: viewer?.principal?.id ?? null,
    tenantId: prepared.scope.tenantId,
    businessId: prepared.scope.businessId,
    payload: {
      provider: LOCAL_PROVIDER_CODE,
      modelId,
      lineOaAccountId: prepared.scope.accountId,
      runtimeSource: profile.runtimeSource,
    },
  })

  return {
    businessId: prepared.scope.businessId,
    accountId: prepared.scope.accountId,
    modelId,
    selected: true,
  }
}
