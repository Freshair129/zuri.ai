import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createIntegrationConnection, registerIntegrationProvider, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { abandonChannelAccountClaim, claimChannelAccount, resolveClaimRace } from '@/platform/integrations/core/channel-account-claim'
import { credentialAuditPayload, storeValidatedCredential } from '@/platform/integrations/core/secret-store/credential-lifecycle'
import { requireWritableSecretStore } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import {
  LINE_CHANNEL_ACCESS_TOKEN_PATTERN,
  LINE_CHANNEL_ID_PATTERN,
  LINE_CHANNEL_SECRET_PATTERN,
  parseSecretBundle,
} from '@/platform/integrations/core/secret-store/secret-store-port'
import { createLineChannelAdminPort, processLineChannelTokenCache } from '@/platform/integrations/providers/line/line-channel-admin-port'

// @req FR-226 — connect a LINE channel from its Channel ID and secret: prove the pair
//   with LINE, take the installation-wide claim, then store the credential through
//   the vault — so a refused claim leaves no secret behind.
// @req FR-223 — the credential is written, validated and activated through the
//   SecretStorePort, with compensation when the connection cannot be completed.
// @spec ADR-089 D2, D3, D6, D7; SEC-030; FR-072 (404-shaped refusals)
// @tested tests/integration/channel-account-claim.test.js
//
// Order (ADR-089 D7, design §5.1) and why:
//   1. input, authority and the write gate — nothing leaves the building for a
//      caller who may not write (FR-224 supplies `assertWriteAllowed`);
//   2. the writable store must exist before LINE is asked anything;
//   3. live validation with LINE — a wrong Channel ID and a wrong secret are the
//      same 422, and nothing is stored;
//   4. the claim and the connection, in one transaction;
//   5. write + activate the credential; if that fails the claim and connection are
//      removed again, and a purge that fails leaves the connection DISABLED with its
//      REVOKED version for a reconciler.
//
// The response carries connection, masked credential and bot metadata only.
// A request body is refused with one generic 400 that quotes no field.

/** The write-only fields a LINE credential request may carry (ADR-089 D3). */
export const LINE_CHANNEL_FIELDS = Object.freeze({
  channelId: z.string().regex(LINE_CHANNEL_ID_PATTERN),
  channelSecret: z.string().regex(LINE_CHANNEL_SECRET_PATTERN),
  channelAccessToken: z.string().regex(LINE_CHANNEL_ACCESS_TOKEN_PATTERN).optional(),
})

const zConnect = z.object({
  businessId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  ...LINE_CHANNEL_FIELDS,
}).strict()

export function refusal(status, code) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

/** The one 400 a credential request body gets: no issue list, no field, no value. */
export function parseCredentialInput(schema, input) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw refusal(400, 'CREDENTIAL_INPUT_INVALID')
  return parsed.data
}

export function credentialView(credential) {
  return {
    status: credential.status,
    version: credential.version,
    secretStore: credential.secretStore,
    displayHint: credential.displayHint,
    lastValidatedAt: credential.lastValidatedAt,
    expiresAt: credential.expiresAt,
  }
}

async function removeUnfinishedConnection(db, connectionId, { keepForReconciler }) {
  await db.$transaction(async tx => {
    await abandonChannelAccountClaim(tx, { connectionId })
    if (keepForReconciler) {
      await tx.integrationConnection.update({ where: { id: connectionId }, data: { status: 'DISABLED', version: { increment: 1 } } })
    } else {
      await tx.integrationConnection.deleteMany({ where: { id: connectionId } })
    }
  }, { timeout: 15000, maxWait: 5000 })
}

/**
 * @param {object} input  { businessId, name, channelId, channelSecret, channelAccessToken? }
 * @param {object} ctx    { viewer, db, env, ports: { store, lineAdmin, assertWriteAllowed, onValidationRejected, tokenCache } }
 */
