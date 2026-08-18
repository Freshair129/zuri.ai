// @req FR-040, FR-068 — Project Work owns the Execution Roadmap and its
// existing Structure Plan, Board, Schedule, and Dependency Map views.
// @spec SDD-019, SDD-039, ADR-012, ADR-028
// @tested tests/unit/project-work-route.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workTabs = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/WorkViewTabs.jsx'), 'utf8')
const dependencyMapRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/dependencies/page.jsx'), 'utf8')
const projectLayout = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/layout.jsx'), 'utf8')

describe('Project Work navigation boundary', () => {
  it('exposes all Work sub-views without promoting Dependency Map to a sidebar domain', () => {
    expect(workTabs).toContain("label: 'Execution Roadmap'")
    expect(workTabs).toContain("/projects/${projectId}/roadmap")
    expect(workTabs).toContain("label: 'Structure Plan'")
    expect(workTabs).toContain("label: 'Board'")
    expect(workTabs).toContain("label: 'Schedule'")
    expect(workTabs).toContain("label: 'Dependency Map'")
    expect(workTabs).toContain("/projects/${projectId}/dependencies")
    expect(workTabs).toContain("aria-current={active ? 'page' : undefined}")
  })

  it('keeps the Dependency Map route inside the project Work shell', () => {
    expect(dependencyMapRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(dependencyMapRoute).toContain('title="Dependency Map"')
    expect(dependencyMapRoute).toContain('/api/projects/${projectId}/dependencies')
    expect(dependencyMapRoute).toContain('<LoadingCard />')
    expect(dependencyMapRoute).toContain('<ErrorState')
    expect(dependencyMapRoute).not.toContain('DependenciesView')
  })

  it('uses one canonical Project tab bar without the retired duplicate project-view rail', () => {
    expect(projectLayout).toContain('<ProjectTabs projectId={projectId} active={active} />')
    expect(projectLayout).not.toContain('aria-label="Project views"')
    expect(projectLayout).not.toContain("label: 'Dependencies'")
  })
})
