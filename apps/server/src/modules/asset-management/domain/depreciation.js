// @req FR-136 — deterministic straight-line depreciation preview for Finance
// review, with no capitalization, book or journal authority.
// @spec SDD-080, NFR-021, BR-023, ADR-055
// @tested tests/unit/asset-depreciation.test.js

function toCents(value, label) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error(`${label} must be a non-negative decimal`)
  const [whole, fraction = ''] = String(value).split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error(`${label} is outside the supported range`)
  return cents
}

function money(cents) {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}

function addUtcMonth(dateText, offset) {
  const [year, month, day] = dateText.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 + offset, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)))
    .toISOString().slice(0, 10)
}

export function calculateStraightLineDepreciation(input = {}) {
  const acquisition = toCents(input.acquisitionAmount, 'acquisitionAmount')
  const residual = toCents(input.residualValue, 'residualValue')
  if (residual > acquisition) throw new Error('residualValue must not exceed acquisitionAmount')
  if (!Number.isInteger(input.usefulLifeMonths) || input.usefulLifeMonths <= 0 || input.usefulLifeMonths > 1_200) {
    throw new Error('usefulLifeMonths must be a positive integer no greater than 1200')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate))) throw new Error('startDate must be YYYY-MM-DD')
  if (!/^[A-Z]{3}$/.test(String(input.currency))) throw new Error('currency must be a three-letter uppercase code')

  const basis = acquisition - residual
  const base = Math.floor(basis / input.usefulLifeMonths)
  const remainder = basis - base * input.usefulLifeMonths
  let accumulated = 0
  const schedule = Array.from({ length: input.usefulLifeMonths }, (_, index) => {
    const depreciation = base + (index === input.usefulLifeMonths - 1 ? remainder : 0)
    accumulated += depreciation
    return {
      period: index + 1,
      periodStart: addUtcMonth(input.startDate, index),
      depreciation: money(depreciation),
      accumulatedDepreciation: money(accumulated),
      bookValue: money(acquisition - accumulated),
    }
  })

  return {
    calculationVersion: 'STRAIGHT_LINE_V1',
    method: 'STRAIGHT_LINE',
    currency: input.currency,
    acquisitionAmount: money(acquisition),
    residualValue: money(residual),
    depreciableBasis: money(basis),
    monthlyDepreciation: money(base),
    schedule,
    finalBookValue: money(acquisition - accumulated),
    accountingAuthority: false,
  }
}
