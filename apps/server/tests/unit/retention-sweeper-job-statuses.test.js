import { describe, expect, it } from 'vitest'
import { LINE_CONVERSATION_JOB_NON_TERMINAL_STATUSES as crmStatuses } from '@/modules/crm/retention-sweep-service'
import { RAW_LINE_NON_TERMINAL_JOB_STATUSES as integrationStatuses } from '@/platform/integrations/core/raw-line-retention-sweep-service'
import { AGENT_TRACE_NON_TERMINAL_JOB_STATUSES as agentStatuses } from '@/modules/agent/trace-retention-sweep-service'

// @req FR-230 — all owning-domain sweepers must preserve the same live-job fence.
// @spec ADR-091 D2
// @tested tests/unit/retention-sweeper-job-statuses.test.js
describe('retention sweeper live-job status fences', () => {
  it('keeps the local non-terminal status lists equal across all three sweepers', () => {
    expect(integrationStatuses).toEqual(crmStatuses)
    expect(agentStatuses).toEqual(crmStatuses)
  })
})
