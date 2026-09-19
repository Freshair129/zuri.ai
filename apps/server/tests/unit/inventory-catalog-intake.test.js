// @req FR-208 — the catalogue intake planner, without a database: it resolves
//   before it creates (active identifier, then code, following merges), matches
//   without overwriting, plans creates only under every ADR-083 guard against
//   the catalogue and the batch, judges every item on its own, and hashes only
//   what a commit must match.
// @spec ADR-084 D1, D2; BR-041
// @tested tests/unit/inventory-catalog-intake.test.js
import { describe, expect, it } from 'vitest'
import {
  catalogIntakeCode,
  catalogIntakeLookups,
  catalogIntakePayloadHash,
  catalogIntakePlanHash,
  canonicalJson,
  planCatalogIntake,
  zCatalogIntakeEnvelope,
} from '@/modules/inventory/domain/catalog-intake'

const B = 'biz-1'
const env = (items) => ({ schemaVersion: '1.0', businessId: B, source: { channel: 'REST_API', correlationId: 'c-1' }, items })
const item = (code, over = {}) => ({ sku: { code, name: `Name ${code}`, ...(over.sku ?? {}) }, master: { code: 'PM-CUP', ...(over.master ?? {}) }, ...(over.rest ?? {}) })

const product = (over) => ({ businessId: B, status: 'ACTIVE', mergedIntoProductId: null, productMasterId: 'm-cup', unit: 'EA', stockPolicy: 'TRACKED', trackingMode: 'NONE', name: null, color: null, material: null, variantKey: null, ...over })
function snapshot({ products = [], identifiers = [], conversions = [], masters = null, categories = null } = {}) {
  const allMasters = masters ?? [
    { id: 'm-cup', code: 'PM-CUP', businessId: B, status: 'ACTIVE', nature: 'GOOD', defaultStockPolicy: 'TRACKED', variantAxes: [] },
    { id: 'm-tee', code: 'PM-TEE', businessId: B, status: 'ACTIVE', nature: 'GOOD', defaultStockPolicy: 'TRACKED', variantAxes: ['color', 'size'] },
    { id: 'm-svc', code: 'PM-SVC', businessId: B, status: 'ACTIVE', nature: 'SERVICE', defaultStockPolicy: 'SERVICE', variantAxes: [] },
  ]
  const byMaster = new Map()
  for (const p of products) { if (!byMaster.has(p.productMasterId)) byMaster.set(p.productMasterId, []); byMaster.get(p.productMasterId).push(p) }
  const conv = new Map()
  for (const c of conversions) { if (!conv.has(c.productId)) conv.set(c.productId, []); conv.get(c.productId).push(c) }
  return {
    businessId: B,
    categoriesByCode: new Map((categories ?? [{ id: 'cat-1', code: 'CAT', businessId: B, status: 'ACTIVE' }]).map((c) => [c.code, c])),
    mastersByCode: new Map(allMasters.map((m) => [m.code, m])),
    mastersById: new Map(allMasters.map((m) => [m.id, m])),
    productsByCode: new Map(products.map((p) => [p.code, p])),
    productsById: new Map(products.map((p) => [p.id, p])),
    identifierRows: identifiers,
    conversionsByProductId: conv,
    productsByMasterId: byMaster,
  }
}
const decisions = (plan) => plan.items.map((i) => i.decision)
const codes = (plan, n) => plan.items[n].issues.map((i) => i.code)

