import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { projectKnowledgeGraph, writeGraph } from '@/modules/knowledge'
import { createGenesisBlockDBSink } from '@/modules/knowledge/genesisblockdb-sink'

// @req FR-024 — GenesisBlockDB sink: the projected graph lands in the real graph engine
//   through addNode/addEdge, and no live fact ever crosses the seam (ADR-007 §P5).
// The engine client is MOCKED here (records the calls it receives) — no real engine, no
// Rust process, no store is opened; the adapter is exercised purely as a translator.
// Distinct prefixes (PF-GKS / TNT-GKS / BUS-GKS, Ugks-*, PSN-gks-*) — test.db is shared.

/**
 * Minimal recording double of the engine's NAPI `GenesisDatabase` write surface. Its
 * addNode/addEdge match the real signatures (single NodeInput/EdgeInput object, async)
 * and just record what they receive so the test can assert the translation.
 */
function makeMockClient() {
  return {
    nodes: [],
    edges: [],
    async addNode(input) {
      this.nodes.push(input)
      return { id: input.id, labels: input.labels, props: input.props }
    },
    async addEdge(input) {
      this.edges.push(input)
      return { id: `e${this.edges.length}`, from: input.from, to: input.to, rel: input.rel, props: input.props }
    },
  }
}

let tenant, business, customerResult, staffPerson

describe('createGenesisBlockDBSink (FR-024)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'GKS Group', code: 'PF-GKS' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'GKS Tenant', code: 'TNT-GKS' })
    business = await createBusiness({ tenantId: tenant.id, name: 'GKS Business', code: 'BUS-GKS' })

    customerResult = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id,
      lineUserId: 'Ugks-1', displayName: 'ลูกค้า จีเคเอส', threadId: 'T-GKS-1', text: 'สวัสดีครับ',
    })

    staffPerson = await prisma.person.create({ data: { code: 'PSN-gks-staff', displayName: 'พนักงาน จีเคเอส' } })
    await prisma.membership.create({ data: { personId: staffPerson.id, tenantId: tenant.id, businessId: business.id, role: 'MANAGER' } })
  })

  it('translates every projected node into an addNode call with {id, labels:[type], props:{label,key}}', async () => {
    const graph = await projectKnowledgeGraph({ tenantId: tenant.id })
    const client = makeMockClient()
    const sink = createGenesisBlockDBSink({ client })

    await writeGraph(graph, sink)
    await sink.drain()

    // One addNode per projected node.
    expect(client.nodes).toHaveLength(graph.nodes.length)

    // Shape: type → single-element labels array; label/key → props.
    for (const call of client.nodes) {
      expect(Array.isArray(call.labels)).toBe(true)
      expect(call.labels).toHaveLength(1)
      expect(call).toHaveProperty('id')
      expect(call.props).toHaveProperty('label')
      expect(call.props).toHaveProperty('key')
    }

    // The Business node maps its type to labels:['Business'] and carries its code as key.
    const bizCall = client.nodes.find((c) => c.id === business.id)
    expect(bizCall).toBeTruthy()
    expect(bizCall.labels).toEqual(['Business'])
    expect(bizCall.props).toMatchObject({ label: 'GKS Business', key: 'BUS-GKS' })

    // The Conversation node has no code → key is null (not dropped).
    const convNode = graph.nodes.find((n) => n.type === 'Conversation')
    const convCall = client.nodes.find((c) => c.id === convNode.id)
    expect(convCall.labels).toEqual(['Conversation'])
    expect(convCall.props.key).toBeNull()
    expect(convCall.props.label).toBe('T-GKS-1')
  })

  it('translates every projected edge into an addEdge call, carrying role on MEMBER_OF only', async () => {
    const graph = await projectKnowledgeGraph({ tenantId: tenant.id })
    const client = makeMockClient()
    const sink = createGenesisBlockDBSink({ client })

    await writeGraph(graph, sink)
    await sink.drain()

    expect(client.edges).toHaveLength(graph.edges.length)

    // HAS_BUSINESS: tenant → business, no edge props.
    const hasBusiness = client.edges.find((e) => e.rel === 'HAS_BUSINESS')
    expect(hasBusiness).toMatchObject({ from: tenant.id, to: business.id })
    expect(hasBusiness.props).toEqual({})

    // MEMBER_OF: role travels into edge props.
    const memberOf = client.edges.find((e) => e.rel === 'MEMBER_OF')
    expect(memberOf).toMatchObject({ from: staffPerson.id, to: tenant.id })
    expect(memberOf.props).toEqual({ role: 'MANAGER' })

    // IS_PRINCIPAL: customer → person, no role.
    const isPrincipal = client.edges.find((e) => e.rel === 'IS_PRINCIPAL')
    expect(isPrincipal).toMatchObject({ from: customerResult.customerId, to: customerResult.personId })
    expect(isPrincipal.props).toEqual({})
  })

  it('toJSON summarises counts of what was written', async () => {
    const graph = await projectKnowledgeGraph({ tenantId: tenant.id })
    const client = makeMockClient()
    const sink = createGenesisBlockDBSink({ client })

    await writeGraph(graph, sink)
    await sink.drain()

    const summary = sink.toJSON()
    expect(summary).toMatchObject({ backend: 'GenesisBlockDB', errors: 0 })
    expect(summary.nodes).toBe(graph.nodes.length)
    expect(summary.edges).toBe(graph.edges.length)
  })

  it('guards the seam: a node carrying a live fact throws via assertNoLiveFacts and never reaches the client', () => {
    const client = makeMockClient()
    const sink = createGenesisBlockDBSink({ client })

    // A synthetic live fact smuggled onto an otherwise-valid node.
    expect(() =>
      sink.addNode({ id: 'x', type: 'Product', label: 'y', key: 'z', price: 1 }),
    ).toThrow()

    // The client was never called — the guard fires before dispatch.
    expect(client.nodes).toHaveLength(0)
  })

  it('requires an injected client with addNode/addEdge', () => {
    expect(() => createGenesisBlockDBSink({})).toThrow()
    expect(() => createGenesisBlockDBSink({ client: {} })).toThrow()
  })
})
