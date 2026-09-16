// @req FR-006, FR-012, FR-040, FR-068, FR-250, FR-251 — Project Work owns one
// seven-view local row; Project Management and Resource Coordination own their
// own local tabs; Delivery Design owns the read-only Execution Domains tab; and
// Import is one shared Project action.
// @spec SDD-019, SDD-039, ADR-012, ADR-028, ADR-096
// @tested tests/unit/project-work-route.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PM_MODULES, PM_SHARED_ACTIONS, PM_WORK_VIEWS } from '@/modules/project-manager/navigation'
import ProjectTabs from '@/modules/project-manager/components/ProjectTabs'

globalThis.React = React

vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ href, children, ...rest }) => createElement(
      'a',
      { href: typeof href === 'string' ? href : href?.pathname || '', ...rest },
      children,
    ),
  }
})

let currentPath = '/projects/project-1'
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}))

const ROOT = process.cwd()
const src = (path) => readFileSync(resolve(ROOT, path), 'utf8')
const workTabs = src('src/modules/project-manager/components/WorkViewTabs.jsx')
const projectTabs = src('src/modules/project-manager/components/ProjectTabs.jsx')
const businessNav = src('src/modules/project-manager/components/ProjectManagerBusinessNav.jsx')
const projectLayout = src('src/app/(pm)/projects/[projectId]/layout.jsx')
const dependencyMapRoute = src('src/app/(pm)/projects/[projectId]/dependencies/page.jsx')
const milestonesRoute = src('src/app/(pm)/projects/[projectId]/milestones/page.jsx')
const timelineRoute = src('src/app/(pm)/projects/[projectId]/timeline/page.jsx')

function renderedHrefs(module) {
  currentPath = `/projects/project-1${module.projectSuffix || ''}`
  const html = renderToStaticMarkup(createElement(ProjectTabs, {
    projectId: 'project-1',
    activeModule: module,
    authorizedProject: { id: 'project-1', businessId: 'business-1' },
  }))
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
}

