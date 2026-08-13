import prisma from '@/lib/db'

// @req FR-041, FR-043 - Business Overview needs a Business-level Roadmap and
// direct Project Business ownership for goal links.
// @spec ADR-013, SDD-020, BR-001 - strategy belongs to Business; never infer it from Organization.
// @tested tests/unit/business-strategy-service.test.js

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

function serializeGoal(goal, businessId) {
  return {
    id: goal.id,
    code: goal.code,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    priority: goal.priority,
    progress: goal.progress,
    startAt: goal.startAt,
    targetAt: goal.targetAt,
    projects: (goal.projects || [])
      .map((link) => projectLink(link.project, businessId))
      .filter(Boolean),
  }
}

function serializeRoadmap(roadmap, businessId) {
  const horizons = [...(roadmap.horizons || [])]
    .sort((a, b) => a.position - b.position)
    .map((horizon) => ({
      id: horizon.id,
      key: horizon.key,
      label: horizon.label,
      position: horizon.position,
      description: horizon.description,
      targetAt: horizon.targetAt,
      goals: (horizon.goals || []).map((goal) => serializeGoal(goal, businessId)),
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
  { db = prisma, visibleBusinessIds = null } = {},
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
                },
              },
            },
          },
        },
      },
    },
  })

  if (!business || business.status === 'ARCHIVED') throw new Error('Business not found')

  const roadmaps = business.roadmaps.map((roadmap) => serializeRoadmap(roadmap, businessId))
  const active = roadmaps[0] || null
  const goals = roadmaps.flatMap((roadmap) => roadmap.horizons.flatMap((horizon) => horizon.goals))
  return {
    business: {
      id: business.id,
      code: business.code,
      name: business.name,
    },
    roadmaps,
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
