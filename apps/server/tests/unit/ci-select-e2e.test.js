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