describe('FR-208 envelope header', () => {
  it('is strict about the header and leaves items to be judged one by one', () => {
    expect(zCatalogIntakeEnvelope.parse(env([{ anything: true }])).items).toHaveLength(1)
    expect(() => zCatalogIntakeEnvelope.parse({ ...env([item('A')]), extra: 1 })).toThrow()
    expect(() => zCatalogIntakeEnvelope.parse(env([]))).toThrow()
    expect(() => zCatalogIntakeEnvelope.parse({ ...env([item('A')]), source: { channel: 'FAX', correlationId: 'x' } })).toThrow()
    expect(() => zCatalogIntakeEnvelope.parse(env(Array.from({ length: 501 }, (_, i) => item(`S${i}`))))).toThrow()
  })

  it('hashes canonically and names a preview by its correlation', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}')
    expect(catalogIntakePayloadHash({ a: 1, b: 2 })).toBe(catalogIntakePayloadHash({ b: 2, a: 1 }))
    expect(catalogIntakeCode({ businessId: B, channel: 'EXCEL', correlationId: 'x' })).toMatch(/^CIT-[0-9A-F]{8}$/)
    expect(catalogIntakeCode({ businessId: B, channel: 'EXCEL', correlationId: 'x' })).toBe(catalogIntakeCode({ businessId: B, channel: 'EXCEL', correlationId: 'x' }))
    expect(catalogIntakeLookups(env([item('A', { rest: { identifiers: [{ kind: 'BARCODE', value: 'X1' }] }, master: { code: 'PM-NEW', categoryCode: 'CAT' } }), { junk: true }]))).toEqual({ codes: ['A'], masterCodes: ['PM-NEW'], categoryCodes: ['CAT'], identifierValues: ['X1'] })
  })
})

