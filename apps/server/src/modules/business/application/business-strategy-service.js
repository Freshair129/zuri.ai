import prisma from '@/lib/db'
import { BUSINESS_GOAL_PERSPECTIVES } from '@/lib/validation/enums'
import { kpiStatus } from '@/modules/business/application/business-kpi-status'
// @req FR-268, SDD-107 — pure calculators; this read model calls them the
// same way project-roadmap-read-model.js already calls calculateWorkstreamProgress
// before returning, rather than leaving every consumer to duplicate the math.
import { keyResultProgress, expectedProgress } from '@/modules/project-manager/progress/key-result-progress'
import { weekStartFor } from '@/modules/project-manager/progress/week'

const DAY_MS = 24 * 60 * 60 * 1000

// @req FR-041, FR-043 - Business Overview needs a Business-level Roadmap and
// direct Project Business ownership for goal links.
// @spec ADR-013, SDD-020, BR-001 - strategy belongs to Business; never infer it from Organization.
// @tested tests/unit/business-strategy-service.test.js

function serializeKpiObservation(observation) {
  if (!observation) return null
  return {
    id: observation.id,
    value: Number(observation.value),
    observedAt: observation.observedAt,
    actorPersonId: observation.actorPersonId,
    note: observation.note,
    createdAt: observation.createdAt,
  }
}

export function serializeBusinessKpi(kpi) {
  const latestObservation = serializeKpiObservation(kpi.observations?.[0] || null)
  return {
    id: kpi.id,
    businessId: kpi.businessId,
    name: kpi.name,
    perspective: kpi.perspective,
    unit: kpi.unit,
    target: Number(kpi.target),
    warningThreshold: Number(kpi.warningThreshold),
    direction: kpi.direction,
    cadence: kpi.cadence,
    status: kpi.status,
    createdAt: kpi.createdAt,
    updatedAt: kpi.updatedAt,
    latestObservation,
    resultStatus: kpiStatus(kpi, latestObservation),
  }
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0
}

function groupKpisByPerspective(rows) {
  const groups = BUSINESS_GOAL_PERSPECTIVES.map((perspective) => ({ perspective, kpis: [] }))
  const byPerspective = new Map(groups.map((group) => [group.perspective, group]))
  for (const row of rows || []) {
    const group = byPerspective.get(row.perspective)
    // A persisted perspective is enum-constrained. Fail closed if a corrupted
    // row escapes that constraint rather than silently dropping it.
    if (!group) throw new Error(`Unsupported Business KPI perspective: ${row.perspective}`)
    group.kpis.push(serializeBusinessKpi(row))
  }
  for (const group of groups) group.kpis.sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id))
  return groups
}

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
    isLagMeasure: kr.isLagMeasure,
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

