import { z } from 'zod'
import { tokensUsed } from '@/modules/platform-control/program-delivery-metrics'

// @req FR-218, FR-221, FR-239 — project task-bound ProgrammeUsageReport rows
// into measured usage without promoting plan estimates or shared lane totals.
// @spec ADR-086 D1-D7; ADR-087 D4-D6; SDD-008
// @tested tests/unit/task-usage-ledger.test.js

export const TASK_USAGE_LEDGER_SCHEMA_VERSION = 'task-usage-ledger.v1'
export const TASK_USAGE_MEASUREMENT_STATUSES = Object.freeze([
  'MEASURED_DIRECT',
  'MEASURED_DIRECT_WITH_WARNING',
  'NOT_REPORTED',
  'LANE_ONLY_UNALLOCATED',
  'UNATTRIBUTED',
  'SOURCE_UNAVAILABLE',
  'CONFLICT',
])
export const TASK_USAGE_RECONCILIATION_STATUSES = Object.freeze([
  'NONE',
  'METER_OVERLAP',
  'BRANCH_ONLY_LANE',
  'UNATTRIBUTED_REPORT',
  'OVERLAPPING_INTERVALS',
  'TASK_BINDING_CHANGED',
])

const TASK_CODE = /^TASK-ZAI-\d{3}$/
const NON_NEGATIVE_INTEGER = z.number().int().min(0)
const ISO_DATE = z.string().datetime({ offset: true })

const TokensSchema = z.object({
  inputTokens: NON_NEGATIVE_INTEGER,
  cacheWriteTokens: NON_NEGATIVE_INTEGER,
  cacheReadTokens: NON_NEGATIVE_INTEGER,
  outputTokens: NON_NEGATIVE_INTEGER,
  usedTokens: NON_NEGATIVE_INTEGER,
}).strict()

const ActualUsageSchema = z.object({
  tokens: TokensSchema,
  requestCount: NON_NEGATIVE_INTEGER,
  activeMinutes: NON_NEGATIVE_INTEGER,
  startedAt: ISO_DATE.nullable(),
  endedAt: ISO_DATE.nullable(),
  reportCount: z.number().int().min(1),
  models: z.array(z.object({
    name: z.string().min(1),
    requests: z.number().int().min(1),
  }).strict()),
}).strict()

const AttributionSchema = z.object({
  kind: z.enum(['DIRECT_TASK_CODE', 'LANE_ONLY', 'UNATTRIBUTED', 'NONE']),
  directReportCount: NON_NEGATIVE_INTEGER,
  laneIds: z.array(z.string()),
}).strict()

