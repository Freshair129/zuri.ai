import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const modulePath = '@/modules/knowledge/line-product-disclosure-contract'
const contractPromise = import(modulePath).catch(() => null)

function requireExport(contract, name) {
  expect(typeof contract?.[name]).toBe('function')
  return contract[name]
}

const hash = (value) => createHash('sha256').update(value).digest('hex')

describe('LINE product disclosure fact contract', () => {
  it('keeps the public field vocabulary fixed and ordered', async () => {
    const contract = await contractPromise
    expect(contract?.DISCLOSURE_FIELDS).toEqual([
      'sku', 'nameTh', 'nameEn', 'unit', 'category', 'productFamily', 'dimensionsCm', 'unitWeightKg',
    ])
  })

  it('projects only typed approved values with opaque IDs and fixed Thai labels', async () => {
    const contract = await contractPromise
    const project = requireExport(contract, 'projectDisclosureFacts')
    expect(project([
      { field: 'unitWeightKg', value: 0.25 },
      { field: 'dimensionsCm', value: { height: 10, length: 20, width: 3 } },
      { field: 'nameTh', value: 'แก้วน้ำ' },
      { field: 'nameEn', value: null },
    ])).toEqual([
      { id: 'f1', field: 'nameTh', label: 'ชื่อสินค้า', value: 'แก้วน้ำ' },
      { id: 'f2', field: 'dimensionsCm', label: 'ขนาด', value: { height: 10, length: 20, width: 3 } },
      { id: 'f3', field: 'unitWeightKg', label: 'น้ำหนักต่อหน่วย', value: 0.25 },
    ])
  })

  it('rejects unknown or commercially sensitive fields instead of projecting them', async () => {
    const contract = await contractPromise
    const project = requireExport(contract, 'projectDisclosureFacts')
    expect(() => project([{ field: 'srpPriceThbQty1', value: 999 }])).toThrow()
    expect(() => project([{ field: 'nameTh', value: 'Public name', cost: 999 }])).toThrow()
    expect(() => project([{ field: 'dimensionsCm', value: { height: 1, length: 2, width: 3, cost: 999 } }])).toThrow()
  })

  it('renders only selected supplied facts with server labels and exact values', async () => {
    const contract = await contractPromise
    const project = requireExport(contract, 'projectDisclosureFacts')
    const render = requireExport(contract, 'renderDisclosureFacts')
    const facts = project([
      { field: 'unit', value: 'EA' },
      { field: 'sku', value: 'MUG-01' },
      { field: 'dimensionsCm', value: { height: 10, length: 20, width: 3 } },
    ])

    expect(render(facts, ['f3', 'f1'])).toBe('รหัสสินค้า: MUG-01\nขนาด: height 10 cm, length 20 cm, width 3 cm')
  })

  it('returns a stable empty result for empty, duplicate, unknown, or malformed selections', async () => {
    const contract = await contractPromise
    const project = requireExport(contract, 'projectDisclosureFacts')
    const render = requireExport(contract, 'renderDisclosureFacts')
    const facts = project([{ field: 'nameTh', value: 'แก้วน้ำ' }])

    expect(render(facts, [])).toBe('')
    expect(render(facts, ['f1', 'f1'])).toBe('')
    expect(render(facts, ['f9'])).toBe('')
    expect(render([{ ...facts[0], label: 'Hidden label' }], ['f1'])).toBe('')
  })

  it('hashes only the trimmed NFC uppercase alias form and rejects controls or oversized values', async () => {
    const contract = await contractPromise
    const lookupHash = requireExport(contract, 'disclosureLookupHash')
    expect(lookupHash(' café ')).toBe(hash('CAFÉ'))
    expect(lookupHash('cafe\u0301')).toBe(hash('CAFÉ'))
    expect(lookupHash('Ａ')).not.toBe(lookupHash('A'))
    expect(() => lookupHash(' name\n')).toThrow()
    expect(() => lookupHash('x'.repeat(501))).toThrow()
  })
})
