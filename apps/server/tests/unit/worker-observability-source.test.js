import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkerObservabilitySource } from '@/modules/platform-control/application/worker-observability-source'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function repoWithoutController() {
  const root = mkdtempSync(join(tmpdir(), 'zuri-worker-source-'))
  roots.push(root)
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true })
  git(['init'])
  git(['config', 'user.email', 'source-test@example.invalid'])
  git(['config', 'user.name', 'Source Test'])
  writeFileSync(join(root, 'seed.txt'), 'seed')
  git(['add', 'seed.txt'])
  git(['commit', '-m', 'seed'])
  return root
}

describe('worker observability source adapter', () => {
  it('returns UNKNOWN when no local controller exists and creates no source state', () => {
    const root = repoWithoutController()
    const before = readFileSync(join(root, '.git', 'HEAD'))
    const result = readWorkerObservabilitySource({ repoRoot: root, since: '2026-10-16T04:00:00.000Z' })
    expect(result).toMatchObject({ state: 'UNKNOWN', source: { proofScope: 'LOCAL_ONLY', eventChain: 'UNKNOWN' } })
    expect(existsSync(join(root, '.git', 'zuri-delivery-control'))).toBe(false)
    expect(readFileSync(join(root, '.git', 'HEAD'))).toEqual(before)
  })

  it('reads only the supplied root and returns an UNKNOWN envelope for an invalid root', () => {
    const result = readWorkerObservabilitySource({ repoRoot: join(tmpdir(), 'no-such-zuri-source'), since: null })
    expect(result).toMatchObject({ schemaVersion: 'worker-observability/v1', state: 'UNKNOWN', summary: { mode: 'UNKNOWN' } })
  })
})
