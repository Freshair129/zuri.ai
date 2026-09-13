// @req FR-218 — the usage report endpoint: bearer before body, a validated report
//   stored once per (source, sessionId), replay 200, conflict 409, unknown task
//   404, audit on create; the board list survives an absent table; the model and
//   its route are in both schemas, both migration trees and the route inventory.
// @spec ADR-086 D5; SEC-001; SDD-008
// @tested tests/unit/programme-usage-reports.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  ProgrammeUsageReportSchema,
  bearerMatches,
  listProgrammeUsageReports,
  recordProgrammeUsageReport,
  usageReportDigest,
} from '@/modules/platform-control/application/programme-usage-reports'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const SECRET = 'x'.repeat(40)
const body = (over = {}) => ({
  source: 'codex',
  sessionId: '01a085ee-0215-73d3-8f7a-b4e25f29b9ba',
  taskCode: 'TASK-ZAI-066',
  model: 'gpt-5.5-codex',
  inputTokens: 1200,
  cacheWriteTokens: 0,
  cacheReadTokens: 90000,
  outputTokens: 800,
  requestCount: 14,
  activeMinutes: 32,
  startedAt: '2026-09-13T10:00:00.000Z',
  endedAt: '2026-09-13T10:40:00+00:00',
  ...over,
})

function fakeDb({ existing = null, raceWinner = null } = {}) {
  const rows = existing ? [existing] : []
  const audits = []
  const db = {
    programmeUsageReport: {
      findUnique: vi.fn(async ({ where }) => rows.find((r) => r.source === where.source_sessionId.source && r.sessionId === where.source_sessionId.sessionId) || null),
      findMany: vi.fn(async () => rows),
    },
    $transaction: vi.fn(async (fn) => fn({
      programmeUsageReport: {
        create: vi.fn(async ({ data }) => {
          if (raceWinner) {
            rows.push(raceWinner)
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002', name: 'PrismaClientKnownRequestError' })
          }
          const row = { id: 'row-1', reportedAt: new Date('2026-09-13T11:00:00.000Z'), ...data }
          rows.push(row)
          return row
        }),
      },
      auditEvent: { create: vi.fn(async ({ data }) => { audits.push(data); return { id: 'audit-1', ...data } }) },
    })),
  }
  return { db, rows, audits }
}

const known = new Set(['TASK-ZAI-066'])

describe('FR-218 bearer', () => {
  it('admits only the exact deployment bearer, and nothing when the secret is short or unset', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(bearerMatches(SECRET, SECRET)).toBe(false)
    expect(bearerMatches(null, SECRET)).toBe(false)
    expect(bearerMatches('Bearer short', 'short')).toBe(false)
    expect(bearerMatches('Bearer ', undefined)).toBe(false)
  })
})

describe('FR-218 recording', () => {
  it('stores a valid report once and audits it without token secrets or content', async () => {
    const { db, rows, audits } = fakeDb()
    const result = await recordProgrammeUsageReport(db, body(), { knownTaskCodes: known })
    expect(result.status).toBe(201)
    expect(result.body).toMatchObject({ replayed: false, report: { source: 'codex', taskCode: 'TASK-ZAI-066' } })
    expect(rows[0]).toMatchObject({ inputTokens: 1200, cacheReadTokens: 90000, payloadSha256: usageReportDigest(ProgrammeUsageReportSchema.parse(body())) })
    expect(audits[0]).toMatchObject({ entityType: 'PROGRAMME_USAGE_REPORT', action: 'REPORTED', actorType: 'AGENT' })
    expect(JSON.parse(audits[0].payloadJson)).toEqual({ taskCode: 'TASK-ZAI-066', requestCount: 14, tokensUsed: 2000, cacheReadTokens: 90000 })
  })

  it('answers a replay of the same session with 200 and a different payload with 409', async () => {
    const stored = { id: 'row-1', source: 'codex', sessionId: body().sessionId, taskCode: 'TASK-ZAI-066', reportedAt: new Date(), payloadSha256: usageReportDigest(ProgrammeUsageReportSchema.parse(body())) }
    const replay = await recordProgrammeUsageReport(fakeDb({ existing: stored }).db, body({ endedAt: '2026-09-13T17:40:00+07:00' }), { knownTaskCodes: known })
    expect(replay.status).toBe(200)
    expect(replay.body.replayed).toBe(true)
    const conflict = await recordProgrammeUsageReport(fakeDb({ existing: stored }).db, body({ outputTokens: 801 }), { knownTaskCodes: known })
    expect(conflict).toMatchObject({ status: 409, body: { error: 'USAGE_REPORT_CONFLICT' } })
  })

  it('resolves a lost race as a replay rather than a server error', async () => {
    const winner = { id: 'row-2', source: 'codex', sessionId: body().sessionId, taskCode: 'TASK-ZAI-066', reportedAt: new Date(), payloadSha256: usageReportDigest(ProgrammeUsageReportSchema.parse(body())) }
    const result = await recordProgrammeUsageReport(fakeDb({ raceWinner: winner }).db, body(), { knownTaskCodes: known })
    expect(result.status).toBe(200)
  })

  it('refuses an unknown task and an invalid body by name', async () => {
    const { db } = fakeDb()
    expect(await recordProgrammeUsageReport(db, body({ taskCode: 'TASK-ZAI-999' }), { knownTaskCodes: known })).toMatchObject({ status: 404, body: { error: 'PROGRAMME_TASK_UNKNOWN' } })
    for (const bad of [body({ inputTokens: -1 }), body({ source: 'Codex CLI' }), body({ endedAt: '2026-09-13T09:00:00.000Z' }), { ...body(), prompt: 'secret text' }, body({ requestCount: 0 })]) {
      const r = await recordProgrammeUsageReport(db, bad, { knownTaskCodes: known })
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('USAGE_REPORT_INVALID')
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('lists nothing, without throwing, when the table has not been migrated yet', async () => {
    const db = { programmeUsageReport: { findMany: vi.fn(async () => { throw Object.assign(new Error('table does not exist'), { code: 'P2021' }) }) } }
    expect(await listProgrammeUsageReports(db)).toEqual({ available: false, reports: [] })
  })
})

describe('FR-218 route and persistence contract', () => {
  it('checks the bearer before reading the body and never resolves a browser viewer', () => {
    const route = read('src/app/api/platform/programme-usage-reports/route.js')
    expect(route).toMatch(/export async function POST/)
    expect(route).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/)
    expect(route.indexOf('bearerMatches(')).toBeLessThan(route.indexOf('request.json('))
    expect(route).toMatch(/ZURI_PROGRAMME_USAGE_TOKEN/)
    expect(route).not.toMatch(/resolveRequestViewer/)
  })

  it('declares the model in both schemas and migrates it in both trees', () => {
    for (const schema of ['prisma/schema.prisma', 'prisma/schema.postgres.prisma']) {
      expect(read(schema)).toMatch(/model ProgrammeUsageReport \{[\s\S]*@@unique\(\[source, sessionId\]\)/)
    }
    expect(read('prisma/migrations/20260913230000_programme_usage_report/migration.sql')).toMatch(/CREATE TABLE "ProgrammeUsageReport"/)
    const supabase = read('supabase/migrations/20260913230000_programme_usage_report.sql')
    expect(supabase).toMatch(/FORCE ROW LEVEL SECURITY/)
    expect(supabase).toMatch(/NOT APPLIED to production/)
  })
})
