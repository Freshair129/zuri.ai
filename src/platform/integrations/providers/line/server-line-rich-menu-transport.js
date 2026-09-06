import { z } from 'zod'

// @req FR-152 — the Integration-owned LINE rich menu port: create a rich menu
//   object, upload its image, set the default menu for all users, set an
//   alias. One attempt per call; the durable job owns retries and the
//   decision of what an ambiguous outcome means for each operation.
// @spec ADR-061 D1 (the Integration lane calls LINE; the Studio never holds
//   the token), D6/D7 (acceptance is the provider's status, never a delivery
//   claim; ambiguity is reported, not guessed), SEC-016 — provider error
//   bodies are never read or exposed, only a short opaque request id.
// @tested tests/unit/platform/server-line-rich-menu-transport.test.js

const API = 'https://api.line.me/v2/bot'
const DATA_API = 'https://api-data.line.me/v2/bot'

const zAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), label: z.string().max(20).optional(), text: z.string().min(1).max(300) }).strict(),
  z.object({ type: z.literal('postback'), label: z.string().max(20).optional(), data: z.string().min(1).max(300), displayText: z.string().max(300).optional() }).strict(),
  z.object({ type: z.literal('uri'), label: z.string().max(20).optional(), uri: z.string().min(1).max(1000) }).strict(),
  z.object({ type: z.literal('richmenuswitch'), label: z.string().max(20).optional(), richMenuAliasId: z.string().min(1).max(32), data: z.string().min(1).max(300) }).strict(),
])
export const zLineRichMenuObject = z.object({
  size: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  selected: z.boolean(),
  name: z.string().min(1).max(300),
  chatBarText: z.string().min(1).max(14),
  areas: z.array(z.object({
    bounds: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
    action: zAction,
  }).strict()).min(1).max(20),
}).strict()
const zRichMenuId = z.string().regex(/^richmenu-[A-Za-z0-9]{1,190}$/)
const zAliasId = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(32)
const zMime = z.enum(['image/png', 'image/jpeg'])

function failure(code, status = 503) {
  const error = new Error(code)
  error.code = code
  error.status = status
  return error
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function requestId(response, header = 'x-line-request-id') {
  const value = response?.headers?.get?.(header)
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : null
}

function token(account) {
  if (!present(account?.channelAccessToken) || /\s/.test(account.channelAccessToken)) throw failure('LINE_SEND_INPUT_INVALID', 400)
  return account.channelAccessToken
}

/**
 * Classify one HTTP outcome the way the push transport does: 2xx accepted,
 * 5xx retryable, other 4xx permanent, and a network/timeout error
 * `UNCONFIRMED` — the caller decides whether that is retryable (idempotent
 * operations) or terminal-ambiguous (a create, which would duplicate).
 */
function outcome(response) {
  const httpStatus = response.status
  if (httpStatus >= 200 && httpStatus < 300) return { status: 'ACCEPTED_BY_LINE', httpStatus, requestId: requestId(response), code: null }
  return {
    status: httpStatus >= 500 && httpStatus <= 599 ? 'RETRYABLE_FAILURE' : 'PERMANENT_FAILURE',
    httpStatus,
    requestId: requestId(response),
    code: `LINE_HTTP_${Number.isInteger(httpStatus) ? httpStatus : 'INVALID'}`,
  }
}

export function createServerLineRichMenuTransport({ fetchFn = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  if (typeof fetchFn !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw failure('LINE_TRANSPORT_CONFIGURATION_INVALID')
  }

  async function call(url, { method, headers, body, account }) {
    const controller = new AbortController()
    let timer
    try {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(failure('LINE_SEND_TIMEOUT')) }, timeoutMs)
      })
      const response = await Promise.race([
        fetchFn(url, {
          method, redirect: 'error',
          headers: { Authorization: `Bearer ${token(account)}`, ...headers },
          body, signal: controller.signal,
        }),
        timeout,
      ])
      return { response, result: outcome(response) }
    } catch (error) {
      if (error?.code === 'LINE_SEND_INPUT_INVALID') throw error
      return { response: null, result: { status: 'UNCONFIRMED', httpStatus: null, requestId: null, code: 'LINE_NETWORK_UNAVAILABLE' } }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    /** POST /richmenu — NOT idempotent: an UNCONFIRMED outcome may have created a menu. */
    async create({ account, richMenu } = {}) {
      let body
      try { body = JSON.stringify(zLineRichMenuObject.parse(richMenu)) } catch { throw failure('LINE_SEND_INPUT_INVALID', 400) }
      const { response, result } = await call(`${API}/richmenu`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, account })
      if (result.status !== 'ACCEPTED_BY_LINE') return { ...result, richMenuId: null }
      let richMenuId = null
      try {
        const parsed = await response.json()
        richMenuId = zRichMenuId.parse(parsed?.richMenuId)
      } catch {
        // Accepted but the id is unreadable: the menu may exist on LINE under a
        // name we know and an id we do not — that is ambiguity, not success.
        return { status: 'UNCONFIRMED', httpStatus: result.httpStatus, requestId: result.requestId, code: 'LINE_RICH_MENU_ID_UNREADABLE', richMenuId: null }
      }
      return { ...result, richMenuId }
    },

    /** POST api-data /richmenu/{id}/content — one image per menu; LINE refuses a second upload. */
    async uploadImage({ account, richMenuId, bytes, mime } = {}) {
      let id, type
      try {
        id = zRichMenuId.parse(richMenuId)
        type = zMime.parse(mime)
        if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 1024 * 1024) throw new Error('invalid')
      } catch { throw failure('LINE_SEND_INPUT_INVALID', 400) }
      const { result } = await call(`${DATA_API}/richmenu/${id}/content`, { method: 'POST', headers: { 'Content-Type': type }, body: bytes, account })
      return result
    },

    /** POST /user/all/richmenu/{id} — idempotent. */
    async setDefault({ account, richMenuId } = {}) {
      let id
      try { id = zRichMenuId.parse(richMenuId) } catch { throw failure('LINE_SEND_INPUT_INVALID', 400) }
      const { result } = await call(`${API}/user/all/richmenu/${id}`, { method: 'POST', headers: {}, body: undefined, account })
      return result
    },

    /**
     * POST /richmenu/alias, falling back to PUT /richmenu/alias/{aliasId} when
     * the alias already exists — the end state is the same either way, so the
     * pair is idempotent.
     */
    async setAlias({ account, aliasId, richMenuId } = {}) {
      let id, alias
      try { id = zRichMenuId.parse(richMenuId); alias = zAliasId.parse(aliasId) } catch { throw failure('LINE_SEND_INPUT_INVALID', 400) }
      const created = await call(`${API}/richmenu/alias`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ richMenuAliasId: alias, richMenuId: id }), account })
      if (created.result.status !== 'PERMANENT_FAILURE' || created.result.httpStatus !== 400) return created.result
      const updated = await call(`${API}/richmenu/alias/${alias}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ richMenuId: id }), account })
      return updated.result
    },
  }
}
