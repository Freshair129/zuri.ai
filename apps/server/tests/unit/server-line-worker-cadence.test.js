import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  FAST_MS, IDLE_MAX_MS, IDLE_START_MS, RICH_MENU_MIN_INTERVAL_MS, didWork, nextCadence,
} from '../../scripts/worker-cadence.mjs'

// @req FR-149, FR-152 — the supervised worker polls on a cadence derived from whether it found work.
// @spec ADR-061
// @tested tests/unit/server-line-worker-cadence.test.js

describe('what counts as a productive round', () => {
  it('reads the body, not the HTTP status — a 200 that found nothing is not work', () => {
    // Both worker endpoints answer 200 whether or not they did anything, so backing off on the
    // status code alone would never back off at all.
    expect(didWork(true, { status: 'IDLE', reconciled: { scanned: 0 } })).toBe(false)
    expect(didWork(true, { status: 'RECORDED', executed: 1, sent: 1 })).toBe(true)
    expect(didWork(true, { status: 'FAILED' })).toBe(true)
  })

  it('treats a failing or misconfigured deployment as no work, so it backs off instead of hammering', () => {
    expect(didWork(false, { error: 'WORKER_CREDENTIAL_REQUIRED' })).toBe(false)
    expect(didWork(false, { error: 'LINE_WORKER_UNAVAILABLE' })).toBe(false)
    // An unparseable body is `null` here; a round we cannot read is not a round we can call busy.
    expect(didWork(true, null)).toBe(false)
    expect(didWork(true, {})).toBe(false)
  })
})

describe('the cadence itself', () => {
  it('runs faster than the old flat second while there is work', () => {
    // The point of the change: a busy queue is not slowed down by making the idle case cheaper.
    expect(FAST_MS).toBeLessThan(1_000)
    expect(nextCadence({ worked: true, idleMs: IDLE_MAX_MS })).toEqual({ delayMs: FAST_MS, idleMs: IDLE_START_MS })
  })

  it('backs off geometrically to a ceiling once the queue goes quiet', () => {
    const seen = []
    let idleMs = IDLE_START_MS
    for (let round = 0; round < 8; round += 1) {
      const cadence = nextCadence({ worked: false, idleMs })
      seen.push(cadence.delayMs)
      idleMs = cadence.idleMs
    }
    expect(seen).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000])
    expect(Math.max(...seen)).toBe(IDLE_MAX_MS)
  })

  it('resets the moment one round finds something, so a burst never pays for the quiet before it', () => {
    // Without this, the first message after a quiet night would be followed by nine more slow
    // rounds while the backoff unwound — exactly the conversation where latency is most visible.
    const afterQuiet = nextCadence({ worked: false, idleMs: IDLE_MAX_MS })
    expect(afterQuiet.idleMs).toBe(IDLE_MAX_MS)
    expect(nextCadence({ worked: true, idleMs: afterQuiet.idleMs }).idleMs).toBe(IDLE_START_MS)
  })
})

describe('the script that uses it', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts/server-line-worker.mjs'), 'utf8')

  it('no longer sleeps a flat second regardless of what it found', () => {
    expect(script).not.toMatch(/delay\(1000\)/)
    expect(script).toContain('nextCadence')
  })

  it('gives the rich menu tick its own floor rather than riding the fast conversation cadence', () => {
    // A rich menu publish is an operator action nobody is waiting on inside a conversation; at
    // FAST_MS it would otherwise be polled four times a second throughout a busy period.
    expect(RICH_MENU_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(1_000)
    expect(script).toContain('RICH_MENU_MIN_INTERVAL_MS')
  })
})

describe('everything the supervisor imports is actually in the runtime image', () => {
  // The runtime stage copies named files, not the `scripts/` folder, so a new local import
  // is invisible to the build and fatal at start-up. Splitting the cadence out of the
  // supervisor did exactly that: build green, tests green, CI green — and the deployed
  // container died with ERR_MODULE_NOT_FOUND on every restart, taking the LINE worker with
  // it until someone read its logs. Nothing in the repository could have caught it, so this
  // is the check that now does.
  const root = process.cwd()
  const supervisor = readFileSync(resolve(root, 'scripts/server-line-worker.mjs'), 'utf8')
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
  // Only the final runtime stage matters — the builder stage copies the whole tree.
  const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))

  const localImports = [...supervisor.matchAll(/^import[^'"]*['"](\.[^'"]+)['"]/gm)].map(m => m[1])

  it('finds at least the cadence module, so this test cannot pass by matching nothing', () => {
    expect(localImports).toContain('./worker-cadence.mjs')
  })

  for (const specifier of localImports) {
    it(`ships ${specifier}`, () => {
      const file = specifier.replace(/^\.\//, '')
      expect(runtimeStage, `scripts/${file} is imported by server-line-worker.mjs but the runtime stage never copies it — the container will not start`)
        .toContain(`/app/scripts/${file}`)
    })
  }
})