export async function connectLineChannelWithSecret(input, { viewer, db = prisma, env = process.env, ports = {} } = {}) {
  const data = parseCredentialInput(zConnect, input)
  if (!ownsBusiness(viewer, data.businessId) || !seesBusiness(viewer, data.businessId)) throw refusal(404, 'Business not found')
  assertDomainVisible(viewer, data.businessId, 'line-oa')
  if (typeof ports.assertWriteAllowed === 'function') await ports.assertWriteAllowed({ viewer, businessId: data.businessId, action: 'CONNECT' })

  const store = ports.store ?? requireWritableSecretStore(env, { db })
  const lineAdmin = ports.lineAdmin ?? createLineChannelAdminPort()
  const tokenCache = ports.tokenCache ?? processLineChannelTokenCache()
  const bundle = parseSecretBundle('LINE_CHANNEL', {
    channelId: data.channelId,
    channelSecret: data.channelSecret,
    ...(data.channelAccessToken === undefined ? {} : { channelAccessToken: data.channelAccessToken }),
  })

  let validation
  try {
    validation = await lineAdmin.validateChannel(bundle)
  } catch (error) {
    if ((error?.code === 'LINE_CREDENTIALS_REJECTED' || error?.code === 'LINE_TOKEN_REJECTED') && typeof ports.onValidationRejected === 'function') {
      await ports.onValidationRejected({ viewer, businessId: data.businessId })
    }
    throw refusal(Number(error?.status) || 503, typeof error?.code === 'string' ? error.code : 'LINE_UNAVAILABLE')
  }

  const business = await db.business.findUnique({ where: { id: data.businessId }, select: { id: true, tenantId: true } })
  if (!business) throw refusal(404, 'Business not found')
  const actorId = viewer?.principal?.id ?? null

  let connection
  try {
    connection = await db.$transaction(async tx => {
      const provider = await tx.integrationProvider.findUnique({ where: { code: LINE_OA_PROVIDER_CODE } })
        ?? await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' }, { db: tx })
      const created = await createIntegrationConnection({
        tenantId: business.tenantId, businessId: business.id, providerId: provider.id, name: data.name,
        externalAccountId: validation.destination, status: 'ACTIVE', authorizationType: 'SECRET_MANAGER',
        metadata: { basicId: validation.bot.basicId, displayName: validation.bot.displayName },
      }, { db: tx })
      await claimChannelAccount(tx, {
        provider: LINE_OA_PROVIDER_CODE, externalAccountId: validation.destination,
        tenantId: business.tenantId, businessId: business.id, connectionId: created.id,
      })
      return created
    }, { timeout: 15000, maxWait: 5000 })
  } catch (error) {
    let answer = error
    if (error?.code === 'CHANNEL_CLAIM_RACE') {
      answer = await resolveClaimRace(db, { provider: LINE_OA_PROVIDER_CODE, externalAccountId: validation.destination, tenantId: business.tenantId })
    } else if (error?.name === 'PrismaClientKnownRequestError' && error?.code === 'P2002') {
      // IntegrationConnection is unique per Tenant: this Tenant already has the bot.
      answer = await resolveClaimRace(db, { provider: LINE_OA_PROVIDER_CODE, externalAccountId: validation.destination, tenantId: business.tenantId })
      if (answer.code !== 'LINE_CHANNEL_ALREADY_CONNECTED') answer = refusal(409, 'LINE_CHANNEL_ALREADY_CONNECTED')
    }
    // Name the sibling only to a viewer who may see its Business (FR-226).
    if (answer?.code === 'LINE_CHANNEL_ALREADY_CONNECTED' && answer.claim && seesBusiness(viewer, answer.claim.businessId) && Array.isArray(answer.details)) {
      answer.details = [{ ...answer.details[0], businessId: answer.claim.businessId, connectionId: answer.claim.connectionId }]
    }
    throw answer
  }

  const scope = { tenantId: business.tenantId, businessId: business.id, connectionId: connection.id }
  let compensation = null
  try {
    await storeValidatedCredential({
      store, ...scope, kind: 'LINE_CHANNEL', bundle, validationCode: validation.validationCode,
      actorPersonId: actorId, createdVia: 'BROWSER_MFA',
      onInvalidate: async () => tokenCache.invalidate(connection.id),
      onCompensation: async (outcome) => { compensation = outcome },
      afterActivate: async (result) => recordAudit(db, {
        entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id, action: 'CREDENTIAL_WRITTEN',
        actorId, businessId: business.id, tenantId: business.tenantId,
        payload: credentialAuditPayload({
          businessId: business.id, connectionId: connection.id, credentialVersion: result.versionNumber,
          secretStore: store.store, displayHint: bundle.channelId.slice(-4), validationCode: validation.validationCode, via: 'BROWSER_MFA',
        }),
      }),
    })
  } catch (error) {
    const keepForReconciler = compensation?.outcome === 'CREDENTIAL_ORPHAN_PURGE_FAILED'
    await removeUnfinishedConnection(db, connection.id, { keepForReconciler }).catch(() => {})
    if (compensation) {
      await recordAudit(db, {
        entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id, action: compensation.outcome,
        actorId, businessId: business.id, tenantId: business.tenantId,
        payload: credentialAuditPayload({ businessId: business.id, connectionId: connection.id, credentialVersion: compensation.versionNumber, secretStore: store.store, outcome: compensation.outcome, purgedCount: compensation.purgedCount, purgeFailedCount: compensation.purgeFailedCount }),
      }).catch(() => {})
    }
    throw refusal(Number(error?.status) || 503, typeof error?.code === 'string' ? error.code : 'CHANNEL_SECRET_STORE_UNAVAILABLE')
  }

  const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } })
  return {
    connection: { id: connection.id, businessId: business.id, name: connection.name, destination: connection.externalAccountId, status: connection.status },
    credential: credentialView(credential),
    bot: {
      basicId: validation.bot.basicId,
      displayName: validation.bot.displayName,
      pictureUrl: validation.bot.pictureUrl,
      chatMode: validation.bot.chatMode,
      markAsReadMode: validation.bot.markAsReadMode,
    },
    claim: { status: 'CLAIMED' },
  }
}
