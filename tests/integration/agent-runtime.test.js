import { describe, it, expect, beforeAll } from 'vitest'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import { createProject } from '@/modules/project-manager/application/project-service'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import prisma from '@/lib/db'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { assembleAgentContext, createAgentPorts, handleAgentTurn } from '@/modules/agent'
import { makeViewer } from '../factories/viewer'

// @req FR-029 — the agent runs on the REAL backends when configured: MSP memory +
// GenesisBlockDB knowledge, wired through createAgentPorts, with graceful fallback.

let tenant, business, workspace, project

describe('createAgentPorts — agent bound to MSP + GenesisBlockDB (FR-029)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Runtime Group', code: 'PF-RT' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Runtime Tenant', code: 'TNT-RT' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Runtime Business', code: 'BUS-RT' })
    workspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: business.id, name: 'Runtime Workspace', code: 'WS-RT' })
    const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    project = await createProject({ workspaceId: workspace.id, businessId: business.id, name: 'Runtime Project', code: 'PRJ-RT' }, { viewer: owner })
  })

  it('with no backends, ports fall back to in-memory + Prisma (agent still works)', async () => {
    const ports = createAgentPorts()
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Urt-1', threadId: 'T-rt-1', text: 'hi' })
    const ctx = await assembleAgentContext({ tenantId: tenant.id, lineUserId: 'Urt-1', memory: ports.memory, knowledge: ports.knowledge })
    expect(ctx.knowledge.found).toBe(true) // Prisma-relation default
    expect(ctx.memory.key).toContain('principal:')
    void r
  })

  it("the agent's knowledge comes from GenesisBlockDB when a graph traverse is wired", async () => {
    const graphRelations = [{ rel: 'BOUGHT', node: { id: 'prod-1', type: 'Product', label: 'คอร์สเบเกอรี่' } }]
    const calls = []
    const graphTraverse = async ({ tenantId, principalId }) => {
      calls.push({ tenantId, principalId })
      return graphRelations
    }
    const ports = createAgentPorts({ graphTraverse })
    await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Urt-2', threadId: 'T-rt-2', text: 'hi' })
    const ctx = await assembleAgentContext({ tenantId: tenant.id, lineUserId: 'Urt-2', knowledge: ports.knowledge })
    expect(ctx.knowledge.relations).toEqual(graphRelations) // came from the graph, not Prisma
    expect(calls.length).toBe(1)
    expect(calls[0].principalId).toBe(ctx.identity.principalId)
  })

  it("the agent's memory reads/writes MSP when an MSP transport is wired", async () => {
    const wire = []
    // Minimal mock MSP transport: (toolName, input) => structuredContent
    const transport = async (name, input) => {
      wire.push({ name, input })
      if (name === 'msp_vault_resolve') {
        return {
          workspacePrivateVaultId: 'vault-runtime-workspace',
          globalPrivateVaultIds: [],
          sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'FR-057.v2' },
        }
      }
      if (name === 'msp_memory_list') return { entities: [{ body_json: { note: 'seen before' } }] }
      return { ok: true }
    }
    const ports = createAgentPorts({ mspTransport: transport })
    const person = await prisma.person.create({ data: { code: 'PSN-RT-MSP', displayName: 'MSP user' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' } })
    const link = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({ tenantId: tenant.id, token: link.token, lineUserId: 'Urt-3' })
    const ctx = await assembleAgentContext({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: 'Urt-3',
      memory: ports.memory,
      serverScope: { transportVerified: true, businessId: business.id, workspaceId: workspace.id, projectId: project.id },
    })
    // memory recall went to MSP, scoped to the principal vault (never a channel handle)
    const listCall = wire.find((c) => c.name === 'msp_memory_list')
    expect(listCall).toBeTruthy()
    expect(JSON.stringify(listCall.input)).not.toContain('line:')
    expect(ctx.memory.key).toBe('vault-runtime-workspace')
  })

  it('handleAgentTurn accepts the composed ports end to end', async () => {
    const graphTraverse = async () => [{ rel: 'BOUGHT', node: { id: 'p9', type: 'Product', label: 'X' } }]
    const ports = createAgentPorts({ graphTraverse })
    const r = await handleAgentTurn(
      { tenantId: tenant.id, businessId: business.id, lineUserId: 'Urt-4', threadId: 'T-rt-4', text: 'ซื้ออะไรได้บ้าง' },
      { memory: ports.memory, knowledge: ports.knowledge },
    )
    expect(r.response.kind).toBe('ANSWER')
    expect(r.response.relationCount).toBe(1)
  })
})
