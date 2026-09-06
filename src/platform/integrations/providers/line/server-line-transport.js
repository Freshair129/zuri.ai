import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { LINE_OA_ACCOUNT_STATUSES } from '@/lib/validation/enums'
import { createSecretManagerPort } from '../../core/secret-manager'

// @req FR-149 — account-scoped native ingress and server-owned LINE send port.
// @spec ADR-061, SEC-001, SEC-016 — exact account scope, opaque secrets and
// provider acceptance rather than an unsupported delivery/read claim.
// @tested tests/unit/platform/server-line-transport.test.js

const PUSH_URL = 'https://api.line.me/v2/bot/message/push'
const REPLY_URL = 'https://api.line.me/v2/bot/message/reply'
const zSecret = z.object({
  channelSecret: z.string().min(1).max(4096).refine((value) => value.trim() === value),
  channelAccessToken: z.string().min(1).max(8192).refine((value) => !/\s/.test(value)),
}).strict()
const zWebhook = z.object({
  destination: z.string().min(1),
  events: z.array(z.object({ type: z.string().min(1) }).passthrough()).max(1000),
}).passthrough()
const zPush = z.object({
  to: z.string().min(1).max(200),
  messages: z.array(z.object({ type: z.literal('text'), text: z.string().min(1).max(5000) }).strict()).min(1).max(5),
}).strict()
const zRetryKey = z.string().uuid()
const zMountedEntry = z.object({
  secretRef: z.string().regex(/^deployment-secret:[A-Za-z0-9_-]+$/),
  tenantId: z.string().min(1),
  businessId: z.string().min(1),
  accountId: z.string().min(1),
  connectionId: z.string().min(1),
  destination: z.string().min(1),
  version: z.string().min(1),
  expiresAt: z.string().datetime({ offset: true }),
  channelSecret: zSecret.shape.channelSecret,
  channelAccessToken: zSecret.shape.channelAccessToken,
}).strict()
const zMountedFile = z.object({ version: z.literal(1), entries: z.array(zMountedEntry) }).strict()

function failure(code, status = 503) {
  const error = new Error(code)
  error.code = code
  error.status = status
  return error
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function unexpired(value, now) {
  if (value == null) return true
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > now.getTime()
}

/** Operator-mounted production secrets, separate from the developer file vault.
 * The mount must live outside the checkout. Every resolution re-reads it so a
 * rotated/revoked credential cannot survive in an unbounded process cache.
 */
export function createServerLineSecretManagerFromEnv(env = process.env, {
  readFileFn = readFile,
  cwd = process.cwd(),
  now = () => new Date(),
} = {}) {
  const file = env.ZURI_LINE_SECRET_FILE
  if (!present(file) || !path.isAbsolute(file)) throw failure('LINE_SECRET_MOUNT_NOT_CONFIGURED')
  const relative = path.relative(path.resolve(cwd), path.resolve(file))
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw failure('LINE_SECRET_MOUNT_MUST_BE_OUTSIDE_CHECKOUT')
  }
  return {
    runtimeSource: 'PRODUCTION_LINE',
    async resolve(secretRef, scope) {
      const port = createSecretManagerPort({
        runtimeSource: 'PRODUCTION_LINE', now,
        adapter: {
          kind: 'deployment-secret-mount',
          async resolve(ref, { tenantId, businessId }) {
            let config
            try {
              config = zMountedFile.parse(JSON.parse(await readFileFn(file, 'utf8')))
            } catch {
              throw failure('LINE_SECRET_MOUNT_UNAVAILABLE')
            }
            const matches = config.entries.filter((entry) => entry.secretRef === ref)
            if (matches.length !== 1) throw failure('LINE_SECRET_MOUNT_UNAVAILABLE')
            const entry = matches[0]
            if (entry.tenantId !== tenantId || entry.businessId !== businessId
              || entry.accountId !== scope?.accountId || entry.connectionId !== scope?.connectionId
              || entry.destination !== scope?.destination) throw failure('LINE_SECRET_MOUNT_UNAVAILABLE')
            return {
              material: JSON.stringify({ channelSecret: entry.channelSecret, channelAccessToken: entry.channelAccessToken }),
              version: entry.version, expiresAt: entry.expiresAt,
            }
          },
        },
      })
      return port.resolve(secretRef, scope)
    },
  }
}

