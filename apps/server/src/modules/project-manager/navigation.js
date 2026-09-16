import {
  BriefcaseBusiness,
  Columns3,
  FileText,
  Flag,
  GanttChartSquare,
  Layers,
  ListChecks,
  Map,
  Network,
  Rocket,
  Share2,
  Users,
} from 'lucide-react'

// @req FR-247 — Projects & Work presents six logical modules while retaining
// the existing Business and Project routes. This registry is presentation
// metadata only: grants, route guards, and API ownership remain unchanged.
// @spec ADR-095, docs/architecture/project-manager-system/22-NAVIGATION-IMPLEMENTATION-BASELINE.md
// @tested tests/unit/fr247-navigation.test.js, tests/e2e/fr247-navigation.spec.js

const PROJECT_PREFIX = '/projects/'
const EXECUTION_MODES = new Set([
  'sprint',
  'migration',
  'b2b-sales',
  'b2c-campaign',
  'product-launch',
  'operations',
  'expansion',
])

export const PM_MODULES = [
  {
    id: 'module.project-management',
    label: 'Project Management',
    status: 'CORE_LIVE',
    icon: BriefcaseBusiness,
    businessPath: '/projects',
    projectSuffix: '',
    businessTabs: [
      { id: 'pm.projects', label: 'Projects', legacyBusinessId: 'b.dashboard', path: '/projects' },
    ],
    projectTabs: [
      { id: 'pm.project-overview', label: 'Project Overview', suffix: '' },
      { id: 'pm.inventory', label: 'Inventory', suffix: '/inventory', readOnly: true },
    ],
  },
  {
    id: 'module.work-management',
    label: 'Work Management',
    status: 'CORE_LIVE',
    icon: ListChecks,
    businessPath: '/work',
    projectSuffix: '/structure',
    businessTabs: [
      { id: 'wm.all-work', label: 'All Work', legacyBusinessId: 'b.all-work', path: '/work' },
      { id: 'wm.execution', label: 'Execution', legacyBusinessId: 'b.execution', path: '/execution' },
      { id: 'wm.timeline', label: 'Timeline', legacyBusinessId: 'b.timeline', path: '/timeline' },
      { id: 'wm.dependencies', label: 'Dependencies', legacyBusinessId: 'b.dependencies', path: '/dependencies' },
      { id: 'wm.milestones', label: 'Milestones & Gates', legacyBusinessId: 'b.milestones', path: '/milestones' },
    ],
    // The existing seven-view row is the only Work local view surface.
    projectTabs: [],
  },
  {
    id: 'module.delivery-design',
    label: 'Delivery Design',
    status: 'PLANNED_MODULE',
    icon: FileText,
    businessPath: null,
    projectSuffix: null,
    businessTabs: [
      { id: 'dd.domains', label: 'Domains' },
      { id: 'dd.features', label: 'Features' },
      { id: 'dd.requirements', label: 'Requirements' },
      { id: 'dd.architecture', label: 'Architecture' },
      { id: 'dd.api', label: 'API' },
      { id: 'dd.docs-decisions', label: 'Docs & Decisions' },
    ],
    projectTabs: [],
  },
  {
    id: 'module.resource-coordination',
    label: 'Resource Coordination',
    status: 'CORE_LIVE_WITH_PLANNED_WORKFORCE',
    icon: Users,
    businessPath: '/files',
    projectSuffix: '/team',
    businessTabs: [
      { id: 'rc.files', label: 'Files', legacyBusinessId: 'b.files', path: '/files' },
      { id: 'rc.repositories', label: 'Repositories', legacyBusinessId: 'b.repositories', path: '/repositories' },
    ],
    plannedBusinessTabs: [
      { id: 'rc.resources', label: 'Resources' },
      { id: 'rc.connections', label: 'Connections Used' },
    ],
    projectTabs: [
      { id: 'rc.team', label: 'Team', suffix: '/team' },
      { id: 'rc.files', label: 'Files', suffix: '/files' },
      { id: 'rc.repositories', label: 'Repositories', suffix: '/repositories' },
    ],
    plannedProjectTabs: [
      { id: 'rc.resources', label: 'Resources' },
      { id: 'rc.connections', label: 'Connections Used' },
    ],
  },
  {
    id: 'module.delivery-governance',
    label: 'Delivery Governance',
    status: 'PLANNED_MODULE',
    icon: Network,
    businessPath: null,
    projectSuffix: null,
    businessTabs: [
      { id: 'dg.risks', label: 'Risks' },
      { id: 'dg.reviews', label: 'Reviews' },
      { id: 'dg.test-release', label: 'Test & Release Evidence' },
      { id: 'dg.activity', label: 'Activity' },
    ],
    projectTabs: [],
  },
  {
    id: 'module.agent-delivery',
    label: 'Agent Delivery',
    status: 'PLANNED_MODULE',
    icon: Rocket,
    businessPath: null,
    projectSuffix: null,
    businessTabs: [
      { id: 'ad.command-center', label: 'Command Center' },
      { id: 'ad.agents', label: 'Agents' },
      { id: 'ad.fleets', label: 'Fleets' },
      { id: 'ad.workflows', label: 'Workflows' },
    ],
    projectTabs: [],
  },
]

