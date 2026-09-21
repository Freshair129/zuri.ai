import { z } from 'zod'
import prisma from '@/lib/db'
import {
  INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES,
  MODEL_ID_PATTERN,
  MODEL_PROVIDER_CODES,
  MODEL_PROVIDER_PURPOSE,
  MODEL_PROVIDER_SUGGESTED_MODELS,
  zModelProviderCode,
} from '@/lib/validation/enums'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { credentialAuditPayload, revokeCredential, storeValidatedCredential } from '@/platform/integrations/core/secret-store/credential-lifecycle'
import { requireWritableSecretStore } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import {
  MODEL_PROVIDER_API_KEY_PATTERN,
  parseSecretBundle,
} from '@/platform/integrations/core/secret-store/secret-store-port'
import { createModelProviderAdminPort } from '@/platform/integrations/providers/model/model-provider-admin-port'
import { credentialView, parseCredentialInput, refusal } from './line-channel-connection-service'

// @req FR-266 — a Business owner provisions, rotates, revokes and re-validates the
//   model provider API key from the browser, write-only. The key is proved live
//   against its provider before anything is stored, then written through the
//   SecretStorePort as a MODEL_PROVIDER_KEY credential (FR-242) on a Business-scoped
//   IntegrationConnection whose purpose is MODEL_PROVIDER.
// @req FR-223, FR-224 — the credential lifecycle and the write gate (AAL2 step-up
//   plus rate limit) are the LINE channel's, reused rather than reimplemented.
// @spec ADR-100 D4; ADR-089 D2, D4, D5, D7; SEC-030; SEC-033; SDD-101; SDD-106
// @tested tests/integration/fr266-model-provider-credential.test.js,
//   tests/unit/platform/model-provider-admin-port.test.js
//
// Order, and why it is this order (ADR-089 D7 applied to a second kind):
//   1. input, authority and the write gate — nothing leaves the building for a
//      caller who may not write;
//   2. the writable store must exist before the provider is asked anything;
//   3. live validation with the provider — a refusal stores nothing at all;
//   4. the connection, created or reused, in one transaction;
//   5. write + activate the credential through the shared lifecycle.
//
// One MODEL_PROVIDER connection per Business, enforced here rather than by a
// database constraint: `IntegrationConnection`'s uniqueness is
// (tenantId, providerId, externalAccountId), and a model provider connection has
// no external account id — so two rows with NULL there are distinct to the
// database and ambiguous to `resolveModel`. A second write reuses the first
// connection, which is also what makes "enter a new key" and "rotate the key" the
// same action for the owner.

// `model` is required, not defaulted. The server does not get to pick what a
// Business pays per token, and a default here would keep working long after the
// provider renamed the model it names.
const zProvision = z.object({
  businessId: z.string().trim().min(1).max(200),
  provider: zModelProviderCode,
  model: z.string().trim().regex(MODEL_ID_PATTERN),
  // Trimmed before the pattern check. A key copied from a provider's page very
  // often carries a trailing newline or space, and the pattern admits neither, so
  // an untrimmed field refused a correct key with a message that blamed its format.
  // No provider issues a key with leading or trailing whitespace, so trimming can
  // only ever repair a paste, never change a real key.
  apiKey: z.string().trim().regex(MODEL_PROVIDER_API_KEY_PATTERN),
}).strict()

const zRevoke = z.object({
  reason: z.string().trim().min(1).max(200),
  confirmation: z.literal('REVOKE'),
}).strict()

const zValidate = z.object({}).strict()

const PROVIDER_NAMES = Object.freeze({
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  groq: 'Groq',
})

function asRefusal(error, fallback) {
  if (error?.status && typeof error?.message === 'string' && /^[A-Z][A-Z0-9_:]+$/.test(error.message)) {
    const answer = refusal(Number(error.status), error.message)
    if (Number.isInteger(error.retryAfterSeconds)) answer.retryAfterSeconds = error.retryAfterSeconds
    return answer
  }
  return refusal(503, fallback)
}

/** The Business this viewer may write model credentials for, or a 404-shaped refusal. */
async function loadBusiness(db, businessId, viewer) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  const business = id ? await db.business.findUnique({ where: { id }, select: { id: true, tenantId: true } }) : null
  if (!business || !ownsBusiness(viewer, business.id) || !seesBusiness(viewer, business.id)) {
    throw refusal(404, 'Business not found')
  }
  assertDomainVisible(viewer, business.id, 'line-oa')
  return business
}

/** The connection's stored model id, or null. The column is defended-parsed for
 * the same reason `integration-management-service.js` defends it: it is free JSON
 * on a row an older writer may have left in another shape. */
