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

/** The lane id the unattributed group uses: reports whose branch no lane declares (ADR-087 D4). */
export const UNATTRIBUTED_LANE = 'UNATTRIBUTED'
/** The breakdown key for figures that carry no person: the meter's local logs. */
export const NO_PERSON = ''

// @req FR-240 — usage detail aggregates the same way tokens do. Kept here rather
// than imported from the plugin so the server bundle never reaches outside its
// tree; the field list matches ADR-086 D7 and is asserted by the board tests.
const DETAIL_COUNTS = ['reasoningTokens', 'cacheWrite5mTokens', 'cacheWrite1hTokens', 'webSearchRequests', 'webFetchRequests', 'prompts', 'toolCalls', 'toolErrors', 'toolDenials', 'compactions', 'apiErrors']
export const emptyUsageDetail = () => ({ ...Object.fromEntries(DETAIL_COUNTS.map((k) => [k, 0])), tools: {}, models: {} })

/** Add one detail into another; returns whether anything was added. */
export function addUsageDetail(into, detail) {
  if (!detail) return false
  for (const key of DETAIL_COUNTS) into[key] += detail[key] || 0
  for (const [name, row] of Object.entries(detail.tools || {})) {
    const target = into.tools[name] || { calls: 0, errors: 0 }
    target.calls += row.calls || 0
    target.errors += row.errors || 0
    into.tools[name] = target
  }
  for (const [name, n] of Object.entries(detail.models || {})) into.models[name] = (into.models[name] || 0) + n
  return true
}

/** The most used tools, calls descending then name, for a task's telemetry. */
export function topTools(detail, limit = 8) {
  return Object.entries(detail?.tools || {})
    .map(([name, row]) => ({ name, calls: row.calls, errors: row.errors }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
    .slice(0, limit)
}

function addBreakdown(bucket, label, tokens, sessions) {
  const row = bucket[label] || { used: 0, cacheRead: 0, sessions: 0 }
  row.used += tokensUsed(tokens)
  row.cacheRead += tokens.cacheRead || 0
  row.sessions += sessions
  bucket[label] = row
}

/** Which lane a report belongs to: an explicit task, else its branch, else unattributed. */
export function laneOfReport(report, lanes = []) {
  if (report.taskCode) {
    const lane = lanes.find((l) => l.tasks.includes(report.taskCode))
    return lane ? lane.id : `TASK:${report.taskCode}`
  }
  const lane = report.branch ? lanes.find((l) => l.branches.includes(report.branch)) : null
  return lane ? lane.id : UNATTRIBUTED_LANE
}

/**
 * One measurement per lane, from the meter's block plus usage reports. A report
 * for a session the meter already counted in the same lane is skipped; a report
 * naming a task in no lane becomes a lane of its own (`TASK:<id>`); a report
 * whose branch no lane declares goes to `UNATTRIBUTED`. Each lane also carries a
 * breakdown by person id; the meter's figures carry no person (FR-221).
 * Lanes with nothing measured are absent from the result.
 */
export function mergeLaneUsage({ lanes = [], usage = {}, reports = [] }) {
  const merged = new Map()
  const counted = new Set()
  for (const [laneId, m] of Object.entries(usage.lanes || {})) {
    for (const key of m.sessions || []) counted.add(`${laneId}|${key}`)
    const tokens = addTokens(emptyTokens(), m.tokens || {})
    const entry = {
      laneId,
      tokens,
      requests: m.requests || 0,
      sessions: (m.sessions || []).length,
      activeMinutes: m.activeMinutes || 0,
      firstActivityAt: m.firstActivityAt || null,
      lastActivityAt: m.lastActivityAt || null,
      sources: Object.keys(m.bySource || {}).sort(),
      reported: 0,
      byPerson: {},
      detail: emptyUsageDetail(),
      detailSessions: 0,
    }
    if (addUsageDetail(entry.detail, m.detail)) entry.detailSessions += entry.sessions
    addBreakdown(entry.byPerson, NO_PERSON, tokens, entry.sessions)
    merged.set(laneId, entry)
  }
  for (const report of reports) {
    const laneId = laneOfReport(report, lanes)
    // A session the meter already counted in this lane is not counted again (the
    // meter read the same log). The same (source, sessionId, branch) twice is one
    // report; a second branch of one session is a different report and counts.
    if (counted.has(`${laneId}|${report.source}:${report.sessionId}`)) continue
    const reportKey = `report|${report.source}:${report.sessionId}:${report.branch || ''}`
    if (counted.has(reportKey)) continue
    const entry = merged.get(laneId) || {
      laneId, tokens: emptyTokens(), requests: 0, sessions: 0, activeMinutes: 0, firstActivityAt: null, lastActivityAt: null, sources: [], reported: 0, byPerson: {},
      detail: emptyUsageDetail(), detailSessions: 0,
    }
    if (addUsageDetail(entry.detail, report.detail)) entry.detailSessions += 1
    const tokens = { input: report.inputTokens, cacheWrite: report.cacheWriteTokens, cacheRead: report.cacheReadTokens, output: report.outputTokens }
    addTokens(entry.tokens, tokens)
    entry.requests += report.requestCount || 0
    entry.sessions += 1
    entry.reported += 1
    entry.activeMinutes += report.activeMinutes || 0
    entry.firstActivityAt = minIso(entry.firstActivityAt, toIso(report.startedAt))
    entry.lastActivityAt = maxIso(entry.lastActivityAt, toIso(report.endedAt))
    const source = `report:${report.source}`
    if (!entry.sources.includes(source)) entry.sources = [...entry.sources, source].sort()
    addBreakdown(entry.byPerson, report.personId || (report.installationId ? 'historical attribution' : 'deployment'), tokens, 1)
    counted.add(reportKey)
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
    measured ||= { tokens: emptyTokens(), requests: 0, sessions: 0, activeMinutes: 0, firstActivityAt: null, lastActivityAt: null, sources: [], lanes: 0, byPerson: {}, detail: emptyUsageDetail(), detailSessions: 0 }
    addTokens(measured.tokens, m.tokens)
    if (m.detailSessions) {
      addUsageDetail(measured.detail, m.detail)
      measured.detailSessions += m.detailSessions
    }
    for (const [label, row] of Object.entries(m.byPerson || {})) {
      const into = measured.byPerson[label] || { used: 0, cacheRead: 0, sessions: 0 }
      into.used += row.used
      into.cacheRead += row.cacheRead
      into.sessions += row.sessions
      measured.byPerson[label] = into
    }
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
