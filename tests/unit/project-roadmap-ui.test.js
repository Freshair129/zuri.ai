// @req FR-068 — the Roadmap UI is a Project Work sub-view and displays linked
// Business Goals from the single authorized read model.
// @spec SDD-039, ADR-028
// @tested tests/unit/project-roadmap-ui.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/roadmap/page.jsx'), 'utf8')
const route = readFileSync(resolve(process.cwd(), 'src/app/api/projects/[id]/roadmap/route.js'), 'utf8')

describe('Execution Roadmap UI boundary', () => {
  it('uses one Project Roadmap response and renders Business Goals', () => {
    expect(page).toContain("/api/projects/${projectId}/roadmap")
    expect(page).toContain('Business Goals')
    expect(page).toContain('No Business Goals linked')
    expect(page).toContain('aria-label="Roadmap dependency list"')
    expect(page).toContain('<WorkViewTabs projectId={projectId} />')
  })

  it('authorizes the server-side Roadmap route through the request viewer', () => {
    expect(route).toContain('resolveRequestViewer(request)')
    expect(route).toContain('getProjectRoadmap(params.id, { viewer })')
  })
})
