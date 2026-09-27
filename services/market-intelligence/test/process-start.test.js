import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { start } from '../src/main.js'
import { createFakeCore } from './support/fake-core.js'

// The composition root boots from environment alone, serves readiness through its own
// wiring, and drains on stop. The spawned run proves `node src/main.js` starts as a
// separate OS process with nothing from apps/server on its path.

const CORE_TOKEN = 'c'.repeat(40)
const env = (coreUrl, dir) => ({
  MARKET_ENV: 'test',
  MARKET_PORT: '0',
  MARKET_API_TOKEN: 'a'.repeat(40),
  MARKET_CORE_TOKEN: CORE_TOKEN,
  MARKET_CORE_URL: coreUrl,
  MARKET_STORE: 'sqlite',
  MARKET_SQLITE_PATH: path.join(dir, 'market.db'),
})

test('start() wires config, store, core and HTTP, then stops cleanly', async () => {
  const core = createFakeCore({ token: CORE_TOKEN })
  const dir = mkdtempSync(path.join(tmpdir(), 'market-start-'))
  try {
    const running = await start(env(await core.listen(), dir))
    const ready = await fetch(`http://127.0.0.1:${running.address.port}/readyz`)
    assert.equal(ready.status, 200)
    assert.equal((await ready.json()).deps.core, 'fake')
    await running.stop('test')
    await assert.rejects(fetch(`http://127.0.0.1:${running.address.port}/healthz`))
  } finally {
    await core.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('invalid configuration refuses to start', async () => {
  await assert.rejects(start({ MARKET_STORE: 'sqlite' }))
})

test('node src/main.js runs as its own process', async () => {
  const core = createFakeCore({ token: CORE_TOKEN })
  const dir = mkdtempSync(path.join(tmpdir(), 'market-proc-'))
  const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const child = spawn(process.execPath, ['src/main.js'], {
    cwd: serviceRoot,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env(await core.listen(), dir) },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('service did not report listening')), 10_000)
      child.stdout.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          const entry = JSON.parse(line)
          if (entry.message === 'listening') { clearTimeout(timer); resolve(entry.port) }
        }
      })
      child.once('exit', (code) => reject(new Error(`exited early with ${code}`)))
    })
    assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200)
    assert.equal((await fetch(`http://127.0.0.1:${port}/readyz`)).status, 200)
  } finally {
    const exited = child.exitCode === null ? once(child, 'exit') : Promise.resolve()
    child.kill()
    await exited
    await core.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
