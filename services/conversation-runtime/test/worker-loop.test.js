import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkerLoop } from '../src/worker-loop.js'

test('worker loop backs off on idle and stops after the current tick', async () => {
  let calls = 0
  const loop = createWorkerLoop({ runtime: { runOne: async () => { calls += 1; return { status: 'IDLE' } } }, idleStartMs: 1, idleMaxMs: 2 })
  const controller = new AbortController()
  const running = loop.run({ signal: controller.signal })
  await new Promise(resolve => setTimeout(resolve, 5))
  await loop.stop()
  controller.abort()
  await running
  assert.ok(calls >= 1)
})
