import { z } from 'zod'
import prisma from '@/lib/db'
import { INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES } from '@/lib/validation/enums'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { fenceLineOaAccountForCredentialRevocation } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { claimChannelAccount, readChannelAccountClaim, resolveClaimRace } from '@/platform/integrations/core/channel-account-claim'
import { credentialAuditPayload, revokeCredential, storeValidatedCredential } from '@/platform/integrations/core/secret-store/credential-lifecycle'
import { createLineSecretManagerFromEnv, requireWritableSecretStore } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { parseSecretBundle } from '@/platform/integrations/core/secret-store/secret-store-port'
import { createLineChannelAdminPort, processLineChannelTokenCache } from '@/platform/integrations/providers/line/line-channel-admin-port'
import { LINE_CHANNEL_FIELDS, credentialView, parseCredentialInput, refusal } from './line-channel-connection-service'

// @req FR-223 — rotate, revoke and re-validate a LINE connection's credential
//   through the SecretStorePort: rotation keeps queued work flowing and never bumps
//   an epoch; revocation fences the account first and purges every version;
//   validation re-proves the stored pair with LINE and records the outcome.
// @req FR-224 — each one passes the write gate (AAL2 step-up and rate limits)
//   before LINE or the store is touched.
// @spec ADR-089 D2, D4, D5, D7; SEC-030; FR-072 (404-shaped refusals)
// @tested tests/integration/line-channel-credential-routes.test.js

const zRotate = z.object({ ...LINE_CHANNEL_FIELDS }).strict()
const zRevoke = z.object({
  reason: z.string().trim().min(1).max(200),
  confirmation: z.literal('REVOKE'),
}).strict()
const zValidate = z.object({}).strict()

async function loadLineConnection(db, connectionId, viewer) {
  const id = typeof connectionId === 'string' ? connectionId.trim() : ''
  const connection = id
    ? await db.integrationConnection.findUnique({ where: { id }, include: { provider: true, credential: true } })
    : null
  if (!connection || connection.provider?.code !== LINE_OA_PROVIDER_CODE || !connection.businessId
    || !ownsBusiness(viewer, connection.businessId) || !seesBusiness(viewer, connection.businessId)) {
    throw refusal(404, 'Connection not found')
  }
  assertDomainVisible(viewer, connection.businessId, 'line-oa')
  return connection
}

function scopeOf(connection) {
  return { tenantId: connection.tenantId, businessId: connection.businessId, connectionId: connection.id }
}

function asRefusal(error, fallback) {
  if (error?.status && typeof error?.message === 'string' && /^[A-Z][A-Z0-9_:]+$/.test(error.message)) {
    const answer = refusal(Number(error.status), error.message)
    if (Array.isArray(error.details)) answer.details = error.details
    if (Number.isInteger(error.retryAfterSeconds)) answer.retryAfterSeconds = error.retryAfterSeconds
    return answer
  }
  return refusal(503, fallback)
}

async function validateWithLine({ lineAdmin, bundle, ports, viewer, businessId }) {
  try {
    return await lineAdmin.validateChannel(bundle)
  } catch (error) {
    if ((error?.code === 'LINE_CREDENTIALS_REJECTED' || error?.code === 'LINE_TOKEN_REJECTED') && typeof ports.onValidationRejected === 'function') {
      await ports.onValidationRejected({ viewer, businessId })
    }
    throw asRefusal(error, 'LINE_UNAVAILABLE')
  }
}

/** POST /api/line-oa/connections/{id}/credential — rotate. */
export async function rotateLineChannelCredential(connectionId, input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  const data = parseCredentialInput(zRotate, input)
  const connection = await loadLineConnection(db, connectionId, viewer)
  if (typeof ports.assertWriteAllowed === 'function') await ports.assertWriteAllowed({ viewer, businessId: connection.businessId, action: 'ROTATE' })
  if (connection.status !== 'ACTIVE') throw refusal(409, 'LINE_CONNECTION_NOT_ACTIVE')

  const store = ports.store ?? requireWritableSecretStore(env, { db })
  const lineAdmin = ports.lineAdmin ?? createLineChannelAdminPort()
  const tokenCache = ports.tokenCache ?? processLineChannelTokenCache()
  const bundle = parseSecretBundle('LINE_CHANNEL', {
    channelId: data.channelId,
    channelSecret: data.channelSecret,
    ...(data.channelAccessToken === undefined ? {} : { channelAccessToken: data.channelAccessToken }),
  })
  const validation = await validateWithLine({ lineAdmin, bundle, ports, viewer, businessId: connection.businessId })
  // A valid pair for another bot is not a rotation of this one.
  if (validation.destination !== connection.externalAccountId) throw refusal(422, 'LINE_CHANNEL_MISMATCH')

  // A connection made before claims existed takes its claim now (FR-226).
  const claim = await readChannelAccountClaim(db, { externalAccountId: connection.externalAccountId })
  if (!claim) {
    try {
      await db.$transaction(tx => claimChannelAccount(tx, { externalAccountId: connection.externalAccountId, ...scopeOf(connection) }), { timeout: 15000, maxWait: 5000 })
    } catch (error) {
      throw error?.code === 'CHANNEL_CLAIM_RACE' ? await resolveClaimRace(db, { externalAccountId: connection.externalAccountId, tenantId: connection.tenantId }) : error
    }
  } else if (claim.connectionId !== connection.id) {
    throw refusal(409, claim.tenantId === connection.tenantId ? 'LINE_CHANNEL_ALREADY_CONNECTED' : 'LINE_CHANNEL_CLAIMED_ELSEWHERE')
  }

  const actorId = viewer?.principal?.id ?? null
  try {
    await storeValidatedCredential({
      store, ...scopeOf(connection), kind: 'LINE_CHANNEL', bundle, validationCode: validation.validationCode,
      actorPersonId: actorId, createdVia: 'BROWSER_MFA',
      onInvalidate: async () => tokenCache.invalidate(connection.id),
      afterActivate: async (result) => recordAudit(db, {
        entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id, action: 'CREDENTIAL_ROTATED',
        actorId, businessId: connection.businessId, tenantId: connection.tenantId,
        payload: credentialAuditPayload({
          businessId: connection.businessId, connectionId: connection.id, credentialVersion: result.versionNumber,
          secretStore: store.store, displayHint: bundle.channelId.slice(-4), validationCode: validation.validationCode,
          via: 'BROWSER_MFA', purgeFailedCount: result.purgeFailedCount,
        }),
      }),
    })
  } catch (error) {
    throw asRefusal(error, 'CHANNEL_SECRET_STORE_UNAVAILABLE')
  }
  const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } })
  return { credential: credentialView(credential), bot: validation.bot }
}

