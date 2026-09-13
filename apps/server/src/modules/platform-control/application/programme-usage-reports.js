import { createHash, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-218 — agents without local session logs report one session's usage for
//   one programme task. Stored once per (source, sessionId): the same payload
//   again is a replay, a different payload is a conflict, an unknown task is
//   refused by name. The board reads the rows back and merges them with the
//   meter's figures without counting a session twice (program-delivery-metrics).
// @spec ADR-086 D5; SDD-008 (Zod at the boundary)
// @tested tests/unit/programme-usage-reports.test.js

/** The deployment bearer, compared in constant time; a secret under 32 characters admits nothing. */
export function bearerMatches(header, secret) {
  if (!secret || secret.length < 32) return false
  const supplied = Buffer.from(header || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

const count = z.number().int().min(0).max(2_000_000_000)

export const ProgrammeUsageReportSchema = z.object({
  source: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{1,39}$/, 'source must be a lowercase tool name such as codex or claude-code'),
  sessionId: z.string().trim().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  taskCode: z.string().trim().regex(/^TASK-ZAI-\d{3}$/),
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
    report.source, report.sessionId, report.taskCode, report.model ?? '',
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
  taskCode: row.taskCode,
  reportedAt: row.reportedAt instanceof Date ? row.reportedAt.toISOString() : row.reportedAt,
})

const isUniqueViolation = (error) => error?.code === 'P2002'

/**
 * @returns {Promise<{ status: number, body: object }>} never throws for a caller
 *   mistake; a database failure propagates to the route, which answers 503.
 */
export async function recordProgrammeUsageReport(db, input, { knownTaskCodes }) {
  const parsed = ProgrammeUsageReportSchema.safeParse(input)
  if (!parsed.success) {
    return { status: 400, body: { error: 'USAGE_REPORT_INVALID', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }
  }
  const report = parsed.data
  if (!knownTaskCodes.has(report.taskCode)) {
    return { status: 404, body: { error: 'PROGRAMME_TASK_UNKNOWN', taskCode: report.taskCode } }
  }
  const payloadSha256 = usageReportDigest(report)
  const existing = await db.programmeUsageReport.findUnique({ where: { source_sessionId: { source: report.source, sessionId: report.sessionId } } })
  if (existing) return replayOrConflict(existing, payloadSha256)

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.programmeUsageReport.create({
        data: {
          source: report.source,
          sessionId: report.sessionId,
          taskCode: report.taskCode,
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
        },
      })
      await recordAudit(tx, {
        entityType: 'PROGRAMME_USAGE_REPORT',
        entityId: row.id,
        action: 'REPORTED',
        actorType: 'AGENT',
        actorId: `${report.source}:${report.sessionId}`,
        payload: {
          taskCode: report.taskCode,
          requestCount: report.requestCount,
          tokensUsed: report.inputTokens + report.cacheWriteTokens + report.outputTokens,
          cacheReadTokens: report.cacheReadTokens,
        },
      })
      return row
    })
    return { status: 201, body: { report: view(created), replayed: false } }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // Two deliveries of one session raced; the loser answers as a replay or a conflict.
    const winner = await db.programmeUsageReport.findUnique({ where: { source_sessionId: { source: report.source, sessionId: report.sessionId } } })
    if (!winner) throw error
    return replayOrConflict(winner, payloadSha256)
  }
}

function replayOrConflict(row, payloadSha256) {
  if (row.payloadSha256 === payloadSha256) return { status: 200, body: { report: view(row), replayed: true } }
  return { status: 409, body: { error: 'USAGE_REPORT_CONFLICT', report: view(row) } }
}

/**
 * Every report, for the board. Answers `available: false` instead of throwing
 * when the table is absent — the migration is applied separately (ADR-057) and
 * the board must render before it is.
 */
export async function listProgrammeUsageReports(db) {
  try {
    const rows = await db.programmeUsageReport.findMany({
      orderBy: [{ taskCode: 'asc' }, { startedAt: 'asc' }],
      take: 5000,
      select: {
        source: true, sessionId: true, taskCode: true, model: true,
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
