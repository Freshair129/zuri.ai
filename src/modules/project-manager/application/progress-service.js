import prisma from '@/lib/db'
import { calculateWorkstreamProgress } from '../progress/strategies'
import { rollupProject, rollupBusiness } from '../progress/rollup'
import { safeParse } from './audit'

function hydrateBundle(workstream) {
  return {
    workstream,
    viewConfig: safeParse(workstream.viewConfigJson),
    items: (workstream.items || [])
      .filter((i) => !i.deletedAt)
      .map((i) => ({ ...i, metrics: safeParse(i.metricDataJson), metadata: safeParse(i.metadataJson) })),
    containers: workstream.containers || [],
    milestones: workstream.milestones || [],
    gates: (workstream.gates || []).map((g) => ({ ...g, evidence: safeParse(g.evidenceJson) })),
  }
}

/**
 * Compute progress for one workstream (loads data, runs pure calculator).
 */
export async function computeWorkstreamProgress(workstreamId) {
  const workstream = await prisma.workstream.findUnique({
    where: { id: workstreamId },
    include: { items: true, containers: true, milestones: true, gates: true },
  })
  if (!workstream || workstream.deletedAt) throw new Error('Workstream not found')
  const bundle = hydrateBundle(workstream)
  const result = calculateWorkstreamProgress(workstream.progressStrategy, bundle)
  // Refresh cache (best-effort; progress remains derivable at any time).
  await prisma.workstream.update({
    where: { id: workstreamId },
    data: { progressCache: result.percent },
  })
  return {
    workstreamId,
    code: workstream.code,
    name: workstream.name,
    executionMode: workstream.executionMode,
    progressStrategy: workstream.progressStrategy,
    progressWeight: workstream.progressWeight,
    ...result,
    calculatedAt: new Date().toISOString(),
  }
}

/**
 * Compute project progress: every active workstream + weighted roll-up.
 */
export async function computeProjectProgress(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      workstreams: {
        where: { deletedAt: null, status: { not: 'ARCHIVED' } },
        include: { items: true, containers: true, milestones: true, gates: true },
      },
    },
  })
  if (!project || project.deletedAt) throw new Error('Project not found')
  const workstreamResults = []
  for (const ws of project.workstreams) {
    const bundle = hydrateBundle(ws)
    const result = calculateWorkstreamProgress(ws.progressStrategy, bundle)
    workstreamResults.push({
      workstreamId: ws.id,
      code: ws.code,
      name: ws.name,
      executionMode: ws.executionMode,
      progressStrategy: ws.progressStrategy,
      progressWeight: ws.progressWeight,
      ...result,
    })
    await prisma.workstream.update({ where: { id: ws.id }, data: { progressCache: result.percent } })
  }
  const rollup = rollupProject(workstreamResults)
  return {
    projectId,
    code: project.code,
    name: project.name,
    ...rollup,
    calculatedAt: new Date().toISOString(),
  }
}

// @req FR-020 — group landing: one health card per business.
// Progress is recomputed from the strategies (never read from progressCache),
// so a card can never show a number the project page would disagree with.

const PROJECT_BUNDLE_INCLUDE = {
  business: { select: { id: true, code: true, name: true } },
  workspace: { select: { businessId: true, scopeType: true } },
  milestones: { orderBy: { targetAt: 'asc' } },
  gates: true,
  workstreams: {
    where: { deletedAt: null, status: { not: 'ARCHIVED' } },
    include: { items: true, containers: true, milestones: true, gates: true },
  },
}

function summarizeLoadedProject(project) {
  const rollup = rollupProject(
    project.workstreams.map((ws) => ({
      workstreamId: ws.id,
      progressWeight: ws.progressWeight,
      ...calculateWorkstreamProgress(ws.progressStrategy, hydrateBundle(ws)),
    }))
  )
  return {
    projectId: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    percent: rollup.percent,
    totalWeight: rollup.totalWeight,
    openRequiredGates: project.gates.filter((g) => g.required && !['PASSED', 'WAIVED'].includes(g.status)).length,
    nextMilestone:
      project.milestones.find((m) => m.status !== 'DONE' && m.targetAt) || null,
  }
}

function bucketSummary({ id, code, name }, projects) {
  const rollup = rollupBusiness(projects)
  const upcoming = projects
    .map((p) => p.nextMilestone)
    .filter(Boolean)
    .sort((a, b) => new Date(a.targetAt) - new Date(b.targetAt))[0]
  return {
    id,
    code,
    name,
    percent: rollup.percent,
    totalWeight: rollup.totalWeight,
    projectCount: projects.length,
    activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
    openRequiredGates: projects.reduce((s, p) => s + p.openRequiredGates, 0),
    nextMilestone: upcoming ? { title: upcoming.title, targetAt: upcoming.targetAt } : null,
    warnings: rollup.warnings,
  }
}

/**
 * Group ("ทุกธุรกิจ") roll-up: a card per business plus one for group-level
 * work that lives in PORTFOLIO-scoped workspaces and belongs to no single
 * business.
 */
export async function computePortfolioProgress() {
  const [businesses, projects] = await Promise.all([
    prisma.business.findMany({ orderBy: { code: 'asc' } }),
    prisma.project.findMany({
      where: { deletedAt: null, status: { not: 'ARCHIVED' } },
      include: PROJECT_BUNDLE_INCLUDE,
    }),
  ])
  const summaries = projects.map((p) => ({ ...summarizeLoadedProject(p), businessId: p.businessId || null }))

  const businessCards = businesses.map((b) =>
    bucketSummary(b, summaries.filter((s) => s.businessId === b.id))
  )
  const groupProjects = summaries.filter((s) => !s.businessId)
  const group = groupProjects.length
    ? bucketSummary({ id: null, code: 'GROUP', name: 'งานระดับเครือ' }, groupProjects)
    : null

  const total = rollupBusiness(summaries)
  return {
    businesses: businessCards,
    group,
    total: {
      percent: total.percent,
      projectCount: summaries.length,
      businessCount: businesses.length,
      openRequiredGates: summaries.reduce((s, p) => s + p.openRequiredGates, 0),
    },
    calculatedAt: new Date().toISOString(),
  }
}
