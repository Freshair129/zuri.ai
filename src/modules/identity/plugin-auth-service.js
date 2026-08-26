import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { resolveViewer } from './resolve-viewer'

// @req FR-094 — plugin authorization is a separate public-client boundary;
// it never reuses the browser cookie or MCP continuation id.
// @spec ADR-045, SDD-052, SEC-018
// @tested tests/unit/fr094-plugin-auth-service.test.js

export const PLUGIN_AUTH_CODE_TTL_SECONDS = 60
export const PLUGIN_ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const DEFAULT_PLUGIN_POLICY_SNAPSHOT_ID = 'zuri-plugin-policy.v1'

const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
const INSTALLATION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{1,512}$/

export class PluginAuthError extends Error {
  constructor(code, status, message = code) {
    super(message)
    this.name = 'PluginAuthError'
    this.code = code
    this.status = status
  }
}

const invalidRequest = () => new PluginAuthError('INVALID_REQUEST', 400)
const invalidGrant = () => new PluginAuthError('INVALID_GRANT', 400)

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? Date.now())
  if (Number.isNaN(date.getTime())) throw new PluginAuthError('AUTH_UNAVAILABLE', 503)
  return date
}

function isSafeRedirectUri(value) {
  if (typeof value !== 'string' || !value || value.length > 2048) return false
  try {
    const uri = new URL(value)
    if (uri.hash) return false
    if (['javascript:', 'data:', 'file:'].includes(uri.protocol.toLowerCase())) return false
    if (!/^[a-z][a-z\d+.-]*:$/i.test(uri.protocol)) return false
    if ((uri.protocol === 'http:' || uri.protocol === 'https:') && !uri.host) return false
    return true
  } catch {
    return false
  }
}

function readRedirectUris(value) {
  if (typeof value !== 'string') return []
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

export function readPluginAuthConfig(env = process.env) {
  const clientId = typeof env.ZURI_PLUGIN_CLIENT_ID === 'string' ? env.ZURI_PLUGIN_CLIENT_ID.trim() : ''
  const redirectUris = readRedirectUris(env.ZURI_PLUGIN_REDIRECT_URIS)
  if (!clientId || !redirectUris.length || redirectUris.some((uri) => !isSafeRedirectUri(uri))) {
    throw new PluginAuthError('PLUGIN_AUTH_CONFIG_MISSING', 503)
  }

  return {
    clientId,
    redirectUris,
    policySnapshotId: typeof env.ZURI_PLUGIN_POLICY_SNAPSHOT_ID === 'string' && env.ZURI_PLUGIN_POLICY_SNAPSHOT_ID.trim()
      ? env.ZURI_PLUGIN_POLICY_SNAPSHOT_ID.trim()
      : DEFAULT_PLUGIN_POLICY_SNAPSHOT_ID,
  }
}

const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  code_challenge: z.string().regex(CODE_CHALLENGE_PATTERN),
  code_challenge_method: z.literal('S256'),
  state: z.string().min(16).max(512),
  installation_id: z.string().regex(INSTALLATION_PATTERN),
})

const tokenSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().regex(OPAQUE_PATTERN),
  client_id: z.string().min(1).max(128),
  redirect_uri: z.string().min(1).max(2048),
  code_verifier: z.string().regex(CODE_CHALLENGE_PATTERN),
  installation_id: z.string().regex(INSTALLATION_PATTERN),
})

function parseInput(schema, input) {
  const result = schema.safeParse(input)
  if (!result.success) throw invalidRequest()
  return result.data
}

function assertClientAndRedirect(input, config) {
  if (input.client_id !== config.clientId || !config.redirectUris.includes(input.redirect_uri)) {
    throw invalidRequest()
  }
  if (!isSafeRedirectUri(input.redirect_uri)) throw invalidRequest()
}

