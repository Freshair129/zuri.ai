// Test-only pricing rule set. Every number, name and provenance entry below is
// INVENTED so tests can exercise the engine; none of it is a real tenant's
// policy. Production code ships no default rules: a Business owner supplies
// them. Shared by the SCM service tests and the apps/server pricing tests
// (which import it by relative path, as they do pricing-parity.js).
const warehouses = ['guangzhou_shenzhen', 'yiwu']
const modes = ['truck', 'sea']
const goods = ['general', 'electronic_tisi']
const tiers = ['ELITE', 'GOLD', 'SILVER', 'MEMBER']

function rates() {
  const out = {}
  warehouses.forEach((w, wi) => {
    out[w] = {}
    modes.forEach((m, mi) => {
      out[w][m] = {}
      goods.forEach((g, gi) => {
        out[w][m][g] = {}
        tiers.forEach((t, ti) => {
          out[w][m][g][t] = { cbm: String(1000 + 100 * wi + 200 * mi + 50 * gi + 10 * ti), kg: String(5 + wi + 2 * mi + gi + ti) }
        })
      })
    })
  })
  return out
}

const RULES = {
  schemaVersion: 'pricing-rules.v1',
  version: 'fixture-v1',
  provenance: {
    sourcePath: 'fixtures/pricing-rules-fixture.js',
    sourceSha256: 'a'.repeat(64),
    sourceVersion: 'fixture-v1',
    sourceContext: { business: 'Fixture Business', note: 'synthetic test data' },
    sources: { fixture: { level: 'undocumented', note: 'invented values for tests' } },
    importNotes: ['Synthetic fixture: every number is invented.'],
  },
  fx: { cnyToThb: '2', usdToThb: '10' },
  logistics: {
    densityThreshold: '100', minCbm: '0.01', seaThresholdCbm: '2', peakMonths: [11, 12], forceTruckInPeak: true,
    inlandCnyPerUnit: '1', domesticSingleDropThb: '1000', rates: rates(),
  },
  rounding: { priceStepThb: '5' },
  quantityFloors: [{ maxQty: 20, thb: '1000' }, { maxQty: null, thb: '500' }],
  kindFloors: { set: [{ minQty: 100, thb: '5000' }], single: [{ minQty: 50, thb: '700' }] },
  smallOrderFactors: [{ maxQty: 20, factor: '1.5' }, { maxQty: 100, factor: '1.2' }, { maxQty: null, factor: '1' }],
  markupBands: [{ maxCostThb: '100', multiplier: '3' }, { maxCostThb: '300', multiplier: '2' }, { maxCostThb: null, multiplier: '1.5' }],
  profiles: {
    standard: {
      name: 'standard', basis: 'factory', anchorQty: 500, breaks: [10, 20, 50, 100, 300, 500, 1000],
      factors: ['1', '0.95', '0.9', '0.85', '0.8', '0.75', '0.7'], flatMarkup: null, referenceGoodsType: null,
      targetProfitThb: null, marginWarningBand: { minPercent: '10', maxPercent: '60' },
    },
    corporate: {
      name: 'corporate', basis: 'landed', anchorQty: 1000, breaks: [100, 300, 500, 1000],
      factors: ['0.9', '0.85', '0.8', '0.75'], flatMarkup: '1.5', referenceGoodsType: 'electronic_tisi',
      targetProfitThb: '3000', marginWarningBand: { minPercent: '20', maxPercent: '50' },
    },
  },
  logo: {
    flatThbPerPosition: '5', hotstampSetupUsd: '2', hotstampBaseQty: 100,
    hotstampTiers: [{ maxQty: 100, usd: '0' }, { maxQty: 500, usd: '0.1' }, { maxQty: null, usd: '0.05' }],
    hotstampTextUsd: '1', engraveTiers: [{ maxQty: 99, usd: '0.2' }, { maxQty: null, usd: '0.1' }],
    silkFlatUpToQty: 300, silkFlatUsd: '3', silkPerPieceUsd: '0.05', uvPerPieceUsd: null,
  },
  logoPositions: { piecesFromCodeLastDigit: true, extraPositions: 2, minPositions: 1 },
  leadTime: {
    artwork: { min: 1, max: 2 }, sample: { min: 3, max: 5 },
    production: [{ maxQty: 500, min: 5, max: 7 }, { maxQty: null, min: 10, max: 15 }],
    freight: { truck: { min: 5, max: 8 }, sea: { min: 20, max: 30 } },
  },
  formulas: [{ name: 'candidatePrice', expression: 'anchorPrice * factor / anchorFactor', unit: 'THB/unit' }],
}

/** A fresh, mutable copy of the invented rule set. */
export function fixtureRules() { return structuredClone(RULES) }
