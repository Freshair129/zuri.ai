import { createServer } from 'node:http'
import { REFERENCE_FIXTURE } from './fixtures.js'

// A synthetic core serving the provider half of contracts/v1/scm-core.v1.json on
// 127.0.0.1:<ephemeral>: static service token, subject → scope from a synthetic
// table, facts from REFERENCE_FIXTURE. It applies the contract's disclosure rule
// (a Business the subject has no grant for → null / []), but deliberately does NOT
// filter by Tenant or by the fact's own Business: that proves SCM applies its own
// predicate to whatever core returns. Never a copy of real data.

export const CORE_TOKEN = 'scm-core-token-synthetic-000000000000000000'
export const API_TOKEN = 'scm-api-token-synthetic-1111111111111111111'

const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))
const shape = {
  branch: (r) => pick(r, ['id', 'code', 'name', 'tenantId', 'businessId', 'status']),
  branchRow: (r) => ({ ...pick(r, ['id', 'code', 'name', 'address', 'kind', 'status', 'tenantId', 'businessId']), kind: r.kind ?? 'SITE' }),
  customer: (r) => pick(r, ['id', 'code', 'tenantId', 'businessId', 'deletedAt']),
  conversation: (r) => pick(r, ['id', 'tenantId', 'businessId', 'customerId']),
}

export async function startFakeCore({ subjects, fixture = REFERENCE_FIXTURE, token = CORE_TOKEN } = {}) {
  const state = { down: false, downOps: new Set(), calls: [] }
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const op = req.url.replace(/^\/api\/internal\/scm\/v1\//, '')
    const subject = req.headers['x-zuri-subject']
    state.calls.push({ op, subject, authorization: req.headers.authorization })
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (state.down || state.downOps.has(op)) return reply(503, { error: { code: 'CORE_DOWN' } })
    if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${token}`) return reply(401, { error: { code: 'SERVICE_TOKEN_INVALID' } })
    const who = typeof subject === 'string' ? subjects[subject] : undefined
    if (!who) return reply(401, { error: { code: 'SUBJECT_UNAUTHENTICATED' } })
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    const sees = typeof body.businessId === 'string' && Object.hasOwn(who.grants, body.businessId)
    const find = (list, id) => (sees ? (list ?? []).find((r) => r.id === id) ?? null : null)
    const ok = (data) => reply(200, { contractVersion: 'scm-core.v1', ok: true, data })
    if (op === 'resolve-scope') return ok({ actorId: who.actorId, tenantId: who.tenantId, grants: who.grants })
    if (op === 'branch') { const r = find(fixture.branches, body.branchId); return ok({ fact: r && shape.branch(r) }) }
    if (op === 'branches') return ok({ branches: sees ? (fixture.branches ?? []).filter((r) => r.businessId === body.businessId && r.tenantId === who.tenantId).map(shape.branchRow) : [] })
    if (op === 'customer') { const r = find(fixture.customers, body.customerId); return ok({ fact: r && shape.customer(r) }) }
    if (op === 'conversation') { const r = find(fixture.conversations, body.conversationId); return ok({ fact: r && shape.conversation(r) }) }
    return reply(404, { error: { code: 'NOT_FOUND' } })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections?.() }),
  }
}
