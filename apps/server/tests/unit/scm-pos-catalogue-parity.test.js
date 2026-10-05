// @req FR-183 — the legacy POS terminal catalogue is the recorder of the SCM
//   catalogue parity golden: the pinned synthetic catalogue in
//   services/scm/contracts/v1/pos-catalogue-parity-cases.json is fed to the
//   legacy getPosTerminalCatalogue through an in-memory db stub (each where /
//   orderBy the legacy query names is applied as Prisma would), and every case's
//   output must equal the recorded file. services/scm's
//   test/unit/pos-catalogue-parity.test.js holds the SCM catalogue — reading the
//   same rows from its own store and Branch facts from the core owner — to the
//   same file. WRITE_SCM_POS_CATALOGUE_GOLDEN=1 re-records it from this engine.
// @spec ADR-065
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPosTerminalCatalogue } from '../../src/modules/commerce/application/pos-cashier-service'
import { makeViewer } from '../factories/viewer'

const contracts = join(__dirname, '..', '..', '..', '..', 'services', 'scm', 'contracts', 'v1')
const cases = JSON.parse(readFileSync(join(contracts, 'pos-catalogue-parity-cases.json'), 'utf8'))
const goldenPath = join(contracts, 'pos-catalogue-parity-golden.json')

const businessIds = [...new Set(cases.cases.map((c) => c.businessId))]
const viewer = makeViewer({ visibleBusinessIds: businessIds, ownedBusinessIds: businessIds, visibleDomains: ['commerce', 'inventory'] })
const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
const pick = (row, select) => Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null]))
const db = {
  business: { findUnique: async ({ where }) => (businessIds.includes(where.id) ? { id: where.id, tenantId: cases.tenantId } : null) },
  product: {
    findMany: async ({ where, select }) => cases.products
      .filter((p) => p.businessId === where.businessId && p.status === where.status)
      .sort(byCode)
      .map((p) => {
        const { productMaster, ...rest } = select
        const master = cases.masters.find((m) => m.id === p.productMasterId)
        return { ...pick(p, rest), productMaster: master ? pick(master, productMaster.select) : null }
      }),
  },
  stockMovement: {
    groupBy: async ({ where }) => {
      const sums = new Map()
      for (const m of cases.movements.filter((x) => x.businessId === where.businessId)) sums.set(m.productId, (sums.get(m.productId) ?? 0) + m.quantity)
      return [...sums].map(([productId, quantity]) => ({ productId, _sum: { quantity } }))
    },
  },
  inventoryCategory: { findMany: async ({ where, select }) => cases.categories.filter((c) => c.businessId === where.businessId && c.status === where.status).sort(byCode).map((c) => pick(c, select)) },
  branch: { findMany: async ({ where, select }) => cases.branches.filter((b) => b.businessId === where.businessId && b.status === where.status).sort(byCode).map((b) => pick(b, select)) },
  warehouseLocation: { findMany: async ({ where, select }) => cases.locations.filter((l) => l.businessId === where.businessId && l.status === where.status && l.isVirtual === where.isVirtual).sort(byCode).map((l) => pick(l, select)) },
}

async function run(businessId) {
  try {
    return { ok: true, result: JSON.parse(JSON.stringify(await getPosTerminalCatalogue(businessId, { viewer, db }))) }
  } catch (error) {
    return { ok: false, error: { status: error.status ?? null } }
  }
}

describe('SCM POS catalogue parity golden (legacy recorder)', async () => {
  const outputs = Object.fromEntries(await Promise.all(cases.cases.map(async (c) => [c.id, await run(c.businessId)])))
  if (process.env.WRITE_SCM_POS_CATALOGUE_GOLDEN === '1') writeFileSync(goldenPath, `${JSON.stringify({ schema: 'scm.pos-catalogue-parity-golden.v1', outputs }, null, 2)}\n`)
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

  it('covers tracked, untracked, service, name fallback, retired category and filtered rows', () => {
    const items = outputs['full-catalogue'].result.items
    expect(new Set(items.map((i) => i.stockPolicy))).toEqual(new Set(['TRACKED', 'UNTRACKED', 'SERVICE']))
    expect(items.some((i) => i.onHand === 0 && i.isAvailable === false)).toBe(true)
    expect(items.some((i) => i.categoryId === null)).toBe(true)
    expect(Object.keys(golden.outputs).sort()).toEqual(cases.cases.map((c) => c.id).sort())
  })
  it.each(cases.cases.map((c) => [c.id]))('%s matches the recorded output', (id) => {
    expect(outputs[id]).toEqual(golden.outputs[id])
  })
})
