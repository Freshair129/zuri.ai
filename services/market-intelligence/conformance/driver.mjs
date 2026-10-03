// Local provider conformance driver (delegated Q11): real browser-session requests against the console's Market routes.
// Run once against MARKET_EXECUTOR unset (legacy) and once against service mode; the two
// normalized outputs must be identical except for the documented unauthenticated case.
import { writeFileSync } from 'node:fs'

const { BASE, BUSINESS_ID, OUT } = process.env
if (!BASE || !BUSINESS_ID || !OUT) throw new Error('BASE, BUSINESS_ID and OUT are required')

async function waitReady() {
  for (let i = 0; i < 180; i += 1) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.status < 500) return
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('dev server did not become ready')
}

await waitReady()
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'owner@local', password: process.env.CONFORMANCE_PASSWORD }),
})
const setCookie = login.headers.get('set-cookie') || ''
const session = /zuri_session=([^;]+)/.exec(setCookie)?.[1]
if (!session) throw new Error(`login failed: ${login.status} ${await login.text()}`)
const cookie = `zuri_session=${session}`

async function call(name, method, path, { body, auth = true, cookieOverride } = {}) {
  const sent = cookieOverride ?? (auth ? cookie : null)
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(sent ? { cookie: sent } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json
  try { json = JSON.parse(text) } catch { json = { nonJson: text.slice(0, 200) } }
  return { name, status: r.status, body: json }
}

// Fields that legitimately differ between two runs: row ids and processing time.
function normalize(step) {
  const body = step.body
  if (Array.isArray(body?.observations)) {
    body.observations = body.observations.map(({ id, translatedAt, ...row }) => row)
  }
  return step
}

const feed = `/api/market/observations?businessId=${BUSINESS_ID}`
const steps = [
  await call('feed-before', 'GET', feed),
  await call('translate', 'POST', '/api/market/translations', { body: { businessId: BUSINESS_ID } }),
  await call('feed-after', 'GET', feed),
  await call('translate-replay', 'POST', '/api/market/translations', { body: { businessId: BUSINESS_ID } }),
  await call('feed-limit-1', 'GET', `${feed}&limit=1`),
  await call('feed-unknown-business', 'GET', '/api/market/observations?businessId=does-not-exist'),
  await call('translate-unknown-business', 'POST', '/api/market/translations', { body: { businessId: 'does-not-exist' } }),
  await call('feed-bad-query', 'GET', `${feed}&tenantId=evil`),
  await call('translate-bad-body', 'POST', '/api/market/translations', { body: { businessId: BUSINESS_ID, viewer: { role: 'OWNER' } } }),
  await call('feed-no-session', 'GET', feed, { auth: false }),
  await call('feed-invalid-session', 'GET', feed, { cookieOverride: 'zuri_session=garbage-token' }),
  await call('translate-invalid-session', 'POST', '/api/market/translations', { body: { businessId: BUSINESS_ID }, cookieOverride: 'zuri_session=garbage-token' }),
].map(normalize)

writeFileSync(OUT, `${JSON.stringify(steps, null, 2)}\n`)
for (const step of steps) process.stdout.write(`${step.name}: ${step.status}\n`)
