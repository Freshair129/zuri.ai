// @req FR-045 — Business and Project File Manager surfaces use the managed API.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { api } from '@/modules/project-manager/components/useApi'

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

  // T3b-1 FIX 6: api() surfaced only err.message, so a status-dependent UI
  // branch (e.g. FR-059's "already linked" 409 handling in
  // StrategyEditModals.jsx) had to sniff message text — reword the server
  // message and the branch silently degrades. Purely additive: every
  // existing consumer reads only `.message` and is unaffected.
  describe('api() attaches the HTTP status to the thrown Error', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('sets error.status to the response status on a non-ok response, alongside the existing message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: false,
          status: 409,
          json: async () => ({ error: 'Project is already linked to this Goal' }),
        }))
      )
      await expect(api('/api/business/goals/g1/projects', { method: 'POST', body: { projectId: 'p1' } })).rejects.toMatchObject({
        message: 'Project is already linked to this Goal',
        status: 409,
      })
    })

    it('does not attach a status (or throw) on a successful response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({ id: 'g1' }),
        }))
      )
      await expect(api('/api/business/goals/g1')).resolves.toEqual({ id: 'g1' })
    })
  })
})
