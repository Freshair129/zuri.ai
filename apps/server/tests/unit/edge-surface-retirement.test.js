// @req ADR-109 D1-D3 — retired Edge Device and harness routes stay absent while
//   the signed LINE ingress, PRP key flow and historical records remain.
// @tested tests/unit/edge-surface-retirement.test.js
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')
const exists = (file) => existsSync(resolve(process.cwd(), file))
const pluginRoot = resolve(process.cwd(), '..', '..', 'plugins', 'zuri-harness')

function pluginFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? pluginFiles(path) : [path]
  })
}

describe('ADR-109 Edge Device and harness retirement', () => {
  it.each([
    'src/app/api/agent/heartbeat/route.js',
    'src/app/api/agent/line-webhook/route.js',
    'src/app/api/agent/line-delivery/route.js',
    'src/app/api/agent/line-asset-handoff/route.js',
    'src/app/api/edge/pairing/start/route.js',
    'src/app/api/edge/extraction-jobs/claim/route.js',
    'src/app/api/platform/edge-devices/credentials/route.js',
    'src/app/api/platform/harness-pairing/start/route.js',
    'src/app/api/platform/harness-devices/route.js',
    'src/app/api/platform/programme-usage-reports/whoami/route.js',
    'src/app/edge/pair/page.jsx',
    'src/app/harness/pair/page.jsx',
    'src/modules/identity/edge-device-credential.js',
    'src/modules/identity/harness-credential.js',
    'src/modules/asset-management/application/asset-extraction-provider.js',
  ])('removes retired surface %s', (file) => expect(exists(file), file).toBe(false))

  it('keeps only the server signed LINE ingress and the PRP model-key card', () => {
    expect(exists('src/app/api/line-oa/accounts/[id]/webhook/route.js')).toBe(true)
    const accountConsole = read('src/modules/line-oa-studio/ui/LineStudioAccountConsole.jsx')
    expect(accountConsole).toContain('LineOaModelKeyCard')
    expect(accountConsole).toContain('/api/integration/model-providers?businessId=')
    expect(accountConsole).not.toMatch(/edge-pairing|edge-devices|จับคู่ Edge/i)
  })

  it('removes harness plugin source without editing shared registries', () => {
    expect(pluginFiles(pluginRoot)).toEqual([])
  })

  it('retains historical models and the existing backup exclusion policy', () => {
    const schema = read('prisma/schema.prisma')
    for (const model of ['EdgeDeviceCredential', 'AssetExtractionJob', 'HarnessCredential', 'ProgrammeUsageReport']) {
      expect(schema).toMatch(new RegExp(`model ${model} \\{`))
    }
    const backup = read('src/modules/project-manager/application/backup-service.js')
    expect(backup).toContain('SNAPSHOT_EXCLUDED_MODELS')
    for (const model of ['assetExtractionJob', 'harnessCredential', 'edgeDeviceCredential']) {
      expect(backup).toMatch(new RegExp(`${model}\\s*:`))
    }
  })
})