export function readConnectionModel(connection) {
  try {
    const parsed = JSON.parse(connection?.metadataJson ?? '{}')
    const model = parsed && typeof parsed.model === 'string' ? parsed.model.trim() : ''
    return MODEL_ID_PATTERN.test(model) ? model : null
  } catch {
    return null
  }
}

/** The Business's one model provider connection, or null. */
export async function readModelProviderConnection(businessId, { db = prisma } = {}) {
  return db.integrationConnection.findFirst({
    where: { businessId, purpose: MODEL_PROVIDER_PURPOSE },
    include: { provider: true, credential: true },
    orderBy: { createdAt: 'asc' },
  })
}

/**
 * The non-secret view of a Business's model credential, for the Studio's readiness
 * journey and its settings card. `displayHint` is always null for this kind
 * (SDD-101) and is not in the shape at all, so a future caller cannot start
 * rendering four characters of an API key by mistake.
 */
export async function readModelProviderStatus(businessId, { viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, businessId, viewer)
  const connection = await readModelProviderConnection(business.id, { db })
  const catalogue = { providers: MODEL_PROVIDER_CODES, suggestedModels: MODEL_PROVIDER_SUGGESTED_MODELS }
  if (!connection?.credential) return { modelCredential: null, ...catalogue }
  return {
    modelCredential: {
      connectionId: connection.id,
      provider: connection.provider?.code ?? null,
      model: readConnectionModel(connection),
      status: connection.credential.status,
      secretStore: connection.credential.secretStore,
      lastValidatedAt: connection.credential.lastValidatedAt,
      // The outcome of that last check, not just its time. A re-validation that
      // the provider refused still stamps `lastValidatedAt`, so a reader that saw
      // only the time would show a key that just failed as ready. This is an
      // outcome code (`MODEL_KEY_VALIDATED:OPENAI`, `MODEL_KEY_REJECTED`,
      // `MODEL_NOT_FOUND`), never key material.
      lastValidationCode: connection.credential.lastValidationCode ?? null,
      version: connection.credential.version,
    },
    ...catalogue,
  }
}

/**
 * @req FR-266, SDD-106 — the server worker's read: the Business's own model
 * provider credential, resolved through the SecretStorePort.
 *
 * Returns `null` for **absence** — this Business has no model provider connection
 * — which is the one case `resolveModel` is allowed to fall back to the Phase-1
 * resolver for (ADR-100 D5). Everything else throws: a connection that exists but
 * whose credential is revoked, unresolvable or of the wrong kind is a configured
 * key that is broken, and answering that customer with a *different* Business's
 * operator-provisioned key would be a silent downgrade no trace would show.
 *
 * It takes no viewer: the caller is the durable worker acting on an already
 * account-scoped job, not a browser session. The scope it is given is the job's,
 * and it is applied as a filter here rather than trusted.
 */