/** Resolve by server-owned account id; never trust the webhook's scope fields. */
export async function resolveServerLineAccount({
  accountId,
  db,
  secretManager,
  runtimeSource = 'PRODUCTION_LINE',
  now = new Date(),
  requireEnabled = true,
} = {}) {
  if (!present(accountId)) throw failure('LINE_ACCOUNT_NOT_AVAILABLE', 404)
  const row = await db.lineOaAccount.findUnique({
    where: { id: accountId },
    include: { connection: { include: { provider: true, credential: true } } },
  })
  const connection = row?.connection
  const credential = connection?.credential
  if (!row || !connection || row.archivedAt || !(requireEnabled ? ['CONNECTED'] : LINE_OA_ACCOUNT_STATUSES.filter(status => status !== 'ARCHIVED')).includes(row.status)
    || row.transportMode !== 'CLOUD' || (requireEnabled && row.serverEnabled !== true)
    || !present(row.tenantId) || !present(row.businessId)
    || connection?.id !== row.integrationConnectionId
    || connection.tenantId !== row.tenantId || connection.businessId !== row.businessId
    || connection.status !== 'ACTIVE' || connection.authorizationType !== 'SECRET_MANAGER'
    || connection.provider?.code !== 'LINE_OA' || connection.provider.status !== 'ACTIVE'
    || !present(connection.externalAccountId)) {
    throw failure('LINE_ACCOUNT_NOT_AVAILABLE', 404)
  }
  if (credential?.connectionId !== connection.id || credential.status !== 'ACTIVE'
    || !present(credential.secretRef) || !unexpired(credential.expiresAt, now)
    || !unexpired(credential.accessTokenExpiresAt, now)) {
    throw failure('LINE_ACCOUNT_CREDENTIAL_UNAVAILABLE')
  }
  if (typeof secretManager?.resolve !== 'function'
    || secretManager.runtimeSource !== runtimeSource
    || !['PRODUCTION_LINE', 'LOCAL_DEV', 'TEST', 'EVAL'].includes(runtimeSource)) {
    throw failure('LINE_SECRET_MANAGER_NOT_CONFIGURED')
  }

  let secrets
  try {
    const resolved = await secretManager.resolve(credential.secretRef, {
      tenantId: row.tenantId, businessId: row.businessId,
      accountId: row.id, connectionId: connection.id, destination: connection.externalAccountId,
    })
    secrets = zSecret.parse(JSON.parse(resolved.material))
  } catch {
    // Vault, JSON and schema exceptions may contain material. Do not retain cause.
    throw failure('LINE_ACCOUNT_CREDENTIAL_UNAVAILABLE')
  }
  const account = {
    id: row.id,
    channelAccountId: row.bindingCode || row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    connectionId: connection.id,
    destination: connection.externalAccountId,
    version: row.version,
    transportMode: row.transportMode,
    executionMode: row.executionMode ?? 'SERVER',
    modelAccess: row.modelAccess,
    transportEpoch: row.transportEpoch,
    serverEnabled: row.serverEnabled,
    allowDelayedPush: row.allowDelayedPush === true,
  }
  Object.defineProperties(account, {
    channelSecret: { value: secrets.channelSecret, enumerable: false },
    channelAccessToken: { value: secrets.channelAccessToken, enumerable: false },
  })
  return Object.freeze(account)
}

/** Raw bytes are authenticated before parsing, including LINE's empty-event probe. */
export function verifyServerLineWebhook({ rawBody, signature, account } = {}) {
  if (!(rawBody instanceof Uint8Array) || !present(account?.channelSecret)) {
    throw failure('LINE_WEBHOOK_REQUEST_INVALID', 400)
  }
  const expected = createHmac('sha256', account.channelSecret).update(rawBody).digest('base64')
  const actual = Buffer.from(typeof signature === 'string' ? signature : '', 'utf8')
  const calculated = Buffer.from(expected, 'utf8')
  if (actual.length !== calculated.length || !timingSafeEqual(actual, calculated)) {
    throw failure('LINE_WEBHOOK_SIGNATURE_INVALID', 401)
  }
  let body
  try {
    body = zWebhook.parse(JSON.parse(Buffer.from(rawBody).toString('utf8')))
  } catch {
    throw failure('LINE_WEBHOOK_PAYLOAD_INVALID', 400)
  }
  if (body.destination !== account.destination) throw failure('LINE_WEBHOOK_DESTINATION_MISMATCH', 403)
  // The job owner may seal the token separately for short-lived Reply API use.
  // Ordinary JSON serialization, raw evidence and compute inputs omit it.
  return {
    ...body,
    events: body.events.map(({ replyToken, ...event }) => {
      if (typeof replyToken === 'string') Object.defineProperty(event, 'replyToken', { value: replyToken, enumerable: false })
      return event
    }),
  }
}

