import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-218 — agents report one session's usage for programme work. Stored once
//   per key: the same payload again is a replay, an unknown task is refused by
//   name. The board reads the rows back and merges them with the meter's figures
//   without counting a session twice (program-delivery-metrics).
// @req FR-221 — the key is (source, sessionId, branch); a harness report carries
//   the credential's person and installation, never the body's; a resumed
//   session's report from the same installation extends when every count and the
//   end time only grow; the deployment bearer's reports carry no person.
// @spec ADR-086 D5; ADR-087 D4-D6; SDD-008 (Zod at the boundary)
// @tested tests/unit/programme-usage-reports.test.js

/** The deployment bearer, compared in constant time; a secret under 32 characters admits nothing. */
export function bearerMatches(header, secret) {
  if (!secret || secret.length < 32) return false
  const supplied = Buffer.from(header || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

const count = z.number().int().min(0).max(2_000_000_000)
const optionalLabel = (max) => z.string().trim().min(1).max(max).nullish()

export const ProgrammeUsageReportSchema = z.object({
  source: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,39}$/, 'source must be a lowercase tool name such as codex or claude-code'),
  sessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  branch: z.string().trim().max(200).regex(/^[\w./@+-]*$/, 'branch must be a git ref name').default(''),
  taskCode: z.string().trim().regex(/^TASK-ZAI-\d{3}$/).nullish(),
  repository: optionalLabel(200),
  aiAccount: optionalLabel(80),
  model: z.string().trim().max(80).nullish(),
  inputTokens: count,
  cacheWriteTokens: count,
  cacheReadTokens: count,
  outputTokens: count,
  requestCount: z.number().int().min(1).max(1_000_000),
  activeMinutes: z.number().int().min(0).max(100_000),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
}).strict().refine((r) => Date.parse(r.endedAt) >= Date.parse(r.startedAt), { message: 'endedAt is before startedAt', path: ['endedAt'] })

/** The digest a replay must match: every stored field, in a fixed order, times normalised to UTC. */
export function usageReportDigest(report) {
  const canonical = [
    report.source, report.sessionId, report.branch ?? '', report.taskCode ?? '', report.repository ?? '', report.aiAccount ?? '', report.model ?? '',
    report.inputTokens, report.cacheWriteTokens, report.cacheReadTokens, report.outputTokens,
    report.requestCount, report.activeMinutes,
    new Date(report.startedAt).toISOString(), new Date(report.endedAt).toISOString(),
  ].join('')
  return createHash('sha256').update(canonical).digest('hex')
}

const view = (row) => ({
  id: row.id,
  source: row.source,
  sessionId: row.sessionId,
  branch: row.branch,
  taskCode: row.taskCode,
  reportedAt: row.reportedAt instanceof Date ? row.reportedAt.toISOString() : row.reportedAt,
})

const isUniqueViolation = (error) => error?.code === 'P2002'
const COUNTS = ['inputTokens', 'cacheWriteTokens', 'cacheReadTokens', 'outputTokens', 'requestCount', 'activeMinutes']

/** A resumed session: same installation, same start, and nothing got smaller (ADR-087 D5). */
function growsFrom(row, report, reporter) {
  if ((row.installationId || null) !== (reporter.installationId || null)) return false
  if (new Date(row.startedAt).getTime() !== Date.parse(report.startedAt)) return false
  if (Date.parse(report.endedAt) < new Date(row.endedAt).getTime()) return false
  return COUNTS.every((field) => report[field] >= row[field])
}

const rowData = (report, payloadSha256, reporter) => ({
  source: report.source,
  sessionId: report.sessionId,
  branch: report.branch ?? '',
  taskCode: report.taskCode ?? null,
  repository: report.repository ?? null,
  personId: reporter.personId ?? null,
  installationId: reporter.installationId ?? null,
  aiAccountLabel: report.aiAccount ?? null,
  model: report.model ?? null,
  inputTokens: report.inputTokens,
  cacheWriteTokens: report.cacheWriteTokens,
  cacheReadTokens: report.cacheReadTokens,
  outputTokens: report.outputTokens,
  requestCount: report.requestCount,
  activeMinutes: report.activeMinutes,
  startedAt: new Date(report.startedAt),
  endedAt: new Date(report.endedAt),
  payloadSha256,
})

/**
 * @param reporter `{ kind: 'harness', personId, installationId }` from an active
 *   harness credential, or `{ kind: 'deployment' }` for the deployment bearer.
 * @returns {Promise<{ status: number, body: object }>} never throws for a caller
 *   mistake; a database failure propagates to the route, which answers 503.
 */
