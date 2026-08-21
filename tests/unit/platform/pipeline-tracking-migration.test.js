import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-071 — the pipeline ledger remains private, server-owned and forced-RLS.
// @spec ADR-030 D5, SEC-003, SEC-008
// @tested tests/unit/platform/pipeline-tracking-migration.test.js

const sql = readFileSync('supabase/migrations/20260820221703_smartgift_pipeline_tracking.sql', 'utf8')

describe('FR-071 full pipeline tracking migration', () => {
  it('creates the complete server-owned ledger and useful scope/idempotency indexes', () => {
    for (const table of [
      'pipeline_run',
      'pipeline_step',
      'pipeline_event_receipt',
      'pipeline_record_event',
      'pipeline_reconciliation',
      'pipeline_gate_decision',
    ]) expect(sql).toMatch(new RegExp(`create table if not exists "${table === 'pipeline_run' ? 'PipelineRun' : table === 'pipeline_step' ? 'PipelineStep' : table === 'pipeline_event_receipt' ? 'PipelineEventReceipt' : table === 'pipeline_record_event' ? 'PipelineRecordEvent' : table === 'pipeline_reconciliation' ? 'PipelineReconciliation' : 'PipelineGateDecision'}"`, 'i'))
    expect(sql).toMatch(/executionRunId.*unique/i)
    expect(sql).toMatch(/idempotencyKey.*unique/i)
    expect(sql).toMatch(/"tenantId" text[\s\S]*"businessId" text/i)
  })

  it('forces RLS and does not expose monitor tables through browser/Data API roles', () => {
    expect(sql).toMatch(/enable row level security/i)
    expect(sql).toMatch(/force row level security/i)
    expect(sql).toMatch(/revoke all on table[\s\S]*from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*\b(?:anon|authenticated|service_role)\b/i)
    expect(sql).not.toMatch(/service_role_key|database_url|raw_payload|ocr_text|image_bytes/i)
  })
})
