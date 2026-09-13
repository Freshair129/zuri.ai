// @req FR-216 — phase card delivery metrics: counts, size, plan window and effort
//   estimate (planned), beside the time and tokens measured for the phase's lanes
//   (measured). Pure: no I/O, the same inputs always give the same card.
// @req FR-218 — usage reports merge with the meter's figures, a session counted once.
// @req FR-219 — subtask progress under the board's status mapping.
// @spec ADR-086 D1, D2, D3, D5, D6; ADR-048 D3
// @tested tests/unit/program-delivery-metrics.test.js

/** The board's status mapping, the same one the html board uses. */
export const STATUS_PROGRESS = { done: 100, review: 90, 'in-progress': 50, assigned: 25, ready: 10, planned: 0, blocked: 0 }

const DAY_MS = 86_400_000

/** Calendar days from start to end, both inclusive. */
export function planWindowDays(start, end) {
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / DAY_MS) + 1
}

export function subtaskProgress(subtasks = []) {
  if (!subtasks.length) return null
  const total = subtasks.reduce((sum, sub) => sum + (STATUS_PROGRESS[sub.status] ?? 0), 0)
  return Math.round(total / subtasks.length)
}

const emptyTokens = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 })
const addTokens = (into, t) => {
  into.input += t.input || 0
  into.cacheWrite += t.cacheWrite || 0
  into.cacheRead += t.cacheRead || 0
  into.output += t.output || 0
  return into
}
/** Tokens used = input + cache write + output; cache read is shown beside it (ADR-086 D4). */
export const tokensUsed = (t) => (t.input || 0) + (t.cacheWrite || 0) + (t.output || 0)

const minIso = (a, b) => (!a ? b : !b ? a : a < b ? a : b)
const maxIso = (a, b) => (!a ? b : !b ? a : a > b ? a : b)

/**
 * One measurement per lane, from the meter's block plus usage reports. A report
 * whose `source:sessionId` the meter already counted is skipped; a report for a
 * task in no lane becomes a lane of its own (`TASK:<id>`) so it is still shown
 * once. Lanes with nothing measured are absent from the result.
 */
export function mergeLaneUsage({ lanes = [], usage = {}, reports = [] }) {
  const laneOfTask = new Map()
  for (const lane of lanes) for (const task of lane.tasks) laneOfTask.set(task, lane.id)
  const merged = new Map()
  const metered = new Set()
  for (const [laneId, m] of Object.entries(usage.lanes || {})) {
    for (const key of m.sessions || []) metered.add(key)
    merged.set(laneId, {
      laneId,
      tokens: addTokens(emptyTokens(), m.tokens || {}),
      requests: m.requests || 0,
      sessions: (m.sessions || []).length,
      activeMinutes: m.activeMinutes || 0,
      firstActivityAt: m.firstActivityAt || null,
      lastActivityAt: m.lastActivityAt || null,
      sources: Object.keys(m.bySource || {}).sort(),
      reported: 0,
    })
  }
  for (const report of reports) {
    const key = `${report.source}:${report.sessionId}`
    if (metered.has(key)) continue
    const laneId = laneOfTask.get(report.taskCode) || `TASK:${report.taskCode}`
    const entry = merged.get(laneId) || {
      laneId, tokens: emptyTokens(), requests: 0, sessions: 0, activeMinutes: 0, firstActivityAt: null, lastActivityAt: null, sources: [], reported: 0,
    }
    addTokens(entry.tokens, {
      input: report.inputTokens, cacheWrite: report.cacheWriteTokens, cacheRead: report.cacheReadTokens, output: report.outputTokens,
    })
    entry.requests += report.requestCount || 0
    entry.sessions += 1
    entry.reported += 1
    entry.activeMinutes += report.activeMinutes || 0
    entry.firstActivityAt = minIso(entry.firstActivityAt, toIso(report.startedAt))
    entry.lastActivityAt = maxIso(entry.lastActivityAt, toIso(report.endedAt))
    const source = `report:${report.source}`
    if (!entry.sources.includes(source)) entry.sources = [...entry.sources, source].sort()
    metered.add(key)
    merged.set(laneId, entry)
  }
  return merged
}

function toIso(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Everything a phase card says (ADR-086 D1, D2). `measured` is null when no lane
 * of the phase has a measurement — the card then reads "not measured", never 0.
 */
export function phaseDeliveryMetrics({ phase, tasks, containers = {}, sizing, lanes = [], laneUsage = new Map() }) {
  const sprintIds = new Set(phase.sprints.map((s) => s.id))
  const phaseTasks = tasks.filter((t) => sprintIds.has(t[1]))
  const byStatus = {}
  let sizePoints = 0
  let effortHours = 0
  for (const [, , , , complexity, , status] of phaseTasks) {
    byStatus[status] = (byStatus[status] || 0) + 1
    sizePoints += sizing.points[complexity] ?? 0
    effortHours += sizing.effortHours[complexity] ?? 0
  }
  const phaseTaskIds = new Set(phaseTasks.map((t) => t[0]))
  const phaseLanes = lanes.filter((lane) => lane.tasks.some((task) => phaseTaskIds.has(task)))
  const laneIds = new Set(phaseLanes.map((lane) => lane.id))
  for (const task of phaseTaskIds) laneIds.add(`TASK:${task}`)

  let measured = null
  const measuredTasks = new Set()
  for (const laneId of laneIds) {
    const m = laneUsage.get(laneId)
    if (!m) continue
    measured ||= { tokens: emptyTokens(), requests: 0, sessions: 0, activeMinutes: 0, firstActivityAt: null, lastActivityAt: null, sources: [], lanes: 0 }
    addTokens(measured.tokens, m.tokens)
    measured.requests += m.requests
    measured.sessions += m.sessions
    measured.activeMinutes += m.activeMinutes
    measured.firstActivityAt = minIso(measured.firstActivityAt, m.firstActivityAt)
    measured.lastActivityAt = maxIso(measured.lastActivityAt, m.lastActivityAt)
    measured.sources = [...new Set([...measured.sources, ...m.sources])].sort()
    measured.lanes += 1
    const lane = phaseLanes.find((l) => l.id === laneId)
    if (lane) lane.tasks.forEach((task) => measuredTasks.add(task))
    else measuredTasks.add(laneId.slice('TASK:'.length))
  }
  if (measured) {
    measured.used = tokensUsed(measured.tokens)
    measured.elapsedDays = measured.firstActivityAt && measured.lastActivityAt
      ? Math.max(0, (Date.parse(measured.lastActivityAt) - Date.parse(measured.firstActivityAt)) / DAY_MS)
      : null
    measured.coveredTasks = measuredTasks.size
  }

  return {
    sprintCount: phase.sprints.length,
    taskCount: phaseTasks.length,
    byStatus,
    sizePoints,
    effortHours,
    planDays: planWindowDays(phase.start, phase.end),
    predictedTokens: phaseTasks.reduce((sum, t) => sum + (containers[t[0]]?.predictedTokens || 0), 0),
    done: phase.status === 'done',
    measured,
  }
}

export function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function formatDuration(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} นาที`
  const hours = minutes / 60
  return `${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} ชม.`
}
