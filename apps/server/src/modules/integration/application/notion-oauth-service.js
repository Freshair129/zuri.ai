// @req FR-273 — Business-scoped Notion OAuth uses single-use hashed state,
//   exchanges codes only with Notion's fixed endpoint and stores tokens through
//   SecretStorePort without returning them to the browser.
// @spec ADR-109 D1; SDD-108; SEC-037
// @tested tests/integration/notion-oauth-webhook.test.js
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { createIntegrationConnection, registerIntegrationProvider } from '@/platform/integrations/core/integration-registry'
import { storeValidatedCredential } from '@/platform/integrations/core/secret-store/credential-lifecycle'
import { requireWritableSecretStore } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { parseSecretBundle } from '@/platform/integrations/core/secret-store/secret-store-port'

export const NOTION_OAUTH_AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize'
export const NOTION_OAUTH_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
export const NOTION_API_VERSION = '2026-03-11'
export const NOTION_OAUTH_STATE_TTL_MS = 10 * 60_000
const NOTION_TOKEN_RESPONSE_LIMIT_BYTES = 16 * 1024

const zTokenResponse = z.object({
  access_token: z.string().min(1).max(4096).regex(/^[!-~]+$/),
  token_type: z.string().toLowerCase().refine((value) => value === 'bearer'),
  refresh_token: z.union([z.string().min(1).max(4096).regex(/^[!-~]+$/), z.null()]).optional(),
  workspace_id: z.string().uuid(),
  workspace_name: z.string().max(200).nullable().optional(),
}).transform((value) => ({
  accessToken: value.access_token,
  refreshToken: value.refresh_token ?? null,
  workspaceId: value.workspace_id,
  workspaceName: value.workspace_name?.trim() || null,
}))

function refuse(status, code) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

function callbackUri(env) {
  const redirectUri = typeof env.NOTION_REDIRECT_URI === 'string' ? env.NOTION_REDIRECT_URI.trim() : ''
  let redirect
  try { redirect = new URL(redirectUri) } catch { throw refuse(503, 'NOTION_OAUTH_NOT_CONFIGURED') }
  const localHttp = redirect.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)
  if (redirect.pathname !== '/oauth/notion/callback'
    || redirect.search || redirect.hash || redirect.username || redirect.password
    || (redirect.protocol !== 'https:' && !localHttp)) {
    throw refuse(503, 'NOTION_OAUTH_NOT_CONFIGURED')
  }
  return redirectUri
}

function oauthConfig(env) {
  const clientId = typeof env.NOTION_CLIENT_ID === 'string' ? env.NOTION_CLIENT_ID.trim() : ''
  const clientSecret = typeof env.NOTION_CLIENT_SECRET === 'string' ? env.NOTION_CLIENT_SECRET.trim() : ''
  const redirectUri = callbackUri(env)
  if (!/^[!-~]{1,200}$/.test(clientId)
    || !/^[!-~]{16,4096}$/.test(clientSecret)) {
    throw refuse(503, 'NOTION_OAUTH_NOT_CONFIGURED')
  }
  return { clientId, clientSecret, redirectUri }
}

function stateDigest(state) {
  return createHash('sha256').update(state, 'utf8').digest('hex')
}

async function loadOwnedBusiness(db, businessId, viewer) {
  if (typeof businessId !== 'string' || !businessId.trim() || businessId.length > 200) {
    throw refuse(400, 'NOTION_BUSINESS_REQUIRED')
  }
  const business = await db.business.findUnique({
    where: { id: businessId.trim() },
    select: { id: true, tenantId: true },
  })
  if (!business || !ownsBusiness(viewer, business.id)) throw refuse(404, 'NOTION_BUSINESS_NOT_FOUND')
  return business
}