/** POST /api/line-oa/connections/{id}/credential/revoke */
export async function revokeLineChannelCredential(connectionId, input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  const data = parseCredentialInput(zRevoke, input)
  const connection = await loadLineConnection(db, connectionId, viewer)
  if (!connection.credential) throw refusal(404, 'CREDENTIAL_NOT_FOUND')
  if (typeof ports.assertWriteAllowed === 'function') await ports.assertWriteAllowed({ viewer, businessId: connection.businessId, action: 'REVOKE' })

  const store = ports.store ?? requireWritableSecretStore(env, { db })
  const tokenCache = ports.tokenCache ?? processLineChannelTokenCache()
  const fence = ports.fence ?? fenceLineOaAccountForCredentialRevocation
  const actorId = viewer?.principal?.id ?? null
  let result
  try {
    result = await revokeCredential({
      store, ...scopeOf(connection), reason: data.reason,
      fence: async (scope) => fence({ ...scope, actorId, db }),
      onInvalidate: async () => tokenCache.invalidate(connection.id),
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

/** POST /api/line-oa/connections/{id}/credential/validate — re-prove the stored credential with LINE. */
export async function validateLineChannelCredential(connectionId, input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  parseCredentialInput(zValidate, input ?? {})
  const connection = await loadLineConnection(db, connectionId, viewer)
  const current = connection.credential
  if (!current) throw refusal(404, 'CREDENTIAL_NOT_FOUND')
  if (typeof ports.assertWriteAllowed === 'function') await ports.assertWriteAllowed({ viewer, businessId: connection.businessId, action: 'VALIDATE' })
  if (!INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES.includes(current.status)) throw refusal(409, 'CREDENTIAL_REENTRY_REQUIRED')

  const lineAdmin = ports.lineAdmin ?? createLineChannelAdminPort()
  const secretManager = ports.secretManager ?? createLineSecretManagerFromEnv(env, { db })
  const account = await db.lineOaAccount.findUnique({ where: { integrationConnectionId: connection.id }, select: { id: true } })
  let material
  try {
    const resolved = await secretManager.resolve(current.secretRef, {
      ...scopeOf(connection), destination: connection.externalAccountId, accountId: account?.id ?? null,
    })
    material = JSON.parse(resolved.material)
  } catch {
    throw refusal(409, 'CREDENTIAL_REENTRY_REQUIRED')
  }

  const record = async (code) => {
    await db.integrationCredential.update({ where: { id: current.id }, data: { lastValidatedAt: new Date(), lastValidationCode: code } })
    await recordAudit(db, {
      entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id, action: 'CREDENTIAL_VALIDATED',
      actorId: viewer?.principal?.id ?? null, businessId: connection.businessId, tenantId: connection.tenantId,
      payload: credentialAuditPayload({ businessId: connection.businessId, connectionId: connection.id, credentialVersion: current.version, secretStore: current.secretStore, displayHint: current.displayHint, validationCode: code, via: 'BROWSER_MFA' }),
    })
  }

  let bot
  try {
    if (typeof material?.channelId === 'string') {
      bot = (await lineAdmin.validateChannel(parseSecretBundle('LINE_CHANNEL', material))).bot
    } else {
      // A mounted entry holds a long-lived token and no Channel ID (ADR-061 D8).
      bot = await lineAdmin.getBotInfo(material?.channelAccessToken)
    }
  } catch (error) {
    const answer = asRefusal(error, 'LINE_UNAVAILABLE')
    if (answer.message !== 'LINE_UNAVAILABLE') {
      await record(answer.message)
      if (typeof ports.onValidationRejected === 'function') await ports.onValidationRejected({ viewer, businessId: connection.businessId })
    }
    throw answer
  } finally {
    material = null
  }
  if (bot.destination !== connection.externalAccountId) {
    await record('LINE_CHANNEL_MISMATCH')
    throw refusal(422, 'LINE_CHANNEL_MISMATCH')
  }
  await record('LINE_OK')
  const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } })
  return {
    credential: credentialView(credential),
    bot: { basicId: bot.basicId, displayName: bot.displayName, pictureUrl: bot.pictureUrl, chatMode: bot.chatMode, markAsReadMode: bot.markAsReadMode },
  }
}