export async function resolveBusinessModelCredential({ tenantId, businessId }, { db = prisma, env = process.env, store = null } = {}) {
  if (!tenantId || !businessId) throw new Error('MODEL_CREDENTIAL_SCOPE_REQUIRED')
  const connection = await db.integrationConnection.findFirst({
    where: { tenantId, businessId, purpose: MODEL_PROVIDER_PURPOSE, status: 'ACTIVE', role: 'PRIMARY' },
    include: { provider: true, credential: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!connection) return null
  const provider = connection.provider?.code
  const model = readConnectionModel(connection)
  if (!provider || !model) throw new Error('MODEL_CREDENTIAL_CONNECTION_INCOMPLETE')
  const credential = connection.credential
  if (!credential || !INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES.includes(credential.status)) {
    throw new Error('MODEL_CREDENTIAL_NOT_RESOLVABLE')
  }
  const secretStore = store ?? requireWritableSecretStore(env, { db })
  let apiKey
  try {
    const resolved = await secretStore.resolve(credential.secretRef, {
      tenantId, businessId, connectionId: connection.id, kind: 'MODEL_PROVIDER_KEY',
    })
    apiKey = JSON.parse(resolved.material).apiKey
  } catch {
    // The store's own codes may name a reference; this one names nothing (SEC-030).
    throw new Error('MODEL_CREDENTIAL_NOT_RESOLVABLE')
  }
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('MODEL_CREDENTIAL_NOT_RESOLVABLE')
  // Non-enumerable, so the key cannot ride out through a spread, a JSON
  // serialization or a logger that stringifies whatever it is handed.
  const answer = { provider, model }
  Object.defineProperty(answer, 'apiKey', { value: apiKey, enumerable: false })
  return Object.freeze(answer)
}

/**
 * POST /api/integration/model-providers — enter or replace the Business's model key.
 *
 * Creating and rotating are deliberately the same call. The owner's mental model is
 * "this is my key now"; splitting it would make them first discover whether a key
 * already exists, and the answer to that is a thing this route will not show them.
 */
export async function provisionModelProviderCredential(input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  const data = parseCredentialInput(zProvision, input)
  const business = await loadBusiness(db, data.businessId, viewer)
  if (typeof ports.assertWriteAllowed === 'function') {
    await ports.assertWriteAllowed({ viewer, businessId: business.id, action: 'ROTATE' })
  }

  const store = ports.store ?? requireWritableSecretStore(env, { db })
  const admin = ports.modelAdmin ?? createModelProviderAdminPort()
  const bundle = parseSecretBundle('MODEL_PROVIDER_KEY', { apiKey: data.apiKey })

  let validation
  try {
    validation = await admin.validateKey({ provider: data.provider, apiKey: data.apiKey, model: data.model })
  } catch (error) {
    if (error?.code === 'MODEL_KEY_REJECTED' && typeof ports.onValidationRejected === 'function') {
      await ports.onValidationRejected({ viewer, businessId: business.id })
    }
    throw asRefusal(error, 'MODEL_PROVIDER_UNAVAILABLE')
  }

  const existing = await readModelProviderConnection(business.id, { db })
  // A key for a different vendor replaces the connection's provider rather than
  // creating a second connection: the owner has one model provider at a time, and
  // two ACTIVE MODEL_PROVIDER connections would make `resolveModel` ambiguous —
  // which SDD-106 refuses rather than resolves arbitrarily.
  const providerChanged = Boolean(existing) && existing.provider?.code !== data.provider
  let connection = existing
  try {
    connection = await db.$transaction(async tx => {
      const provider = await tx.integrationProvider.findUnique({ where: { code: data.provider } })
        ?? await registerIntegrationProvider({ code: data.provider, name: PROVIDER_NAMES[data.provider] ?? data.provider }, { db: tx })
      if (!existing) {
        return createIntegrationConnection({
          tenantId: business.tenantId, businessId: business.id, providerId: provider.id,
          name: `${PROVIDER_NAMES[data.provider] ?? data.provider} model access`,
          purpose: MODEL_PROVIDER_PURPOSE, role: 'PRIMARY', status: 'ACTIVE',
          // The model id is non-secret configuration and lives on the connection,
          // exactly where the Phase-1 connection already keeps it, so
          // `resolveModel` reads one shape whichever resolver found the row.
          authorizationType: 'SECRET_MANAGER', metadata: { model: data.model },
        }, { db: tx })
      }
      await tx.integrationConnection.update({
        where: { id: existing.id },
        data: {
          providerId: provider.id, status: 'ACTIVE',
          name: `${PROVIDER_NAMES[data.provider] ?? data.provider} model access`,
          metadataJson: JSON.stringify({ model: data.model }),
          version: { increment: 1 },
        },
      })
      return tx.integrationConnection.findUnique({ where: { id: existing.id }, include: { provider: true, credential: true } })
    }, { timeout: 15000, maxWait: 5000 })
  } catch (error) {
    throw asRefusal(error, 'MODEL_PROVIDER_CONNECTION_FAILED')
  }

  const scope = { tenantId: business.tenantId, businessId: business.id, connectionId: connection.id }
  const actorId = viewer?.principal?.id ?? null
  try {
    await storeValidatedCredential({
      store, ...scope, kind: 'MODEL_PROVIDER_KEY', bundle, validationCode: validation.validationCode,
      actorPersonId: actorId, createdVia: 'BROWSER_MFA',
      afterActivate: async (result) => recordAudit(db, {
        entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id,
        action: existing ? 'CREDENTIAL_ROTATED' : 'CREDENTIAL_WRITTEN',
        actorId, businessId: business.id, tenantId: business.tenantId,
        payload: credentialAuditPayload({
          businessId: business.id, connectionId: connection.id, credentialVersion: result.versionNumber,
          // No displayHint: a model key has no non-secret identifier (SDD-101).
          secretStore: store.store, validationCode: validation.validationCode, via: 'BROWSER_MFA',
          purgeFailedCount: result.purgeFailedCount,
        }),
      }),
    })
  } catch (error) {
    throw asRefusal(error, 'CHANNEL_SECRET_STORE_UNAVAILABLE')
  }

  const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } })
  return { connectionId: connection.id, provider: data.provider, model: data.model, providerChanged, credential: credentialView(credential) }
}