export async function recordProgrammeUsageReport(db, input, { knownTaskCodes, reporter = { kind: 'deployment' } }) {
  const parsed = ProgrammeUsageReportSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 400, body: { error: 'USAGE_REPORT_INVALID', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }
  }
  const report = parsed.data
  if (report.taskCode && !knownTaskCodes.has(report.taskCode)) {
    return { status: 404, body: { error: 'PROGRAMME_TASK_UNKNOWN', taskCode: report.taskCode } }
  }
  if (!report.taskCode && !report.branch) {
    return { status: 400, body: { error: 'USAGE_REPORT_INVALID', issues: [{ path: 'branch', message: 'name the branch the session worked on, or a taskCode' }] } }
  }
  const payloadSha256 = usageReportDigest(report)
  const key = { source_sessionId_branch: { source: report.source, sessionId: report.sessionId, branch: report.branch ?? '' } }
  const existing = await db.programmeUsageReport.findUnique({ where: key })
  if (existing) return settleExisting(db, existing, report, payloadSha256, reporter)

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.programmeUsageReport.create({ data: rowData(report, payloadSha256, reporter) })
      await recordAudit(tx, {
        entityType: 'PROGRAMME_USAGE_REPORT',
        entityId: row.id,
        action: 'REPORTED',
        actorType: 'AGENT',
        actorId: reporter.personId || `${report.source}:${report.sessionId}`,
        payload: {
          reporter: reporter.kind,
          installationId: reporter.installationId || null,
          branch: row.branch,
          taskCode: row.taskCode,
          requestCount: report.requestCount,
          tokensUsed: report.inputTokens + report.cacheWriteTokens + report.outputTokens,
          cacheReadTokens: report.cacheReadTokens,
        },
      })
      return row
    })
    return { status: 201, body: { report: view(created), replayed: false, extended: false } }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Two deliveries of one key raced; the loser settles against the winner.
    const winner = await db.programmeUsageReport.findUnique({ where: key })
    if (!winner) throw error
    return settleExisting(db, winner, report, payloadSha256, reporter)
  }
}

async function settleExisting(db, row, report, payloadSha256, reporter) {
  if (row.payloadSha256 === payloadSha256 && (row.installationId || null) === (reporter.installationId || null)) {
    return { status: 200, body: { report: view(row), replayed: true, extended: false } }
  }
  if (!growsFrom(row, report, reporter)) return { status: 409, body: { error: 'USAGE_REPORT_CONFLICT', report: view(row) } }
  const updated = await db.$transaction(async (tx) => {
    const next = await tx.programmeUsageReport.update({
      where: { id: row.id },
      data: { ...rowData(report, payloadSha256, reporter), extendedAt: new Date() },
    })
    await recordAudit(tx, {
      entityType: 'PROGRAMME_USAGE_REPORT',
      entityId: row.id,
      action: 'EXTENDED',
      actorType: 'AGENT',
      actorId: reporter.personId || `${report.source}:${report.sessionId}`,
      payload: {
        installationId: reporter.installationId || null,
        requestCount: { from: row.requestCount, to: report.requestCount },
        tokensUsed: {
          from: row.inputTokens + row.cacheWriteTokens + row.outputTokens,
          to: report.inputTokens + report.cacheWriteTokens + report.outputTokens,
        },
      },
    })
    return next
  })
  return { status: 200, body: { report: view(updated), replayed: false, extended: true } }
}

/**
 * Every report, for the board. Answers `available: false` instead of throwing
 * when the table is absent or not yet migrated — migrations are applied
 * separately (ADR-057) and the board must render before they are.
 */
export async function listProgrammeUsageReports(db) {
  try {
    const rows = await db.programmeUsageReport.findMany({
      orderBy: [{ startedAt: 'asc' }],
      take: 5000,
      select: {
        source: true, sessionId: true, branch: true, taskCode: true, repository: true,
        personId: true, installationId: true, aiAccountLabel: true, model: true,
        inputTokens: true, cacheWriteTokens: true, cacheReadTokens: true, outputTokens: true,
        requestCount: true, activeMinutes: true, startedAt: true, endedAt: true,
      },
    })
    return {
      available: true,
      reports: rows.map((r) => ({ ...r, startedAt: r.startedAt.toISOString(), endedAt: r.endedAt.toISOString() })),
    }
  } catch {
    return { available: false, reports: [] }
  }
}
