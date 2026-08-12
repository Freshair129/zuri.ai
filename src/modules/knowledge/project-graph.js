import prisma from '@/lib/db'
import { assertNoLiveFacts } from './live-facts'

// @req FR-024 — Zuri → GKS/KG projection: turn a tenant's relation-bearing records
//   (Tenant, Business, Customer, Person, Conversation) into a deterministic
//   { nodes, edges } graph a knowledge store can reason over.
// @spec ADR-007 §P5 — project ONLY entities whose relations help reasoning. Live/
//   transactional facts (price, credits, invoice, payment, stock, schedule) are NOT
//   projected — they stay a Zuri query. assertNoLiveFacts enforces the split per node.
// @spec BR-001, SEC-001 — tenant-scoped throughout; soft-deleted customers excluded.
// @tested tests/integration/knowledge-project.test.js

// Node types we know how to project. Kept local (not a shared enum) so this module
// owns its own contract.
const NODE_TYPES = ['Tenant', 'Business', 'Customer', 'Person', 'Conversation']

/**
 * Build the label for a node — the human-readable name a reasoner shows. Only ever
 * a relation-bearing/display field, never a live fact.
 */
function labelFor(type, row) {
  switch (type) {
    case 'Tenant':
      return row.name
    case 'Business':
      return row.name
    case 'Customer':
      return row.displayName
    case 'Person':
      return row.displayName
    case 'Conversation':
      return row.externalThreadId
    default:
      return null
  }
}

/** A node = { id, type, label, key }. `key` is the human `code` where the model has
 *  one (Conversation has none → null). Each node's props are asserted live-fact-free. */
function makeNode(type, row) {
  const node = {
    id: row.id,
    type,
    label: labelFor(type, row) ?? null,
    key: row.code ?? null,
  }
  // The gate: a projected node may never smuggle a live fact.
  assertNoLiveFacts(node)
  return node
}

/**
 * Project a tenant's relation graph.
 * @param {{ tenantId: string }} args
 * @returns {Promise<{ nodes: Array<{id,type,label,key}>, edges: Array<{from,to,rel,role?}> }>}
 *   Deterministic: nodes sorted by (type, id); edges by (rel, from, to). Tenant-scoped;
 *   soft-deleted customers and their conversations are excluded.
 */
export async function projectKnowledgeGraph({ tenantId }) {
  if (!tenantId) throw new Error('projectKnowledgeGraph requires a tenantId')

  // Read only the relation-bearing fields. We never select price/credit/invoice/etc,
  // so a live fact cannot reach the projection even by accident.
  const [tenant, businesses, customers, memberships] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, code: true, name: true } }),
    prisma.business.findMany({ where: { tenantId }, select: { id: true, code: true, name: true } }),
    prisma.customer.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        code: true,
        displayName: true,
        businessId: true,
        personId: true,
        person: { select: { id: true, code: true, displayName: true } },
        conversations: { select: { id: true, externalThreadId: true, customerId: true } },
      },
    }),
    prisma.membership.findMany({
      where: { tenantId },
      select: { personId: true, role: true, person: { select: { id: true, code: true, displayName: true } } },
    }),
  ])

  if (!tenant) return { nodes: [], edges: [] }

  const nodes = []
  const edges = []
  const seenNode = new Set() // dedupe on `${type}:${id}` — a Person can be reached twice

  const addNode = (type, row) => {
    const nodeKey = `${type}:${row.id}`
    if (seenNode.has(nodeKey)) return
    seenNode.add(nodeKey)
    nodes.push(makeNode(type, row))
  }

  // Tenant — the root.
  addNode('Tenant', tenant)

  // Businesses, and Tenant → Business (HAS_BUSINESS).
  for (const b of businesses) {
    addNode('Business', b)
    edges.push({ from: tenant.id, to: b.id, rel: 'HAS_BUSINESS' })
  }

  // Customers (+ their principal Person and conversations).
  for (const c of customers) {
    addNode('Customer', c)

    // Business → Customer (HAS_CUSTOMER) — only when the customer is scoped to a business.
    if (c.businessId) {
      edges.push({ from: c.businessId, to: c.id, rel: 'HAS_CUSTOMER' })
    }

    // Customer → Person (IS_PRINCIPAL).
    if (c.person) {
      addNode('Person', c.person)
      edges.push({ from: c.id, to: c.person.id, rel: 'IS_PRINCIPAL' })
    }

    // Customer → Conversation (HAS_CONVERSATION).
    for (const conv of c.conversations) {
      addNode('Conversation', conv)
      edges.push({ from: c.id, to: conv.id, rel: 'HAS_CONVERSATION' })
    }
  }

  // Staff/members: Person → Tenant (MEMBER_OF), role carried on the edge. One edge per
  // membership row (a person may hold more than one role in the tenant).
  for (const m of memberships) {
    if (m.person) addNode('Person', m.person)
    edges.push({ from: m.personId, to: tenant.id, rel: 'MEMBER_OF', role: m.role })
  }

  // Deterministic ordering — the same tenant always projects byte-identical output.
  nodes.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id))
  edges.sort(
    (a, b) =>
      a.rel.localeCompare(b.rel) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  )

  return { nodes, edges }
}

export { NODE_TYPES }
