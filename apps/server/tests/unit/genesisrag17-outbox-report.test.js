import { describe, expect, it, vi } from 'vitest'
import { buildRedactedRequestJson } from '@/modules/knowledge/genesisrag17-outbox-redaction'
import {
  main,
  parseArgs,
  PENDING_MAX_AGE_DAYS,
  TERMINAL_TEXT_RETENTION_DAYS,
} from '../../scripts/genesisrag17-outbox-report.mjs'

// @req FR-109 — read-only over-bound reporting for the Stage 9 outbox.
// @spec ADR-121
// @tested tests/unit/genesisrag17-outbox-report.test.js

const DAY_MS = 24 * 60 * 60 * 1000
const FIXED_NOW = new Date('2026-11-26T12:00:00.000Z')
const scope = {
  portfolioId: 'portfolio-1',
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  visibility: 'private',
}
const allowedReply = {
  schemaVersion: 'genesisrag17.v1',
  scope,
  batchId: 'batch-1',
  status: 'ACKNOWLEDGED',
  decisionId: 'decision-1',
}

function requestJson({ content = '', chunks = [], mentions = [] } = {}) {
  return JSON.stringify({ source: { content }, chunks, mentions })
}

function row({
  id = 'row-001',
  batchId = id,
  status = 'ACKNOWLEDGED',
  createdDaysAgo = 0,
  updatedDaysAgo = createdDaysAgo,
  request = requestJson(),
  response = allowedReply,
  scopeValue = scope,
} = {}) {
  return {
    id,
    batchId,
    status,
    createdAt: new Date(FIXED_NOW.getTime() - createdDaysAgo * DAY_MS),
    updatedAt: new Date(FIXED_NOW.getTime() - updatedDaysAgo * DAY_MS),
    scopeJson: typeof scopeValue === 'string' ? scopeValue : JSON.stringify(scopeValue),
    requestJson: typeof request === 'string' ? request : JSON.stringify(request),
    responseJson: typeof response === 'string' ? response : JSON.stringify(response),
  }
}

function readOnlyDb(rows) {
  const ordered = [...rows].sort((left, right) => left.id.localeCompare(right.id))
  const findMany = vi.fn(async (query) => {
    const start = query.cursor
      ? ordered.findIndex((candidate) => candidate.id === query.cursor.id) + (query.skip ?? 0)
      : 0
    return ordered.slice(start, start + query.take).map((candidate) => ({ ...candidate }))
  })
  const model = new Proxy({ findMany }, {
    get(target, key, receiver) {
      if (key === 'findMany') return Reflect.get(target, key, receiver)
      throw new Error(`READ_ONLY_MODEL_METHOD_FORBIDDEN:${String(key)}`)
    },
  })
  const db = new Proxy({ genesisRag17Batch: model }, {
    get(target, key, receiver) {
      if (key === 'genesisRag17Batch') return Reflect.get(target, key, receiver)
      throw new Error(`READ_ONLY_DATABASE_METHOD_FORBIDDEN:${String(key)}`)
    },
  })
  return { db, findMany }
}

