// @req FR-218 — the usage report endpoint: credential before body, a validated
//   report stored once per key, replay 200, unknown task 404, audit on create; the
//   board list survives an absent table; the model and its route are in both
//   schemas, both migration trees and the route inventory.
// @req FR-221 — a harness report carries the credential's person and installation,
//   is keyed by (source, sessionId, branch), extends a resumed session whose counts
//   only grow, and conflicts on anything else.
// @spec ADR-086 D5; ADR-087 D4-D6; SEC-001; SDD-008
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
const HARNESS = { kind: 'harness', personId: 'per-1', installationId: 'inst-1' }
const body = (over = {}) => ({
  source: 'codex',
  sessionId: '01a085ee-0215-73d3-8f7a-b4e25f29b9ba',
  branch: 'feat/harness-usage-plugin',
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
const digestOf = (b) => usageReportDigest(ProgrammeUsageReportSchema.parse(b))

function fakeDb({ existing = null, raceWinner = null } = {}) {
  const rows = existing ? [existing] : []
  const audits = []
  const findKey = ({ where }) => rows.find((r) => r.source === where.source_sessionId_branch.source && r.sessionId === where.source_sessionId_branch.sessionId && r.branch === where.source_sessionId_branch.branch) || null
  const tx = {
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
      update: vi.fn(async ({ where, data }) => {
        const row = rows.find((r) => r.id === where.id)
        Object.assign(row, data)
        return row
      }),
    },
    auditEvent: { create: vi.fn(async ({ data }) => { audits.push(data); return { id: `audit-${audits.length}`, ...data } }) },
  }
  const db = {
    programmeUsageReport: { findUnique: vi.fn(async (args) => findKey(args)), findMany: vi.fn(async () => rows) },
    $transaction: vi.fn(async (fn) => fn(tx)),
  }
  return { db, rows, audits }
}

const known = new Set(['TASK-ZAI-066'])
const storedFrom = (b, reporter = HARNESS, over = {}) => ({
  id: 'row-1', source: b.source, sessionId: b.sessionId, branch: b.branch ?? '', taskCode: b.taskCode ?? null, reportedAt: new Date(),
  installationId: reporter.installationId ?? null, personId: reporter.personId ?? null,
  inputTokens: b.inputTokens, cacheWriteTokens: b.cacheWriteTokens, cacheReadTokens: b.cacheReadTokens, outputTokens: b.outputTokens,
  requestCount: b.requestCount, activeMinutes: b.activeMinutes, startedAt: new Date(b.startedAt), endedAt: new Date(b.endedAt),
  payloadSha256: digestOf(b), ...over,
})

describe('FR-218 deployment bearer', () => {
  it('admits only the exact deployment bearer, and nothing when the secret is short or unset', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(bearerMatches(SECRET, SECRET)).toBe(false)
    expect(bearerMatches(null, SECRET)).toBe(false)
    expect(bearerMatches('Bearer short', 'short')).toBe(false)
    expect(bearerMatches('Bearer ', undefined)).toBe(false)
  })
})

