import prisma from '@/lib/db'
// @req FR-268, SDD-107 — pure calculators; this read model calls them the
// same way project-roadmap-read-model.js already calls calculateWorkstreamProgress
// before returning, rather than leaving every consumer to duplicate the math.
import { keyResultProgress, expectedProgress } from '@/modules/project-manager/progress/key-result-progress'

// @req FR-041, FR-043 - Business Overview needs a Business-level Roadmap and
// direct Project Business ownership for goal links.
// @spec ADR-013, SDD-020, BR-001 - strategy belongs to Business; never infer it from Organization.
// @tested tests/unit/business-strategy-service.test.js

function serializeCheckIn(checkIn) {
  return {
    id: checkIn.id,
    weekStartAt: checkIn.weekStartAt,
    value: checkIn.value,
    confidence: checkIn.confidence,
    note: checkIn.note,
    source: checkIn.source,
    actorPersonId: checkIn.actorPersonId,
  }
}

// @req FR-268, SDD-107 — additive: progress/expectedProgress are never
// stored on BusinessKeyResult, so every reader (this file, the mutation
// service, the UI) computes them the same way from the same raw facts,
// rather than one of them trusting a cached number the others do not.
function serializeKeyResult(kr, now) {
  const checkIns = [...(kr.checkIns || [])].sort((a, b) => new Date(a.weekStartAt) - new Date(b.weekStartAt))
  const latest = checkIns[checkIns.length - 1]
  const current = latest ? latest.value : kr.baseline
  return {
    id: kr.id,
    code: kr.code,
    title: kr.title,
    metric: kr.metric,
    unit: kr.unit,
    baseline: kr.baseline,
    target: kr.target,
    direction: kr.direction,
    dueAt: kr.dueAt,
    ownerPersonId: kr.ownerPersonId,
    confidence: kr.confidence,
    status: kr.status,
    current,
    progress: keyResultProgress(kr, current),
    expectedProgress: expectedProgress(kr, now),
    checkIns: checkIns.map(serializeCheckIn),
  }
}

function projectLink(project, businessId) {
  const ownerId = project && project.businessId !== undefined
    ? project.businessId
    : project?.workspace?.businessId || null
  if (!project || ownerId !== businessId) return null
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
  }
}

function serializeGoal(goal, businessId, now) {
  const keyResults = (goal.keyResults || []).map((kr) => serializeKeyResult(kr, now))
  return {
    id: goal.id,
    code: goal.code,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    priority: goal.priority,
    perspective: goal.perspective,
    isWig: goal.isWig,
    progress: goal.progress,
    // @req SDD-107 — which of the two writers `progress` currently reflects.
    // Additive: a goal with no active Key Result reads exactly as it always
    // has, MANUAL, because that is what it has always been.
    progressSource: keyResults.length > 0 ? 'KEY_RESULTS' : 'MANUAL',
    startAt: goal.startAt,
    targetAt: goal.targetAt,
    projects: (goal.projects || [])
      .map((link) => projectLink(link.project, businessId))
      .filter(Boolean),
    keyResults,
  }
}

function serializeRoadmap(roadmap, businessId, now) {
  const horizons = [...(roadmap.horizons || [])]
    .sort((a, b) => a.position - b.position)
    .map((horizon) => ({
      id: horizon.id,
      key: horizon.key,
      label: horizon.label,
      position: horizon.position,
      description: horizon.description,
      targetAt: horizon.targetAt,
      goals: (horizon.goals || []).map((goal) => serializeGoal(goal, businessId, now)),
    }))

  if (horizons.length < 2 || horizons.length > 3) {
    throw new Error('Business roadmap must have 2 or 3 horizons')
  }

  return {
    id: roadmap.id,
    code: roadmap.code,
    title: roadmap.title,
    description: roadmap.description,
    status: roadmap.status,
    startAt: roadmap.startAt,
    targetAt: roadmap.targetAt,
    horizons,
  }
}

/**
 * Read the strategy owned by one Business. `visibleBusinessIds` is supplied by
 * the viewer gate at the route boundary and is also accepted here so tests can
 * prove isolation without relying on a global identity.
 */
export async function getBusinessStrategy(
  businessId,
  { db = prisma, visibleBusinessIds = null, now = Date.now() } = {},
) {
  if (!businessId) throw new Error('businessId is required')
  if (visibleBusinessIds && !visibleBusinessIds.includes(businessId)) {
    throw new Error('Business access denied')
  }

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      tenantId: true,
      roadmaps: {
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
        include: {
          horizons: {
            orderBy: { position: 'asc' },
            include: {
              goals: {
                where: { businessId, status: { not: 'ARCHIVED' } },
                orderBy: { code: 'asc' },
                include: {
                  projects: {
                    include: {
                      project: {
                        select: {
                          id: true,
                          code: true,
                          name: true,
                          status: true,
                          businessId: true,
                          workspace: { select: { businessId: true } },
                        },
                      },
                    },
                  },
                  // @req FR-268 — additive. Up to 13 check-ins (a quarter of
                  // weeks) per Key Result, the same bound the mutation
                  // service's KEY_RESULT_INCLUDE uses.
                  keyResults: {
                    where: { status: { not: 'ARCHIVED' } },
                    orderBy: { code: 'asc' },
                    include: { checkIns: { orderBy: { weekStartAt: 'desc' }, take: 13 } },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!business || business.status === 'ARCHIVED') throw new Error('Business not found')

  const roadmaps = business.roadmaps.map((roadmap) => serializeRoadmap(roadmap, businessId, now))
  const active = roadmaps[0] || null
  const goals = roadmaps.flatMap((roadmap) => roadmap.horizons.flatMap((horizon) => horizon.goals))
  return {
    business: {
      id: business.id,
      code: business.code,
      name: business.name,
    },
    roadmaps,
    // @req FR-268 — additive top-level flatten of the same goals already
    // nested under roadmaps[].horizons[].goals[]. Exists so a consumer that
    // only needs "every goal" (an attention-queue scan, a KPI-perspective
    // grouping) does not have to re-derive this same flatten a second time —
    // this is exactly what business-home-read-model.js's own attentionQueue
    // had to do by hand (PRD-SDD 1.246.0b) before this field existed.
    goals,
    activeRoadmapId: active?.id || null,
    summary: {
      roadmapCount: roadmaps.length,
      horizonCount: active?.horizons.length || 0,
      goalCount: goals.length,
      averageProgress: goals.length
        ? Math.round((goals.reduce((sum, goal) => sum + goal.progress, 0) / goals.length) * 10) / 10
        : 0,
    },
  }
}