describe('GenesisRAG17 outbox report', () => {
  it('reports over-bound text and pending rows with strict age boundaries and UTF-8 byte counts', async () => {
    const { db } = readOnlyDb([
      row({
        id: 'ack-31',
        batchId: 'ack-31',
        status: 'ACKNOWLEDGED',
        createdDaysAgo: 60,
        updatedDaysAgo: 31,
        request: requestJson({ content: 'é', chunks: [{ text: 'x' }], mentions: [{ name: '👍' }] }),
      }),
      row({ id: 'ack-29', status: 'ACKNOWLEDGED', createdDaysAgo: 40, updatedDaysAgo: 29, request: requestJson({ content: 'still retained' }) }),
      row({ id: 'ack-empty', status: 'ACKNOWLEDGED', createdDaysAgo: 60, updatedDaysAgo: 31 }),
      row({ id: 'ack-exact-30', status: 'ACKNOWLEDGED', createdDaysAgo: 60, updatedDaysAgo: 30, request: requestJson({ content: 'boundary' }) }),
      row({ id: 'pending-91', status: 'PENDING', createdDaysAgo: 91, updatedDaysAgo: 91 }),
      row({ id: 'pending-89', status: 'PENDING', createdDaysAgo: 89, updatedDaysAgo: 89 }),
    ])
    const log = vi.fn()

    const result = await main(['--json'], { db, log, now: FIXED_NOW })

    expect(result.rows.map((entry) => entry.batchId)).toEqual(['ack-31', 'pending-91'])
    expect(result.rows[0]).toMatchObject({
      reasons: ['TEXT_PAST_TERMINAL_BOUND'],
      textBytes: 7,
      scope,
      scopeUnreadable: false,
      ageDaysSinceUpdatedAt: 31,
    })
    expect(result.rows[1].reasons).toEqual(['PENDING_PAST_BOUND'])
    expect(result.rows[1].textBytes).toBe(0)
    expect(result.summary).toMatchObject({ rowsScanned: 6, rowsReported: 2, countPerReason: { TEXT_PAST_TERMINAL_BOUND: 1, PENDING_PAST_BOUND: 1 } })
    expect(result.summary.dryRun).toBe('dry run: nothing was changed')
    expect(log.mock.calls[0][0]).toContain('dry run: nothing was changed')
  })

  it('reports only extra response key names, marks unreadable JSON, and never exposes member values', async () => {
    const sourceMarker = 'DISTINCTIVE_OUTBOX_SOURCE_TEXT_MARKER'
    const responseMarker = 'DISTINCTIVE_EXTRA_RESPONSE_VALUE_MARKER'
    const { db } = readOnlyDb([
      row({
        id: 'response-extra',
        batchId: 'response-extra',
        request: requestJson({ content: sourceMarker, chunks: [{ text: 'DISTINCTIVE_CHUNK_TEXT_MARKER' }], mentions: [{ name: 'DISTINCTIVE_MENTION_TEXT_MARKER' }] }),
        response: { ...allowedReply, entities: responseMarker },
      }),
      row({ id: 'unreadable', batchId: 'unreadable', request: 'not-json-source-marker', response: 'not-json-response-marker', scopeValue: 'not-json-scope-marker' }),
    ])
    const log = vi.fn()

    const result = await main(['--json'], { db, log, now: FIXED_NOW })
    const output = `${JSON.stringify(result)}${JSON.stringify(log.mock.calls)}`

    expect(result.rows.find((entry) => entry.batchId === 'response-extra')).toMatchObject({
      reasons: ['RESPONSE_BEYOND_CONTRACT'],
      extraResponseKeys: ['entities'],
    })
    expect(result.rows.find((entry) => entry.batchId === 'unreadable')).toMatchObject({
      reasons: ['RESPONSE_UNREADABLE', 'REQUEST_UNREADABLE'],
      extraResponseKeys: [],
      scope: null,
      scopeUnreadable: true,
    })
    for (const marker of [
      sourceMarker,
      'DISTINCTIVE_CHUNK_TEXT_MARKER',
      'DISTINCTIVE_MENTION_TEXT_MARKER',
      responseMarker,
      'decision-1',
      'batch-1',
      'not-json-source-marker',
      'not-json-response-marker',
      'not-json-scope-marker',
    ]) {
      expect(output).not.toContain(marker)
    }
    expect(output).toContain('entities')
  })

  it('does not flag a PENDING row that has no reply stored yet', async () => {
    const pending = { ...row({ id: 'row-null', status: 'PENDING', createdDaysAgo: 1 }), responseJson: null }
    const { db } = readOnlyDb([pending])
    const result = await main([], { db, log: vi.fn(), now: () => FIXED_NOW })
    expect(result.rows).toEqual([])
    expect(result.summary.rowsScanned).toBe(1)
  })

  it('summarizes valid redactions separately and flags an anomalous redacted PENDING row', async () => {
    const sourceText = 'REPORT_REDACTED_SOURCE_SECRET'
    const request = requestJson({ content: sourceText, chunks: [{ text: 'REPORT_REDACTED_CHUNK_SECRET' }], mentions: [{ name: 'REPORT_REDACTED_MENTION_SECRET' }] })
    const redactedRequest = buildRedactedRequestJson(request, {
      actor: 'Owner One',
      reason: 'Retention review',
      redactedAt: '2026-11-27T03:04:05.000Z',
    })
    const pendingRequest = buildRedactedRequestJson(request, {
      actor: 'Owner Two',
      reason: 'Retention review',
      redactedAt: '2026-11-27T03:04:05.000Z',
    })
    const { db } = readOnlyDb([
      row({ id: 'redacted-terminal', batchId: 'redacted-terminal', updatedDaysAgo: 45, request: redactedRequest }),
      { ...row({ id: 'redacted-pending', batchId: 'redacted-pending', status: 'PENDING', createdDaysAgo: 91, updatedDaysAgo: 91, request: pendingRequest }), responseJson: null },
    ])
    const log = vi.fn()

    const result = await main(['--json'], { db, log, now: FIXED_NOW })
    const output = `${JSON.stringify(result)}${JSON.stringify(log.mock.calls)}`

    expect(result.rows.map((entry) => entry.batchId)).toEqual(['redacted-pending'])
    expect(result.rows[0].reasons).toEqual(['PENDING_PAST_BOUND', 'REDACTED_BUT_PENDING'])
    expect(result.rows.some((entry) => entry.reasons.includes('TEXT_PAST_TERMINAL_BOUND'))).toBe(false)
    expect(result.summary.redactedRows).toBe(2)
    expect(result.summary.redacted).toEqual([
      {
        batchId: 'redacted-pending',
        redactedAt: '2026-11-27T03:04:05.000Z',
        redactedBy: 'Owner Two',
        originalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      {
        batchId: 'redacted-terminal',
        redactedAt: '2026-11-27T03:04:05.000Z',
        redactedBy: 'Owner One',
        originalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ])
    for (const marker of [sourceText, 'REPORT_REDACTED_CHUNK_SECRET', 'REPORT_REDACTED_MENTION_SECRET']) {
      expect(output).not.toContain(marker)
    }
  })

  it('uses the initial 30/90 day bounds and rejects every unknown or write-like flag', () => {
    expect(TERMINAL_TEXT_RETENTION_DAYS).toBe(30)
    expect(PENDING_MAX_AGE_DAYS).toBe(90)
    expect(parseArgs([])).toEqual({ json: false })
    expect(parseArgs(['--json'])).toEqual({ json: true })
    for (const flag of ['--write', '--apply', '--delete', '--redact', '--anything']) {
      expect(() => parseArgs([flag])).toThrow(/GENESISRAG17_OUTBOX_REPORT_USAGE/)
    }
  })

  it('paginates by id in batches of 200 and selects only required columns', async () => {
    const rows = Array.from({ length: 205 }, (_, index) => row({
      id: `row-${String(index).padStart(3, '0')}`,
      batchId: `batch-${index}`,
    }))
    const { db, findMany } = readOnlyDb(rows)
    const log = vi.fn()

    const result = await main([], { db, log, now: FIXED_NOW })

    expect(result.summary).toMatchObject({ rowsScanned: 205, rowsReported: 0 })
    expect(findMany).toHaveBeenCalledTimes(2)
    expect(findMany.mock.calls[0][0]).toMatchObject({
      orderBy: { id: 'asc' },
      take: 200,
      select: {
        id: true,
        batchId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        scopeJson: true,
        requestJson: true,
        responseJson: true,
      },
    })
    expect(findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'row-199' }, skip: 1, take: 200 })
    expect(log.mock.calls[0][0]).toContain('dry run: nothing was changed')
  })
})
