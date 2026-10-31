// Isolated E2E evidence separates event-loop delay from API waits.
// @tested tests/unit/e2e-warmup.test.js
const { monitorEventLoopDelay, performance } = require('node:perf_hooks')
const { isMainThread } = require('node:worker_threads')
const { basename } = require('node:path')

const PRELOAD = '--require ./tests/e2e/server-timings.cjs'

function appendServerTimingsPreload(existing = '') {
  const options = String(existing || '').trim()
  return options.includes(PRELOAD)
    ? options
    : [options, PRELOAD].filter(Boolean).join(' ')
}

function diagnosticsEnabled(env = process.env) {
  return env.NODE_ENV === 'test' &&
    env.E2E_SERVER_MODE === 'production' &&
    env.E2E_EXTERNAL_SERVER === 'true' &&
    env.ZURI_E2E_SERVER_DIAGNOSTICS === '1' &&
    typeof env.DATABASE_URL === 'string' &&
    /^file:/i.test(env.DATABASE_URL)
}

function createHostCleanupRecord({ pid, outcome, at = new Date().toISOString() }) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('E2E_DIAGNOSTIC_PID_INVALID')
  if (!['terminated', 'already-exited', 'kill-failed'].includes(outcome)) {
    throw new Error('E2E_DIAGNOSTIC_OUTCOME_INVALID')
  }
  return {
    kind: 'E2E_SERVER_DIAGNOSTIC',
    event: 'host-cleanup',
    at,
    pid,
    outcome,
  }
}

// The workflow enables this only for its isolated E2E SQLite server. Requiring
// every condition here prevents inherited NODE_OPTIONS from turning diagnostics
// on for an application deployment or an unrelated test process.
if (diagnosticsEnabled() && isMainThread && basename(process.argv[1] || '') === 'next' && process.argv[2] === 'start') {
  const histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  let previousTime = performance.now()
  let previousCpu = process.cpuUsage()
  let sequence = 0
  const startedAt = performance.now()
  const startedWallClock = new Date().toISOString()

  // Closed schema: no argv, environment, URL, SQL, query arguments, errors or
  // application data are accepted by this emitter.
  function emit(event, metrics = {}) {
    process.stderr.write(JSON.stringify({
      kind: 'E2E_SERVER_DIAGNOSTIC',
      event,
      at: new Date().toISOString(),
      pid: process.pid,
      parentPid: process.ppid,
      sequence: sequence++,
      uptimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
      ...metrics,
    }) + '\n')
  }

  emit('started', { startedAt: startedWallClock })
  const timer = setInterval(() => {
    const now = performance.now()
    const cpu = process.cpuUsage(previousCpu)
    previousCpu = process.cpuUsage()
    emit('heartbeat', {
      windowMs: Math.round(now - previousTime),
      // A delayed sampling callback can run before the histogram's first
      // observation. Absence of observations is unknown, never a healthy zero.
      eventLoopMaxMs: histogram.count ? Math.round(histogram.max / 1e6) : null,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
    })
    previousTime = now
    histogram.reset()
  }, 1000)
  timer.unref()
  process.once('exit', () => {
    clearInterval(timer)
    histogram.disable()
    // The exit event is the final synchronous write so the redirected stderr
    // artifact records a clean shutdown when the host allows one.
    emit('exit')
  })
}

module.exports = { appendServerTimingsPreload, createHostCleanupRecord, diagnosticsEnabled }
