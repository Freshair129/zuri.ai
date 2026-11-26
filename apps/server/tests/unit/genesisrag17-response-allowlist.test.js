import { describe, expect, it } from 'vitest'
import { GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS, contractResponseJson } from '@/modules/knowledge/genesisrag17-response-contract'
import { assertGenesisRag17Publication } from '@/platform/integrations/core/genesisrag17-publication'

// @req FR-109 — persisted Stage 9 replies contain only the contract fields, while publication reads the decision column.
// @spec ADR-121
// @tested tests/unit/genesisrag17-response-allowlist.test.js

const scope = {
  portfolioId: 'portfolio-1',
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  visibility: 'private',
}

describe('GenesisRAG17 response contract allowlist', () => {
  it('copies only the five contract fields in contract order and normalizes decisionId', () => {
    const reply = {
      schemaVersion: 'genesisrag17.v1',
      scope,
      batchId: 'batch-1',
      status: 'ACKNOWLEDGED',
      decisionId: 'decision-1',
      entities: [{ internal: 'EXTRA_RESPONSE_VALUE' }],
      facts: ['EXTRA_FACT_VALUE'],
      heldRows: ['EXTRA_HELD_ROW_VALUE'],
      internal: 'EXTRA_INTERNAL_VALUE',
    }

    const filtered = contractResponseJson(reply, reply.decisionId)

    expect(Object.isFrozen(GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS)).toBe(true)
    expect(Object.keys(filtered)).toEqual([
      'schemaVersion',
      'scope',
      'batchId',
      'status',
      'decisionId',
    ])
    expect(Object.keys(filtered)).toEqual(GENESIS_RAG17_RESPONSE_CONTRACT_FIELDS)
    expect(filtered).toEqual({
      schemaVersion: 'genesisrag17.v1',
      scope,
      batchId: 'batch-1',
      status: 'ACKNOWLEDGED',
      decisionId: 'decision-1',
    })
  })

  it('normalizes empty or non-string decision ids to null', () => {
    const reply = { schemaVersion: 'genesisrag17.v1', scope, batchId: 'batch-1', status: 'PENDING' }
    expect(contractResponseJson({ ...reply, decisionId: '' }, '')).toMatchObject({ decisionId: null })
    expect(contractResponseJson({ ...reply, decisionId: 7 }, 7)).toMatchObject({ decisionId: null })
    expect(contractResponseJson({ ...reply, decisionId: null }, null)).toMatchObject({ decisionId: null })
  })

  it('allows publication finish to pass the decision check when responseJson omits decisionId but the column has it', async () => {
    const db = {
      pipelineRun: {
        findUnique: async () => ({ id: 'run-row-1', tenantId: scope.tenantId, businessId: scope.businessId }),
      },
      business: {
        findUnique: async () => ({ tenantId: scope.tenantId, status: 'ACTIVE', tenant: { portfolioId: scope.portfolioId } }),
      },
      genesisRag17Batch: {
        findFirst: async () => ({
          requestJson: JSON.stringify({ scope }),
          responseJson: JSON.stringify({ schemaVersion: 'genesisrag17.v1', scope, batchId: 'batch-1', status: 'ACKNOWLEDGED' }),
          decisionId: 'decision-from-column',
        }),
      },
      pipelineStep: { findMany: async () => [] },
      genesisRag17StageEvidence: { findMany: async () => [] },
    }

    await expect(assertGenesisRag17Publication({
      schemaVersion: 'genesisrag17.v1',
      executionRunId: 'run-1',
      scope,
    }, { db })).rejects.toThrow('GenesisRAG17 finish requires matching terminal evidence and publication receipt')
  })
})