describe('FR-208 resolve before create (BR-041)', () => {
  it('a new code with nothing to resolve is a create under the existing master', () => {
    const plan = planCatalogIntake(env([item('NEW-1', { rest: { identifiers: [{ kind: 'GTIN', value: '4006381333931' }], unitConversions: [{ unit: 'BOX12', factor: 12 }] } })]), snapshot())
    expect(decisions(plan)).toEqual(['CREATE'])
    expect(plan.items[0].actions.map((a) => a.type)).toEqual(['CREATE_PRODUCT', 'ADD_UNIT_CONVERSION', 'ADD_IDENTIFIER'])
    expect(plan.items[0].actions[0].payload).toMatchObject({ code: 'NEW-1', stockPolicy: 'TRACKED', trackingMode: 'NONE', unit: 'EA', safetyStock: 10 })
    expect(plan.committable).toBe(true)
    expect(plan.counts).toMatchObject({ total: 1, create: 1, match: 0, conflict: 0, invalid: 0, createMasters: 0 })
  })

  it('an active identifier matches the SKU that holds it even when the code differs, and only adds what it lacks', () => {
    const existing = product({ id: 'p-1', code: 'CUP-BLK', name: 'Cup black' })
    const plan = planCatalogIntake(env([item('CUP-BLACK-2', { sku: { name: 'Cup black' }, rest: { identifiers: [{ kind: 'GTIN', value: '4006381333931' }, { kind: 'SUPPLIER_CODE', value: 'ACME-9' }], unitConversions: [{ unit: 'BOX12', factor: 12 }] } })]),
      snapshot({ products: [existing], identifiers: [{ kind: 'GTIN', value: '4006381333931', status: 'ACTIVE', productId: 'p-1' }] }))
    expect(decisions(plan)).toEqual(['MATCH'])
    expect(plan.items[0]).toMatchObject({ matchedBy: 'IDENTIFIER', product: { id: 'p-1', code: 'CUP-BLK' } })
    expect(plan.items[0].actions.map((a) => [a.type, a.payload.value ?? a.payload.unit])).toEqual([['ADD_UNIT_CONVERSION', 'BOX12'], ['ADD_IDENTIFIER', 'ACME-9']])
    expect(plan.items[0].warnings.map((w) => w.code)).toContain('INTAKE_CODE_DIFFERS')
  })

  it('a scannable value is one thing whatever its label: a BARCODE matches the same digits held as a GTIN', () => {
    const plan = planCatalogIntake(env([item('X', { rest: { identifiers: [{ kind: 'BARCODE', value: '4006381333931' }] } })]),
      snapshot({ products: [product({ id: 'p-1', code: 'CUP' })], identifiers: [{ kind: 'GTIN', value: '4006381333931', status: 'ACTIVE', productId: 'p-1' }] }))
    expect(plan.items[0]).toMatchObject({ decision: 'UNCHANGED', matchedBy: 'IDENTIFIER', product: { code: 'CUP' } })
  })

  it('a code held by a merged duplicate resolves to the survivor and says so', () => {
    const dup = product({ id: 'p-dup', code: 'OLD', status: 'ARCHIVED', mergedIntoProductId: 'p-keep' })
    const keep = product({ id: 'p-keep', code: 'KEEP' })
    const plan = planCatalogIntake(env([item('OLD')]), snapshot({ products: [dup, keep] }))
    expect(plan.items[0]).toMatchObject({ decision: 'UNCHANGED', matchedBy: 'CODE', product: { id: 'p-keep', code: 'KEEP' } })
    expect(plan.items[0].warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['INTAKE_REDIRECTED_FROM_MERGED', 'INTAKE_CODE_DIFFERS']))
  })

  it('a match never overwrites: different descriptive fields and master are warnings, not actions', () => {
    const plan = planCatalogIntake(env([item('CUP', { sku: { name: 'Totally different', color: 'Red' }, master: { code: 'PM-TEE' } })]), snapshot({ products: [product({ id: 'p-1', code: 'CUP', name: 'Cup', color: 'Black' })] }))
    expect(plan.items[0].decision).toBe('UNCHANGED')
    expect(plan.items[0].actions).toEqual([])
    expect(plan.items[0].warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['INTAKE_MASTER_DIFFERS', 'INTAKE_FIELDS_NOT_UPDATED']))
  })

  it('identifiers and a code pointing at two different SKUs are a conflict', () => {
    const plan = planCatalogIntake(env([item('CUP-A', { rest: { identifiers: [{ kind: 'BARCODE', value: 'B-OF-CUP-B' }] } })]),
      snapshot({ products: [product({ id: 'p-a', code: 'CUP-A' }), product({ id: 'p-b', code: 'CUP-B' })], identifiers: [{ kind: 'BARCODE', value: 'B-OF-CUP-B', status: 'ACTIVE', productId: 'p-b' }] }))
    expect(plan.items[0].decision).toBe('CONFLICT')
    expect(codes(plan, 0)).toEqual(['INTAKE_MATCHES_DIFFERENT_SKUS'])
    expect(plan.committable).toBe(false)
  })

  it('a code in another Business of the Tenant is a conflict that describes nothing about it', () => {
    const plan = planCatalogIntake(env([item('SHARED')]), snapshot({ products: [product({ id: 'p-x', code: 'SHARED', businessId: 'biz-2', name: 'Secret' })] }))
    expect(plan.items[0].decision).toBe('CONFLICT')
    expect(codes(plan, 0)).toEqual(['INTAKE_CODE_TAKEN_IN_TENANT'])
    expect(JSON.stringify(plan.items[0])).not.toMatch(/Secret|p-x/)
  })

  it('an archived match, a retired identifier and a different factor are conflicts on a match', () => {
    const archived = planCatalogIntake(env([item('CUP')]), snapshot({ products: [product({ id: 'p-1', code: 'CUP', status: 'ARCHIVED' })] }))
    expect(codes(archived, 0)).toEqual(['INTAKE_MATCHED_SKU_ARCHIVED'])
    const retired = planCatalogIntake(env([item('CUP', { rest: { identifiers: [{ kind: 'BARCODE', value: 'OLD-BAR' }] } })]),
      snapshot({ products: [product({ id: 'p-1', code: 'CUP' })], identifiers: [{ kind: 'BARCODE', value: 'OLD-BAR', status: 'RETIRED', productId: 'p-1' }] }))
    expect(codes(retired, 0)).toEqual(['INTAKE_IDENTIFIER_RETIRED'])
    const factor = planCatalogIntake(env([item('CUP', { rest: { unitConversions: [{ unit: 'BOX12', factor: 10 }] } })]),
      snapshot({ products: [product({ id: 'p-1', code: 'CUP' })], conversions: [{ productId: 'p-1', unit: 'BOX12', factor: 12, status: 'ACTIVE' }] }))
    expect(codes(factor, 0)).toEqual(['INTAKE_UNIT_FACTOR_DIFFERS'])
    const same = planCatalogIntake(env([item('CUP', { rest: { unitConversions: [{ unit: 'BOX12', factor: 12 }] } })]),
      snapshot({ products: [product({ id: 'p-1', code: 'CUP' })], conversions: [{ productId: 'p-1', unit: 'BOX12', factor: 12, status: 'ACTIVE' }] }))
    expect(same.items[0].decision).toBe('UNCHANGED')
  })
})

