import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { buildRedactedRequestJson } from '@/modules/knowledge/genesisrag17-outbox-redaction'
import { persistBatch } from '@/platform/integrations/core/genesisrag17-executor'

// @req FR-109 — redacted outbox retries match only the original request and attempt.
// @spec ADR-121 D3-D6, F4
// @tested tests/unit/genesisrag17-persist-redacted.test.js

function fixture(content = 'original source text') {
  const suffix = randomUUID()
  const batch = {
    schemaVersion: 'genesisrag17.v1',
    batchId: `batch-${suffix}`,
    idempotencyKey: `key-${suffix}`,
    scope: { tenantId: 'tenant-1' },
    source: { sourceId: 'source-1', content, contentHash: 'a'.repeat(64) },
    chunks: [{ chunkId: 'chunk-1', text: content, startOffset: 0, endOffset: content.length }],
    mentions: [{ sourceMentionId: 'mention-1', name: 'Alice' }],
  }
  const run = { id: `run-row-${suffix}`, executionRunId: `run-${suffix}` }
  const stage9 = { executionStepId: `step-${suffix}`, attemptId: `attempt-${suffix}` }
  return { suffix, batch, run, stage9 }
}

async function createRedactedRow({ suffix, batch, run, stage9, marker = true }) {
  const requestJson = JSON.stringify(batch)
  const storedRequest = marker
    ? buildRedactedRequestJson(requestJson, { actor: 'Owner One', reason: 'Retention review', redactedAt: '2026-11-27T03:04:05.000Z' })
    : JSON.stringify({ ...batch, redaction: { redacted: true } })
  return prisma.genesisRag17Batch.create({
    data: {
      id: `row-${suffix}`,
      batchId: batch.batchId,
      idempotencyKey: batch.idempotencyKey,
      runId: run.id,
      executionRunId: run.executionRunId,
      stage9StepId: stage9.executionStepId,
      stage9AttemptId: stage9.attemptId,
      scopeJson: JSON.stringify(batch.scope),
      requestJson: storedRequest,
      status: 'ACKNOWLEDGED',
      decisionId: 'decision-1',
      responseJson: JSON.stringify({ schemaVersion: 'genesisrag17.v1', scope: batch.scope, batchId: batch.batchId, status: 'ACKNOWLEDGED', decisionId: 'decision-1' }),
    },
  })
}

describe('GenesisRAG17 persistBatch with a redacted row', () => {
  it('returns the redacted row for the same original request without creating a duplicate', async () => {
    const value = fixture()
    const stored = await createRedactedRow(value)

    const result = await persistBatch(prisma, { ...value, now: new Date('2026-11-27T03:04:05.000Z') })

    expect(result.id).toBe(stored.id)
    expect(result.requestJson).toBe(stored.requestJson)
    expect(await prisma.genesisRag17Batch.count({ where: { idempotencyKey: value.batch.idempotencyKey } })).toBe(1)
  })

  it('keeps a 409 for different input under the same key and attempt', async () => {
    const value = fixture()
    await createRedactedRow(value)
    const differentBatch = {
      ...value.batch,
      source: { ...value.batch.source, content: 'different source text' },
      chunks: [{ ...value.batch.chunks[0], text: 'different source text', endOffset: 20 }],
    }

    await expect(persistBatch(prisma, { ...value, batch: differentBatch })).rejects.toMatchObject({ status: 409 })
    expect(await prisma.genesisRag17Batch.count({ where: { idempotencyKey: value.batch.idempotencyKey } })).toBe(1)
  })

  it('requires the original batch id and Stage 9 attempt even when the marker hash matches', async () => {
    for (const mismatch of ['batchId', 'stage9AttemptId']) {
      const value = fixture()
      const stored = await createRedactedRow(value)
      await prisma.genesisRag17Batch.update({
        where: { id: stored.id },
        data: mismatch === 'batchId' ? { batchId: `different-${value.suffix}` } : { stage9AttemptId: `different-${value.suffix}` },
      })

      await expect(persistBatch(prisma, value)).rejects.toMatchObject({ status: 409 })
      expect(await prisma.genesisRag17Batch.count({ where: { idempotencyKey: value.batch.idempotencyKey } })).toBe(1)
    }
  })

  it('keeps a 409 when the marker is malformed', async () => {
    const value = fixture()
    await createRedactedRow({ ...value, marker: false })

    await expect(persistBatch(prisma, value)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.genesisRag17Batch.count({ where: { idempotencyKey: value.batch.idempotencyKey } })).toBe(1)
  })
})