/** Reply tokens have no retry-key support: ambiguous attempts are never retried. */
export function createServerLineReplyTransport({ fetchFn = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchFn !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw failure('LINE_TRANSPORT_CONFIGURATION_INVALID')
  }
  return {
    async send({ account, replyToken, messages } = {}) {
      let body
      try {
        const validated = zPush.shape.messages.parse(messages)
        if (!present(replyToken) || !present(account?.channelAccessToken) || /\s/.test(account.channelAccessToken)) throw new Error('invalid')
        body = JSON.stringify({ replyToken, messages: validated })
      } catch {
        throw failure('LINE_SEND_INPUT_INVALID', 400)
      }
      const controller = new AbortController()
      let timer
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(failure('LINE_SEND_TIMEOUT'))
          }, timeoutMs)
        })
        const response = await Promise.race([
          fetchFn(REPLY_URL, {
            method: 'POST', redirect: 'error',
            headers: { Authorization: `Bearer ${account.channelAccessToken}`, 'Content-Type': 'application/json' },
            body, signal: controller.signal,
          }),
          timeout,
        ])
        const httpStatus = response.status
        if (httpStatus >= 200 && httpStatus < 300) {
          return { status: 'ACCEPTED_BY_LINE', httpStatus, requestId: requestId(response, 'x-line-request-id'), code: null }
        }
        return {
          status: httpStatus >= 500 && httpStatus <= 599 ? 'UNKNOWN' : 'PERMANENT_FAILURE',
          httpStatus, requestId: requestId(response, 'x-line-request-id'),
          code: `LINE_HTTP_${Number.isInteger(httpStatus) ? httpStatus : 'INVALID'}`,
        }
      } catch {
        return { status: 'UNKNOWN', httpStatus: null, requestId: null, code: 'LINE_NETWORK_UNAVAILABLE' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

function requestId(response, header) {
  const value = response?.headers?.get?.(header)
  // Keep only a short opaque id. Provider error bodies are never read or exposed.
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null
}

/** One attempt only. The durable job owns payload, UUID, retry horizon and backoff. */
export function createServerLinePushTransport({ fetchFn = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchFn !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw failure('LINE_TRANSPORT_CONFIGURATION_INVALID')
  }
  return {
    async send({ account, to, messages, retryKey } = {}) {
      let body
      try {
        zRetryKey.parse(retryKey)
        body = JSON.stringify(zPush.parse({ to, messages }))
        if (!present(account?.channelAccessToken) || /\s/.test(account.channelAccessToken)) throw new Error('invalid')
      } catch {
        throw failure('LINE_SEND_INPUT_INVALID', 400)
      }
      // Snapshot before awaiting: caller mutation cannot alter this attempt.
      const controller = new AbortController()
      let timer
      try {
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(failure('LINE_SEND_TIMEOUT'))
          }, timeoutMs)
        })
        const response = await Promise.race([
          fetchFn(PUSH_URL, {
            method: 'POST',
            redirect: 'error',
            headers: {
              Authorization: `Bearer ${account.channelAccessToken}`,
              'Content-Type': 'application/json',
              'X-Line-Retry-Key': retryKey,
            },
            body,
            signal: controller.signal,
          }),
          timeout,
        ])
        const httpStatus = response.status
        const acceptedRequestId = requestId(response, 'x-line-accepted-request-id')
        const currentRequestId = requestId(response, 'x-line-request-id')
        if ((httpStatus >= 200 && httpStatus < 300) || (httpStatus === 409 && acceptedRequestId)) {
          return { status: 'ACCEPTED_BY_LINE', httpStatus, requestId: acceptedRequestId ?? currentRequestId, code: null }
        }
        return {
          status: httpStatus >= 500 && httpStatus <= 599 ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE',
          httpStatus,
          requestId: currentRequestId,
          code: `LINE_HTTP_${Number.isInteger(httpStatus) ? httpStatus : 'INVALID'}`,
        }
      } catch {
        // A timeout is ambiguous: LINE may already have accepted the request.
        // Retrying is safe only with this same UUID and immutable body < 24h.
        return { status: 'RETRYABLE_FAILURE', httpStatus: null, requestId: null, code: 'LINE_NETWORK_UNAVAILABLE' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