/** POST /api/integration/model-providers/{id}/revoke */
export async function revokeModelProviderCredential(connectionId, input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  const data = parseCredentialInput(zRevoke, input)
  const connection = await loadModelConnection(db, connectionId, viewer)
  if (!connection.credential) throw refusal(404, 'CREDENTIAL_NOT_FOUND')
  if (typeof ports.assertWriteAllowed === 'function') {
    await ports.assertWriteAllowed({ viewer, businessId: connection.businessId, action: 'REVOKE' })
  }

  const store = ports.store ?? requireWritableSecretStore(env, { db })
  const actorId = viewer?.principal?.id ?? null
  let result
  try {
    // No fence: unlike a LINE channel credential, a revoked model key stops the
    // next answer by failing to resolve (SDD-106 fails closed), and pausing the
    // OA as well would be this route deciding the account's availability on the
    // owner's behalf. The Studio reports the terminal failures either way.
    result = await revokeCredential({
      store, tenantId: connection.tenantId, businessId: connection.businessId, connectionId: connection.id,
      reason: data.reason,
    })
  } catch (error) {
    throw asRefusal(error, 'CHANNEL_SECRET_STORE_UNAVAILABLE')
  }
  await recordAudit(db, {
    entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id, action: 'CREDENTIAL_REVOKED',
    actorId, businessId: connection.businessId, tenantId: connection.tenantId, reason: data.reason,
    payload: credentialAuditPayload({
      businessId: connection.businessId, connectionId: connection.id, secretStore: store.store, via: 'BROWSER_MFA',
      purgedCount: result.purgedCount, purgeFailedCount: result.purgeFailedCount,
    }),
  })
  const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } })
  return { credential: { status: credential.status, version: credential.version } }
}

/** POST /api/integration/model-providers/{id}/validate — re-prove the stored key. */
export async function validateModelProviderCredential(connectionId, input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  parseCredentialInput(zValidate, input ?? {})
  const connection = await loadModelConnection(db, connectionId, viewer)
  const current = connection.credential
  if (!current) throw refusal(404, 'CREDENTIAL_NOT_FOUND')
  if (typeof ports.assertWriteAllowed === 'function') {
    await ports.assertWriteAllowed({ viewer, businessId: connection.businessId, action: 'VALIDATE' })
  }

  const store = ports.store ?? requireWritableSecretStore(env, { db })
  const admin = ports.modelAdmin ?? createModelProviderAdminPort()
  let apiKey
  try {
    const resolved = await store.resolve(current.secretRef, {
      tenantId: connection.tenantId, businessId: connection.businessId, connectionId: connection.id,
      kind: 'MODEL_PROVIDER_KEY',
    })
    apiKey = JSON.parse(resolved.material).apiKey
  } catch {
    // A credential that cannot be resolved cannot be re-proved, and the only way
    // out is re-entry — the same answer the LINE path gives for the same state.
    throw refusal(409, 'CREDENTIAL_REENTRY_REQUIRED')
  }

  const record = async (code) => {
    await db.integrationCredential.update({ where: { id: current.id }, data: { lastValidatedAt: new Date(), lastValidationCode: code } })
    await recordAudit(db, {
      entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id, action: 'CREDENTIAL_VALIDATED',
      actorId: viewer?.principal?.id ?? null, businessId: connection.businessId, tenantId: connection.tenantId,
      payload: credentialAuditPayload({
        businessId: connection.businessId, connectionId: connection.id, credentialVersion: current.version,
        secretStore: current.secretStore, validationCode: code, via: 'BROWSER_MFA',
      }),
    })
  }

  try {
    // Re-validation proves the stored model too, which is what makes this button
    // worth pressing later: a provider that retires the model a Business chose
    // leaves the key perfectly valid and every answer failing, and this is the
    // one place an owner can find that out before a customer does.
    const validation = await admin.validateKey({ provider: connection.provider?.code, apiKey, model: readConnectionModel(connection) })
    await record(validation.validationCode)
  } catch (error) {
    // A refusal is recorded: "the stored key (or model) no longer works" is exactly
    // the evidence the readiness journey needs, and losing it would leave the step
    // reading COMPLETE from an older success. Unavailability is not recorded — it
    // says nothing about the key, and overwriting a good outcome with it would
    // demote a working key on a provider's bad minute.
    if (error?.code === 'MODEL_KEY_REJECTED' || error?.code === 'MODEL_NOT_FOUND') {
      await record(error.code)
      throw refusal(422, error.code)
    }
    throw asRefusal(error, 'MODEL_PROVIDER_UNAVAILABLE')
  }
  const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } })
  return { credential: credentialView(credential), provider: connection.provider?.code ?? null }
}

async function loadModelConnection(db, connectionId, viewer) {
  const id = typeof connectionId === 'string' ? connectionId.trim() : ''
  const connection = id
    ? await db.integrationConnection.findUnique({ where: { id }, include: { provider: true, credential: true } })
    : null
  if (!connection || connection.purpose !== MODEL_PROVIDER_PURPOSE || !connection.businessId
    || !ownsBusiness(viewer, connection.businessId) || !seesBusiness(viewer, connection.businessId)) {
    throw refusal(404, 'Connection not found')
  }
  assertDomainVisible(viewer, connection.businessId, 'line-oa')
  return connection
}