describe('FR-208 creates pass every ADR-083 guard, against the catalogue and the batch', () => {
  it('a new master is created once by the first row that describes it, and later rows must agree', () => {
    const master = { code: 'PM-NEW', categoryCode: 'CAT', nameTh: 'ใหม่', nameEn: 'New', variantAxes: ['color'] }
    const plan = planCatalogIntake(env([
      item('N-1', { sku: { color: 'Red' }, master }),
      item('N-2', { sku: { color: 'Blue' }, master: { code: 'PM-NEW' } }),
      item('N-3', { sku: { color: 'Green' }, master: { code: 'PM-NEW', nameTh: 'อื่น' } }),
    ]), snapshot())
    expect(decisions(plan)).toEqual(['CREATE', 'CREATE', 'INVALID'])
    expect(plan.items[0].actions[0]).toMatchObject({ type: 'CREATE_MASTER', payload: { code: 'PM-NEW', categoryId: 'cat-1', variantAxes: ['color'] } })
    expect(plan.items[1].actions.map((a) => a.type)).toEqual(['CREATE_PRODUCT'])
    expect(codes(plan, 2)).toEqual(['INTAKE_MASTER_INCONSISTENT'])
    expect(plan.counts.createMasters).toBe(1)
  })

  it('an unknown master without its fields, an unknown category and a nature mismatch are invalid', () => {
    const plan = planCatalogIntake(env([
      item('A', { master: { code: 'PM-NOPE' } }),
      item('B', { master: { code: 'PM-NEW2', categoryCode: 'NOPE', nameTh: 'x', nameEn: 'x' } }),
      item('C', { sku: { stockPolicy: 'SERVICE' } }),
      item('D', { master: { code: 'PM-SVC' }, sku: { stockPolicy: 'TRACKED' } }),
      item('E', { master: { code: 'PM-SVC' }, sku: { safetyStock: 5 } }),
    ]), snapshot())
    expect(decisions(plan)).toEqual(['INVALID', 'INVALID', 'INVALID', 'INVALID', 'INVALID'])
    expect([codes(plan, 0), codes(plan, 1), codes(plan, 2), codes(plan, 3), codes(plan, 4)]).toEqual([['INTAKE_MASTER_NOT_FOUND'], ['INVENTORY_CATEGORY_NOT_FOUND'], ['INVENTORY_NATURE_MISMATCH'], ['INVENTORY_NATURE_MISMATCH'], ['INVENTORY_PRODUCT_IS_A_SERVICE']])
  })

  it('a service under a service master is created with no stock fields', () => {
    const plan = planCatalogIntake(env([item('SVC-1', { master: { code: 'PM-SVC' } })]), snapshot())
    expect(plan.items[0].decision).toBe('CREATE')
    expect(plan.items[0].actions[0].payload).toEqual({ code: 'SVC-1', name: 'Name SVC-1', color: null, material: null, unit: 'EA', stockPolicy: 'SERVICE' })
  })

  it('the variant key is checked against the catalogue and the batch', () => {
    const taken = product({ id: 'p-t', code: 'TEE-BLK-M', productMasterId: 'm-tee', variantKey: 'color=black|size=m' })
    const plan = planCatalogIntake(env([
      item('T-1', { master: { code: 'PM-TEE' }, sku: { variant: { color: 'Black', size: 'M' } } }),
      item('T-2', { master: { code: 'PM-TEE' }, sku: { variant: { color: 'Red', size: 'M' } } }),
      item('T-3', { master: { code: 'PM-TEE' }, sku: { variant: { color: 'red', size: 'm' }, name: 'Other name' } }),
      item('T-4', { master: { code: 'PM-TEE' }, sku: { variant: { color: 'Red' } } }),
    ]), snapshot({ products: [taken] }))
    expect(decisions(plan)).toEqual(['CONFLICT', 'CREATE', 'CONFLICT', 'INVALID'])
    expect(codes(plan, 0)).toEqual(['INVENTORY_PRODUCT_VARIANT_EXISTS'])
    expect(codes(plan, 2)).toEqual(['INTAKE_DUPLICATE_IN_BATCH'])
    expect(codes(plan, 3)).toEqual(['INVENTORY_VARIANT_AXES_INCOMPLETE'])
  })

  it('a lookalike is a conflict unless the row allows it, and a retired identifier elsewhere still blocks', () => {
    const existing = product({ id: 'p-l', code: 'CUP-OLD', name: 'Cup black', color: 'Black' })
    const plan = planCatalogIntake(env([
      item('L-1', { sku: { name: 'cup-black', color: 'black' } }),
      item('L-2', { sku: { name: 'cup-black', color: 'black', allowLookalike: true } }),
      item('L-3', { rest: { identifiers: [{ kind: 'BARCODE', value: 'GONE' }] } }),
    ]), snapshot({ products: [existing], identifiers: [{ kind: 'BARCODE', value: 'GONE', status: 'RETIRED', productId: 'p-l' }] }))
    expect(decisions(plan)).toEqual(['CONFLICT', 'CREATE', 'CONFLICT'])
    expect(codes(plan, 0)).toEqual(['INVENTORY_PRODUCT_LOOKALIKE'])
    expect(plan.items[1].warnings.map((w) => w.code)).toEqual(['INTAKE_LOOKALIKE_ALLOWED'])
    expect(codes(plan, 2)).toEqual(['INTAKE_IDENTIFIER_TAKEN'])
  })

  it('duplicates inside the batch — code and scannable value — conflict on the second row', () => {
    const plan = planCatalogIntake(env([
      item('D-1', { rest: { identifiers: [{ kind: 'GTIN', value: '4006381333931' }] } }),
      item('D-1', { sku: { name: 'again' } }),
      item('D-3', { rest: { identifiers: [{ kind: 'BARCODE', value: '4006381333931' }] } }),
    ]), snapshot())
    expect(decisions(plan)).toEqual(['CREATE', 'CONFLICT', 'CONFLICT'])
    expect(plan.items[1].issues[0]).toMatchObject({ code: 'INTAKE_DUPLICATE_IN_BATCH', firstRef: '1' })
    expect(plan.items[2].issues[0]).toMatchObject({ code: 'INTAKE_DUPLICATE_IN_BATCH', firstRef: '1' })
  })

  it('a malformed row is INVALID with its paths, and the rest of the batch is still planned', () => {
    const plan = planCatalogIntake(env([
      { ref: 'แถว 3', sku: { code: 'OK-1' }, master: { code: 'PM-CUP' } },
      { ref: 'แถว 4', sku: { code: 'has space', safetyStock: 'abc' }, master: {} },
      { ref: 'แถว 5', sku: { code: 'G-1' }, master: { code: 'PM-CUP' }, identifiers: [{ kind: 'GTIN', value: '4006381333932' }], unitConversions: [{ unit: 'BOX12', factor: 'x' }] },
    ]), snapshot())
    expect(decisions(plan)).toEqual(['CREATE', 'INVALID', 'INVALID'])
    expect(plan.items[1].ref).toBe('แถว 4')
    expect(plan.items[1].issues.map((i) => i.path)).toEqual(expect.arrayContaining(['sku.code', 'sku.safetyStock', 'master.code']))
    expect(plan.items[2].issues.map((i) => i.path)).toEqual(expect.arrayContaining(['identifiers.0.value', 'unitConversions.0.factor']))
  })

  it('the plan hash covers decisions and actions, not warnings', () => {
    const snap = snapshot({ products: [product({ id: 'p-1', code: 'CUP', name: 'Cup' })] })
    const a = planCatalogIntake(env([item('CUP', { sku: { name: 'Cup' } })]), snap)
    const b = planCatalogIntake(env([item('CUP', { sku: { name: 'Different' } })]), snap)
    expect(a.items[0].warnings).toHaveLength(0)
    expect(b.items[0].warnings).toHaveLength(1)
    expect(catalogIntakePlanHash(a)).toBe(catalogIntakePlanHash(b))
    const c = planCatalogIntake(env([item('CUP', { rest: { identifiers: [{ kind: 'BARCODE', value: 'NEW' }] } })]), snap)
    expect(catalogIntakePlanHash(c)).not.toBe(catalogIntakePlanHash(a))
  })
})
