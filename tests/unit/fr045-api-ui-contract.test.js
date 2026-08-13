// @req FR-045 — Business and Project File Manager surfaces use the managed API.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')

describe('FR-045 API and UI contract', () => {
  it('provides managed list/create, Business aggregate, migration, reconcile, cache, mount and reveal routes', () => {
    for (const path of [
      'src/app/api/files/route.js',
      'src/app/api/business/files/route.js',
      'src/app/api/files/migrate/route.js',
      'src/app/api/files/reconcile/route.js',
      'src/app/api/files/cache/rebuild/route.js',
      'src/app/api/files/mounts/route.js',
      'src/app/api/files/[id]/reveal/route.js',
      'src/app/api/files/[id]/content/route.js',
      'src/app/api/files/[id]/relink/route.js',
      'src/app/api/files/[id]/route.js',
    ]) expect(fs.existsSync(path), path).toBe(true)
  })

  it('exposes Business Files in Development and replaces metadata-only Project copy', () => {
    expect(read('src/config/domains.js')).toContain("{ label: 'Files', path: '/files'")
    expect(read('src/app/(pm)/files/page.jsx')).toContain('ManagedFilesPanel')
    const projectPage = read('src/app/(pm)/projects/[projectId]/files/page.jsx')
    expect(projectPage).toContain('ManagedFilesPanel')
    expect(projectPage).not.toContain('does not upload or store binary content')
    const panel = read('src/modules/project-manager/components/ManagedFilesPanel.jsx')
    expect(panel).toContain('/api/business/files')
    expect(panel).toContain('/api/files?projectId=')
  })
})
