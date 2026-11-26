import { describe, expect, it, vi } from 'vitest'
import { buildRedactedRequestJson, parseRedactionMarker } from '@/modules/knowledge/genesisrag17-outbox-redaction'
import { main, parseArgs } from '../../scripts/genesisrag17-outbox-redact.mjs'

// @req FR-109 — named owner-run redaction is dry-run-first and optimistic-guarded.
// @spec ADR-121 D3-D6
// @tested tests/unit/genesisrag17-outbox-redact-script.test.js

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-27T03:04:05.000Z')

function requestJson({ source = 'SOURCE_SECRET_MARKER', chunk = 'CHUNK_SECRET_MARKER', mention = 'MENTION_SECRET_MARKER' } = {}) {
  return JSON.stringify({
    schemaVersion: 'genesisrag17.v1',
    batchId: 'envelope-batch',
    source: { sourceId: 'source-1', content: source, contentHash: 'a'.repeat(64) },
    chunks: [{ chunkId: 'chunk-1', text: chunk, startOffset: 0, endOffset: 5 }],
    mentions: [{ sourceMentionId: 'mention-1', name: mention, startOffset: 0, endOffset: 3 }],
  })
}

function row({
  id,
  batchId = id,
  status = 'ACKNOWLEDGED',
  createdDaysAgo = 45,
  updatedDaysAgo = createdDaysAgo,
  request = requestJson(),
  response = JSON.stringify({ decisionId: 'RESPONSE_SECRET_MARKER' }),
  tenantId = 'tenant-1',
} = {}) {
  return {
    id,
    batchId,
    status,
    createdAt: new Date(NOW.getTime() - createdDaysAgo * DAY_MS),
    updatedAt: new Date(NOW.getTime() - updatedDaysAgo * DAY_MS),
    scopeJson: JSON.stringify({ tenantId }),
    requestJson: request,
    responseJson: response,
    decisionId: 'decision-1',
  }
}

function fakeDb(initialRows, { conflictIds = [] } = {}) {
  const rows = initialRows.map((value) => ({ ...value }))
  const updateMany = vi.fn(async ({ where, data }) => {
    if (conflictIds.includes(where.id)) return { count: 0 }
    const found = rows.find((candidate) => candidate.id === where.id && candidate.requestJson === where.requestJson)
    if (!found) return { count: 0 }
    Object.assign(found, data)
    return { count: 1 }
  })
  const update = vi.fn(async () => { throw new Error('UPDATE_FORBIDDEN') })
  const deleteOne = vi.fn(async () => { throw new Error('DELETE_FORBIDDEN') })
  const deleteMany = vi.fn(async () => { throw new Error('DELETE_MANY_FORBIDDEN') })
  const findMany = vi.fn(async (query) => {
    const selected = rows
      .filter((candidate) => !query.where?.batchId?.in || query.where.batchId.in.includes(candidate.batchId))
      .sort((left, right) => left.id.localeCompare(right.id))
    const start = query.cursor
      ? selected.findIndex((candidate) => candidate.id === query.cursor.id) + (query.skip ?? 0)
      : 0
    return selected.slice(start, start + query.take).map(({ responseJson: _responseJson, ...candidate }) => ({ ...candidate }))
  })
  const transactions = []
  const db = {
    genesisRag17Batch: { findMany, updateMany, update, delete: deleteOne, deleteMany },
    $transaction: vi.fn(async (callback) => {
      transactions.push('transaction')
      return callback({ genesisRag17Batch: { updateMany } })
    }),
  }
  return { db, rows, findMany, updateMany, update, delete: deleteOne, deleteMany, transactions }
}

function parseOutput(log) {
  return JSON.parse(log.mock.calls[0][0])
}

describe('GenesisRAG17 outbox redact script arguments', () => {
  it('parses safe defaults, repeatable batch ids, and a bounded page size', () => {
    expect(parseArgs([])).toEqual({ apply: false, actor: null, reason: null, json: false, scopeTenant: null, batchIds: [], limit: 200 })
    expect(parseArgs(['--json', '--scope-tenant', 'tenant-1', '--batch-id', 'b-1', '--batch-id', 'b-2', '--limit', '25'])).toEqual({
      apply: false,
      actor: null,
      reason: null,
      json: true,
      scopeTenant: 'tenant-1',
      batchIds: ['b-1', 'b-2'],
      limit: 25,
    })
    for (const argv of [
      ['--unknown'],
      ['--batch-id'],
      ['--batch-id', '--apply'],
      ['--actor'],
      ['--reason'],
      ['--scope-tenant'],
      ['--limit', '0'],
      ['--limit', 'nope'],
      ['--apply', '--actor', 'Owner'],
      ['--apply', '--reason', 'review'],
    ]) {
      expect(() => parseArgs(argv)).toThrow(/GENESISRAG17_OUTBOX_REDACT_USAGE/)
    }
  })
})