describe('FR-221 recording', () => {
  it('stores a harness report with the credential person and installation, and audits it without content', async () => {
    const { db, rows, audits } = fakeDb()
    const result = await recordProgrammeUsageReport(db, body({ aiAccount: 'claude-max-team-a', repository: 'Freshair129/zuri.ai' }), { knownTaskCodes: known, reporter: HARNESS })
    expect(result.status).toBe(201)
    expect(rows[0]).toMatchObject({ personId: 'per-1', installationId: 'inst-1', branch: 'feat/harness-usage-plugin', taskCode: null, aiAccountLabel: 'claude-max-team-a', repository: 'Freshair129/zuri.ai' })
    expect(audits[0]).toMatchObject({ entityType: 'PROGRAMME_USAGE_REPORT', action: 'REPORTED', actorType: 'AGENT', actorId: 'per-1' })
    expect(JSON.parse(audits[0].payloadJson)).toMatchObject({ reporter: 'harness', installationId: 'inst-1', tokensUsed: 2000, cacheReadTokens: 90000 })
  })

  it('refuses a body that names a person or installation of its own', async () => {
    const r = await recordProgrammeUsageReport(fakeDb().db, { ...body(), personId: 'someone-else' }, { knownTaskCodes: known, reporter: HARNESS })
    expect(r.status).toBe(400)
  })

  it('stores a deployment report with no person, and requires a branch or a task', async () => {
    const { db, rows } = fakeDb()
    expect((await recordProgrammeUsageReport(db, body({ branch: undefined, taskCode: 'TASK-ZAI-066' }), { knownTaskCodes: known })).status).toBe(201)
    expect(rows[0]).toMatchObject({ personId: null, installationId: null, branch: '', taskCode: 'TASK-ZAI-066' })
    expect((await recordProgrammeUsageReport(fakeDb().db, body({ branch: undefined }), { knownTaskCodes: known })).status).toBe(400)
  })

  it('answers the same payload with a replay, and a resumed session whose counts only grow with an extension', async () => {
    const first = body()
    const replay = await recordProgrammeUsageReport(fakeDb({ existing: storedFrom(first) }).db, body({ endedAt: '2026-09-13T17:40:00+07:00' }), { knownTaskCodes: known, reporter: HARNESS })
    expect(replay).toMatchObject({ status: 200, body: { replayed: true, extended: false } })

    const { db, rows, audits } = fakeDb({ existing: storedFrom(first) })
    const resumed = body({ outputTokens: 2400, inputTokens: 3000, requestCount: 30, activeMinutes: 70, endedAt: '2026-09-13T12:00:00.000Z' })
    const extended = await recordProgrammeUsageReport(db, resumed, { knownTaskCodes: known, reporter: HARNESS })
    expect(extended).toMatchObject({ status: 200, body: { extended: true } })
    expect(rows[0]).toMatchObject({ outputTokens: 2400, requestCount: 30 })
    expect(rows[0].extendedAt).toBeInstanceOf(Date)
    expect(audits[0]).toMatchObject({ action: 'EXTENDED' })
  })

  it('conflicts when a count shrinks, the start moves, or another installation claims the key', async () => {
    const first = body()
    const cases = [
      [body({ outputTokens: 700 }), HARNESS],
      [body({ outputTokens: 900, startedAt: '2026-09-13T09:00:00.000Z' }), HARNESS],
      [body({ outputTokens: 900 }), { kind: 'harness', personId: 'per-2', installationId: 'inst-2' }],
      [body({ outputTokens: 900 }), { kind: 'deployment' }],
    ]
    for (const [next, reporter] of cases) {
      const r = await recordProgrammeUsageReport(fakeDb({ existing: storedFrom(first) }).db, next, { knownTaskCodes: known, reporter })
      expect(r).toMatchObject({ status: 409, body: { error: 'USAGE_REPORT_CONFLICT' } })
    }
  })

  it('keeps a session task binding immutable across extensions', async () => {
    const branchOnly = body({ taskCode: undefined })
    const reboundToTask = await recordProgrammeUsageReport(
      fakeDb({ existing: storedFrom(branchOnly) }).db,
      body({ taskCode: 'TASK-ZAI-066', outputTokens: 900 }),
      { knownTaskCodes: known, reporter: HARNESS },
    )
    expect(reboundToTask).toMatchObject({ status: 409, body: { error: 'USAGE_REPORT_CONFLICT' } })

    const taskBound = body({ taskCode: 'TASK-ZAI-066' })
    const reboundToBranch = await recordProgrammeUsageReport(
      fakeDb({ existing: storedFrom(taskBound) }).db,
      body({ taskCode: undefined, outputTokens: 900 }),
      { knownTaskCodes: known, reporter: HARNESS },
    )
    expect(reboundToBranch).toMatchObject({ status: 409, body: { error: 'USAGE_REPORT_CONFLICT' } })
  })

  it('treats a second branch of one session as its own report', async () => {
    const { db } = fakeDb({ existing: storedFrom(body()) })
    const r = await recordProgrammeUsageReport(db, body({ branch: 'docs/harness-usage-plugin-plan' }), { knownTaskCodes: known, reporter: HARNESS })
    expect(r.status).toBe(201)
  })

  it('resolves a lost race against the winner', async () => {
    const winner = storedFrom(body(), HARNESS, { id: 'row-2' })
    expect((await recordProgrammeUsageReport(fakeDb({ raceWinner: winner }).db, body(), { knownTaskCodes: known, reporter: HARNESS })).status).toBe(200)
  })

  it('refuses an unknown task and an invalid body by name', async () => {
    const { db } = fakeDb()
    expect(await recordProgrammeUsageReport(db, body({ taskCode: 'TASK-ZAI-999' }), { knownTaskCodes: known, reporter: HARNESS })).toMatchObject({ status: 404, body: { error: 'PROGRAMME_TASK_UNKNOWN' } })
    for (const bad of [body({ inputTokens: -1 }), body({ source: 'Codex CLI' }), body({ endedAt: '2026-09-13T09:00:00.000Z' }), { ...body(), prompt: 'secret text' }, body({ requestCount: 0 }), body({ branch: 'feat bad branch' })]) {
      const r = await recordProgrammeUsageReport(db, bad, { knownTaskCodes: known, reporter: HARNESS })
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('USAGE_REPORT_INVALID')
    }
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('lists nothing, without throwing, when the table has not been migrated yet', async () => {
    const db = { programmeUsageReport: { findMany: vi.fn(async () => { throw Object.assign(new Error('column does not exist'), { code: 'P2022' }) }) } }
    expect(await listProgrammeUsageReports(db)).toEqual({ available: false, reports: [] })
  })
})

describe('FR-218 / FR-221 route and persistence contract', () => {
  it('checks the credential before reading the body, accepts a harness credential, and never resolves a browser viewer', () => {
    const route = read('src/app/api/platform/programme-usage-reports/route.js')
    expect(route).toMatch(/export async function POST/)
    expect(route).not.toMatch(/export async function (GET|PUT|PATCH|DELETE)/)
    expect(route.indexOf('resolveReporter(')).toBeGreaterThan(-1)
    expect(route.lastIndexOf('resolveReporter(')).toBeLessThan(route.indexOf('request.json('))
    expect(route).toMatch(/authenticateHarnessCredential/)
    expect(route).toMatch(/HARNESS_NOT_ACTIVATED/)
    expect(route).toMatch(/ZURI_PROGRAMME_USAGE_TOKEN/)
    expect(route).not.toMatch(/resolveRequestViewer/)
  })

  it('declares the models in both schemas and migrates them in both trees', () => {
    for (const schema of ['prisma/schema.prisma', 'prisma/schema.postgres.prisma']) {
      const text = read(schema)
      expect(text).toMatch(/model ProgrammeUsageReport \{[\s\S]*@@unique\(\[source, sessionId, branch\]\)/)
      expect(text).toMatch(/model HarnessCredential \{[\s\S]*keyHash\s+String\s+@unique/)
    }
    expect(read('prisma/migrations/20260913230000_programme_usage_report/migration.sql')).toMatch(/CREATE TABLE "ProgrammeUsageReport"/)
    expect(read('prisma/migrations/20260914100000_harness_usage_attribution/migration.sql')).toMatch(/CREATE TABLE "HarnessCredential"/)
    const supabase = read('supabase/migrations/20260914100000_harness_usage_attribution.sql')
    expect(supabase).toMatch(/"ProgrammeUsageReport_source_sessionId_branch_key"/)
    expect(supabase).toMatch(/ALTER TABLE "HarnessCredential" FORCE ROW LEVEL SECURITY/)
    expect(supabase).toMatch(/NOT APPLIED to production/)
  })
})
