// @req FR-172 — the actual database, HTTP route and MCP transport all reach
// the same durable admission service and live knowledge authorization helper.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/integration/knowledge-admission.integration.test.js
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { admitKnowledge } from '@/modules/knowledge/knowledge-admission-service'

const resolveViewer = vi.hoisted(() => vi.fn())
vi.mock('@/modules/knowledge/knowledge-http', async (importOriginal) => ({
  ...(await importOriginal()),
  resolveKnowledgeRequestViewer: resolveViewer,
}))

const { POST: ADMIT, GET: LIST } = await import('@/app/api/knowledge/ingestions/route')
import { createProjectManagerMcpTransport } from '@/modules/project-manager/mcp/transport'

let portfolio
let tenant
let business
let viewer
const scopeFor = () => ({
  portfolioId: portfolio.id,
  tenantId: tenant.id,
  businessId: business.id,
  workspaceId: 'workspace-knowledge-integration',
  agentId: 'agent-knowledge-integration',
  visibility: 'private',
})

function request(url, method = 'GET', body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('knowledge admission live integration', () => {
  const saved = {}

  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    portfolio = await createPortfolio({ name: 'Admission Integration Portfolio', code: 'PF-ADMISSION-INTEGRATION' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Admission Integration Tenant', code: 'TNT-ADMISSION-INTEGRATION' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Admission Integration Business', code: 'BUS-ADMISSION-INTEGRATION' })
    viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    resolveViewer.mockResolvedValue(viewer)
    const scope = scopeFor()
    process.env.ZURI_KNOWLEDGE_ENABLED = '1'
    process.env.ZURI_KNOWLEDGE_BINDINGS = JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }])
    process.env.MSP_PIPELINE_PRINCIPALS = JSON.stringify([{ role: 'source', credential: 'test-credential', scope }])
    // Binding validation only constructs the transport here; no worker is
    // started by admission, so a harmless executable is sufficient.
    process.env.ZURI_MSP_COMMAND = process.execPath
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await prisma.$disconnect()
  })

  it('persists an HTTP admission through the real ACL and runtime binding', async () => {
    const body = {
      businessId: business.id,
      idempotencyKey: 'integration-http-1',
      source: { kind: 'TEXT', sourceKey: 'http-policy', version: 'v1', title: 'HTTP policy', content: 'HTTP durable text' },
    }
    const response = await ADMIT(request('http://local/api/knowledge/ingestions', 'POST', body))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload).toMatchObject({ status: 'QUEUED', executionRunId: null, source: { sourceKey: 'http-policy' } })
    const row = await prisma.knowledgeIngestion.findUnique({ where: { id: payload.id } })
    expect(row).toMatchObject({ status: 'QUEUED', content: 'HTTP durable text', sourceVersion: 'v1' })
  })

  it('lists the same persisted job without returning raw content', async () => {
    const response = await LIST(request(`http://local/api/knowledge/ingestions?businessId=${business.id}`))
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.items).toEqual(expect.arrayContaining([expect.objectContaining({ sourceVersion: 'v1', status: 'QUEUED' })]))
    expect(JSON.stringify(payload)).not.toContain('HTTP durable text')
  })

  it('admits through MCP using the same service and live ACL', async () => {
    const transport = createProjectManagerMcpTransport()
    const initialized = await transport.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, { viewer })
    const sessionId = initialized.sessionId
    await transport.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { viewer, sessionId })
    const called = await transport.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'knowledge.ingestion_create',
        arguments: {
          businessId: business.id,
          idempotencyKey: 'integration-mcp-1',
          source: { kind: 'TEXT', sourceKey: 'mcp-policy', version: 'v1', content: 'MCP durable text' },
        },
      },
    }, { viewer, sessionId })
    expect(called.status).toBe(200)
    expect(called.body.result.structuredContent).toMatchObject({ status: 'QUEUED', executionRunId: null })
    const row = await prisma.knowledgeIngestion.findFirst({ where: { sourceVersion: 'v1', source: { sourceKey: 'mcp-policy' } } })
    expect(row.content).toBe('MCP durable text')
  })

  it('refuses a visible member write through the real helper', async () => {
    const member = makeViewer({ role: 'MEMBER', visibleBusinessIds: [business.id], ownedBusinessIds: [] })
    await expect(admitKnowledge({
      businessId: business.id,
      idempotencyKey: 'integration-member-write',
      source: { kind: 'TEXT', sourceKey: 'blocked', version: 'v1', content: 'blocked' },
    }, {
      viewer: member,
      env: process.env,
    })).rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_BUSINESS_NOT_FOUND' })
  })
})
