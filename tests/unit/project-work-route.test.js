// @req FR-006, FR-012, FR-040, FR-068 — Project Work owns the Execution
// Roadmap and its Structure Plan, Board, Schedule, Milestones & Gates, and
// Dependency Map views; Project Import is a first-class Project resource.
// @spec SDD-019, SDD-039, ADR-012, ADR-028
// @tested tests/unit/project-work-route.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workTabs = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/WorkViewTabs.jsx'), 'utf8')
const dependencyMapRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/dependencies/page.jsx'), 'utf8')
const milestonesRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/milestones/page.jsx'), 'utf8')
const timelineRoute = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/timeline/page.jsx'), 'utf8')
const projectLayout = readFileSync(resolve(process.cwd(), 'src/app/(pm)/projects/[projectId]/layout.jsx'), 'utf8')
const projectTabs = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ProjectTabs.jsx'), 'utf8')

describe('Project Work navigation boundary', () => {
  it('exposes all Work sub-views without promoting Dependency Map to a sidebar domain', () => {
    expect(workTabs).toContain("label: 'Execution Roadmap'")
    expect(workTabs).toContain("/projects/${projectId}/roadmap")
    expect(workTabs).toContain("label: 'Structure Plan'")
    expect(workTabs).toContain("label: 'Board'")
    expect(workTabs).toContain("label: 'Schedule'")
    expect(workTabs).toContain("label: 'Milestones & Gates'")
    expect(workTabs).toContain("/projects/${projectId}/milestones")
    expect(workTabs).toContain("label: 'Dependency Map'")
    expect(workTabs).toContain("/projects/${projectId}/dependencies")
    expect(workTabs).toContain("aria-current={active ? 'page' : undefined}")
  })

  it('keeps Schedule and Milestones inside the same project Work shell', () => {
    expect(timelineRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(timelineRoute).toContain('title="Schedule"')
    expect(milestonesRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(milestonesRoute).toContain('title="Milestones & Gates"')
    expect(milestonesRoute).toContain('<MilestonesView projectId={projectId} />')
  })

  it('exposes Project Import as a first-class resource tab', () => {
    expect(projectTabs).toContain("label: 'Import'")
    expect(projectTabs).toContain('/projects/${id}/import')
    expect(projectLayout).toContain("['import', ['/import']]")
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
