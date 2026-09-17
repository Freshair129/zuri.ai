import { afterEach, describe, expect, it, vi } from 'vitest'
const ports = vi.hoisted(() => ({ resolve: vi.fn(), execute: vi.fn() }))
vi.mock('@/modules/identity/edge-device-credential', () => ({ resolveEdgeDeviceContext: ports.resolve }))
vi.mock('@/modules/agent/edge-project-work-tools', () => ({ executeEdgeProjectWorkTool: ports.execute }))
import { POST } from '@/app/api/edge/conversation-jobs/[id]/tools/route'

// @req FR-026, FR-150 — authenticated HTTP boundary and bounded request/error DTO.
// @spec SEC-001, SEC-025, ADR-061
const originalFlag = process.env.ZURI_LINE_SERVER_ENABLED
const request = body => new Request('http://localhost/api/edge/conversation-jobs/job/tools', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body,
})
afterEach(() => {
  vi.resetAllMocks()
  if (originalFlag === undefined) delete process.env.ZURI_LINE_SERVER_ENABLED
  else process.env.ZURI_LINE_SERVER_ENABLED = originalFlag
})
describe('Edge Project/Work tool HTTP boundary', () => {
  it('requires enabled runtime and authenticated Edge credential', async () => {
    process.env.ZURI_LINE_SERVER_ENABLED = 'false'
    expect((await POST(request('{}'), { params: { id: 'job' } })).status).toBe(503)
    expect(ports.resolve).not.toHaveBeenCalled()
    process.env.ZURI_LINE_SERVER_ENABLED = 'true'
    ports.resolve.mockResolvedValue(null)
    expect((await POST(request('{}'), { params: { id: 'job' } })).status).toBe(401)
    expect(ports.execute).not.toHaveBeenCalled()
  })
  it('bounds body before calling the tool and handles invalid JSON', async () => {
    process.env.ZURI_LINE_SERVER_ENABLED = 'true'
    ports.resolve.mockResolvedValue({ isEdgeDevice: true })
    expect((await POST(request(JSON.stringify({ args: 'a'.repeat(9000) })), { params: { id: 'job' } })).status).toBe(413)
    expect((await POST(request('{'), { params: { id: 'job' } })).status).toBe(400)
    expect(ports.execute).not.toHaveBeenCalled()
  })
  it('returns only tool results and redacts internal errors', async () => {
    process.env.ZURI_LINE_SERVER_ENABLED = 'true'
    const deviceContext = { isEdgeDevice: true, credentialId: 'device' }
    ports.resolve.mockResolvedValue(deviceContext)
    ports.execute.mockResolvedValue({ toolName: 'search_project_work', result: { items: [] } })
    const body = { version: 2, executionId: 'execution', toolName: 'search_project_work', args: {} }
    const response = await POST(request(JSON.stringify(body)), { params: { id: 'job' } })
    expect(response.status).toBe(200)
    expect(ports.execute).toHaveBeenCalledWith('job', body, { deviceContext })
    ports.execute.mockRejectedValue(Object.assign(new Error('secret internal cause'), { status: 409 }))
    const failed = await POST(request(JSON.stringify(body)), { params: { id: 'job' } })
    expect(failed.status).toBe(409)
    expect(await failed.json()).toEqual({ error: 'CONVERSATION_TOOL_REQUEST_REJECTED' })
  })
})
