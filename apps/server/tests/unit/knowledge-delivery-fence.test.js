import { describe, expect, it, vi } from 'vitest'
import { citationReference, lockKnowledgeCitationSourcesForDelivery } from '@/modules/knowledge/knowledge-corpus-service'

// @req FR-173, FR-235 — delayed delivery holds source withdrawal ordering through its transaction.
// @spec ADR-072, SEC-001
// @tested tests/unit/knowledge-delivery-fence.test.js
const citation = (sourceId, corpusId = 'corpus') => citationReference({ corpusId, sourceId, corpusGeneration: 1, ingestionId: 'ingestion', chunkId: 'chunk' })
const scope = { tenantId: 'tenant', businessId: 'business' }
const rows = [{ id: 'a', corpusId: 'corpus' }, { id: 'z', corpusId: 'corpus' }]

describe('Knowledge delivery source fence', () => {
  it('locks unique sources in deterministic order with parameterized PostgreSQL scope', async () => {
    const query = vi.fn(async () => rows)
    const db = { _engineConfig: { activeProvider: 'postgresql' }, $queryRawUnsafe: query }
    await lockKnowledgeCitationSourcesForDelivery([citation('z'), citation('a'), citation('z')], { db, ...scope })
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, ...params] = query.mock.calls[0]
    expect(sql).toContain('ORDER BY s."id" FOR SHARE OF s')
    expect(sql).toContain('s."revokedAt" IS NULL')
    expect(sql).toContain('c."tenantId" = $1')
    expect(sql).not.toContain('tenant\'')
    expect(params).toEqual(['tenant', 'business', 'a', 'corpus', 'z', 'corpus'])
  })

  it('fails closed for missing, revoked or out-of-scope source rows', async () => {
    const db = { _engineConfig: { activeProvider: 'postgresql' }, $queryRawUnsafe: vi.fn(async () => []) }
    await expect(lockKnowledgeCitationSourcesForDelivery([citation('a')], { db, ...scope })).rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_SOURCE_REVOKED' })
  })

  it('uses scoped source reads under the existing SQLite write transaction', async () => {
    const findMany = vi.fn(async () => rows)
    const db = { _engineConfig: { activeProvider: 'sqlite' }, knowledgeSource: { findMany } }
    await lockKnowledgeCitationSourcesForDelivery([citation('z'), citation('a')], { db, ...scope })
    expect(findMany).toHaveBeenCalledWith({ where: {
      OR: rows.map(({ id, corpusId }) => ({ id, corpusId })), revokedAt: null, deletedAt: null,
      corpus: { tenantId: 'tenant', businessId: 'business', deletedAt: null, status: 'ACTIVE' },
    }, select: { id: true, corpusId: true }, orderBy: { id: 'asc' } })
  })

  it.each([
    { _engineConfig: { activeProvider: 'postgresql' }, $transaction: vi.fn(), $queryRawUnsafe: vi.fn() },
    { _engineConfig: { activeProvider: 'unknown' }, $queryRawUnsafe: vi.fn() },
    { _engineConfig: { activeProvider: 'postgresql' } },
  ])('refuses an unscoped client or unsupported locking adapter', async (db) => {
    await expect(lockKnowledgeCitationSourcesForDelivery([citation('a')], { db, ...scope })).rejects.toMatchObject({ status: 503, code: 'KNOWLEDGE_DELIVERY_FENCE_UNAVAILABLE' })
  })

  it('rejects malformed references before any database access', async () => {
    const query = vi.fn()
    const db = { _engineConfig: { activeProvider: 'postgresql' }, $queryRawUnsafe: query }
    await expect(lockKnowledgeCitationSourcesForDelivery(['bad'], { db, ...scope })).rejects.toMatchObject({ status: 400 })
    expect(query).not.toHaveBeenCalled()
  })
})
