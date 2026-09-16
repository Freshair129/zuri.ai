// @req FR-250 — Projects & Work keeps one domain identity while presenting
// six logical modules, scoped Project surfaces, and one shared Import action.
// @spec ADR-096, docs/architecture/project-manager-system/22-NAVIGATION-IMPLEMENTATION-BASELINE.md
// @tested tests/unit/fr250-navigation.test.js
import { describe, expect, it } from 'vitest'
import { EXECUTION_NAV } from '@/config/modules'
import {
  PM_MODULES,
  PM_SHARED_ACTIONS,
  PM_WORK_VIEWS,
  authorizedProjectFromScope,
  moduleForBusinessPath,
  moduleForProjectPath,
  pathMatches,
  projectActionPath,
  projectIdFromPath,
  projectPath,
} from '@/modules/project-manager/navigation'

const MODULE_LABELS = [
  'Project Management',
  'Work Management',
  'Delivery Design',
  'Resource Coordination',
  'Delivery Governance',
  'Agent Delivery',
]

const PROJECT_ID = 'project-01'

describe('FR-250 Projects & Work navigation registry', () => {
  it('declares exactly six logical modules with three live and three planned entries', () => {
    expect(PM_MODULES).toHaveLength(6)
    expect(PM_MODULES.map((module) => module.label)).toEqual(MODULE_LABELS)
    expect(PM_MODULES.map((module) => module.id)).toEqual([
      'module.project-management',
      'module.work-management',
      'module.delivery-design',
      'module.resource-coordination',
      'module.delivery-governance',
      'module.agent-delivery',
    ])

    expect(PM_MODULES.filter((module) => module.status === 'PLANNED_MODULE')).toHaveLength(3)
    expect(PM_MODULES.filter((module) => module.status !== 'PLANNED_MODULE')).toHaveLength(3)
    expect(PM_MODULES.filter((module) => module.status === 'PLANNED_MODULE').every((module) => {
      return module.businessPath === null && module.projectSuffix === null
    })).toBe(true)
  })

  it('accounts for the eight existing Business destinations without inventing planned hrefs', () => {
    const liveBusinessTabs = PM_MODULES
      .flatMap((module) => module.businessTabs)
      .filter((tab) => typeof tab.path === 'string')
    expect(liveBusinessTabs).toHaveLength(8)
    expect(liveBusinessTabs.map((tab) => tab.path)).toEqual([
      '/projects',
      '/work',
      '/execution',
      '/timeline',
      '/dependencies',
      '/milestones',
      '/files',
      '/repositories',
    ])

    const plannedTabs = PM_MODULES
      .filter((module) => module.status === 'PLANNED_MODULE')
      .flatMap((module) => module.businessTabs)
    expect(plannedTabs.length).toBeGreaterThan(0)
    expect(plannedTabs.every((tab) => !Object.prototype.hasOwnProperty.call(tab, 'path'))).toBe(true)
  })

  it('keeps the seven Work views in one Project-local view group with Structure as entry', () => {
    expect(PM_WORK_VIEWS).toHaveLength(7)
    expect(PM_WORK_VIEWS.map((view) => view.key)).toEqual([
      'roadmap',
      'structure',
      'board',
      'all-work',
      'timeline',
      'milestones',
      'dependencies',
    ])
    expect(PM_MODULES.find((module) => module.id === 'module.work-management')).toMatchObject({
      businessPath: '/work',
      projectSuffix: '/structure',
      projectTabs: [],
    })
    expect(PM_WORK_VIEWS.find((view) => view.key === 'structure')).toMatchObject({
      id: 'wm.structure',
      suffix: '/structure',
    })
  })

  it('keeps Project Management and Resource Coordination project surfaces distinct', () => {
    const projectManagement = PM_MODULES.find((module) => module.id === 'module.project-management')
    const resources = PM_MODULES.find((module) => module.id === 'module.resource-coordination')

    expect(projectManagement.projectTabs).toEqual([
      { id: 'pm.project-overview', label: 'Project Overview', suffix: '' },
      { id: 'pm.inventory', label: 'Inventory', suffix: '/inventory', readOnly: true },
    ])
    expect(resources.projectTabs.map((tab) => tab.id)).toEqual([
      'rc.team',
      'rc.files',
      'rc.repositories',
    ])
    expect(resources.projectTabs.map((tab) => tab.suffix)).toEqual([
      '/team',
      '/files',
      '/repositories',
    ])
    expect(resources.plannedProjectTabs.map((tab) => tab.id)).toContain('rc.resources')
    expect(resources.plannedProjectTabs.every((tab) => !Object.prototype.hasOwnProperty.call(tab, 'suffix'))).toBe(true)
  })

  it('defines one PM-owned Import action and no local Import tab', () => {
    expect(PM_SHARED_ACTIONS).toEqual({
      importPlan: {
        id: 'pm.import',
        label: 'Import plan',
        ownerModuleId: 'module.project-management',
        suffix: '/import',
        returnSuffix: '',
      },
    })
    expect(PM_MODULES.flatMap((module) => module.projectTabs).some((tab) => /import/i.test(tab.id))).toBe(false)
    expect(PM_MODULES.flatMap((module) => module.businessTabs).some((tab) => /import/i.test(tab.id))).toBe(false)
    expect(projectActionPath(PROJECT_ID)).toBe(`/projects/${PROJECT_ID}/import`)
    expect(projectActionPath(PROJECT_ID)).toBe(projectPath(PROJECT_ID, PM_SHARED_ACTIONS.importPlan.suffix))
  })

  it('maps complete Business and Project segments to the intended module', () => {
    const businessModules = [
      ['/projects', 'module.project-management'],
      ['/work', 'module.work-management'],
      ['/execution', 'module.work-management'],
      ['/timeline', 'module.work-management'],
      ['/dependencies', 'module.work-management'],
      ['/milestones', 'module.work-management'],
      ['/files', 'module.resource-coordination'],
      ['/repositories', 'module.resource-coordination'],
    ]
    for (const [path, moduleId] of businessModules) {
      expect(moduleForBusinessPath(path), path).toMatchObject({ id: moduleId })
    }
    expect(moduleForBusinessPath('/projects/not-a-project')).toMatchObject({ id: 'module.project-management' })
    expect(moduleForBusinessPath('/workbench')).toBeNull()

    expect(moduleForProjectPath(`/projects/${PROJECT_ID}`, PROJECT_ID)).toMatchObject({ id: 'module.project-management' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/inventory`, PROJECT_ID)).toMatchObject({ id: 'module.project-management' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/structure`, PROJECT_ID)).toMatchObject({ id: 'module.work-management' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/team`, PROJECT_ID)).toMatchObject({ id: 'module.resource-coordination' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/files`, PROJECT_ID)).toMatchObject({ id: 'module.resource-coordination' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/repositories`, PROJECT_ID)).toMatchObject({ id: 'module.resource-coordination' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/import`, PROJECT_ID)).toMatchObject({ id: 'module.project-management' })
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/unknown`, PROJECT_ID)).toBeNull()
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/execution`, PROJECT_ID)).toBeNull()
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}x/structure`, PROJECT_ID)).toBeNull()
  })

  it('uses complete path segments and keeps authorized Project lookup on scope.projects', () => {
    expect(pathMatches('/projects/project-01', '/projects/project-01/structure')).toBe(true)
    expect(pathMatches('/projects/project-01', '/projects/project-010/structure')).toBe(false)
    expect(pathMatches('/work', '/workbench')).toBe(false)
    expect(projectIdFromPath('/projects/project-01/structure')).toBe(PROJECT_ID)
    expect(projectIdFromPath('/projects/project-01x/structure')).toBe('project-01x')
    expect(projectIdFromPath('/projects/project%2F01/structure')).toBe('project/01')
    expect(projectIdFromPath('/projects')).toBeNull()
    expect(projectIdFromPath('/projects/new')).toBeNull()

    const authorized = { id: PROJECT_ID, code: 'PRJ-01', name: 'Authorized project', businessId: 'business-01' }
    const shared = { id: 'shared-project', code: 'PRJ-SHARED', name: 'Shared project', businessId: null }
    const scope = {
      loaded: true,
      selection: { businessId: 'business-01' },
      projects: [authorized, shared],
      shell: { activeBusinessId: 'business-01' },
      // This filtered projection must not become the authorization source.
      scopedProjects: [],
    }
    expect(authorizedProjectFromScope(scope, PROJECT_ID)).toEqual(authorized)
    expect(authorizedProjectFromScope(scope, 'shared-project')).toEqual(shared)
    expect(authorizedProjectFromScope(scope, 'foreign-project')).toBeNull()
    expect(authorizedProjectFromScope({ ...scope, loaded: false }, PROJECT_ID)).toBeNull()
    expect(authorizedProjectFromScope({ ...scope, selection: {}, shell: {} }, PROJECT_ID)).toBeNull()
    expect(authorizedProjectFromScope({ ...scope, projects: [{ ...authorized, businessId: 'business-02' }] }, PROJECT_ID)).toBeNull()
  })

  it('retains all seven canonical execution modes under the existing Project parent', () => {
    expect(EXECUTION_NAV.map((view) => view.slug)).toEqual([
      'sprint',
      'migration',
      'b2b-sales',
      'b2c-campaign',
      'product-launch',
      'operations',
      'expansion',
    ])
    expect(EXECUTION_NAV).toHaveLength(7)
    for (const mode of EXECUTION_NAV) {
      expect(moduleForProjectPath(`/projects/${PROJECT_ID}/execution/${mode.slug}`, PROJECT_ID)).toMatchObject({
        id: 'module.project-management',
      })
    }
    expect(moduleForProjectPath(`/projects/${PROJECT_ID}/execution/not-a-mode`, PROJECT_ID)).toBeNull()
  })
})
