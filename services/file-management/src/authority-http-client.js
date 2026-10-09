// @spec ADR-107 - bounded fail-closed authority capability client.
// @tested tests/authority-http-client.test.js
import { FileManagementError } from './errors.js'

const MAX_RESPONSE_BYTES = 16 * 1024

export function createAuthorityHttpPort({ endpoint, serviceToken, fetchFn = fetch, timeoutMs = 3000 } = {}) {
  if (typeof endpoint !== 'string' || typeof serviceToken !== 'string' || !serviceToken.trim()) return null
  const root = new URL(endpoint)
  if (!['http:', 'https:'].includes(root.protocol) || root.username || root.password || root.search || root.hash) {
    throw new FileManagementError('FILE_AUTHORITY_CONFIG_INVALID', 500, 'Authority endpoint must be a clean HTTP(S) URL')
  }
  const authorizationUrl = new URL('/internal/v1/file-authorizations', root)
  const healthUrl = new URL('/internal/v1/health/files-authority', root)

  async function request(url, { method = 'GET', body } = {}) {
    let response
    try {
      response = await fetchFn(url, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          authorization: `Bearer ${serviceToken}`,
          accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      throw new FileManagementError('FILE_AUTHORITY_UNAVAILABLE', 503, 'File authority could not be reached')
    }
    if (response.status === 401 || response.status === 403) throw new FileManagementError('FILE_AUTHORITY_DENIED', 403, 'File authority denied this operation')
    if (!response.ok) throw new FileManagementError('FILE_AUTHORITY_UNAVAILABLE', 503, 'File authority did not confirm this operation')
    const length = Number(response.headers.get('content-length'))
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw new FileManagementError('FILE_AUTHORITY_RESPONSE_INVALID', 503, 'File authority response exceeded its limit')
    const reader = response.body?.getReader()
    if (!reader) throw new FileManagementError('FILE_AUTHORITY_RESPONSE_INVALID', 503, 'File authority response body is missing')
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new FileManagementError('FILE_AUTHORITY_RESPONSE_INVALID', 503, 'File authority response exceeded its limit')
      }
      chunks.push(Buffer.from(value))
    }
    const text = Buffer.concat(chunks).toString('utf8')
    try { return text ? JSON.parse(text) : {} } catch { throw new FileManagementError('FILE_AUTHORITY_RESPONSE_INVALID', 503, 'File authority response was not valid JSON') }
  }

  return Object.freeze({
    async authorize(input) {
      return request(authorizationUrl, { method: 'POST', body: input })
    },
    async health() {
      try {
        const result = await request(healthUrl)
        return result.status === 'ready'
      } catch {
        return false
      }
    },
  })
}
