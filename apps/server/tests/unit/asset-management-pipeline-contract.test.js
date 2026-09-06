// @req FR-134 — Asset intake has a distinct definition on the shared ledger.
// @spec SDD-079, ADR-030, ADR-055
// @tested tests/unit/asset-management-pipeline-contract.test.js
import { describe, expect, it } from 'vitest'
import * as pipeline from '@/platform/integrations/core/pipeline-tracking-contract'

describe('Asset intake pipeline identity', () => {
  it('does not alias the knowledge or business-knowledge definitions', () => {
    expect(pipeline.ASSET_REGISTER_IMPORT_DEFINITION_ID).toBe('DPL-ASSET-REGISTER-IMPORT-V1')
    expect(pipeline.ASSET_REGISTER_IMPORT_CONTRACT_ID).toBe('EXC-ASSET-REGISTER-IMPORT-V1')
    expect(pipeline.ASSET_REGISTER_IMPORT_DEFINITION_ID).not.toBe(pipeline.KNOWLEDGE_INGESTION_DEFINITION_ID)
    expect(pipeline.ASSET_REGISTER_IMPORT_DEFINITION_ID).not.toBe(pipeline.DATA_PIPELINE_DEFINITION_ID)
  })

  it('uses stable stages from intake through guarded apply', () => {
    expect(pipeline.ASSET_REGISTER_IMPORT_STAGE_CATALOG?.map((stage) => stage.pipelineStageId)).toEqual([
      'DPS-AM-INTAKE',
      'DPS-AM-EVIDENCE-GUARD',
      'DPS-AM-EXTRACT-CANDIDATES',
      'DPS-AM-NORMALIZE',
      'DPS-AM-SCOPE-REFERENCE-VALIDATE',
      'DPS-AM-RECONCILE',
      'DPS-AM-HUMAN-CONFIRM',
      'DPS-AM-APPROVAL',
      'DPS-AM-APPLY',
    ])
  })
})
