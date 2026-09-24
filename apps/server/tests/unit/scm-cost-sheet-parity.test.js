// @req FR-164 — the legacy supplier cost-sheet preview is the recorder of the SCM
//   cost-sheet parity golden: the pinned synthetic envelopes and SKUs in
//   services/scm/contracts/v1/cost-sheet-parity-cases.json are fed to the legacy
//   previewSupplierCostSheet through an in-memory db stub, and every case's
//   sheet code, preview hash, source hash and SKU-match suggestions (or its
//   refusal) must equal the recorded file. services/scm's
//   test/unit/cost-sheet-parity.test.js holds the SCM preview — reading the same
//   SKUs from its own SQLite store — to the same file.
//   WRITE_SCM_COST_SHEET_GOLDEN=1 re-records it from this engine.
// @spec ADR-066; ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { previewSupplierCostSheet } from '../../src/modules/procurement/application/supplier-cost-sheet-service'
import { makeViewer } from '../factories/viewer'

const contracts = join(__dirname, '..', '..', '..', '..', 'services', 'scm', 'contracts', 'v1')
const cases = JSON.parse(readFileSync(join(contracts, 'cost-sheet-parity-cases.json'), 'utf8'))
const goldenPath = join(contracts, 'cost-sheet-parity-golden.json')

const viewer = makeViewer({ visibleBusinessIds: [cases.businessId], ownedBusinessIds: [cases.businessId], visibleDomains: ['procurement', 'inventory'] })
const db = {
  business: { findUnique: async ({ where }) => (where.id === cases.businessId ? { id: cases.businessId, tenantId: cases.tenantId } : null) },
  supplier: { findUnique: async ({ where }) => (where.id === cases.supplierId ? { id: cases.supplierId, businessId: cases.businessId, status: 'ACTIVE' } : null) },
  supplierCostSheet: {
    findUnique: async () => null,
    create: async ({ data }) => ({ id: 'sheet-parity', ...data, supplier: { id: cases.supplierId, code: 'SUP-PARITY', name: 'Parity Supplier' }, lines: [] }),
  },
  product: {
    findMany: async ({ where }) => cases.products
      .filter((p) => p.status !== 'ARCHIVED' && where.businessId === cases.businessId)
      .map((p) => ({ id: p.id, code: p.code, name: p.name, status: p.status, identifiers: p.identifiers.filter((i) => i.status === 'ACTIVE').map(({ kind, value }) => ({ kind, value })) })),
  },
  auditEvent: { create: async () => ({}) },
}

async function run(envelope) {
  try {
    const { sheet } = await previewSupplierCostSheet({ businessId: cases.businessId, supplierId: cases.supplierId, ...envelope }, { viewer, db })
    return { ok: true, result: JSON.parse(JSON.stringify({ code: sheet.code, previewHash: sheet.preview.hash, sourceSha256: sheet.sourceSha256, sourceRef: sheet.sourceRef, lineCount: sheet.lineCount, lines: sheet.preview.lines })) }
  } catch (error) {
    return { ok: false, error: { name: error.name, paths: (error.issues ?? []).map((i) => i.path.join('.')) } }
  }
}

describe('SCM cost-sheet parity golden (legacy recorder)', async () => {
  const outputs = Object.fromEntries(await Promise.all(cases.cases.map(async (c) => [c.id, await run(c.envelope)])))
  if (process.env.WRITE_SCM_COST_SHEET_GOLDEN === '1') writeFileSync(goldenPath, `${JSON.stringify({ schema: 'scm.cost-sheet-parity-golden.v1', outputs }, null, 2)}\n`)
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

  it('covers every match kind and a refusal', () => {
    const lines = Object.values(outputs).filter((o) => o.ok).flatMap((o) => o.result.lines)
    expect(new Set(lines.map((l) => l.mapping.confidence))).toEqual(new Set(['EXACT_PRODUCT_CODE', 'EXACT_IDENTIFIER', 'AMBIGUOUS', 'UNMATCHED']))
    expect(Object.values(outputs).some((o) => !o.ok)).toBe(true)
    expect(Object.keys(golden.outputs).sort()).toEqual(cases.cases.map((c) => c.id).sort())
  })
  it.each(cases.cases.map((c) => [c.id]))('%s matches the recorded output', (id) => {
    expect(outputs[id]).toEqual(golden.outputs[id])
  })
})
