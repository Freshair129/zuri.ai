// SCM kernel ↔ legacy golden: the service's generated copy of the Commerce
// evaluator must reproduce, byte for byte after JSON normalisation, every output
// the legacy engine recorded (apps/server/tests/unit/scm-pricing-parity.test.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as engine from '../../src/modules/commerce/pricing/index.js'
import { evaluateCase } from '../support/pricing-parity.js'

const contracts = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'contracts', 'v1')
const { cases } = JSON.parse(readFileSync(join(contracts, 'pricing-parity-cases.json'), 'utf8'))
const golden = JSON.parse(readFileSync(join(contracts, 'pricing-parity-golden.json'), 'utf8'))

test('golden covers every pinned case and the evaluator version', () => {
  assert.equal(golden.evaluatorVersion, engine.EVALUATOR_VERSION)
  assert.deepEqual(Object.keys(golden.outputs).sort(), cases.map((c) => c.id).sort())
  assert.ok(cases.length >= 50)
})

for (const testCase of cases) {
  test(`parity: ${testCase.id}`, () => {
    assert.deepEqual(evaluateCase(engine, testCase), golden.outputs[testCase.id])
  })
}
