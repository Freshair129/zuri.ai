import test from 'node:test'
import assert from 'node:assert/strict'
import { createHealthServer } from '../src/health-server.js'

test('health is live while readiness reflects the authenticated core dependency', async () => {
  let ready = false
  const server = createHealthServer({ isReady: () => ready })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  try {
    const live = await fetch(`http://127.0.0.1:${address.port}/healthz`)
    const notReady = await fetch(`http://127.0.0.1:${address.port}/readyz`)
    assert.equal(live.status, 200)
    assert.equal(notReady.status, 503)
    ready = true
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/readyz`)).status, 200)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
