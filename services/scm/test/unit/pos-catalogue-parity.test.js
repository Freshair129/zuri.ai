// SCM POS terminal catalogue ↔ legacy golden: the pinned catalogue is written
// into a real SCM store (products, masters, categories, ledger rows, locations),
// Branch facts come from the fixture ReferenceAuthority, and every case must
// reproduce what the legacy getPosTerminalCatalogue recorded
// (apps/server/tests/unit/scm-pos-catalogue-parity.test.js).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHarness } from '../support/harness.js'
import { createFixtureReferenceAuthority } from '../../src/infrastructure/reference-authority.js'

const contracts = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'v1')
const cases = JSON.parse(readFileSync(join(contracts, 'pos-catalogue-parity-cases.json'), 'utf8'))
const golden = JSON.parse(readFileSync(join(contracts, 'pos-catalogue-parity-golden.json'), 'utf8'))

const h = createHarness({
  products: cases.products,
  seed: {
    categories: cases.categories,
    masters: cases.masters,
    locations: cases.locations,
    stock: cases.movements.map(({ productId, businessId, quantity }) => ({ productId, businessId, quantity })),
  },
  references: createFixtureReferenceAuthority({ branches: cases.branches.map((b) => ({ ...b, tenantId: cases.tenantId })) }),
})
after(() => h.close())
const grants = Object.fromEntries([...new Set(cases.cases.map((c) => c.businessId))].map((id) => [id, { owner: true, domains: ['commerce', 'inventory'], permissions: [] }]))
const viewer = h.as({ sub: 'per-catalogue', tenantId: cases.tenantId, grants })

for (const c of cases.cases) {
  test(`POS catalogue parity: ${c.id}`, async () => {
    const result = JSON.parse(JSON.stringify(await h.bus.queries.posCatalogue(viewer, { businessId: c.businessId })))
    assert.deepEqual({ ok: true, result }, golden.outputs[c.id])
  })
}