export const PM_SHARED_ACTIONS = {
  importPlan: {
    id: 'pm.import',
    label: 'Import plan',
    ownerModuleId: 'module.project-management',
    suffix: '/import',
    returnSuffix: '',
  },
}

export const PM_WORK_VIEWS = [
  { id: 'wm.roadmap', key: 'roadmap', label: 'Execution Roadmap', icon: Map, suffix: '/roadmap' },
  { id: 'wm.structure', key: 'structure', label: 'Structure Plan', icon: Layers, suffix: '/structure' },
  { id: 'wm.board', key: 'board', label: 'Board', icon: Columns3, suffix: '/board' },
  { id: 'wm.work-items', key: 'all-work', label: 'Work Items', icon: ListChecks, suffix: '/all-work' },
  { id: 'wm.schedule', key: 'timeline', label: 'Schedule', icon: GanttChartSquare, suffix: '/timeline' },
  { id: 'wm.milestones', key: 'milestones', label: 'Milestones', icon: Flag, suffix: '/milestones' },
  { id: 'wm.dependency-map', key: 'dependencies', label: 'Dependency Map', icon: Share2, suffix: '/dependencies' },
]

// Complete-segment matching prevents `/projects/a` from claiming `/projects/ab`
// and prevents a route segment such as `/projects/a/not-a-project` from being
// mistaken for a known local surface.
export function pathMatches(base, pathname) {
  return pathname === base || pathname.startsWith(`${base}/`)
}

export function projectPath(projectId, suffix = '') {
  return `${PROJECT_PREFIX}${projectId}${suffix}`
}

export function projectIdFromPath(pathname) {
  const match = String(pathname || '').match(/^\/projects\/([^/]+)(?:\/|$)/)
  if (!match || match[1] === 'new') return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

export function moduleForBusinessPath(pathname) {
  return PM_MODULES.find((module) => [module.businessPath, ...(module.businessTabs || []).map((tab) => tab.path)]
    .some((path) => path && pathMatches(path, pathname))) || null
}

export function moduleForProjectPath(pathname, projectId) {
  if (!projectId || !pathMatches(projectPath(projectId), pathname)) return null
  const relative = pathname.slice(projectPath(projectId).length)
  if (
    relative === ''
    || relative === '/inventory'
    || relative === '/import'
    || (relative.startsWith('/execution/') && EXECUTION_MODES.has(relative.slice('/execution/'.length)))
  ) {
    return PM_MODULES[0]
  }
  if (PM_WORK_VIEWS.some((view) => relative === view.suffix)) return PM_MODULES[1]
  if (PM_MODULES[3].projectTabs.some((tab) => relative === tab.suffix)) return PM_MODULES[3]
  return null
}

export function authorizedProjectFromScope(scope, projectId) {
  if (!projectId || !scope || scope.loaded === false || !Array.isArray(scope.projects)) return null
  const businessId = scope.shell?.activeBusinessId || scope.selection?.businessId || null
  if (!businessId) return null
  const project = scope.projects.find((candidate) => candidate.id === projectId)
  if (!project) return null
  if (project.businessId != null && project.businessId !== businessId) return null
  return project
}

export function projectActionPath(projectId, action = PM_SHARED_ACTIONS.importPlan) {
  return projectPath(projectId, action.suffix)
}
