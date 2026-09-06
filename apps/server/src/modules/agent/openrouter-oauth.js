import crypto from 'node:crypto'

// @req FR-048 — OpenRouter user-controlled key acquisition through OAuth Authorization Code + PKCE.
// @spec SEC-009 — verifier/state are transient server-side values; exchanged credentials are never logged.
// @tested tests/unit/phase1-business-agent-runtime.test.js

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

export function createOpenRouterAuthorization({ callbackUrl }) {
  const parsedCallback = new URL(callbackUrl)
  if (parsedCallback.protocol !== 'https:' && parsedCallback.hostname !== 'localhost') {
    throw new Error('OPENROUTER_OAUTH_HTTPS_CALLBACK_REQUIRED')
  }
  const codeVerifier = base64url(crypto.randomBytes(48))
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const state = base64url(crypto.randomBytes(32))
  const url = new URL('https://openrouter.ai/auth')
  url.searchParams.set('callback_url', parsedCallback.toString())
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  return { authorizationUrl: url.toString(), codeVerifier, state }
}

export async function exchangeOpenRouterCode({ code, codeVerifier, fetchFn = fetch }) {
  if (!code?.trim() || !codeVerifier?.trim()) throw new Error('OPENROUTER_OAUTH_CODE_AND_VERIFIER_REQUIRED')
  const response = await fetchFn('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: codeVerifier, code_challenge_method: 'S256' }),
  })
  if (!response.ok) throw new Error(`OPENROUTER_OAUTH_HTTP_${response.status}`)
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('OPENROUTER_OAUTH_INVALID_JSON')
  }
  if (!payload?.key || typeof payload.key !== 'string') throw new Error('OPENROUTER_OAUTH_KEY_MISSING')
  return { provider: 'openrouter', credential: payload.key }
}
