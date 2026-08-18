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
  return { transport: createProjectManagerMcpTransport({ dryRunPlan, commitPlan }), dryRunPlan, commitPlan }
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

  it('tools/list exposes only implemented PlanEnvelope capabilities', async () => {
    const { transport } = makeTransport()
    const sessionId = await initialized(transport)
    const response = await transport.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, { viewer, sessionId })
    expect(response.body.result.tools.map((tool) => tool.name)).toEqual(['project_manager.plan_dry_run', 'project_manager.plan_commit'])
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
