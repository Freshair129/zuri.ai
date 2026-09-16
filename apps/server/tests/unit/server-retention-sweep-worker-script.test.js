import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runnerStage } from '../helpers/dockerfile-stage.js'

// @req FR-230 — the single-shot worker script itself: it authenticates, calls the
//   route once, logs exactly one JSON line and exits — no loop, no cadence, no
//   live network call in this test (the shape is what's under test, not a real
//   fetch — see tests/unit/retention-sweep-worker-run.test.js for the core
//   behaviour these lines call into).
// @spec ADR-091 D1, D2
// @tested tests/unit/server-retention-sweep-worker-script.test.js

const script = readFileSync(resolve(process.cwd(), 'scripts/server-retention-sweep-worker.mjs'), 'utf8')

describe('the single-shot retention sweep worker script', () => {
  it('is single-shot: no loop, no cadence backoff, no signal-draining supervisor state', () => {
    expect(script).not.toMatch(/\bwhile\s*\(/)
    expect(script).not.toContain('setInterval')
    expect(script).not.toContain('nextCadence')
    expect(script).not.toMatch(/process\.on\(/)
  })

  it('calls the core exactly once and exits with a code derived from the result', () => {
    expect(script).toContain('resolveRetentionSweepWorkerConfig(process.env)')
    expect(script).toContain('runRetentionSweepOnce(')
    expect(script).toContain('formatRetentionSweepLogLine(')
    expect(script).toContain('console.log(')
    expect(script).toContain('process.exit(')
  })
})

describe('everything the worker script imports is actually in the runtime image', () => {
  // The same trap server-line-worker.mjs already hit once (see
  // tests/unit/server-line-worker-cadence.test.js): the Dockerfile runtime
  // stage copies scripts/ file by file, so a new local import is invisible to
  // the build and fatal only when the OS scheduler finally runs this script
  // inside the container — build, tests and CI all stay green regardless.
  const root = process.cwd()
  const dockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8')
  // Only the shipped runtime stage matters — the builder stage copies the whole tree.
  // By NAME, not by "the last FROM": ADR-075 Phase 3 appended opt-in ki17 targets
  // after `runner`, and the positional version of this line silently started reading
  // one of those instead (see tests/helpers/dockerfile-stage.js).
  const runtimeStage = runnerStage(dockerfile)

  const localImports = [...script.matchAll(/^import[^'"]*['"](\.[^'"]+)['"]/gm)].map(m => m[1])

  it('finds at least the core module, so this test cannot pass by matching nothing', () => {
    expect(localImports).toContain('./retention-sweep-worker-run.mjs')
  })

  it('found the runner stage to check, so this test cannot pass by matching an empty slice', () => {
    expect(runtimeStage).toContain('FROM base AS runner')
    expect(runtimeStage).toContain('CMD ["node", "server.js"]')
  })

  it('the script itself is copied into the runtime stage', () => {
    expect(runtimeStage).toContain('/app/scripts/server-retention-sweep-worker.mjs')
  })

  for (const specifier of localImports) {
    it(`ships ${specifier}`, () => {
      const file = specifier.replace(/^\.\//, '')
      expect(runtimeStage, `scripts/${file} is imported by server-retention-sweep-worker.mjs but the runtime stage never copies it — a scheduled \`docker compose exec\` run will crash with ERR_MODULE_NOT_FOUND`)
        .toContain(`/app/scripts/${file}`)
    })
  }
})
