import { describe, expect, it, vi } from 'vitest'
import { createProjectManagerMcpTransport } from '@/modules/project-manager/mcp/transport'

const viewer = { isOperator: true, principalId: 'principal-pipeline-mcp', visibleBusinessIds: ['business-smartgift'] }

const runInput = {
  businessCode: 'smartgift',
  dataPipelineDefinitionId: 'DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1',
  executionContractId: 'EXC-DATA-MIGRATION-V1',
  correlationId: 'corr-pipeline-mcp',
  idempotencyKey: 'run-pipeline-mcp',
  identityRefs: {},
  tagIds: [],
}

const contract = {
  contractVersion: 'smartgift.document-intake.v1',
  document: { documentId: 'doc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', artifactSha256: 'a'.repeat(64) },
  domain: 'product',
}

function makeTransport() {
  const pipeline = {
    createPipelineRunFromWorker: vi.fn(async (input, options) => ({ status: 'CREATED', input, principalId: options.viewer.principalId })),
    stageDocumentIntakeForPipeline: vi.fn(async (input, options) => ({ status: 'STAGED', input, principalId: options.viewer.principalId })),
    recordPipelineEvent: vi.fn(async (input, options) => ({ status: 'CREATED', input, principalId: options.viewer.principalId })),
    getPipelineMonitor: vi.fn(async (executionRunId, options) => ({ executionRunId, status: 'RUNNING', principalId: options.viewer.principalId })),
    requestPipelineReplay: vi.fn(async (executionRunId, replay, options) => ({ status: 'CREATED', executionRunId, replay, principalId: options.viewer.principalId })),
  }
  return { transport: createProjectManagerMcpTransport({ pipeline }), pipeline }
}

async function initialized(transport) {
  const initialized = await transport.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'codex', version: '1.0.0' } },
  }, { viewer })
  const sessionId = initialized.sessionId
  await transport.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { viewer, sessionId })
  return sessionId
}

describe('Codex data_pipeline MCP bridge', () => {
  it('lists a separate data_pipeline namespace with the five approved tools', async () => {
    const { transport } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { viewer, sessionId })
    expect(response.body.result.tools.map((tool) => tool.name)).toEqual([
      'project_manager.plan_dry_run',
      'project_manager.plan_commit',
      'project_manager.work_read',
      'project_manager.work_status_update',
      'data_pipeline.run_create',
      'data_pipeline.document_stage',
      'data_pipeline.event_record',
      'data_pipeline.monitor_read',
      'data_pipeline.replay_request',
    ])
  })

  it('routes run creation and document staging without accepting caller scope fields', async () => {
    const { transport, pipeline } = makeTransport()
    const sessionId = await initialized(transport)
    const created = await transport.handle({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'data_pipeline.run_create', arguments: runInput },
    }, { viewer, sessionId })
    expect(created.body.result.structuredContent.input).toEqual(runInput)
    expect(pipeline.createPipelineRunFromWorker).toHaveBeenCalledWith(runInput, { viewer })

    const staged = await transport.handle({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {
        name: 'data_pipeline.document_stage',
        arguments: { executionRunId: 'execution-run-mcp', contract },
      },
    }, { viewer, sessionId })
    expect(staged.body.result.structuredContent.input.executionRunId).toBe('execution-run-mcp')
    expect(pipeline.stageDocumentIntakeForPipeline).toHaveBeenCalledWith(
      { executionRunId: 'execution-run-mcp', contract },
      { viewer },
    )

    const scopeOverride = await transport.handle({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'data_pipeline.run_create', arguments: { ...runInput, tenantId: 'attacker-tenant' } },
    }, { viewer, sessionId })
    expect(scopeOverride.body.error.code).toBe(-32602)
  })

  it('routes events, monitor reads and replay requests through the same service boundary', async () => {
    const { transport, pipeline } = makeTransport()
    const sessionId = await initialized(transport)
    const event = { eventType: 'STEP_HEARTBEAT', executionRunId: 'execution-run-mcp' }
    await transport.handle({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'data_pipeline.event_record', arguments: event },
    }, { viewer, sessionId })
    await transport.handle({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'data_pipeline.monitor_read', arguments: { executionRunId: event.executionRunId } },
    }, { viewer, sessionId })
    const replay = { scope: 'FULL_RUN', correlationId: 'corr-replay', idempotencyKey: 'replay-key' }
    await transport.handle({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'data_pipeline.replay_request', arguments: { executionRunId: event.executionRunId, replay } },
    }, { viewer, sessionId })
    expect(pipeline.recordPipelineEvent).toHaveBeenCalledWith(event, { viewer })
    expect(pipeline.getPipelineMonitor).toHaveBeenCalledWith(event.executionRunId, { viewer })
    expect(pipeline.requestPipelineReplay).toHaveBeenCalledWith(event.executionRunId, replay, { viewer })
  })

  it('rejects executable or raw-payload-shaped event arguments before service execution', async () => {
    const { transport, pipeline } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({
      jsonrpc: '2.0', id: 9, method: 'tools/call',
      params: {
        name: 'data_pipeline.event_record',
        arguments: { eventType: 'STEP_HEARTBEAT', executionRunId: 'execution-run-mcp', rawPayload: { customerName: 'ไม่ควรเข้า event' } },
      },
    }, { viewer, sessionId })
    expect(response.body.error.code).toBe(-32602)
    expect(pipeline.recordPipelineEvent).not.toHaveBeenCalled()
  })
})
