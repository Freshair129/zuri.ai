import prisma from '@/lib/db'
import { calculateWorkstreamProgress } from '../progress/strategies'
import { rollupProject } from '../progress/rollup'
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
