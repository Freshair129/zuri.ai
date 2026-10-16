import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const baseCompose = parse(readFileSync(path.join(serverRoot, 'docker-compose.yml'), 'utf8'))
const localOverlay = parse(readFileSync(path.join(serverRoot, 'docker-compose.worker-observability.yml'), 'utf8'))

describe('local worker observability Compose overlay', () => {
  it('adds exactly one read-only sanitized export mount to web', () => {
    expect(localOverlay.services.web.environment.ZURI_WORKER_OBSERVABILITY_FILE)
      .toBe('/run/zuri/worker-observability/worker-observability.json')
    expect(localOverlay.services.web.volumes).toEqual([{
      type: 'bind',
      source: './.worker-observability.local',
      target: '/run/zuri/worker-observability',
      read_only: true,
    }])
    expect(JSON.stringify(localOverlay)).not.toMatch(/\.git|controller-v1|supervisor|zuri-delivery-control/i)
  })

  it('keeps controller database, Git metadata, and supervisor state out of the base web mounts', () => {
    const mounts = baseCompose.services.web.volumes ?? []
    expect(JSON.stringify(mounts)).not.toMatch(/\.git|controller-v1|supervisor|zuri-delivery-control/i)
    expect(JSON.stringify(mounts)).not.toMatch(/controller.*\.sqlite|\.sqlite.*controller/i)
  })
})
