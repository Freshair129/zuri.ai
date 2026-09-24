// @spec ADR-107 - authority client scope, bounds and fail-closed proof.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthorityHttpPort } from '../src/authority-http-client.js'

test('authority adapter sends a bounded authorization request using the service credential', async () => {
  let captured
  const port = createAuthorityHttpPort({
    endpoint: 'http://authority.test/base',
    serviceToken: 'service-fixture-token',
    fetchFn: async (url, options) => {
      captured = { url: String(url), options }
      return Response.json({ actorId: '30000000-0000-4000-8000-000000000001', tenantId: '10000000-0000-4000-8000-000000000001', businessId: '20000000-0000-4000-8000-000000000002', permissions: ['files:create'] })
    },
  })
  const provenance = { kind: 'BROWSER_UPLOAD', sourceId: 'fixture-browser-session' }
  const result = await port.authorize({ bearerToken: 'user-fixture-token', action: 'files:create', tenantId: '10000000-0000-4000-8000-000000000001', businessId: '20000000-0000-4000-8000-000000000002', provenance })
  assert.equal(captured.url, 'http://authority.test/internal/v1/file-authorizations')
  assert.equal(captured.options.headers.authorization, 'Bearer service-fixture-token')
  assert.equal(JSON.parse(captured.options.body).bearerToken, 'user-fixture-token')
  assert.deepEqual(JSON.parse(captured.options.body).provenance, provenance)
  assert.deepEqual(result.permissions, ['files:create'])
})

test('authority adapter bounds responses without relying on Content-Length', async () => {
  const port = createAuthorityHttpPort({
    endpoint: 'http://authority.test',
    serviceToken: 'service-fixture-token',
    fetchFn: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(17 * 1024))
        controller.close()
      },
    })),
  })
  await assert.rejects(port.authorize({ bearerToken: 'user-fixture-token', action: 'files:create', tenantId: '10000000-0000-4000-8000-000000000001', businessId: '20000000-0000-4000-8000-000000000002' }), (error) => error.code === 'FILE_AUTHORITY_RESPONSE_INVALID')
})

test('missing authority configuration creates no permissive provider', () => {
  assert.equal(createAuthorityHttpPort({}), null)
})
