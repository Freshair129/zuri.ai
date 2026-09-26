// @req FR-274 — bound Notion webhook ingress to an encrypted one-time challenge,
//   HMAC over exact bounded request bytes and minimal idempotent receipts.
// @spec ADR-109 D2, D3; SDD-109; SEC-037
// @tested tests/integration/notion-oauth-webhook.test.js
import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { createCredentialWriteGuard } from '@/modules/identity/credential-write-gate'
import { openSecretEnvelope, sealSecretEnvelope } from '@/platform/integrations/core/secret-store/envelope-secret-store'

export const NOTION_WEBHOOK_BODY_LIMIT_BYTES = 1024 * 1024
export const NOTION_WEBHOOK_TOKEN_ID = 'NOTION_WEBHOOK_VERIFICATION_TOKEN'
const ENVELOPE_SCOPE = Object.freeze({ tenantId: 'notion-system', businessId: null, connectionId: 'notion-webhook-verification', versionNumber: 1 })
const zChallenge = z.object({ verification_token: z.string().min(1).max(4096).regex(/^[!-~]+$/) }).strict()
const zEvent = z.object({
  id: z.string().uuid(),
  type: z.string().min(1).max(100),
  workspace_id: z.string().uuid(),
  timestamp: z.string().datetime({ offset: true }),
})

function refuse(status, code) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

async function readBoundedBody(request, maxBytes = NOTION_WEBHOOK_BODY_LIMIT_BYTES) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw refuse(413, 'NOTION_WEBHOOK_BODY_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw refuse(400, 'NOTION_WEBHOOK_BODY_INVALID')
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw refuse(413, 'NOTION_WEBHOOK_BODY_TOO_LARGE')
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error?.status) throw error
    throw refuse(400, 'NOTION_WEBHOOK_BODY_INVALID')
  }
  return Buffer.concat(chunks, total)
}

function parseJson(raw) {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch {
    throw refuse(400, 'NOTION_WEBHOOK_JSON_INVALID')
  }
}

function sealVerificationToken(token, env) {
  return sealSecretEnvelope({
    id: NOTION_WEBHOOK_TOKEN_ID,
    ...ENVELOPE_SCOPE,
    plaintext: token,
  }, env)
}

function openVerificationToken(row, env) {
  return openSecretEnvelope(row, ENVELOPE_SCOPE, env)
}

