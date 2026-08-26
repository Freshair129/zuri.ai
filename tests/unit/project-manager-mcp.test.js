import { describe, expect, it, vi } from 'vitest'
import { createProjectManagerMcpTransport } from '@/modules/project-manager/mcp/transport'

const viewer = { principalId: 'principal-mcp-test', visibleBusinessIds: ['business-mcp-test'], ownedBusinessIds: ['business-mcp-test'] }
const plan = {
  schemaVersion: '1.0', generatedBy: 'test-agent', scope: { workspaceCode: 'WS-MCP-TEST' },
  project: { code: 'PRJ-MCP-TEST', name: 'MCP test project' }, workstreams: [],
}

function makeTransport() {
  const dryRunPlan = vi.fn(async (rawPlan, options) => ({
    valid: true, errors: [], workspace: { id: options.workspaceId || 'workspace-mcp-test' },
    preview: { summary: { insertCount: 1, updateCount: 0, conflictCount: 0 } }, plan: rawPlan,
  }))
  const commitPlan = vi.fn(async (rawPlan, options) => ({
    committed: true, projectId: 'project-mcp-test', plan: rawPlan, principalId: options.viewer.principalId,
  }))
  const readWork = vi.fn(async (args, options) => ({
    items: [{ id: 'work-item-mcp-test', code: 'WI-MCP-TEST', status: 'PLANNED' }],
    limit: 500,
    truncated: false,
    principalId: options.viewer.principalId,
    scope: args.projectId || args.workstreamId,
  }))
  const updateWorkStatus = vi.fn(async (workItemId, status, options) => ({
    id: workItemId,
    status,
    principalId: options.viewer.principalId,
  }))
  return {
    transport: createProjectManagerMcpTransport({
      dryRunPlan,
      commitPlan,
      work: { readWork, updateWorkStatus },
    }),
    dryRunPlan,
    commitPlan,
    readWork,
    updateWorkStatus,
  }
}

async function initialize(transport) {
  const response = await transport.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-client', version: '1.0.0' } },
  }, { viewer })
  expect(response.body.result.protocolVersion).toBe('2024-11-05')
  return response.sessionId
}

async function initialized(transport) {
  const sessionId = await initialize(transport)
  await transport.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { viewer, sessionId })
  return sessionId
}

describe('Project Manager MCP transport', () => {
  it('initialize and notifications/initialized establish a session', async () => {
    const { transport } = makeTransport()
    const sessionId = await initialize(transport)
    const notification = await transport.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, { viewer, sessionId })
    expect(notification.body).toBeNull()
    expect(notification.status).toBe(204)
  })

  it('tools/list exposes the PlanEnvelope and approved data-pipeline capabilities', async () => {
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

  it('tools/call success delegates the same viewer and PlanEnvelope to the intake service', async () => {
    const { transport, dryRunPlan } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'project_manager.plan_dry_run', arguments: { plan, workspaceId: 'workspace-mcp-test' } },
    }, { viewer, sessionId })
    expect(response.body.result.isError).toBe(false)
    expect(response.body.result.structuredContent.valid).toBe(true)
    expect(dryRunPlan).toHaveBeenCalledWith(plan, { workspaceId: 'workspace-mcp-test', viewer })
  })

  it('reads scoped work through the authenticated viewer boundary', async () => {
    const { transport, readWork } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({
      jsonrpc: '2.0', id: 11, method: 'tools/call',
      params: {
        name: 'project_manager.work_read',
        arguments: { projectId: 'project-mcp-test', status: 'IN_PROGRESS', q: 'migration' },
      },
    }, { viewer, sessionId })
    expect(response.body.result.isError).toBe(false)
    expect(response.body.result.structuredContent.scope).toBe('project-mcp-test')
    expect(readWork).toHaveBeenCalledWith(
      { projectId: 'project-mcp-test', status: 'IN_PROGRESS', q: 'migration' },
      { viewer },
    )
  })

  it('updates only the work item status through the existing mutation boundary', async () => {
    const { transport, updateWorkStatus } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({
      jsonrpc: '2.0', id: 12, method: 'tools/call',
      params: {
        name: 'project_manager.work_status_update',
        arguments: { workItemId: 'work-item-mcp-test', status: 'IN_PROGRESS' },
      },
    }, { viewer, sessionId })
    expect(response.body.result.isError).toBe(false)
    expect(response.body.result.structuredContent).toMatchObject({
      id: 'work-item-mcp-test',
      status: 'IN_PROGRESS',
      principalId: viewer.principalId,
    })
    expect(updateWorkStatus).toHaveBeenCalledWith('work-item-mcp-test', 'IN_PROGRESS', { viewer })
  })

  it('rejects unscoped work reads and invalid status updates before service execution', async () => {
    const { transport, readWork, updateWorkStatus } = makeTransport()
    const sessionId = await initialized(transport)
    const unscoped = await transport.handle({
      jsonrpc: '2.0', id: 13, method: 'tools/call',
      params: { name: 'project_manager.work_read', arguments: { status: 'PLANNED' } },
    }, { viewer, sessionId })
    expect(unscoped.body.error.code).toBe(-32602)
    expect(readWork).not.toHaveBeenCalled()

    const invalidStatus = await transport.handle({
      jsonrpc: '2.0', id: 14, method: 'tools/call',
      params: { name: 'project_manager.work_status_update', arguments: { workItemId: 'work-item-mcp-test', status: 'COMPLETE' } },
    }, { viewer, sessionId })
    expect(invalidStatus.body.error.code).toBe(-32602)
    expect(updateWorkStatus).not.toHaveBeenCalled()
  })

  it('tools/call rejects unknown tools and arbitrary executable/import payloads', async () => {
    const { transport } = makeTransport()
    const sessionId = await initialized(transport)
    const unknown = await transport.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'project_manager.execute_code', arguments: { code: 'return 1' } } }, { viewer, sessionId })
    expect(unknown.body.error.code).toBe(-32602)
    const executable = await transport.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'project_manager.plan_dry_run', arguments: { plan, import: 'node:fs' } } }, { viewer, sessionId })
    expect(executable.body.error.code).toBe(-32602)
  })

  it('tools/call returns an unauthorized protocol error without a trusted viewer', async () => {
    const { transport, dryRunPlan } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'project_manager.plan_commit', arguments: { plan } } }, { sessionId })
    expect(response.body.error.code).toBe(-32001)
    expect(dryRunPlan).not.toHaveBeenCalled()
  })

  it('returns protocol errors for malformed requests and invalid lifecycle order', async () => {
    const { transport } = makeTransport()
    const beforeInitialize = await transport.handle({ jsonrpc: '2.0', id: 7, method: 'tools/list', params: {} }, { viewer, sessionId: 'missing-session' })
    expect(beforeInitialize.body.error.code).toBe(-32002)
    const malformed = await transport.handle({ jsonrpc: '1.0', id: 8, method: 'tools/list' }, { viewer })
    expect(malformed.body.error.code).toBe(-32600)
    const sessionId = await initialized(transport)
    const invalidParams = await transport.handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'project_manager.plan_dry_run', arguments: { plan, command: 'rm -rf' } } }, { viewer, sessionId })
    expect(invalidParams.body.error.code).toBe(-32602)
    const method = await transport.handle({ jsonrpc: '2.0', id: 10, method: 'tools/nope' }, { viewer, sessionId })
    expect(method.body.error.code).toBe(-32601)
  })
})
