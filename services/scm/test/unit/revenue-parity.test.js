// SCM revenue read model ↔ legacy golden: the pinned orders/payments are written
// into a real SCM SQLite store, read back through the SCM read model (SQL read +
// kernel calculator + DTO), and every query must reproduce exactly what the
// legacy getRevenueSummary recorded (apps/server/tests/unit/scm-revenue-parity.test.js).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { createHarness } from '../support/harness.js'
import { TENANT } from '../support/fixtures.js'

const contracts = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'v1')
const cases = JSON.parse(readFileSync(join(contracts, 'revenue-parity-cases.json'), 'utf8'))
const golden = JSON.parse(readFileSync(join(contracts, 'revenue-parity-golden.json'), 'utf8'))

const h = createHarness()
after(() => h.close())
const scope = h.as({ sub: 'per-analyst', grants: { [cases.businessId]: { owner: false, domains: ['commerce'], permissions: [] } } })

await h.store.transaction((sql) => {
  const now = new Date().toISOString()
  for (const o of cases.orders) {
    sql.run("INSERT INTO SalesOrder (id, code, tenantId, businessId, origin, status, currency, discountSatang, orderedAt, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,'THB',0,?,?,?,1)", o.id, `ORD-${o.id}`, TENANT, cases.businessId, o.origin, o.status, now, now, now)
    for (const p of o.payments) {
      sql.run('INSERT INTO Payment (id, code, tenantId, businessId, orderId, kind, method, amountSatang, status, paidAt, createdAt, updatedAt, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)',
        randomUUID(), `PAY-${randomUUID().slice(0, 8)}`, TENANT, cases.businessId, o.id, p.kind, 'TRANSFER', p.amountSatang, p.status, p.paidAt, p.paidAt, now)
    }
  }
})

async function run(query) {
  try {
    return { ok: true, result: JSON.parse(JSON.stringify(await h.bus.queries.revenue(scope, { businessId: cases.businessId, ...query }))) }
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    return { ok: false, error: { name: error.name, paths: error.issues.map((i) => i.path.join('.')) } }
  }
}

for (const c of cases.queries) {
  test(`revenue parity: ${c.id}`, async () => {
    assert.deepEqual(await run(c.query), golden.outputs[c.id])
  })
}

test('revenue is not readable without the commerce domain', async () => {
  const noDomain = h.as({ sub: 'x', grants: { [cases.businessId]: { owner: true, domains: ['inventory'], permissions: [] } } })
  await assert.rejects(h.bus.queries.revenue(noDomain, { businessId: cases.businessId }), (e) => e.status === 404)
})
