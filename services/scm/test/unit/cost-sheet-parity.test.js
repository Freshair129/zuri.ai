// SCM cost-sheet preview ↔ legacy golden: the pinned SKUs and identifiers are
// written into a real SCM SQLite store, each envelope goes through the real
// preview command, and the sheet code, preview hash, source hash and SKU-match
// suggestions must equal what the legacy previewSupplierCostSheet recorded
// (apps/server/tests/unit/scm-cost-sheet-parity.test.js).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZodError } from 'zod'
import { createHarness } from '../support/harness.js'
import { idem } from '../support/fixtures.js'

const contracts = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'v1')
const cases = JSON.parse(readFileSync(join(contracts, 'cost-sheet-parity-cases.json'), 'utf8'))
const golden = JSON.parse(readFileSync(join(contracts, 'cost-sheet-parity-golden.json'), 'utf8'))

const h = createHarness({
  products: cases.products.map(({ id, code, name, status }) => ({ id, code, name, status, businessId: cases.businessId, tenantId: cases.tenantId })),
  seed: { identifiers: cases.products.flatMap((p) => p.identifiers.map((i) => ({ productId: p.id, kind: i.kind, value: i.value, status: i.status, businessId: cases.businessId, tenantId: cases.tenantId }))) },
})
after(() => h.close())
await h.store.transaction((sql) => {
  const now = new Date().toISOString()
  sql.run("INSERT INTO Supplier (id, code, tenantId, businessId, name, status, createdAt, updatedAt, version) VALUES (?,?,?,?,?,'ACTIVE',?,?,1)", cases.supplierId, 'SUP-PARITY', cases.tenantId, cases.businessId, 'Parity Supplier', now, now)
})
const buyer = h.as({ sub: 'per-parity-buyer', tenantId: cases.tenantId, grants: { [cases.businessId]: { owner: false, domains: ['procurement', 'inventory'], permissions: ['procurement.po.write'] } } })

async function run(envelope) {
  try {
    const { sheet } = await h.run(buyer, 'procurement.cost-sheet.preview', { idempotencyKey: idem('parity'), body: { businessId: cases.businessId, supplierId: cases.supplierId, ...envelope } })
    return { ok: true, result: JSON.parse(JSON.stringify({ code: sheet.code, previewHash: sheet.preview.hash, sourceSha256: sheet.sourceSha256, sourceRef: sheet.sourceRef, lineCount: sheet.lineCount, lines: sheet.preview.lines })) }
  } catch (error) {
    if (!(error instanceof ZodError)) throw error
    return { ok: false, error: { name: error.name, paths: error.issues.map((i) => i.path.join('.')) } }
  }
}

for (const c of cases.cases) {
  test(`cost-sheet parity: ${c.id}`, async () => {
    assert.deepEqual(await run(c.envelope), golden.outputs[c.id])
  })
}
