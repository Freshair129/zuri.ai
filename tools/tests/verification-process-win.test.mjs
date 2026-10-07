import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { runOwnedWindowsProcess } from '../../scripts/verification-qualify.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const adapterSource = path.join(ROOT, 'scripts/verification-process-win.ps1')
const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
async function waitFor(predicate, ms = 5000) {
  const end = Date.now() + ms
  while (!predicate()) {
    assert.ok(Date.now() < end, 'fixture readiness deadline')
    await delay(30)
  }
}

test('Windows owned-job lifecycle with an unrelated live sentinel', { skip: process.platform !== 'win32', timeout: 115_000 }, async t => {
  const parent = path.resolve(tmpdir())
  const root = mkdtempSync(path.join(parent, 'zuri-q1-lifecycle-'))
  const fixture = path.join(root, 'fixture.mjs')
  writeFileSync(fixture, `import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
const [mode, state, levelText, ...extra] = process.argv.slice(2)
const level = Number(levelText)
appendFileSync(state, process.pid + '\\n')
if (mode === 'normal') { console.log(JSON.stringify(extra)); console.error('fixture stderr') }
else {
  if (mode !== 'wrapper' && level < 2) {
    const child = spawn(process.execPath, [process.argv[1], mode, state, String(level + 1)],
      { stdio: 'ignore', windowsHide: true, shell: false, detached: true })
    child.unref()
  }
  setInterval(() => {
    if (mode === 'early-parent' && level < 2 && readFileSync(state, 'utf8').trim().split('\\n').length === 3) process.exit(0)
  }, 20)
}
`)
  const sentinel = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })
  const sentinelExit = new Promise(resolve => sentinel.once('exit', resolve))
  let safeToRemove = true
  t.after(async () => {
    sentinel.kill()
    await sentinelExit
    assert.equal(path.dirname(root), parent)
    assert.ok(path.basename(root).startsWith('zuri-q1-lifecycle-'))
    if (safeToRemove) rmSync(root, { recursive: true, force: true })
    else console.error('Preserved unverified lifecycle fixture: ' + root)
  })

  for (const name of ['normal', 'early-parent', 'wrapper-timeout', 'descendant-timeout', 'containment-failure', 'cancel', 'spawn-error']) {
    let casePassed = false
    await t.test(name, { timeout: 15_000 }, async current => {
      const output = path.join(root, name)
      mkdirSync(output)
      const state = path.join(output, 'pids.txt')
      const pids = () => existsSync(state) ? readFileSync(state, 'utf8').trim().split('\n').filter(Boolean).map(Number) : []
      const controller = new AbortController()
      current.signal.addEventListener('abort', () => controller.abort(), { once: true })
      let adapter = adapterSource
      if (name === 'containment-failure') {
        // Exercise the real native Bind error using an invalid handle in a disposable adapter copy.
        const source = readFileSync(adapterSource, 'utf8')
        const call = '[Q1Job]::Bind($job, $process.Handle)'
        assert.equal(source.split(call).length, 2)
        adapter = path.join(output, 'reject-containment.ps1')
        writeFileSync(adapter, source.replace(call, '[Q1Job]::Bind($job, [IntPtr]::Zero)'))
      }
      const mode = name === 'normal' ? 'normal' : name === 'early-parent' ? 'early-parent'
        : name === 'wrapper-timeout' ? 'wrapper' : 'descendant'
      const extra = ['argument with spaces', '$(literal)', '&', 'a"b', 'ภาษาไทย']
      const pending = runOwnedWindowsProcess(name === 'spawn-error' ? path.join(root, 'missing-node.exe') : process.execPath,
        [fixture, mode, state, '0', ...extra], { cwd: root, env: { ...process.env },
          timeout: name.endsWith('timeout') ? 1200 : 5000, adapter,
          signal: controller.signal, evidencePath: path.join(output, 'process.json'), logPath: path.join(output, 'process.log') })
      let readinessError
      if (name === 'cancel') {
        try { await waitFor(() => pids().length === 3) } catch (error) { readinessError = error }
        finally { controller.abort() }
      }
      const result = await pending
      safeToRemove &&= result.lifecycle?.cleanup === 'VERIFIED'
      if (process.env.Q1_LIFECYCLE_EVIDENCE) {
        const retained = path.resolve(process.env.Q1_LIFECYCLE_EVIDENCE, name)
        mkdirSync(retained, { recursive: true })
        for (const file of ['process.json', 'process.json.adapter.json', 'process.log', 'process.log.stdout', 'process.log.stderr', 'pids.txt']) {
          if (existsSync(path.join(output, file))) copyFileSync(path.join(output, file), path.join(retained, file))
        }
      }
      if (readinessError) throw readinessError
      assert.equal(result.lifecycle.cleanup, 'VERIFIED', JSON.stringify(result))
      assert.equal(result.lifecycle.remainingActive, 0)
      assert.ok(alive(sentinel.pid), 'unrelated sentinel must survive')
      for (const pid of [...pids(), ...result.lifecycle.observedMembers]) assert.equal(alive(pid), false, 'owned process still alive: ' + pid)
      if (name === 'containment-failure' || name === 'spawn-error') {
        assert.equal(result.lifecycle.containment, 'NOT_BOUND')
        assert.equal(result.error.code, 'CONTAINMENT_FAILED')
        assert.equal(pids().length, 0, 'payload never starts without containment')
      } else {
        assert.equal(result.lifecycle.containment, 'BOUND')
        assert.ok(result.lifecycle.observedMembers.length >= 1)
        if (name.endsWith('timeout')) assert.equal(result.error.code, 'ETIMEDOUT')
        else if (name === 'cancel') assert.equal(result.error.code, 'CANCELLED')
        else { assert.equal(result.status, 0); assert.equal(result.error, null) }
        if (mode === 'descendant' || name === 'early-parent') assert.equal(pids().length, 3)
        if (name === 'early-parent') assert.ok(result.lifecycle.activeAtCleanup > 0, 'a descendant outlived its parent')
      }
      if (name === 'normal') {
        assert.deepEqual(JSON.parse(readFileSync(path.join(output, 'process.log.stdout'), 'utf8').trim()), extra)
        assert.match(readFileSync(path.join(output, 'process.log.stderr'), 'utf8'), /fixture stderr/)
      }
      casePassed = true
    })
    if (!casePassed) break
  }
})
