import { beforeEach, describe, expect, it, vi } from 'vitest'

const fenceMocks = vi.hoisted(() => ({
  readExecutionTrace: vi.fn(),
  resolveKnowledgeCitation: vi.fn(),
  lockKnowledgeCitationSourcesForDelivery: vi.fn(),
}))

vi.mock('@/modules/agent/execution-trace', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, readExecutionTrace: (...args) => fenceMocks.readExecutionTrace(...args) }
})

vi.mock('@/modules/knowledge/knowledge-corpus-service', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveKnowledgeCitation: (...args) => fenceMocks.resolveKnowledgeCitation(...args),
    lockKnowledgeCitationSourcesForDelivery: (...args) => fenceMocks.lockKnowledgeCitationSourcesForDelivery(...args),
  }
})

import { lineGksCitationsStillCurrent } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-235 — revalidate the exact GKS citation evidence before delayed LINE delivery.
// @spec ADR-072 D10, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/line-gks-citation-fence.test.js

const generationId = 'g17-6ac35d02bb97900d'
const baseRef = () => ({
  citationId: 'kc1.citation',
  sourceId: '638f6130-e699-46c8-9',
  snapshotId: 'snap-82596dc688641e5',
  generation: generationId,
  corpusGeneration: 1,
  manifestHash: 'a'.repeat(64),
})
const currentCitation = (overrides = {}) => ({
  citationId: 'kc1.citation',
  sourceId: '638f6130-e699-46c8-9',
  snapshotId: 'snap-82596dc688641e5',
  generation: generationId,
  corpusGeneration: 1,
  ...overrides,
})
const job = { id: 'turn-1', tenantId: 'tenant-1', businessId: 'business-1', executionId: 'execution-1',
  account: { knowledgeGrounding: 'GKS_CORPUS' } }

function traceEvents(ref) {
  return [
    { kind: 'EVIDENCE_SELECTED', payload: { source: 'GKS_CORPUS', mode: 'GKS_CORPUS', retrievalRefs: [ref] } },
    { kind: 'CONTEXT_RECEIPT', executionId: job.executionId, payload: { refs: { citations: [ref.citationId] } } },
  ]
}

async function check(ref = baseRef(), current = currentCitation()) {
  fenceMocks.readExecutionTrace.mockResolvedValue(traceEvents(ref))
  fenceMocks.resolveKnowledgeCitation.mockResolvedValue(current)
  return lineGksCitationsStillCurrent({}, job, {})
}

describe('lineGksCitationsStillCurrent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fenceMocks.lockKnowledgeCitationSourcesForDelivery.mockResolvedValue(undefined)
  })

  it('accepts a current citation with the GenesisRAG17 string generation id', async () => {
    await expect(check()).resolves.toBe(true)
    expect(fenceMocks.resolveKnowledgeCitation).toHaveBeenCalledOnce()
  })

  it('refuses a citation when the resolver reports a changed generation', async () => {
    await expect(check(baseRef(), currentCitation({ generation: 'g17-superseded-generation' }))).resolves.toBe(false)
    expect(fenceMocks.resolveKnowledgeCitation).toHaveBeenCalledOnce()
  })

  it('refuses a citation when the resolver reports a changed snapshot id', async () => {
    await expect(check(baseRef(), currentCitation({ snapshotId: 'snap-replaced' }))).resolves.toBe(false)
    expect(fenceMocks.resolveKnowledgeCitation).toHaveBeenCalledOnce()
  })

  it('refuses a malformed manifest hash before resolving the citation', async () => {
    await expect(check({ ...baseRef(), manifestHash: 'bad-hash' })).resolves.toBe(false)
    expect(fenceMocks.resolveKnowledgeCitation).not.toHaveBeenCalled()
  })

  it.each(['citationId', 'sourceId', 'snapshotId', 'generation', 'corpusGeneration', 'manifestHash'])(
    'refuses a retrieval ref missing %s', async field => {
      const ref = baseRef()
      delete ref[field]
      await expect(check(ref)).resolves.toBe(false)
      expect(fenceMocks.resolveKnowledgeCitation).not.toHaveBeenCalled()
    },
  )

  it('refuses an integer generation because the wire contract requires a string id', async () => {
    await expect(check({ ...baseRef(), generation: 17 })).resolves.toBe(false)
    expect(fenceMocks.resolveKnowledgeCitation).not.toHaveBeenCalled()
  })
})
