// @req FR-163 — the legacy revenue read model is the recorder of the SCM revenue
//   parity golden: the pinned synthetic orders/payments in
//   services/scm/contracts/v1/revenue-parity-cases.json are fed to the legacy
//   getRevenueSummary through an in-memory db stub, and every query's output
//   (or refusal) must equal the recorded file. services/scm's
//   test/unit/revenue-parity.test.js holds the SCM read model — reading the
//   same rows from its own SQLite store — to the same file.
//   WRITE_SCM_REVENUE_GOLDEN=1 re-records it from this engine.
// @spec ADR-065
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getRevenueSummary } from '../../src/modules/commerce/application/revenue-read-model'
import { makeViewer } from '../factories/viewer'

const contracts = join(__dirname, '..', '..', '..', '..', 'services', 'scm', 'contracts', 'v1')
const cases = JSON.parse(readFileSync(join(contracts, 'revenue-parity-cases.json'), 'utf8'))
const goldenPath = join(contracts, 'revenue-parity-golden.json')

const viewer = makeViewer({ visibleBusinessIds: [cases.businessId], ownedBusinessIds: [cases.businessId], visibleDomains: ['commerce'] })
const db = {
  business: { findUnique: async ({ where }) => (where.id === cases.businessId ? { id: cases.businessId, tenantId: 'tenant-synthetic-a' } : null) },
  salesOrder: {
    findMany: async ({ where }) => cases.orders
      .filter(() => where.businessId === cases.businessId)
      .map((o) => ({ id: o.id, origin: o.origin, status: o.status, payments: o.payments.map((p) => ({ ...p, paidAt: new Date(p.paidAt), createdAt: new Date(p.paidAt) })) })),
  },
}

async function run(query) {
  try {
    return { ok: true, result: JSON.parse(JSON.stringify(await getRevenueSummary({ businessId: cases.businessId, ...query }, { viewer, db }))) }
  } catch (error) {
    return { ok: false, error: { name: error.name, paths: (error.issues ?? []).map((i) => i.path.join('.')) } }
  }
}

describe('SCM revenue parity golden (legacy recorder)', async () => {
  const outputs = Object.fromEntries(await Promise.all(cases.queries.map(async (c) => [c.id, await run(c.query)])))
  if (process.env.WRITE_SCM_REVENUE_GOLDEN === '1') writeFileSync(goldenPath, `${JSON.stringify({ schema: 'scm.revenue-parity-golden.v1', outputs }, null, 2)}\n`)
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

  it('covers results and a refusal', () => {
    expect(Object.values(outputs).some((o) => o.ok)).toBe(true)
    expect(Object.values(outputs).some((o) => !o.ok)).toBe(true)
    expect(Object.keys(golden.outputs).sort()).toEqual(cases.queries.map((c) => c.id).sort())
  })
  it.each(cases.queries.map((c) => [c.id]))('%s matches the recorded output', (id) => {
    expect(outputs[id]).toEqual(golden.outputs[id])
  })
})
