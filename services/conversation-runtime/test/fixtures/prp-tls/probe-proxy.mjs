// Disposable Docker proxy checks only; this file is never in the Runtime image.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

try {
  execFileSync(process.execPath, ['scripts/probe-private-runtime.mjs'], { stdio: 'inherit', windowsHide: true })
  const base = process.env.ZURI_PRIVATE_RUNTIME_BASE_URL
  const apiKey = readFileSync(process.env.ZURI_PRIVATE_RUNTIME_PROBE_KEY_FILE, 'utf8').trim()
  const body = { model: 'local-alias', messages: [{ role: 'user', content: 'synthetic' }], max_tokens: 1, stream: false }
  const checks = [
    ['HEAD', '/v1/models', undefined, 405],
    ['POST', '/v1/models', {}, 405],
    ['GET', '/v1/chat/completions', undefined, 405],
    ['GET', '/key/generate', undefined, 404],
    ['GET', '/v1/models?redirect=metadata', undefined, 400],
    ['POST', '/v1/chat/completions', { ...body, model: 'business-b-alias' }, 403],
    ['POST', '/v1/chat/completions', { ...body, model: 'not-present' }, 404],
    ['POST', '/v1/chat/completions', { ...body, unsupported: true }, 400],
  ]
  for (const [method, path, payload, expected] of checks) {
    const response = await fetch(`${base}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(2000),
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}) })
    void response.body?.cancel()
    if (response.status !== expected) throw new Error('PROXY_CONTRACT_REFUSED')
  }
  process.stdout.write(`${JSON.stringify({ status: 'PASS', proxyChecks: checks.length, scope: 'synthetic-proxy-only' })}\n`)
} catch {
  process.stderr.write('SYNTHETIC_PROXY_CHECK_FAILED\n')
  process.exitCode = 1
}
