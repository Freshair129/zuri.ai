import { NextResponse } from 'next/server'
import { resolvePublicBaseUrl } from '@/lib/public-base-url'

// @req FR-144 — no-store, bounded requests and explicit browser origin on pairing approval.
// @spec SEC-008, SEC-025
// @tested tests/unit/edge-pairing-routes.test.js
export function pairingOrigin() {
  const url = new URL(resolvePublicBaseUrl())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw Object.assign(new Error('PAIRING_SERVER_ORIGIN_INVALID'), { status: 503 })
  }
  return url.origin
}
export async function pairingBody(request, { browser = false } = {}) {
  if (browser && request.headers.get('origin') !== pairingOrigin()) {
    throw Object.assign(new Error('PAIRING_ORIGIN_REFUSED'), { status: 403 })
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    throw Object.assign(new Error('PAIRING_JSON_REQUIRED'), { status: 400 })
  }
  const reader = request.body?.getReader()
  if (!reader) throw Object.assign(new Error('PAIRING_JSON_REQUIRED'), { status: 400 })
  let length = 0, chunks = []
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      length += part.value.length
      if (length > 4096) {
        await reader.cancel()
        throw Object.assign(new Error('PAIRING_REQUEST_TOO_LARGE'), { status: 413 })
      }
      chunks.push(Buffer.from(part.value))
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid')
    return body
  } catch (error) {
    if (error?.status) throw error
    throw Object.assign(new Error('PAIRING_JSON_INVALID'), { status: 400 })
  } finally { reader.releaseLock() }
}
export async function pairingResponse(work) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' }
  try { return NextResponse.json(await work(), { headers }) }
  catch (error) {
    const status = Number(error?.status) || 503
    const message = status < 500 ? error.message : 'PAIRING_UNAVAILABLE'
    return NextResponse.json({ error: message }, { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '2' } : {}) } })
  }
}
