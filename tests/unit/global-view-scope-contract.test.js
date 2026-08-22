// @req FR-006, FR-007, FR-064 — global views read the selected Business scope.
// @spec SEC-001, SEC-008
// @tested tests/unit/global-view-scope-contract.test.js, tests/e2e/smoke.spec.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8')

describe('global view scope contracts', () => {
  it('passes the selected Business to dependencies and milestones reads', () => {
    const dependencies = read('src/modules/project-manager/views/universal/DependenciesView.jsx')
    const milestones = read('src/modules/project-manager/views/universal/MilestonesView.jsx')

    expect(dependencies).toContain('scope.shell.activeBusinessId')
    expect(dependencies).toContain("params.set('businessId', businessId)")
    expect(milestones).toContain('scope.shell.activeBusinessId')
    expect(milestones).toContain("params.set('businessId', businessId)")
  })
})
