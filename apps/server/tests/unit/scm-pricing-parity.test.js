// @req FR-253 — the legacy Commerce evaluator is the recorder of the SCM pricing
//   parity golden: every pinned case in services/scm/contracts/v1 must produce
//   exactly the recorded output (numbers, warnings, errors) from this engine,
//   and services/scm/test/unit/pricing-parity.test.js holds the SCM kernel to
//   the same file. WRITE_SCM_PRICING_GOLDEN=1 re-records it from this engine.
// @spec ADR-098
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as engine from '../../src/modules/commerce/domain/pricing-engine'
import { evaluateCase } from '../../../../services/scm/test/support/pricing-parity.js'

const contracts = join(__dirname, '..', '..', '..', '..', 'services', 'scm', 'contracts', 'v1')
const { cases } = JSON.parse(readFileSync(join(contracts, 'pricing-parity-cases.json'), 'utf8'))
const goldenPath = join(contracts, 'pricing-parity-golden.json')

describe('SCM pricing parity golden (legacy recorder)', () => {
  const outputs = Object.fromEntries(cases.map((c) => [c.id, evaluateCase(engine, c)]))

  if (process.env.WRITE_SCM_PRICING_GOLDEN === '1') {
    writeFileSync(goldenPath, `${JSON.stringify({ schema: 'scm.pricing-parity-golden.v1', evaluatorVersion: engine.EVALUATOR_VERSION, outputs }, null, 2)}\n`)
  }
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'))

  it('covers both successes and refusals', () => {
    expect(cases.length).toBeGreaterThanOrEqual(50)
    expect(Object.values(outputs).some((o) => o.ok)).toBe(true)
    expect(Object.values(outputs).some((o) => !o.ok)).toBe(true)
    expect(Object.keys(golden.outputs).sort()).toEqual(cases.map((c) => c.id).sort())
  })
  it.each(cases.map((c) => [c.id, c]))('%s matches the recorded output', (id) => {
    expect(outputs[id]).toEqual(golden.outputs[id])
  })
})
