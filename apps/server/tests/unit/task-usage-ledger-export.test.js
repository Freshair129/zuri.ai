// @req FR-216, FR-218 — the deployment bearer protects the task-bound usage
// projection, which reports direct aggregates and keeps NOT_REPORTED distinct
// from source unavailability and lane-only coverage.
// @spec ADR-086 D1-D7; ADR-087 D4-D6; task-usage-ledger.v1 contract
// @tested apps/server/src/app/api/platform/task-usage-ledger/route.js

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  bearerMatches: vi.fn(),
  listReports: vi.fn(),
  prisma: {},
}))

vi.mock('@/lib/db', () => ({ default: mocks.prisma }))
vi.mock('@/modules/platform-control/application/programme-usage-reports', () => ({
  bearerMatches: mocks.bearerMatches,
  listProgrammeUsageReports: mocks.listReports,
}))

const { GET } = await import('@/app/api/platform/task-usage-ledger/route')

const TOKEN = 'deployment-token-that-is-long-enough-for-the-boundary'

const directReport = {
  source: 'codex',
  sessionId: 'session-task-001',
  branch: 'feat/task-001',
  taskCode: 'TASK-ZAI-001',
  repository: 'Freshair129/zuri-ai',
  personId: 'person-secret',
  installationId: 'install-secret',
  aiAccountLabel: 'owner-account',
  model: 'gpt-5.5-codex',
  inputTokens: 1200,
  cacheWriteTokens: 100,
  cacheReadTokens: 9000,
  outputTokens: 800,
  requestCount: 14,
  activeMinutes: 32,
  startedAt: '2026-09-18T10:00:00+00:00',
  endedAt: '2026-09-18T10:40:00+00:00',
  reportedAt: '2026-09-18T10:41:00+00:00',
  id: 'report-secret',
  payloadSha256: 'a'.repeat(64),
  detail: { rawPrompt: 'must never cross the route boundary' },
}

const request = (path = '/api/platform/task-usage-ledger', authorization = `Bearer ${TOKEN}`) => new Request(`http://localhost${path}`, {
  headers: authorization ? { authorization } : {},
})

describe('GET /api/platform/task-usage-ledger', () => {
  beforeEach(() => {
    process.env.ZURI_PROGRAMME_USAGE_TOKEN = TOKEN
    mocks.bearerMatches.mockReset()
    mocks.listReports.mockReset()
    mocks.bearerMatches.mockImplementation((header, secret) => header === `Bearer ${secret}`)
    mocks.listReports.mockResolvedValue({ available: true, reports: [] })
  })

  it('checks the deployment bearer before reading URL data or the report source', async () => {
    mocks.bearerMatches.mockReturnValue(false)
    const guardedRequest = {
      headers: { get: vi.fn(() => null) },
      get url() {
        throw new Error('URL must not be read before authentication')
      },
    }

    const response = await GET(guardedRequest)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'TASK_USAGE_LEDGER_CREDENTIAL_REQUIRED' })
    expect(mocks.listReports).not.toHaveBeenCalled()
  })

  it('returns a redacted direct task aggregate and never exposes report identity fields', async () => {
    mocks.listReports.mockResolvedValue({ available: true, reports: [directReport] })

    const response = await GET(request('/api/platform/task-usage-ledger?taskCode=TASK-ZAI-001'))
    const body = await response.json()
    const task = body.tasks[0]
    const serialised = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.tasks).toHaveLength(1)
    expect(task).toMatchObject({
      taskCode: 'TASK-ZAI-001',
      measurementStatus: 'MEASURED_DIRECT',
      reconciliationStatus: 'NONE',
      actual: {
        tokens: {
          inputTokens: 1200,
          cacheWriteTokens: 100,
          cacheReadTokens: 9000,
          outputTokens: 800,
          usedTokens: 2100,
        },
        requestCount: 14,
        activeMinutes: 32,
        reportCount: 1,
        models: [],
      },
    })
    expect(task).not.toHaveProperty('evidence')
    expect(serialised).not.toMatch(/session-task-001|Freshair129|person-secret|install-secret|owner-account|report-secret|payloadSha256|rawPrompt|gpt-5\.5-codex/)
    expect(mocks.bearerMatches).toHaveBeenCalledWith(`Bearer ${TOKEN}`, TOKEN)
    expect(mocks.listReports).toHaveBeenCalledWith(mocks.prisma)
  })

  it('keeps NOT_REPORTED visible for a known task when no report exists', async () => {
    const response = await GET(request('/api/platform/task-usage-ledger?taskCode=TASK-ZAI-002'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.availability).toBe('AVAILABLE')
    expect(body.tasks).toEqual([expect.objectContaining({
      taskCode: 'TASK-ZAI-002',
      measurementStatus: 'NOT_REPORTED',
      actual: null,
    })])
  })

  it('distinguishes an unavailable report source from a known task with no report', async () => {
    mocks.listReports.mockResolvedValue({ available: false, reports: [] })

    const response = await GET(request('/api/platform/task-usage-ledger?taskCode=TASK-ZAI-002'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ availability: 'SOURCE_UNAVAILABLE', tasks: [expect.objectContaining({
      taskCode: 'TASK-ZAI-002',
      measurementStatus: 'SOURCE_UNAVAILABLE',
      actual: null,
    })] })
  })

  it('keeps branch-only lane usage unallocated instead of copying it into the task actual', async () => {
    mocks.listReports.mockResolvedValue({ available: true, reports: [{
      ...directReport,
      sessionId: 'session-lane-only',
      branch: 'docs/cost-quote-engine-plan',
      taskCode: null,
      id: 'lane-only-report',
    }] })

    const response = await GET(request('/api/platform/task-usage-ledger?taskCode=TASK-ZAI-052'))
    const body = await response.json()
    const task = body.tasks[0]

    expect(response.status).toBe(200)
    expect(task).toMatchObject({
      taskCode: 'TASK-ZAI-052',
      measurementStatus: 'LANE_ONLY_UNALLOCATED',
      reconciliationStatus: 'BRANCH_ONLY_LANE',
      actual: null,
      attribution: { kind: 'LANE_ONLY', directReportCount: 0 },
    })
  })

  it('does not query reports for an unknown task filter after authentication', async () => {
    const response = await GET(request('/api/platform/task-usage-ledger?taskCode=TASK-ZAI-999'))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'PROGRAMME_TASK_UNKNOWN', taskCode: 'TASK-ZAI-999' })
    expect(mocks.listReports).not.toHaveBeenCalled()
  })
})
