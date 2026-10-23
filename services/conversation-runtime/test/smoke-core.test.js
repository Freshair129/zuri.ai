import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createProductionCoreClient, createCoreClient } from '../src/core-client.js'
import { createSmokeCoreServer } from '../scripts/smoke-core.mjs'

// @req FR-149, FR-291 — the image-smoke dependency must speak the Runtime's
// selected Core contract and retain the legacy v1 option.
const TOKEN = 'ci-only-conversation-runtime-token-not-a-secret-000000'

test('smoke Core answers the production v2 handshake and keeps v1 available', async t => {
  const stub = createSmokeCoreServer({ token: TOKEN })
  stub.server.listen(0, '127.0.0.1')
  await once(stub.server, 'listening')
  t.after(() => new Promise((resolve, reject) => stub.server.close(error => error ? reject(error) : resolve())))

  const address = stub.server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const production = createProductionCoreClient({ baseUrl, token: TOKEN, timeoutMs: 1000 })
  const legacy = createCoreClient({ baseUrl, token: TOKEN, timeoutMs: 1000 })

  assert.deepEqual(await production.health(), {
    contractVersion: 'conversation-runtime.v2', status: 'READY', runtimeOwner: 'CONVERSATION_RUNTIME',
  })
  assert.deepEqual(await legacy.health(), {
    contractVersion: 'conversation-runtime.v1', status: 'READY', runtimeOwner: 'CONVERSATION_RUNTIME',
  })
  const legacyClaim = await legacy.call('claim', { claimantId: 'smoke-runtime' })
  assert.equal(legacyClaim.executionId, 'c8f7ce46-9139-4a4f-a243-cc131da651f2')

  const claim = { jobId: 'job-1', executionId: 'exec-1', claimantId: 'worker-1', version: 1,
    tenantId: 'tenant-1', businessId: 'business-1', accountId: 'account-1' }
  const pendingPrepare = production.call('prepare', { claim, authorityVersion: 1 })
  await stub.prepareEntered
  assert.equal(stub.state.prepareEntered, true)
  stub.releasePrepare()
  const prepared = await pendingPrepare
  assert.equal(prepared.question, 'smoke drain')
})
