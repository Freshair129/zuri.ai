// A PostgreSQL worker notification is a hint; the reply port owns completion.
// Exercise the real synchronous waiter with actual MessagePorts/Atomics, without
// a database or timing guesses about the business tests that exposed this race.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MessageChannel, Worker } from 'node:worker_threads'
import { waitForPgReply } from '../../src/infrastructure/pg-connection.js'

const peerSource = `
  const { workerData } = require('node:worker_threads')
  const { flag, phase, replies, mode } = workerData
  const pause = new Int32Array(new SharedArrayBuffer(4))
  const until = (condition) => {
    const deadline = performance.now() + 5000
    while (!condition()) {
      if (performance.now() > deadline) throw new Error('reply test coordination failed')
      Atomics.wait(pause, 0, 0, 1)
    }
  }
  if (mode === 'stale') {
    replies.postMessage({ rows: [{ n: 1 }], rowCount: 1 })
    Atomics.store(flag, 0, 1)
    Atomics.store(phase, 0, 1); Atomics.notify(phase, 0)
    until(() => Atomics.load(phase, 0) === 2)
    // A delayed notify from response 1 reaches the response-2 wait. Require
    // an actual waiter, then observe it waiting again after the empty wake.
    until(() => Atomics.notify(flag, 0) === 1)
    until(() => Atomics.notify(flag, 0) === 1)
    replies.postMessage({ rows: [{ n: 2 }], rowCount: 1 })
    Atomics.store(flag, 0, 1); Atomics.notify(flag, 0)
  } else {
    Atomics.store(phase, 0, 1); Atomics.notify(phase, 0)
    until(() => Atomics.load(phase, 0) === 2)
    const end = performance.now() + 500
    while (performance.now() < end) {
      Atomics.notify(flag, 0)
      Atomics.wait(pause, 0, 0, 1)
    }
    replies.postMessage({ rows: [{ late: true }], rowCount: 1 })
    Atomics.store(flag, 0, 1); Atomics.notify(flag, 0)
  }
`

async function peer(mode) {
  const flag = new Int32Array(new SharedArrayBuffer(4))
  const phase = new Int32Array(new SharedArrayBuffer(4))
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(peerSource, { eval: true, workerData: { flag, phase, replies: port2, mode }, transferList: [port2] })
  const close = async () => { port1.close(); await worker.terminate() }
  try {
    const deadline = performance.now() + 5000
    while (Atomics.load(phase, 0) !== 1) {
      const remaining = deadline - performance.now()
      assert.ok(remaining > 0, 'worker reached the controlled handoff')
      Atomics.wait(phase, 0, 0, remaining)
    }
  } catch (error) {
    await close()
    throw error
  }
  return { flag, phase, port: port1, close }
}

test('a late notification for an already consumed reply does not break the next call', async () => {
  const p = await peer('stale')
  try {
    assert.deepEqual(waitForPgReply(p.port, p.flag, 5000), { rows: [{ n: 1 }], rowCount: 1 })
    Atomics.store(p.phase, 0, 2)
    assert.deepEqual(waitForPgReply(p.port, p.flag, 5000), { rows: [{ n: 2 }], rowCount: 1 })
  } finally { await p.close() }
})

test('empty notifications cannot extend the original call deadline', async () => {
  const p = await peer('deadline')
  try {
    Atomics.store(p.phase, 0, 2)
    assert.throws(() => waitForPgReply(p.port, p.flag, 50), (error) => error.pgCode === 'SCM_PG_NO_REPLY' && error.message === 'SCM PostgreSQL connection did not answer')
  } finally { await p.close() }
})
