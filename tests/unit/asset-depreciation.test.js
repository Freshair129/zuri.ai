// @req FR-136 — depreciation is deterministic review evidence and never a journal.
// @spec SDD-080, NFR-021, BR-023, ADR-055
// @tested tests/unit/asset-depreciation.test.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const modulePath = path.resolve(process.cwd(), 'src/modules/asset-management/domain/depreciation.js')

async function loadCalculator() {
  if (!fs.existsSync(modulePath)) return null
  return import(pathToFileURL(modulePath).href)
}

describe('straight-line depreciation candidate', () => {
  it('builds a bounded monthly schedule and preserves the residual floor', async () => {
    const calculator = await loadCalculator()
    expect(calculator, 'Asset depreciation calculator must exist').not.toBeNull()
    if (!calculator) return
    const result = calculator.calculateStraightLineDepreciation({
      acquisitionAmount: '100000.00',
      residualValue: '20000.00',
      usefulLifeMonths: 4,
      startDate: '2026-01-01',
      currency: 'THB',
    })
    expect(result).toMatchObject({
      calculationVersion: 'STRAIGHT_LINE_V1',
      method: 'STRAIGHT_LINE',
      depreciableBasis: '80000.00',
      monthlyDepreciation: '20000.00',
      finalBookValue: '20000.00',
      accountingAuthority: false,
    })
    expect(result.schedule).toHaveLength(4)
    expect(result.schedule.at(-1)).toMatchObject({
      accumulatedDepreciation: '80000.00', bookValue: '20000.00',
    })
  })

  it('rejects a residual value above acquisition cost', async () => {
    const calculator = await loadCalculator()
    expect(calculator, 'Asset depreciation calculator must exist').not.toBeNull()
    if (!calculator) return
    expect(() => calculator.calculateStraightLineDepreciation({
      acquisitionAmount: '100.00', residualValue: '101.00', usefulLifeMonths: 12,
      startDate: '2026-01-01', currency: 'THB',
    })).toThrow(/residual/i)
  })

  it('allocates rounding remainder to the final period without crossing zero', async () => {
    const calculator = await loadCalculator()
    expect(calculator, 'Asset depreciation calculator must exist').not.toBeNull()
    if (!calculator) return
    const result = calculator.calculateStraightLineDepreciation({
      acquisitionAmount: '100.00', residualValue: '0.00', usefulLifeMonths: 3,
      startDate: '2026-01-31', currency: 'THB',
    })
    expect(result.schedule.map((row) => row.depreciation)).toEqual(['33.33', '33.33', '33.34'])
    expect(result.finalBookValue).toBe('0.00')
  })
})