describe('Project Manager hierarchical navigation boundary', () => {
  it('exposes exactly seven Work sub-views from one local navigation source', () => {
    expect(PM_WORK_VIEWS).toHaveLength(7)
    expect(workTabs).toContain('PM_WORK_VIEWS')
    expect(workTabs).toContain('aria-label="Project work views"')
    expect(workTabs).toContain("aria-current={active ? 'page' : undefined}")
    expect(workTabs).toContain('PM_WORK_VIEWS.map')
    expect(workTabs).toContain('view.suffix')
    expect(workTabs).toContain('{v.label}')
    expect(workTabs).not.toContain("label: 'Import'")
  })

  it('keeps the Project-local module bars separate from the Work view row', () => {
    const projectManagement = PM_MODULES.find((module) => module.id === 'module.project-management')
    const workManagement = PM_MODULES.find((module) => module.id === 'module.work-management')
    const projectHrefs = renderedHrefs(projectManagement)
    const workHrefs = renderedHrefs(workManagement)
    expect(projectHrefs).toEqual(expect.arrayContaining([
      '/projects/project-1',
      '/projects/project-1/inventory',
    ]))
    expect(workHrefs).not.toContain('/projects/project-1/inventory')
    expect(workHrefs).not.toContain('/projects/project-1/team')
    expect(workHrefs).not.toContain('/projects/project-1/repositories')
    expect(workManagement.projectTabs).toEqual([])
    expect(workTabs).toContain('PM_WORK_VIEWS')
    expect(projectTabs).toContain('data-local-surface-scope="PROJECT"')
    expect(projectTabs).toContain('project sections')
    expect(projectTabs).not.toContain('aria-label="Project sections"')
    expect(projectTabs).not.toContain('const TABS = [')
    expect(projectTabs).not.toContain('const PLANNED = [')
    expect(projectTabs).not.toContain("label: 'Import'")
    expect(projectTabs).not.toContain("key: 'import'")
  })

  it('keeps Project Management and Resource Coordination local ownership explicit', () => {
    const projectManagement = PM_MODULES.find((module) => module.id === 'module.project-management')
    const resources = PM_MODULES.find((module) => module.id === 'module.resource-coordination')
    const deliveryDesign = PM_MODULES.find((module) => module.id === 'module.delivery-design')
    expect(projectManagement.projectTabs.map((tab) => tab.label)).toEqual(['Project Overview', 'Inventory'])
    expect(resources.projectTabs.map((tab) => tab.label)).toEqual(['Team', 'Files', 'Repositories'])
    expect(deliveryDesign.projectTabs).toEqual([
      { id: 'dd.domains', label: 'Execution Domains', suffix: '/domain-view', readOnly: true },
    ])
    expect(renderedHrefs(deliveryDesign)).toEqual(expect.arrayContaining([
      '/projects/project-1/domain-view',
      '/projects/project-1/import',
    ]))
    expect(renderedHrefs(deliveryDesign)).not.toContain('/projects/project-1/features')
    expect(projectTabs).toContain('pm.inventory')
    expect(projectTabs).toContain('rc.team')
    expect(projectTabs).toContain('rc.repositories')
    expect(projectTabs).toContain('readOnly')
  })

  it('renders the one PM-owned Import action with a current cue and Project return path', () => {
    expect(PM_SHARED_ACTIONS.importPlan).toMatchObject({
      id: 'pm.import',
      label: 'Import plan',
      ownerModuleId: 'module.project-management',
      suffix: '/import',
      returnSuffix: '',
    })
    expect(projectTabs).toContain('data-action-id={PM_SHARED_ACTIONS.importPlan.id}')
    expect(projectTabs).toContain('data-owner-module-id={PM_SHARED_ACTIONS.importPlan.ownerModuleId}')
    expect(projectTabs).toContain('aria-current={importIsCurrent ? \'page\' : undefined}')
    expect(projectTabs).toContain('data-return-path={returnHref}')
    expect(projectTabs).toContain('Back to Project')
    // Import is an action reference, never a second local tab definition.
    expect(projectTabs).not.toContain('projectTabs.some')
  })

  it('keeps named planned Business content visible without emitting fake hrefs', () => {
    const plannedDomainTabs = PM_MODULES
      .filter((module) => module.status === 'PLANNED_MODULE')
      .flatMap((module) => module.businessTabs)
    const resourceCoordination = PM_MODULES.find((module) => module.id === 'module.resource-coordination')
    const plannedResourceTabs = resourceCoordination.plannedBusinessTabs || []
    const planned = [...plannedDomainTabs, ...plannedResourceTabs]
    for (const label of ['Requirements', 'Risks', 'Resources']) {
      expect(planned.some((tab) => tab.label === label)).toBe(true)
    }
    expect(plannedDomainTabs.map((tab) => tab.label)).toEqual(expect.arrayContaining(['Requirements', 'Risks']))
    expect(plannedResourceTabs.map((tab) => tab.label)).toContain('Resources')
    expect(planned.every((tab) => !tab.path)).toBe(true)
    expect(businessNav).toContain('aria-disabled="true"')
    expect(businessNav).toContain('data-local-surface-scope="BUSINESS"')
    expect(businessNav).toContain('Planned')
    expect(businessNav).not.toMatch(/<a[^>]+href=[^>]+>[^<]*(Requirements|Risks|Resources)/)
  })

  it('derives one active module from the guarded Project context without substring matching', () => {
    expect(projectLayout).toContain('useScope()')
    expect(projectLayout).toContain('authorizedProjectFromScope(scope, projectId)')
    expect(projectLayout).toContain('moduleForProjectPath(pathname, projectId)')
    expect(projectLayout).toContain('authorizedProject={authorizedProject}')
    expect(projectLayout).not.toContain('TAB_SUFFIXES')
    expect(projectLayout).not.toContain('pathname.includes(')
  })

  it('keeps all Work destinations in the same shell so sibling navigation remains two-way', () => {
    expect(timelineRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(milestonesRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(dependencyMapRoute).toContain('<WorkViewTabs projectId={projectId} />')
    expect(dependencyMapRoute).toContain('title="Dependency Map"')
    expect(dependencyMapRoute).toContain('/api/projects/${projectId}/dependencies')
    expect(dependencyMapRoute).toContain('<LoadingCard />')
    expect(dependencyMapRoute).toContain('<ErrorState')
    expect(dependencyMapRoute).not.toContain('DependenciesView')
  })
})