function valueTimeOrder(a, b) {
  return new Date(a.createdAt) - new Date(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function serializeLeadMeasure(measure, currentWeek) {
  const firstWeek = new Date(currentWeek.getTime() - 4 * 7 * DAY_MS)
  const latestByWeek = new Map()
  for (const value of [...(measure.values || [])].sort(valueTimeOrder)) {
    latestByWeek.set(new Date(value.weekStartAt).toISOString(), value)
  }
  const weeklyBars = Array.from({ length: 5 }, (_, index) => {
    const weekStartAt = new Date(firstWeek.getTime() + index * 7 * DAY_MS)
    const latest = latestByWeek.get(weekStartAt.toISOString())
    return {
      weekStartAt,
      value: latest ? Number(latest.value) : null,
      recordedAt: latest?.createdAt ?? null,
      observationId: latest?.id ?? null,
    }
  })
  return {
    id: measure.id,
    goalId: measure.goalId,
    name: measure.name,
    unit: measure.unit,
    weeklyTarget: Number(measure.weeklyTarget),
    direction: measure.direction,
    status: measure.status,
    weeklyBars,
  }
}

function serializeCommitment(row) {
  return {
    id: row.id,
    weekStartAt: row.weekStartAt,
    ownerPersonId: row.ownerPersonId,
    owner: row.owner
      ? { id: row.owner.id, code: row.owner.code, displayName: row.owner.displayName }
      : null,
    leadMeasure: row.leadMeasure ? { id: row.leadMeasure.id, name: row.leadMeasure.name, goalId: row.leadMeasure.goalId } : null,
    title: row.title,
    done: row.done,
  }
}

function serializeSession(session, weekStartAt) {
  return {
    id: session?.id ?? null,
    weekStartAt,
    reportCompletedAt: session?.reportCompletedAt ?? null,
    scoreboardCompletedAt: session?.scoreboardCompletedAt ?? null,
    planCompletedAt: session?.planCompletedAt ?? null,
    complete: Boolean(session?.reportCompletedAt && session?.scoreboardCompletedAt && session?.planCompletedAt),
  }
}

function serializeOverdueSession(session) {
  const dueAt = new Date(new Date(session.weekStartAt).getTime() + 8 * DAY_MS)
  return {
    id: `wig-session-incomplete:${session.businessId}:${new Date(session.weekStartAt).toISOString()}`,
    businessId: session.businessId,
    weekStartAt: session.weekStartAt,
    dueAt,
    missingSteps: [
      !session.reportCompletedAt && 'report',
      !session.scoreboardCompletedAt && 'scoreboard',
      !session.planCompletedAt && 'plan',
    ].filter(Boolean),
  }
}

function serializeWigExecution({ goals, leadMeasures, commitments, commitmentPeople, currentSession, overdueSessions, currentWeek, nextWeek, now }) {
  const measuresByGoal = new Map()
  for (const measure of leadMeasures || []) {
    const list = measuresByGoal.get(measure.goalId) || []
    list.push(serializeLeadMeasure(measure, currentWeek))
    measuresByGoal.set(measure.goalId, list)
  }
  const wigs = (goals || []).filter((goal) => goal.isWig && goal.status !== 'ARCHIVED').map((goal) => {
    const lagKeyResults = goal.keyResults.filter((keyResult) => keyResult.isLagMeasure)
    return {
      goalId: goal.id,
      code: goal.code,
      title: goal.title,
      status: goal.status,
      lagKeyResult: lagKeyResults.length === 1 ? lagKeyResults[0] : null,
      configurationError: lagKeyResults.length === 1 ? null : 'LAG_KEY_RESULT_COUNT',
      leadMeasures: (measuresByGoal.get(goal.id) || []).sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id)),
    }
  })
  const safeCommitments = (commitments || []).map(serializeCommitment)
    .sort((a, b) => a.weekStartAt - b.weekStartAt
      || compareText(a.owner?.displayName || '', b.owner?.displayName || '')
      || compareText(a.title, b.title)
      || compareText(a.id, b.id))
  return {
    currentWeekStartAt: currentWeek,
    nextWeekStartAt: nextWeek,
    weeks: Array.from({ length: 5 }, (_, index) => new Date(currentWeek.getTime() - (4 - index) * 7 * DAY_MS)),
    wigs,
    commitmentPeople: (commitmentPeople || []).map((person) => ({
      id: person.id,
      code: person.code,
      displayName: person.displayName,
    })),
    commitments: {
      current: safeCommitments.filter((item) => item.weekStartAt.getTime() === currentWeek.getTime()),
      next: safeCommitments.filter((item) => item.weekStartAt.getTime() === nextWeek.getTime()),
    },
    currentSession: serializeSession(currentSession, currentWeek),
    overdueSessions: (overdueSessions || [])
      .filter((session) => new Date(session.weekStartAt).getTime() + 8 * DAY_MS <= now.getTime())
      .map(serializeOverdueSession),
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
  // The route supplies the viewer's visible Business set. A direct internal
  // call without that set keeps the legacy Strategy projection and fails
  // closed for this additive KPI slice.
  const canReadKpis = Array.isArray(visibleBusinessIds) && visibleBusinessIds.includes(businessId)
  const nowDate = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  const currentWeek = weekStartFor(nowDate)
  const nextWeek = new Date(currentWeek.getTime() + 7 * DAY_MS)
  const firstWeek = new Date(currentWeek.getTime() - 4 * 7 * DAY_MS)
  const overdueCutoff = new Date(nowDate.getTime() - 8 * DAY_MS)

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
      ...(canReadKpis ? {
        businessKpis: {
          where: { businessId, status: 'ACTIVE' },
          orderBy: [{ perspective: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          include: {
            observations: {
              orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
              take: 1,
            },
          },
        },
        businessLeadMeasures: {
          where: {
            businessId,
            status: 'ACTIVE',
            goal: { businessId, isWig: true, status: { not: 'ARCHIVED' } },
          },
          orderBy: [{ goalId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          include: {
            values: {
              where: { weekStartAt: { gte: firstWeek, lte: currentWeek } },
              orderBy: [{ weekStartAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            },
          },
        },
        businessWeeklyCommitments: {
          where: { businessId, weekStartAt: { in: [currentWeek, nextWeek] } },
          include: {
            owner: { select: { id: true, code: true, displayName: true } },
            leadMeasure: { select: { id: true, name: true, goalId: true } },
          },
        },
        businessWigSessions: {
          where: {
            businessId,
            OR: [
              { weekStartAt: currentWeek },
              {
                weekStartAt: { lte: overdueCutoff },
                OR: [
                  { reportCompletedAt: null },
                  { scoreboardCompletedAt: null },
                  { planCompletedAt: null },
                ],
              },
            ],
          },
          orderBy: [{ weekStartAt: 'asc' }, { id: 'asc' }],
        },
        memberships: {
          where: {
            scopeType: 'BUSINESS',
            status: 'ACTIVE',
            person: { accessDisabledAt: null },
            OR: [{ expiresAt: null }, { expiresAt: { gt: nowDate } }],
          },
          select: { person: { select: { id: true, code: true, displayName: true } } },
        },
      } : {}),
    },
  })

  if (!business || business.status === 'ARCHIVED') throw new Error('Business not found')

  const roadmaps = business.roadmaps.map((roadmap) => serializeRoadmap(roadmap, businessId, now))
  const active = roadmaps[0] || null
  const goals = roadmaps.flatMap((roadmap) => roadmap.horizons.flatMap((horizon) => horizon.goals))
  const kpis = groupKpisByPerspective(business.businessKpis || [])
  const currentWigSession = (business.businessWigSessions || []).find((session) =>
    new Date(session.weekStartAt).getTime() === currentWeek.getTime()) || null
  const commitmentPeople = [...new Map((business.memberships || [])
    .filter((membership) => membership.person)
    .map((membership) => [membership.person.id, membership.person])).values()]
    .sort((a, b) => compareText(a.displayName || '', b.displayName || '') || compareText(a.id, b.id))
  const wigExecution = canReadKpis
    ? serializeWigExecution({
      goals,
      leadMeasures: business.businessLeadMeasures || [],
      commitments: business.businessWeeklyCommitments || [],
      commitmentPeople,
      currentSession: currentWigSession,
      overdueSessions: business.businessWigSessions || [],
      currentWeek,
      nextWeek,
      now: nowDate,
    })
    : null
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
    // @req FR-269 — active Business KPIs are grouped into all four Balanced
    // Scorecard perspectives. Their result status is never part of the
    // cross-domain health composite.
    kpis,
    // @req FR-270 — additive, Business-scoped 4DX projection. It is populated
    // only after the route's visible-Business gate, the same read boundary as
    // the adjacent FR-269 KPI projection.
    wigExecution,
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
