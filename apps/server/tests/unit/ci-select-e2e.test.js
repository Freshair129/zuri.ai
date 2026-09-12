import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { selectE2ETargets } from '../../../../scripts/ci-select-e2e.mjs'
import { workspaceRoot } from '../../scripts/workspace-path.mjs'

const serverRoot = path.resolve(process.cwd())

describe('Selective impact-driven e2e target selection', () => {
  it('skips e2e completely for documentation-only changes', () => {
    const docs = ['docs/architecture/test.md', 'README.md', 'AGENTS.md', '.brain/rca/example.md']
    const result = selectE2ETargets(docs, { serverRoot })
    expect(result.skip).toBe(true)
    expect(result.runAll).toBe(false)
    expect(result.specs).toHaveLength(0)
    expect(result.reason).toBe('documentation-only changes')
  })

  it('selects only SCM specs when SCM code is modified', () => {
    const scmChanges = ['apps/server/src/modules/scm/order-service.js']
    const result = selectE2ETargets(scmChanges, { serverRoot })
    expect(result.skip).toBe(false)
    expect(result.runAll).toBe(false)
    expect(result.specs).toContain('tests/e2e/fr164-procurement.spec.js')
    expect(result.specs).toContain('tests/e2e/fr154-inventory-dashboard.spec.js')
    expect(result.specs).not.toContain('tests/e2e/marketing-campaigns.spec.js')
    expect(result.specs).not.toContain('tests/e2e/fr091-conversation-inbox.spec.js')
  })

  it('selects only CRM and LINE specs when CRM code is modified', () => {
    const crmChanges = ['apps/server/src/modules/crm/conversation-read-model.js']
    const result = selectE2ETargets(crmChanges, { serverRoot })
    expect(result.skip).toBe(false)
    expect(result.runAll).toBe(false)
    expect(result.specs).toContain('tests/e2e/fr091-conversation-inbox.spec.js')
    expect(result.specs).toContain('tests/e2e/fr149-line-server-console.spec.js')
    expect(result.specs).not.toContain('tests/e2e/fr164-procurement.spec.js')
  })

  it('selects only Marketing specs when Growth/Marketing code is modified', () => {
    const mktChanges = ['apps/server/src/modules/marketing/campaigns.js']
    const result = selectE2ETargets(mktChanges, { serverRoot })
    expect(result.skip).toBe(false)
    expect(result.specs).toContain('tests/e2e/marketing-campaigns.spec.js')
    expect(result.specs).toContain('tests/e2e/marketing-strategy.spec.js')
    expect(result.specs).not.toContain('tests/e2e/fr154-inventory-dashboard.spec.js')
  })

  it('selects core smoke and navigation suite when layout/core chrome changes', () => {
    const coreChanges = ['apps/server/src/components/layouts/Topbar.jsx']
    const result = selectE2ETargets(coreChanges, { serverRoot })
    expect(result.skip).toBe(false)
    expect(result.specs).toContain('tests/e2e/smoke.spec.js')
    expect(result.specs).toContain('tests/e2e/navigation-reachability.spec.js')
    expect(result.reason).toBe('core-infrastructure-impact')
  })

  it('includes exact edited spec when an e2e test file is directly modified', () => {
    const testChanges = ['apps/server/tests/e2e/fr184-stocktake.spec.js']
    const result = selectE2ETargets(testChanges, { serverRoot })
    expect(result.skip).toBe(false)
    expect(result.specs).toContain('tests/e2e/fr184-stocktake.spec.js')
    expect(result.reason).toBe('direct-spec-edit')
  })

  // The harness is everything the run stands on rather than anything it
  // exercises: the seed, the Playwright config, global setup, the warm-up.
  // None is a `.spec.js`, so the direct-spec-edit rule misses them; none lives
  // under `src/`, so the server-code fallback misses them too — and before
  // this they selected nothing at all, which meant a change to the one file
  // that can kill every spec was the one change e2e never ran for.
  it.each([
    ['the database seed', 'apps/server/prisma/seed.js'],
    ['the Playwright config', 'apps/server/playwright.config.js'],
    ['e2e global setup', 'apps/server/tests/e2e/global-setup.js'],
    ['the route warm-up', 'apps/server/tests/e2e/warmup.setup.js'],
  ])('runs the core suite when %s changes on its own', (_label, file) => {
    const result = selectE2ETargets([file], { serverRoot })
    expect(result.skip).toBe(false)
    expect(result.specs).toContain('tests/e2e/smoke.spec.js')
    expect(result.reason).toBe('core-infrastructure-impact')
  })

  // Why the seed specifically: it runs inside global-setup before any spec, and
  // no unit or integration test executes it — they build rows through
  // tests/factories/*. On 2026-09-12 a seed break (ADR-078 D1 rescoped
  // LegalEntity to the Tenant; seed.js still passed the dropped `portfolioId`)
  // killed the whole e2e suite while 4,923 unit and integration tests passed.
  it('does not let a seed-only change slip through as documentation', () => {
    const result = selectE2ETargets(['apps/server/prisma/seed.js'], { serverRoot })
    expect(result.reason).not.toBe('documentation-only changes')
    expect(result.reason).not.toBe('no matching e2e targets found')
  })

  it('returns runAll when forceAll is requested', () => {
    const result = selectE2ETargets(['anything.js'], { forceAll: true, serverRoot })
    expect(result.runAll).toBe(true)
    expect(result.skip).toBe(false)
  })

  it('CLI outputs valid key=value pairs consumable by GitHub Actions', () => {
    const scriptPath = path.join(workspaceRoot(process.cwd()), 'scripts/ci-select-e2e.mjs')
    const run = spawnSync(process.execPath, [scriptPath], {
      input: 'apps/server/src/modules/scm/test.js\n',
      encoding: 'utf8',
    })
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('run_all=false')
    expect(run.stdout).toContain('skip=false')
    expect(run.stdout).toContain('tests/e2e/fr164-procurement.spec.js')
  })
})