function hashOpaque(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function pkceChallenge(codeVerifier) {
  return createHash('sha256').update(codeVerifier, 'utf8').digest('base64url')
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function assertOpaqueToken(value) {
  if (typeof value !== 'string' || !OPAQUE_PATTERN.test(value)) throw new PluginAuthError('AUTH_REQUIRED', 401)
  return value
}

async function findOrCreateInstallation(tx, installationId, clientId, now) {
  const existing = await tx.pluginInstallation.findUnique({ where: { installationId } })
  if (existing) {
    if (existing.clientId !== clientId || existing.status !== 'ACTIVE') throw invalidRequest()
    return existing
  }

  return tx.pluginInstallation.create({
    data: {
      installationId,
      clientId,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
  })
}

export async function createPluginAuthorizationCode({
  db = prisma,
  principalId,
  input,
  env = process.env,
  now = new Date(),
} = {}) {
  if (typeof principalId !== 'string' || !principalId.trim()) throw new PluginAuthError('AUTH_REQUIRED', 401)
  const config = readPluginAuthConfig(env)
  const parsed = parseInput(authorizeSchema, input)
  assertClientAndRedirect(parsed, config)
  const issuedAt = asDate(now)
  if (typeof db.$transaction !== 'function') throw new PluginAuthError('AUTH_UNAVAILABLE', 503)

  const code = randomBytes(32).toString('base64url')
  const expiresAt = new Date(issuedAt.getTime() + PLUGIN_AUTH_CODE_TTL_SECONDS * 1000)
  await db.$transaction(async (tx) => {
    const installation = await findOrCreateInstallation(tx, parsed.installation_id, config.clientId, issuedAt)
    await tx.pluginAuthorizationCode.create({
      data: {
        codeHash: hashOpaque(code),
        clientId: config.clientId,
        redirectUri: parsed.redirect_uri,
        codeChallenge: parsed.code_challenge,
        codeChallengeMethod: parsed.code_challenge_method,
        pluginInstallationId: installation.id,
        personId: principalId,
        expiresAt,
        consumedAt: null,
        revokedAt: null,
        createdAt: issuedAt,
      },
    })
  })

  return { code, expiresAt: expiresAt.toISOString() }
}

async function readAuthorizationCode(db, code) {
  return db.pluginAuthorizationCode.findUnique({
    where: { codeHash: hashOpaque(code) },
    include: { pluginInstallation: true },
  })
}

function assertAuthorizationCode(codeRecord, input, config, now) {
  if (!codeRecord || !codeRecord.pluginInstallation) throw invalidGrant()
  if (
    codeRecord.clientId !== config.clientId ||
    codeRecord.clientId !== input.client_id ||
    codeRecord.redirectUri !== input.redirect_uri ||
    codeRecord.pluginInstallation.installationId !== input.installation_id ||
    codeRecord.pluginInstallation.clientId !== config.clientId ||
    codeRecord.pluginInstallation.status !== 'ACTIVE' ||
    codeRecord.codeChallengeMethod !== 'S256' ||
    codeRecord.consumedAt ||
    codeRecord.revokedAt ||
    asDate(codeRecord.expiresAt).getTime() <= now.getTime()
  ) {
    throw invalidGrant()
  }
}

export async function exchangePluginAuthorizationCode({
  db = prisma,
  input,
  env = process.env,
  now = new Date(),
} = {}) {
  const config = readPluginAuthConfig(env)
  const parsed = parseInput(tokenSchema, input)
  assertClientAndRedirect(parsed, config)
  const issuedAt = asDate(now)
  const codeRecord = await readAuthorizationCode(db, parsed.code)
  assertAuthorizationCode(codeRecord, parsed, config, issuedAt)

  if (!constantTimeEqual(codeRecord.codeChallenge, pkceChallenge(parsed.code_verifier))) {
    throw invalidGrant()
  }
  if (typeof db.$transaction !== 'function') throw new PluginAuthError('AUTH_UNAVAILABLE', 503)

  const accessToken = randomBytes(32).toString('base64url')
  const expiresAt = new Date(issuedAt.getTime() + PLUGIN_ACCESS_TOKEN_TTL_SECONDS * 1000)
  const session = await db.$transaction(async (tx) => {
    const consumed = await tx.pluginAuthorizationCode.updateMany({
      where: { id: codeRecord.id, consumedAt: null, revokedAt: null },
      data: { consumedAt: issuedAt },
    })
    if (consumed.count !== 1) throw invalidGrant()

    return tx.pluginSession.create({
      data: {
        tokenHash: hashOpaque(accessToken),
        clientId: config.clientId,
        pluginInstallationId: codeRecord.pluginInstallation.id,
        personId: codeRecord.personId,
        expiresAt,
        revokedAt: null,
        lastUsedAt: null,
        createdAt: issuedAt,
        updatedAt: issuedAt,
      },
    })
  })

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn: PLUGIN_ACCESS_TOKEN_TTL_SECONDS,
    expiresAt: expiresAt.toISOString(),
    sessionId: session.id,
    principalId: codeRecord.personId,
    installationId: codeRecord.pluginInstallation.installationId,
  }
}

async function readActivePluginSession({ db, token, expectedClientId, now }) {
  const session = await db.pluginSession.findUnique({
    where: { tokenHash: hashOpaque(assertOpaqueToken(token)) },
    include: { pluginInstallation: true },
  })
  if (
    !session ||
    session.clientId !== expectedClientId ||
    !session.pluginInstallation ||
    session.pluginInstallation.clientId !== expectedClientId ||
    session.pluginInstallation.status !== 'ACTIVE' ||
    session.revokedAt ||
    asDate(session.expiresAt).getTime() <= now.getTime()
  ) {
    throw new PluginAuthError('AUTH_REQUIRED', 401)
  }
  return session
}

const READ_CAPABILITIES = [
  'plan.preview',
  'pipeline.get',
  'connector.list',
  'connector.health',
]

const OWNER_WRITE_CAPABILITIES = [
  'plan.commit',
  'pipeline.start',
  'pipeline.cancel',
]

export async function getPluginCapabilities({
  db = prisma,
  token,
  env = process.env,
  now = new Date(),
  resolve,
  resolveViewer: injectedResolver,
} = {}) {
  const config = readPluginAuthConfig(env)
  const observedAt = asDate(now)
  const session = await readActivePluginSession({ db, token, expectedClientId: config.clientId, now: observedAt })
  if (typeof db.pluginSession.updateMany === 'function') {
    await db.pluginSession.updateMany({
      where: { tokenHash: session.tokenHash, revokedAt: null },
      data: { lastUsedAt: observedAt },
    })
  }

  const viewerResolver = resolve || injectedResolver || resolveViewer
  const viewer = await viewerResolver({ principalId: session.personId, db })
  const visibleBusinessIds = Array.isArray(viewer?.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  const ownedBusinessIds = Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds : []
  const capabilities = visibleBusinessIds.length
    ? READ_CAPABILITIES.map((capability) => ({ capability, access: 'read', requiresApproval: false }))
    : []

  if (ownedBusinessIds.length) {
    capabilities.push(...OWNER_WRITE_CAPABILITIES.map((capability) => ({
      capability,
      access: 'write',
      requiresApproval: true,
    })))
  }

  const sessionExpiresAt = asDate(session.expiresAt)
  const snapshotExpiresAt = new Date(observedAt.getTime() + 5 * 60 * 1000)
  const expiresAt = sessionExpiresAt < snapshotExpiresAt ? sessionExpiresAt : snapshotExpiresAt
  return {
    policy_snapshot_id: config.policySnapshotId,
    expires_at: expiresAt.toISOString(),
    capabilities,
  }
}

export async function revokePluginToken({ db = prisma, token, now = new Date() } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw invalidRequest()
  const revokedAt = asDate(now)
  await db.pluginSession.updateMany({
    where: { tokenHash: hashOpaque(token), revokedAt: null },
    data: { revokedAt },
  })
  return { revoked: true }
}