describe('GenesisRAG17 outbox redact script', () => {
  it('dry-runs eligible rows without calling any write method or exposing text', async () => {
    const source = 'SOURCE_SECRET_MARKER'
    const chunk = 'CHUNK_SECRET_MARKER'
    const mention = 'MENTION_SECRET_MARKER'
    const fixture = fakeDb([
      row({ id: 'eligible', batchId: 'eligible' }),
      row({ id: 'young-terminal', batchId: 'young-terminal', updatedDaysAgo: 29 }),
      row({ id: 'young-pending', batchId: 'young-pending', status: 'PENDING', createdDaysAgo: 89, updatedDaysAgo: 89 }),
      row({ id: 'old-pending', batchId: 'old-pending', status: 'PENDING', createdDaysAgo: 91, updatedDaysAgo: 91 }),
      row({ id: 'unreadable', batchId: 'unreadable', request: 'not-json' }),
      row({ id: 'other-tenant', batchId: 'other-tenant', tenantId: 'tenant-2' }),
      row({
        id: 'already-redacted',
        batchId: 'already-redacted',
        request: buildRedactedRequestJson(requestJson(), { actor: 'Prior Owner', reason: 'Prior review', redactedAt: '2026-11-01T00:00:00.000Z' }),
      }),
    ])
    const log = vi.fn()

    const result = await main(['--json', '--scope-tenant', 'tenant-1'], { db: fixture.db, log, now: NOW })
    const output = `${JSON.stringify(result)}${JSON.stringify(log.mock.calls)}`

    expect(result.mode).toBe('dry-run')
    expect(result.summary).toMatchObject({
      mode: 'dry-run',
      rowsScanned: 7,
      eligible: 1,
      redacted: 0,
      alreadyRedacted: 1,
      skippedPendingOverBound: 1,
      skippedUnreadable: 1,
      conflicts: 0,
      skippedPendingOverBoundBatchIds: ['old-pending'],
    })
    expect(result.rows).toEqual([{ batchId: 'eligible', textBytes: 60, originalSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }])
    expect(output).toContain('dry run: nothing was changed')
    for (const secret of [source, chunk, mention, 'RESPONSE_SECRET_MARKER', 'not-json']) expect(output).not.toContain(secret)
    expect(fixture.findMany).toHaveBeenCalled()
    expect(fixture.update).not.toHaveBeenCalled()
    expect(fixture.updateMany).not.toHaveBeenCalled()
    expect(fixture.delete).not.toHaveBeenCalled()
    expect(fixture.deleteMany).not.toHaveBeenCalled()
    expect(fixture.db.$transaction).not.toHaveBeenCalled()
  })

  it('refuses apply without both owner metadata fields before reading the database', async () => {
    const fixture = fakeDb([row({ id: 'eligible' })])
    for (const args of [['--apply'], ['--apply', '--actor', 'Owner'], ['--apply', '--reason', 'review']]) {
      await expect(main(args, { db: fixture.db, log: vi.fn(), now: NOW })).rejects.toThrow(/GENESISRAG17_OUTBOX_REDACT_USAGE/)
    }
    expect(fixture.findMany).not.toHaveBeenCalled()
    expect(fixture.db.$transaction).not.toHaveBeenCalled()
  })

  it('fails closed when a page read fails', async () => {
    const db = { genesisRag17Batch: { findMany: vi.fn(async () => { throw new Error('private database error') }) } }

    await expect(main([], { db, log: vi.fn(), now: NOW })).rejects.toThrow('GENESISRAG17_OUTBOX_REDACT_READ_FAILED')
  })

  it('redacts only old terminal rows and keeps delivery state and replies unchanged', async () => {
    const fixture = fakeDb([
      row({ id: 'eligible', batchId: 'eligible' }),
      row({ id: 'young-terminal', batchId: 'young-terminal', updatedDaysAgo: 29 }),
      row({ id: 'young-pending', batchId: 'young-pending', status: 'PENDING', createdDaysAgo: 89, updatedDaysAgo: 89 }),
      row({ id: 'old-pending', batchId: 'old-pending', status: 'PENDING', createdDaysAgo: 91, updatedDaysAgo: 91 }),
      row({ id: 'unreadable', batchId: 'unreadable', request: 'not-json' }),
    ])
    const before = new Map(fixture.rows.map((value) => [value.id, { ...value }]))
    const log = vi.fn()

    const result = await main(['--apply', '--actor', 'Owner One', '--reason', 'Retention review', '--json'], {
      db: fixture.db,
      log,
      now: NOW,
    })

    expect(result.mode).toBe('apply')
    expect(result.actor).toBe('Owner One')
    expect(result.reason).toBe('Retention review')
    expect(result.summary).toMatchObject({ mode: 'apply', eligible: 1, redacted: 1, skippedPendingOverBound: 1, skippedUnreadable: 1, conflicts: 0 })
    const updated = fixture.rows.find((value) => value.id === 'eligible')
    const redaction = parseRedactionMarker(updated.requestJson)
    expect(redaction).toMatchObject({ redacted: true, marker: { redactedBy: 'Owner One', reason: 'Retention review', redactedAt: NOW.toISOString() } })
    expect(result.rows[0].originalSha256).toBe(redaction.marker.originalSha256)
    expect(updated.status).toBe(before.get('eligible').status)
    expect(updated.decisionId).toBe(before.get('eligible').decisionId)
    expect(updated.responseJson).toBe(before.get('eligible').responseJson)
    for (const id of ['young-terminal', 'young-pending', 'old-pending', 'unreadable']) {
      expect(fixture.rows.find((value) => value.id === id).requestJson).toBe(before.get(id).requestJson)
    }
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(1)
    expect(fixture.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'eligible',
        requestJson: before.get('eligible').requestJson,
        status: before.get('eligible').status,
        updatedAt: before.get('eligible').updatedAt,
      },
      data: { requestJson: expect.any(String) },
    }))
    expect(Object.keys(fixture.updateMany.mock.calls[0][0].data)).toEqual(['requestJson'])
    expect(fixture.delete).not.toHaveBeenCalled()
    expect(fixture.deleteMany).not.toHaveBeenCalled()
  })

  it('is idempotent after an apply and filters by named batch ids', async () => {
    const fixture = fakeDb([
      row({ id: 'named', batchId: 'named' }),
      row({ id: 'other', batchId: 'other' }),
    ])
    const args = ['--apply', '--actor', 'Owner One', '--reason', 'Retention review', '--batch-id', 'named']
    const first = await main(args, { db: fixture.db, log: vi.fn(), now: NOW })
    const second = await main(args, { db: fixture.db, log: vi.fn(), now: NOW })

    expect(first.summary).toMatchObject({ rowsScanned: 1, redacted: 1 })
    expect(second.summary).toMatchObject({ rowsScanned: 1, eligible: 0, redacted: 0, alreadyRedacted: 1 })
    expect(fixture.rows.find((value) => value.id === 'other').requestJson).toBe(requestJson())
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('commits one transaction per page and caps each transaction at 200 rows', async () => {
    const fixture = fakeDb(Array.from({ length: 205 }, (_, index) => row({
      id: `row-${String(index).padStart(3, '0')}`,
      batchId: `batch-${index}`,
    })))

    const result = await main(['--apply', '--actor', 'Owner One', '--reason', 'Retention review'], {
      db: fixture.db,
      log: vi.fn(),
      now: NOW,
    })

    expect(result.summary).toMatchObject({ rowsScanned: 205, eligible: 205, redacted: 205 })
    expect(fixture.db.$transaction).toHaveBeenCalledTimes(2)
    expect(fixture.findMany.mock.calls.map(([query]) => query.take)).toEqual([200, 200])
    expect(fixture.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'row-199' }, skip: 1 })
  })

  it('counts optimistic conflicts, prints a safe summary, and fails the apply run', async () => {
    const fixture = fakeDb([row({ id: 'race' })], { conflictIds: ['race'] })
    const log = vi.fn()

    await expect(main(['--apply', '--actor', 'Owner One', '--reason', 'Retention review', '--json'], {
      db: fixture.db,
      log,
      now: NOW,
    })).rejects.toMatchObject({ code: 'GENESISRAG17_OUTBOX_REDACT_CONFLICTS' })
    expect(parseOutput(log)).toMatchObject({ mode: 'apply', summary: { eligible: 1, redacted: 0, conflicts: 1, conflictBatchIds: ['race'] } })
    expect(fixture.rows[0].requestJson).toBe(requestJson())
  })

  it('keeps actor and reason metadata in human output while never printing request or reply text', async () => {
    const fixture = fakeDb([
      row({ id: 'eligible' }),
      row({ id: 'old-pending', status: 'PENDING', createdDaysAgo: 91, updatedDaysAgo: 91 }),
    ])
    const log = vi.fn()
    const result = await main(['--actor', 'Owner One', '--reason', 'Retention review'], { db: fixture.db, log, now: NOW })
    const output = `${JSON.stringify(result)}${log.mock.calls[0][0]}`

    expect(output).toContain('Owner One')
    expect(output).toContain('Retention review')
    expect(output).toContain('eligible')
    expect(log.mock.calls[0][0]).toContain('old-pending')
    for (const secret of ['SOURCE_SECRET_MARKER', 'CHUNK_SECRET_MARKER', 'MENTION_SECRET_MARKER', 'RESPONSE_SECRET_MARKER']) {
      expect(output).not.toContain(secret)
    }
  })
})