const EvidenceSchema = z.object({
  sourceRefs: z.array(z.object({
    kind: z.literal('PROGRAMME_USAGE_REPORT'),
    id: z.string().min(1),
    payloadSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()),
}).strict()

export const TaskUsageLedgerTaskSchema = z.object({
  taskCode: z.string().regex(TASK_CODE),
  taskStatus: z.string().min(1),
  plan: z.object({
    predictedTokens: NON_NEGATIVE_INTEGER.nullable(),
    source: z.literal('PROGRAMME_CONTAINERS'),
  }).strict(),
  measurementStatus: z.enum(TASK_USAGE_MEASUREMENT_STATUSES),
  reconciliationStatus: z.enum(TASK_USAGE_RECONCILIATION_STATUSES),
  actual: ActualUsageSchema.nullable(),
  attribution: AttributionSchema,
  evidence: EvidenceSchema.optional(),
  warnings: z.array(z.string()),
}).strict()

/** Runtime shape returned by the pure task usage projection. */
export const TaskUsageLedgerSchema = z.object({
  schemaVersion: z.literal(TASK_USAGE_LEDGER_SCHEMA_VERSION),
  availability: z.enum(['AVAILABLE', 'SOURCE_UNAVAILABLE']),
  asOf: ISO_DATE.nullable(),
  tasks: z.array(TaskUsageLedgerTaskSchema),
}).strict()

const ReportInputSchema = z.object({
  source: z.string().trim().min(1).max(80),
  sessionId: z.string().trim().min(1).max(200),
  branch: z.string().trim().max(200).nullish().default(''),
  taskCode: z.string().trim().min(1).max(80).nullish(),
  model: z.string().trim().max(80).nullish(),
  inputTokens: NON_NEGATIVE_INTEGER.nullish(),
  cacheWriteTokens: NON_NEGATIVE_INTEGER.nullish(),
  cacheReadTokens: NON_NEGATIVE_INTEGER.nullish(),
  outputTokens: NON_NEGATIVE_INTEGER.nullish(),
  requestCount: NON_NEGATIVE_INTEGER.nullish(),
  activeMinutes: NON_NEGATIVE_INTEGER.nullish(),
  startedAt: z.union([z.string(), z.date()]).nullish(),
  endedAt: z.union([z.string(), z.date()]).nullish(),
  reportedAt: z.union([z.string(), z.date()]).nullish(),
  id: z.string().trim().min(1).max(200).nullish(),
  reportRef: z.string().trim().min(1).max(200).nullish(),
  payloadSha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
}).strip()

/**
 * Input boundary for the pure projection. `knownTasks` is the preferred name;
 * `tasks` and `programmeTasks` are accepted because the generated programme
 * module and callers use both names in different read surfaces.
 */
export const TaskUsageLedgerInputSchema = z.object({
  knownTasks: z.array(z.unknown()).optional(),
  tasks: z.array(z.unknown()).optional(),
  programmeTasks: z.array(z.unknown()).optional(),
  containers: z.unknown().optional(),
  lanes: z.array(z.unknown()).optional(),
  meterUsage: z.unknown().optional(),
  usage: z.unknown().optional(),
  reports: z.unknown().optional(),
  usageReports: z.unknown().optional(),
  asOf: z.union([z.string(), z.date()]).nullish(),
}).passthrough()

const COUNT_FIELDS = ['inputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'outputTokens', 'requestCount', 'activeMinutes']
const REQUIRED_COUNT_FIELDS = ['inputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'outputTokens', 'requestCount', 'activeMinutes']

const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0

function dateToIso(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function dateTime(value) {
  const parsed = Date.parse(value || '')
  return Number.isFinite(parsed) ? parsed : null
}

function minIso(current, next) {
  if (!current) return next
  if (!next) return current
  return current < next ? current : next
}

function maxIso(current, next) {
  if (!current) return next
  if (!next) return current
  return current > next ? current : next
}

function getContainer(containers, taskCode) {
  if (containers instanceof Map) return containers.get(taskCode) || {}
  return containers && typeof containers === 'object' ? containers[taskCode] || {} : {}
}

function normaliseTasks(input) {
  const rawTasks = input.knownTasks ?? input.tasks ?? input.programmeTasks ?? []
  if (!Array.isArray(rawTasks)) throw new TypeError('TASK_USAGE_LEDGER_TASKS_INVALID')

  const seen = new Set()
  return rawTasks.map((raw, index) => {
    const taskCode = Array.isArray(raw)
      ? raw[0]
      : raw && typeof raw === 'object'
        ? raw.taskCode || raw.code || raw.id
        : null
    const taskStatus = Array.isArray(raw)
      ? raw[6]
      : raw && typeof raw === 'object'
        ? raw.taskStatus || raw.status
        : null
    if (typeof taskCode !== 'string' || !TASK_CODE.test(taskCode)) throw new TypeError(`TASK_USAGE_LEDGER_TASK_INVALID:${index}`)
    if (seen.has(taskCode)) throw new TypeError(`TASK_USAGE_LEDGER_TASK_DUPLICATE:${taskCode}`)
    seen.add(taskCode)
    return { taskCode, taskStatus: typeof taskStatus === 'string' && taskStatus.trim() ? taskStatus.trim() : 'unknown' }
  }).sort((a, b) => a.taskCode.localeCompare(b.taskCode))
}

function normaliseLanes(input) {
  const rawLanes = input.lanes ?? []
  if (!Array.isArray(rawLanes)) throw new TypeError('TASK_USAGE_LEDGER_LANES_INVALID')
  return rawLanes.map((lane, index) => {
    if (!lane || typeof lane !== 'object' || typeof lane.id !== 'string' || !lane.id.trim()) {
      throw new TypeError(`TASK_USAGE_LEDGER_LANE_INVALID:${index}`)
    }
    const tasks = lane.tasks == null ? [] : lane.tasks
    const branches = lane.branches == null ? [] : lane.branches
    if (!Array.isArray(tasks) || !tasks.every((task) => typeof task === 'string')) throw new TypeError(`TASK_USAGE_LEDGER_LANE_TASKS_INVALID:${lane.id}`)
    if (!Array.isArray(branches) || !branches.every((branch) => typeof branch === 'string')) throw new TypeError(`TASK_USAGE_LEDGER_LANE_BRANCHES_INVALID:${lane.id}`)
    return {
      id: lane.id.trim(),
      tasks: [...new Set(tasks)].sort(),
      branches: [...new Set(branches)].sort(),
    }
  }).sort((a, b) => a.id.localeCompare(b.id))
}

function normaliseReport(raw) {
  const parsed = ReportInputSchema.safeParse(raw)
  if (!parsed.success) return null
  const row = parsed.data
  return {
    ...row,
    branch: row.branch || '',
    taskCode: row.taskCode || null,
    model: row.model || null,
    startedAt: dateToIso(row.startedAt),
    endedAt: dateToIso(row.endedAt),
    reportedAt: dateToIso(row.reportedAt),
  }
}

function reportCollection(input) {
  const candidate = input.reports ?? input.usageReports ?? []
  if (Array.isArray(candidate)) return { available: input.reportsAvailable !== false, rows: candidate }
  if (candidate && typeof candidate === 'object' && Array.isArray(candidate.reports)) {
    return { available: candidate.available !== false, rows: candidate.reports }
  }
  throw new TypeError('TASK_USAGE_LEDGER_REPORTS_INVALID')
}

function meterLanes(input) {
  const candidate = input.meterUsage ?? input.usage ?? {}
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {}
  return candidate.lanes && typeof candidate.lanes === 'object' && !Array.isArray(candidate.lanes) ? candidate.lanes : {}
}

function taskLaneIds(taskCode, lanes) {
  return lanes.filter((lane) => lane.tasks.includes(taskCode)).map((lane) => lane.id).sort()
}

function branchLaneIds(branch, lanes) {
  if (!branch) return []
  return lanes.filter((lane) => lane.branches.includes(branch)).map((lane) => lane.id).sort()
}

function reportKey(row) {
  return [row.source, row.sessionId, row.branch || ''].join('\u001f')
}

function reportSignature(row) {
  return JSON.stringify([
    row.taskCode,
    row.model,
    ...COUNT_FIELDS.map((field) => row[field] ?? null),
    row.startedAt,
    row.endedAt,
    row.payloadSha256 || null,
  ])
}

function reportTieBreak(row) {
  return [row.id || '', row.reportRef || '', row.reportedAt || '', row.payloadSha256 || ''].join('\u001f')
}

function reportCompleteness(row) {
  return REQUIRED_COUNT_FIELDS.reduce((score, field) => score + (isNonNegativeInteger(row[field]) ? 1 : 0), 0)
    + (row.startedAt ? 1 : 0)
    + (row.endedAt ? 1 : 0)
    + (row.model ? 1 : 0)
}

function reportOrder(a, b) {
  const end = (dateTime(a.endedAt) ?? -1) - (dateTime(b.endedAt) ?? -1)
  if (end) return end
  const completeness = reportCompleteness(a) - reportCompleteness(b)
  if (completeness) return completeness
  const totalA = COUNT_FIELDS.reduce((sum, field) => sum + (a[field] || 0), 0)
  const totalB = COUNT_FIELDS.reduce((sum, field) => sum + (b[field] || 0), 0)
  if (totalA !== totalB) return totalA - totalB
  const signature = reportSignature(a).localeCompare(reportSignature(b))
  return signature || reportTieBreak(a).localeCompare(reportTieBreak(b))
}

function countsGrowFrom(previous, current) {
  return COUNT_FIELDS.every((field) => {
    if (!isNonNegativeInteger(previous[field]) || !isNonNegativeInteger(current[field])) return true
    return current[field] >= previous[field]
  })
}

/**
 * Collapse rows sharing the ProgrammeUsageReport key. The database writer
 * normally gives the projection one final row, but this also makes a replay or
 * exported snapshot safe to project: exact duplicates count once, monotonic
 * extensions use their largest row, and contradictory rows are quarantined.
 */
function settleReportGroups(rows, knownTaskCodes) {
  const grouped = new Map()
  for (const row of rows) {
    if (!row) continue
    if (row.taskCode && (!TASK_CODE.test(row.taskCode) || !knownTaskCodes.has(row.taskCode))) continue
    const key = reportKey(row)
    const group = grouped.get(key) || []
    group.push(row)
    grouped.set(key, group)
  }

  const settled = []
  for (const key of [...grouped.keys()].sort()) {
    const unique = new Map()
    for (const row of grouped.get(key)) {
      const signature = reportSignature(row)
      const prior = unique.get(signature)
      if (!prior || reportTieBreak(row).localeCompare(reportTieBreak(prior)) > 0) unique.set(signature, row)
    }
    const candidates = [...unique.values()].sort(reportOrder)
    const taskCodes = new Set(candidates.map((row) => row.taskCode).filter(Boolean))
    const hasBranchOnly = candidates.some((row) => !row.taskCode)
    const warnings = new Set()
    let conflict = false

    if (taskCodes.size > 1 || (taskCodes.size && hasBranchOnly)) {
      conflict = true
      warnings.add('TASK_BINDING_CHANGED')
    }
    for (let i = 1; i < candidates.length; i += 1) {
      const previous = candidates[i - 1]
      const current = candidates[i]
      if (previous.startedAt && current.startedAt && previous.startedAt !== current.startedAt) {
        conflict = true
        warnings.add('REPORT_CONFLICT')
      }
      if (previous.model && current.model && previous.model !== current.model) {
        conflict = true
        warnings.add('REPORT_CONFLICT')
      }
      if (!countsGrowFrom(previous, current)) {
        conflict = true
        warnings.add('REPORT_CONFLICT')
      }
      if (previous.endedAt && current.endedAt && current.endedAt < previous.endedAt) {
        conflict = true
        warnings.add('REPORT_CONFLICT')
      }
      if (previous.payloadSha256 && current.payloadSha256 && previous.payloadSha256 !== current.payloadSha256) {
        conflict = true
        warnings.add('REPORT_CONFLICT')
      }
    }

    const selected = candidates[candidates.length - 1] || null
    settled.push({
      key,
      selected,
      candidates,
      conflict,
      warnings: [...warnings].sort(),
      conflictTaskCodes: conflict ? [...taskCodes].sort() : [],
    })
  }
  return settled
}

function addLaneCoverage(map, taskCode, laneId) {
  const current = map.get(taskCode) || new Set()
  current.add(laneId)
  map.set(taskCode, current)
}

function isValidInterval(row) {
  const start = dateTime(row.startedAt)
  const end = dateTime(row.endedAt)
  return start !== null && end !== null && end >= start
}

function usageWarnings(rows) {
  const warnings = new Set()
  if (rows.some((row) => !REQUIRED_COUNT_FIELDS.every((field) => isNonNegativeInteger(row[field])))) warnings.add('COUNTS_NOT_REPORTED')
  if (rows.some((row) => !row.startedAt || !row.endedAt)) warnings.add('TIMESTAMP_NOT_REPORTED')
  if (rows.some((row) => row.startedAt && row.endedAt && !isValidInterval(row))) warnings.add('INVALID_INTERVAL')
  if (rows.some((row) => !row.model)) warnings.add('MODEL_NOT_REPORTED')
  if (new Set(rows.map((row) => row.model).filter(Boolean)).size > 1) warnings.add('MULTIPLE_MODELS')
  return warnings
}

function intervalsOverlap(rows) {
  const intervals = rows
    .map((row) => ({ start: dateTime(row.startedAt), end: dateTime(row.endedAt) }))
    .filter((interval) => interval.start !== null && interval.end !== null && interval.end >= interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < intervals.length; i += 1) {
    if (intervals[i].start < intervals[i - 1].end) return true
  }
  return false
}

function actualFor(rows) {
  if (!rows.length) return null
  const completeCounts = rows.every((row) => REQUIRED_COUNT_FIELDS.every((field) => isNonNegativeInteger(row[field])))
  if (!completeCounts) return null

  const sums = Object.fromEntries(REQUIRED_COUNT_FIELDS.map((field) => [field, 0]))
  const models = new Map()
  let startedAt = null
  let endedAt = null
  for (const row of rows) {
    for (const field of REQUIRED_COUNT_FIELDS) sums[field] += row[field]
    if (row.model) models.set(row.model, (models.get(row.model) || 0) + row.requestCount)
    startedAt = minIso(startedAt, row.startedAt)
    endedAt = maxIso(endedAt, row.endedAt)
  }

  const tokenInput = {
    input: sums.inputTokens,
    cacheWrite: sums.cacheWriteTokens,
    cacheRead: sums.cacheReadTokens,
    output: sums.outputTokens,
  }
  return {
    tokens: {
      inputTokens: tokenInput.input,
      cacheWriteTokens: tokenInput.cacheWrite,
      cacheReadTokens: tokenInput.cacheRead,
      outputTokens: tokenInput.output,
      usedTokens: tokensUsed(tokenInput),
    },
    requestCount: sums.requestCount,
    activeMinutes: sums.activeMinutes,
    startedAt,
    endedAt,
    reportCount: rows.length,
    models: [...models.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, requests]) => ({ name, requests })),
  }
}

function evidenceFor(rows) {
  const sourceRefs = rows
    .filter((row) => (row.id || row.reportRef) && row.payloadSha256)
    .map((row) => ({ kind: 'PROGRAMME_USAGE_REPORT', id: row.id || row.reportRef, payloadSha256: row.payloadSha256 }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return sourceRefs.length ? { sourceRefs } : undefined
}

function reportAsOf(rows, meter) {
  let asOf = dateToIso(meter?.measuredThrough)
  for (const row of rows) {
    asOf = maxIso(asOf, row.endedAt)
    asOf = maxIso(asOf, row.reportedAt)
  }
  return asOf
}

function reconciliationStatus({ conflict, overlap, meterOverlap, branchOnly }) {
  if (conflict) return 'TASK_BINDING_CHANGED'
  if (overlap) return 'OVERLAPPING_INTERVALS'
  if (meterOverlap) return 'METER_OVERLAP'
  if (branchOnly) return 'BRANCH_ONLY_LANE'
  return 'NONE'
}

function projectTask(task, context) {
  const { taskCode, taskStatus } = task
  const taskLaneIds = context.taskLaneIds.get(taskCode) || []
  const coveredLaneIds = [...(context.coverageByTask.get(taskCode) || new Set())].sort()
  const directRows = context.directRows.get(taskCode) || []
  const directEvidence = evidenceFor(directRows)
  const warnings = new Set(context.conflictTaskCodes.has(taskCode) ? ['TASK_BINDING_CHANGED', 'REPORT_CONFLICT'] : [])

  if (context.availability === 'SOURCE_UNAVAILABLE') {
    warnings.add('SOURCE_UNAVAILABLE')
    return {
      taskCode,
      taskStatus,
      plan: { predictedTokens: context.predictedTokens(taskCode), source: 'PROGRAMME_CONTAINERS' },
      measurementStatus: 'SOURCE_UNAVAILABLE',
      reconciliationStatus: 'NONE',
      actual: null,
      attribution: { kind: 'NONE', directReportCount: 0, laneIds: [] },
      warnings: [...warnings].sort(),
    }
  }

  if (directRows.length && !context.conflictTaskCodes.has(taskCode) && context.availability !== 'SOURCE_UNAVAILABLE') {
    for (const warning of usageWarnings(directRows)) warnings.add(warning)
    const overlap = intervalsOverlap(directRows)
    if (overlap) warnings.add('OVERLAPPING_INTERVALS')
    const meterOverlap = directRows.some((row) => taskLaneIds.some((laneId) => context.meterSessionKeys.get(laneId)?.has(`${row.source}:${row.sessionId}`)))
    if (meterOverlap) warnings.add('METER_OVERLAP')
    const actual = actualFor(directRows)
    const hasWarning = warnings.size > 0
    return {
      taskCode,
      taskStatus,
      plan: { predictedTokens: context.predictedTokens(taskCode), source: 'PROGRAMME_CONTAINERS' },
      measurementStatus: hasWarning ? 'MEASURED_DIRECT_WITH_WARNING' : 'MEASURED_DIRECT',
      reconciliationStatus: reconciliationStatus({ conflict: false, overlap, meterOverlap, branchOnly: false }),
      actual,
      attribution: { kind: 'DIRECT_TASK_CODE', directReportCount: directRows.length, laneIds: taskLaneIds },
      ...(directEvidence ? { evidence: directEvidence } : {}),
      warnings: [...warnings].sort(),
    }
  }

  if (context.conflictTaskCodes.has(taskCode)) {
    return {
      taskCode,
      taskStatus,
      plan: { predictedTokens: context.predictedTokens(taskCode), source: 'PROGRAMME_CONTAINERS' },
      measurementStatus: 'CONFLICT',
      reconciliationStatus: 'TASK_BINDING_CHANGED',
      actual: null,
      attribution: { kind: directRows.length ? 'DIRECT_TASK_CODE' : 'NONE', directReportCount: directRows.length, laneIds: taskLaneIds },
      warnings: [...warnings].sort(),
    }
  }

  if (coveredLaneIds.length) {
    warnings.add('LANE_ONLY_UNALLOCATED')
    const branchOnly = context.branchOnlyTasks.has(taskCode)
    return {
      taskCode,
      taskStatus,
      plan: { predictedTokens: context.predictedTokens(taskCode), source: 'PROGRAMME_CONTAINERS' },
      measurementStatus: 'LANE_ONLY_UNALLOCATED',
      reconciliationStatus: branchOnly ? 'BRANCH_ONLY_LANE' : 'NONE',
      actual: null,
      attribution: { kind: 'LANE_ONLY', directReportCount: 0, laneIds: coveredLaneIds },
      warnings: [...warnings].sort(),
    }
  }

  if (context.hasUnattributedReport) {
    warnings.add('UNATTRIBUTED_REPORT')
    return {
      taskCode,
      taskStatus,
      plan: { predictedTokens: context.predictedTokens(taskCode), source: 'PROGRAMME_CONTAINERS' },
      measurementStatus: 'UNATTRIBUTED',
      reconciliationStatus: 'UNATTRIBUTED_REPORT',
      actual: null,
      attribution: { kind: 'UNATTRIBUTED', directReportCount: 0, laneIds: [] },
      warnings: [...warnings].sort(),
    }
  }

  return {
    taskCode,
    taskStatus,
    plan: { predictedTokens: context.predictedTokens(taskCode), source: 'PROGRAMME_CONTAINERS' },
    measurementStatus: 'NOT_REPORTED',
    reconciliationStatus: 'NONE',
    actual: null,
    attribution: { kind: 'NONE', directReportCount: 0, laneIds: [] },
    warnings: [...warnings].sort(),
  }
}

/**
 * Build a deterministic, task-bound usage read model. This function has no
 * database or clock dependency: callers pass the already-read report result,
 * generated programme metadata and optional meter snapshot.
 */
export function projectTaskUsageLedger(input = {}) {
  const parsedInput = TaskUsageLedgerInputSchema.parse(input)
  const tasks = normaliseTasks(parsedInput)
  const lanes = normaliseLanes(parsedInput)
  const knownTaskCodes = new Set(tasks.map((task) => task.taskCode))
  const containers = parsedInput.containers || {}
  const reportResult = reportCollection(parsedInput)
  const meter = meterLanes(parsedInput)
  const availability = reportResult.available ? 'AVAILABLE' : 'SOURCE_UNAVAILABLE'

  const parsedRows = reportResult.rows.map(normaliseReport).filter(Boolean)
  const settled = reportResult.available ? settleReportGroups(parsedRows, knownTaskCodes) : []
  const directRows = new Map()
  const conflictTaskCodes = new Set()
  const coverageByTask = new Map()
  const branchOnlyTasks = new Set()
  let hasUnattributedReport = false

  const taskLaneIds = new Map(tasks.map((task) => [task.taskCode, taskLaneIdsFor(task.taskCode, lanes)]))
  const meterSessionKeys = new Map()
  for (const lane of lanes) {
    const measurement = meter[lane.id]
    const sessions = Array.isArray(measurement?.sessions) ? new Set(measurement.sessions.filter((session) => typeof session === 'string')) : new Set()
    meterSessionKeys.set(lane.id, sessions)
    if (measurement == null) continue
    for (const taskCode of lane.tasks) {
      if (knownTaskCodes.has(taskCode)) addLaneCoverage(coverageByTask, taskCode, lane.id)
    }
  }

  for (const group of settled) {
    for (const taskCode of group.conflictTaskCodes) if (knownTaskCodes.has(taskCode)) conflictTaskCodes.add(taskCode)
    if (group.conflict || !group.selected) continue
    const row = group.selected
    if (row.taskCode) {
      const current = directRows.get(row.taskCode) || []
      current.push(row)
      directRows.set(row.taskCode, current)
      continue
    }
    const laneIds = branchLaneIds(row.branch, lanes)
    if (!laneIds.length) {
      hasUnattributedReport = true
      continue
    }
    for (const laneId of laneIds) {
      const lane = lanes.find((candidate) => candidate.id === laneId)
      for (const taskCode of lane?.tasks || []) {
        if (!knownTaskCodes.has(taskCode)) continue
        addLaneCoverage(coverageByTask, taskCode, laneId)
        branchOnlyTasks.add(taskCode)
      }
    }
  }

  for (const rows of directRows.values()) rows.sort(reportOrder)
  const allRows = settled.flatMap((group) => group.candidates)
  const ledger = {
    schemaVersion: TASK_USAGE_LEDGER_SCHEMA_VERSION,
    availability,
    asOf: parsedInput.asOf != null ? dateToIso(parsedInput.asOf) : reportAsOf(allRows, parsedInput.meterUsage ?? parsedInput.usage),
    tasks: tasks.map((task) => projectTask(task, {
      availability,
      branchOnlyTasks,
      conflictTaskCodes,
      coverageByTask,
      directRows,
      hasUnattributedReport,
      meterSessionKeys,
      predictedTokens: (taskCode) => {
        const predicted = getContainer(containers, taskCode).predictedTokens
        return isNonNegativeInteger(predicted) ? predicted : null
      },
      taskLaneIds,
    })),
  }
  const result = TaskUsageLedgerSchema.safeParse(ledger)
  if (!result.success) throw new Error(`TASK_USAGE_LEDGER_OUTPUT_INVALID:${result.error.issues[0]?.path.join('.') || 'shape'}`)
  return result.data
}

function taskLaneIdsFor(taskCode, lanes) {
  return taskLaneIds(taskCode, lanes)
}

/**
 * Remove operator evidence and model identifiers before a member/public read.
 * The internal projection already excludes sessions, branches, people and
 * account labels; this final boundary also strips report hashes and models.
 */
export function redactTaskUsageLedger(ledger, audience = 'public') {
  const parsed = TaskUsageLedgerSchema.parse(ledger)
  const operator = audience === 'operator' || audience?.kind === 'operator'
  if (operator) return parsed
  return {
    ...parsed,
    tasks: parsed.tasks.map((task) => {
      const { evidence, ...withoutEvidence } = task
      return {
        ...withoutEvidence,
        ...(task.actual ? { actual: { ...task.actual, models: [] } } : { actual: null }),
      }
    }),
  }
}

// A descriptive alias keeps the projection easy to discover for callers that
// use “build” terminology while retaining one implementation and one shape.
export const buildTaskUsageLedger = projectTaskUsageLedger