/** Create a short-lived OAuth capability and return Notion's fixed authorization URL. */
export async function beginNotionOAuth({ businessId, viewer, db = prisma, env = process.env, guard, now = () => new Date() } = {}) {
  const config = oauthConfig(env)
  const business = await loadOwnedBusiness(db, businessId, viewer)
  if (!viewer?.principal?.id) throw refuse(401, 'AUTH_REQUIRED')
  if (typeof guard?.assertWriteAllowed !== 'function') throw refuse(503, 'NOTION_OAUTH_NOT_CONFIGURED')
  await guard.assertWriteAllowed({ viewer, businessId: business.id, action: 'NOTION_OAUTH_CONNECT' })

  const at = now()
  await db.notionOAuthState.deleteMany({ where: { expiresAt: { lte: at } } })
  const state = randomBytes(32).toString('base64url')
  await db.notionOAuthState.create({ data: {
    stateHash: stateDigest(state), tenantId: business.tenantId, businessId: business.id,
    actorId: viewer.principal.id, expiresAt: new Date(at.getTime() + NOTION_OAUTH_STATE_TTL_MS),
  } })

  const authorization = new URL(NOTION_OAUTH_AUTHORIZE_URL)
  authorization.searchParams.set('client_id', config.clientId)
  authorization.searchParams.set('redirect_uri', config.redirectUri)
  authorization.searchParams.set('response_type', 'code')
  authorization.searchParams.set('owner', 'user')
  authorization.searchParams.set('state', state)
  return authorization.toString()
}

async function readBoundedResponseText(response) {
  const declared = Number(response.headers?.get('content-length'))
  if (Number.isFinite(declared) && declared > NOTION_TOKEN_RESPONSE_LIMIT_BYTES) {
    throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text()
    if (Buffer.byteLength(text, 'utf8') > NOTION_TOKEN_RESPONSE_LIMIT_BYTES) {
      throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
    }
    return text
  }
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > NOTION_TOKEN_RESPONSE_LIMIT_BYTES) {
        await reader.cancel().catch(() => {})
        throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error?.status) throw error
    throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total))
  } catch {
    throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
  }
}

async function exchangeAuthorizationCode({ code, config, fetchImpl }) {
  let response
  try {
    response = await fetchImpl(NOTION_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_API_VERSION,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: config.redirectUri }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw refuse(503, 'NOTION_OAUTH_EXCHANGE_FAILED')
  }
  if (!response?.ok) throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
  let payload
  try {
    payload = JSON.parse(await readBoundedResponseText(response))
  } catch {
    throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
  }
  const parsed = zTokenResponse.safeParse(payload)
  if (!parsed.success) throw refuse(502, 'NOTION_OAUTH_EXCHANGE_FAILED')
  return parsed.data
}

async function findOrCreateConnection({ db, business, workspaceId, workspaceName }) {
  const connection = await db.$transaction(async (tx) => {
    const provider = await tx.integrationProvider.findUnique({ where: { code: 'NOTION' } })
      ?? await registerIntegrationProvider({ code: 'NOTION', name: 'Notion' }, { db: tx })
    const existing = await tx.integrationConnection.findFirst({
      where: { tenantId: business.tenantId, providerId: provider.id, externalAccountId: workspaceId },
      include: { credential: true },
    })
    if (existing) {
      if (existing.businessId !== business.id || existing.purpose !== 'NOTION') {
        throw refuse(409, 'NOTION_WORKSPACE_ALREADY_CONNECTED')
      }
      return { connection: existing, createdNew: false }
    }
    const created = await createIntegrationConnection({
      tenantId: business.tenantId,
      businessId: business.id,
      providerId: provider.id,
      name: workspaceName ? `Notion (${workspaceName})` : 'Notion workspace',
      authorizationType: 'SECRET_MANAGER',
      externalAccountId: workspaceId,
      purpose: 'NOTION',
      role: 'SECONDARY',
      status: 'DRAFT',
      metadata: { workspaceId, workspaceName },
    }, { db: tx })
    return { connection: created, createdNew: true }
  }, { timeout: 15000, maxWait: 5000 })
  return connection
}