function sameToken(leftToken, rightToken) {
  const left = Buffer.from(leftToken, 'utf8')
  const right = Buffer.from(rightToken, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

async function receiveChallenge({ token, db, env, now }) {
  const sealed = sealVerificationToken(token, env)
  try {
    await db.notionWebhookVerificationToken.create({
      data: {
        id: NOTION_WEBHOOK_TOKEN_ID,
        kekId: sealed.kekId,
        wrappedDek: sealed.wrappedDek,
        iv: sealed.iv,
        tag: sealed.tag,
        ciphertext: sealed.ciphertext,
        createdAt: now(),
      },
    })
    return { received: true, challengeAccepted: true }
  } catch (error) {
    // Notion may retry the same verification request after a lost response. A
    // matching encrypted token is safe to acknowledge; a competing token cannot
    // overwrite the first one.
    if (error?.code !== 'P2002') throw refuse(503, 'NOTION_WEBHOOK_SETUP_UNAVAILABLE')
    const current = await db.notionWebhookVerificationToken.findUnique({ where: { id: NOTION_WEBHOOK_TOKEN_ID } })
    if (!current) throw refuse(503, 'NOTION_WEBHOOK_SETUP_UNAVAILABLE')
    const stored = openVerificationToken(current, env)
    if (!sameToken(stored, token)) throw refuse(409, 'NOTION_WEBHOOK_TOKEN_ALREADY_CONFIGURED')
    return { received: true, challengeAccepted: true }
  }
}

function signatureMatches(raw, signature, token) {
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', token).update(raw).digest()
  const provided = Buffer.from(signature.slice('sha256='.length), 'hex')
  return provided.length === expected.length && timingSafeEqual(expected, provided)
}

/** Receive Notion's initial challenge or a signed event; payload data is discarded. */
export async function receiveNotionWebhook(request, { db = prisma, env = process.env, now = () => new Date() } = {}) {
  const contentType = (request.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw refuse(415, 'NOTION_WEBHOOK_CONTENT_TYPE_INVALID')
  const raw = await readBoundedBody(request)
  const configured = await db.notionWebhookVerificationToken.findUnique({ where: { id: NOTION_WEBHOOK_TOKEN_ID } })

  if (!configured) {
    const parsed = zChallenge.safeParse(parseJson(raw))
    if (!parsed.success) throw refuse(401, 'NOTION_WEBHOOK_VERIFICATION_REQUIRED')
    try {
      return await receiveChallenge({ token: parsed.data.verification_token, db, env, now })
    } catch (error) {
      if (error?.status) throw error
      throw refuse(503, 'NOTION_WEBHOOK_SETUP_UNAVAILABLE')
    }
  }

  let verificationToken
  try {
    verificationToken = openVerificationToken(configured, env)
  } catch {
    throw refuse(503, 'NOTION_WEBHOOK_VERIFICATION_UNAVAILABLE')
  }
  // Notion can retry its unsigned setup challenge if the first response was
  // lost. A retry is acknowledged only when it proves possession of the exact
  // token already pinned; it cannot replace that token.
  let challengeBody
  try { challengeBody = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)) } catch { /* handled by the signed event path */ }
  const challenge = zChallenge.safeParse(challengeBody)
  if (challenge.success) {
    if (!sameToken(challenge.data.verification_token, verificationToken)) {
      throw refuse(409, 'NOTION_WEBHOOK_TOKEN_ALREADY_CONFIGURED')
    }
    return { received: true, challengeAccepted: true }
  }
  if (!signatureMatches(raw, request.headers.get('x-notion-signature'), verificationToken)) {
    throw refuse(401, 'NOTION_WEBHOOK_SIGNATURE_INVALID')
  }

  const parsed = zEvent.safeParse(parseJson(raw))
  if (!parsed.success) throw refuse(400, 'NOTION_WEBHOOK_EVENT_INVALID')
  const event = parsed.data
  try {
    await db.notionWebhookReceipt.create({
      data: {
        eventId: event.id,
        eventType: event.type,
        workspaceId: event.workspace_id,
        occurredAt: new Date(event.timestamp),
        receivedAt: now(),
      },
    })
    return { received: true, duplicate: false }
  } catch (error) {
    if (error?.code === 'P2002') return { received: true, duplicate: true }
    throw refuse(503, 'NOTION_WEBHOOK_RECEIPT_UNAVAILABLE')
  }
}

function requireInstallationOperator(viewer) {
  if (!isInstallationOperator(viewer)) throw refuse(403, 'INSTALLATION_OPERATOR_REQUIRED')
  if (!viewer?.principal?.id) throw refuse(401, 'AUTH_REQUIRED')
}

/** Decrypt and atomically consume the sole permitted reveal. */
export async function revealNotionWebhookVerificationToken({ viewer, request, db = prisma, env = process.env, guard = null } = {}) {
  requireInstallationOperator(viewer)
  const writeGuard = guard ?? createCredentialWriteGuard({ request, db, env: {} })
  await writeGuard.assertWriteAllowed({ viewer, businessId: null, action: 'NOTION_WEBHOOK_REVEAL' })
  return db.$transaction(async (tx) => {
    const row = await tx.notionWebhookVerificationToken.findUnique({ where: { id: NOTION_WEBHOOK_TOKEN_ID } })
    if (!row) throw refuse(404, 'NOTION_WEBHOOK_TOKEN_NOT_AVAILABLE')
    if (row.revealedAt) throw refuse(409, 'NOTION_WEBHOOK_TOKEN_ALREADY_REVEALED')
    let verificationToken
    try {
      verificationToken = openVerificationToken(row, env)
    } catch {
      throw refuse(503, 'NOTION_WEBHOOK_VERIFICATION_UNAVAILABLE')
    }
    const at = new Date()
    const claimed = await tx.notionWebhookVerificationToken.updateMany({
      where: { id: NOTION_WEBHOOK_TOKEN_ID, revealedAt: null },
      data: { revealedAt: at, version: { increment: 1 } },
    })
    if (claimed.count !== 1) throw refuse(409, 'NOTION_WEBHOOK_TOKEN_ALREADY_REVEALED')
    await recordAudit(tx, {
      entityType: 'NOTION_WEBHOOK_VERIFICATION', entityId: NOTION_WEBHOOK_TOKEN_ID,
      action: 'TOKEN_REVEALED_ONCE', actorId: viewer.principal.id,
      payload: { outcome: 'REVEALED' },
    })
    return { verificationToken }
  }, { timeout: 15000, maxWait: 5000 })
}

/** Reset app-level verification material before an operator recreates a subscription. */
export async function resetNotionWebhookVerificationToken({ viewer, request, db = prisma, guard = null } = {}) {
  requireInstallationOperator(viewer)
  const writeGuard = guard ?? createCredentialWriteGuard({ request, db, env: {} })
  await writeGuard.assertWriteAllowed({ viewer, businessId: null, action: 'NOTION_WEBHOOK_RESET' })
  return db.$transaction(async (tx) => {
    const deleted = await tx.notionWebhookVerificationToken.deleteMany({ where: { id: NOTION_WEBHOOK_TOKEN_ID } })
    await recordAudit(tx, {
      entityType: 'NOTION_WEBHOOK_VERIFICATION', entityId: NOTION_WEBHOOK_TOKEN_ID,
      action: 'TOKEN_RESET', actorId: viewer.principal.id,
      payload: { existed: deleted.count === 1 },
    })
    return { reset: true, hadConfiguredToken: deleted.count === 1 }
  }, { timeout: 15000, maxWait: 5000 })
}
