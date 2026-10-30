// Isolated E2E evidence separates event-loop delay from API waits.
// @tested tests/unit/e2e-warmup.test.js
const { monitorEventLoopDelay, performance } = require('node:perf_hooks')
const { isMainThread } = require('node:worker_threads')
const { basename } = require('node:path')

// NODE_OPTIONS is set only by the CI E2E server launch. Inherited options must
// not start duplicate observers in Next workers or other Node entrypoints.
if (isMainThread && basename(process.argv[1] || '') === 'next' && process.argv[2] === 'start') {
  const histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()
  let previousTime = performance.now()
  let previousCpu = process.cpuUsage()
  const timer = setInterval(() => {
    const now = performance.now()
    const cpu = process.cpuUsage(previousCpu)
    previousCpu = process.cpuUsage()
    // Closed fields only: no environment, query parameters, payloads or auth.
    process.stderr.write(JSON.stringify({
      kind: 'E2E_SERVER_TIMING',
      at: new Date().toISOString(),
      pid: process.pid,
      windowMs: Math.round(now - previousTime),
      // A delayed sampling callback can run before the histogram's first
      // observation. Absence of observations is unknown, never a healthy zero.
      eventLoopMaxMs: histogram.count ? Math.round(histogram.max / 1e6) : null,
      cpuUserMs: Math.round(cpu.user / 1000),
      cpuSystemMs: Math.round(cpu.system / 1000),
    }) + '\n')
    previousTime = now
    histogram.reset()
  }, 1000)
  timer.unref()
  process.once('exit', () => {
    clearInterval(timer)
    histogram.disable()
  })
}