/** Consume state, exchange the code, then activate a vault-backed Notion connection. */
export async function completeNotionOAuth({ code, state, providerError, viewer, db = prisma, env = process.env, guard, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const config = oauthConfig(env)
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw refuse(400, 'NOTION_OAUTH_STATE_INVALID')
  if (providerError === undefined && (typeof code !== 'string' || !/^[!-~]{1,2048}$/.test(code))) {
    throw refuse(400, 'NOTION_OAUTH_CODE_INVALID')
  }
  const row = await db.notionOAuthState.findUnique({ where: { stateHash: stateDigest(state) } })
  const at = now()
  if (!row || row.consumedAt || new Date(row.expiresAt).getTime() <= at.getTime()) throw refuse(400, 'NOTION_OAUTH_STATE_INVALID')
  if (!viewer?.principal?.id || viewer.principal.id !== row.actorId) throw refuse(403, 'NOTION_OAUTH_ACTOR_MISMATCH')
  const business = await loadOwnedBusiness(db, row.businessId, viewer)
  if (business.tenantId !== row.tenantId) throw refuse(400, 'NOTION_OAUTH_STATE_INVALID')
  if (typeof guard?.assertWriteAllowed !== 'function') throw refuse(503, 'NOTION_OAUTH_NOT_CONFIGURED')
  await guard.assertWriteAllowed({ viewer, businessId: business.id, action: 'NOTION_OAUTH_CONNECT' })

  const consumed = await db.notionOAuthState.updateMany({
    where: { id: row.id, actorId: viewer.principal.id, consumedAt: null, expiresAt: { gt: at } },
    data: { consumedAt: at, version: { increment: 1 } },
  })
  if (consumed.count !== 1) throw refuse(400, 'NOTION_OAUTH_STATE_INVALID')
  if (providerError !== undefined) throw refuse(400, 'NOTION_OAUTH_DENIED')

  const token = await exchangeAuthorizationCode({ code, config, fetchImpl })
  const store = requireWritableSecretStore(env, { db })
  const bundle = parseSecretBundle('NOTION_OAUTH_TOKEN', {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
  })
  let connection
  let created = false
  try {
    const result = await findOrCreateConnection({ db, business, workspaceId: token.workspaceId, workspaceName: token.workspaceName })
    connection = result.connection
    created = result.createdNew
    await storeValidatedCredential({
      store,
      tenantId: business.tenantId,
      businessId: business.id,
      connectionId: connection.id,
      kind: 'NOTION_OAUTH_TOKEN',
      bundle,
      validationCode: 'NOTION_OAUTH_EXCHANGED',
      actorPersonId: viewer.principal.id,
      createdVia: 'BROWSER_MFA',
      afterActivate: async (credential) => db.$transaction(async (tx) => {
        await tx.integrationConnection.update({
          where: { id: connection.id },
          data: {
            name: token.workspaceName ? `Notion (${token.workspaceName})` : 'Notion workspace',
            metadataJson: JSON.stringify({ workspaceId: token.workspaceId, workspaceName: token.workspaceName }),
            status: 'ACTIVE', role: 'SECONDARY', lastSuccessAt: at, version: { increment: 1 },
          },
        })
        await recordAudit(tx, {
          entityType: 'INTEGRATION_CREDENTIAL', entityId: connection.id,
          action: 'NOTION_OAUTH_CONNECTED', actorId: viewer.principal.id,
          tenantId: business.tenantId, businessId: business.id,
          payload: { connectionId: connection.id, workspaceId: token.workspaceId, credentialVersion: credential.versionNumber, secretStore: store.store },
        })
      }),
    })
  } catch (error) {
    if (created && connection) {
      const credential = await db.integrationCredential.findUnique({ where: { connectionId: connection.id } }).catch(() => null)
      if (!credential) await db.integrationConnection.deleteMany({ where: { id: connection.id, status: 'DRAFT' } }).catch(() => {})
    }
    if (error?.code === 'NOTION_WORKSPACE_ALREADY_CONNECTED') throw error
    if (error?.status) throw error
    throw refuse(503, 'NOTION_CREDENTIAL_STORE_FAILED')
  }
  return { connectionId: connection.id }
}

/** The trusted origin for stripping OAuth query parameters after the callback. */
export function notionIntegrationRedirect(env = process.env, status = 'error', reason = 'NOTION_OAUTH_FAILED') {
  const target = new URL('/platform/integrations', callbackUri(env))
  target.searchParams.set('notion', status)
  if (status === 'error') target.searchParams.set('reason', reason)
  return target.toString()
}
