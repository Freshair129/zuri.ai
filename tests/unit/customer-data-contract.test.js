import fs from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const schema = JSON.parse(
  fs.readFileSync('contracts/migrations/smartgift-customer-data-contract.schema.json', 'utf8'),
)
const contract = JSON.parse(
  fs.readFileSync('contracts/migrations/smartgift-customer-data-contract.json', 'utf8'),
)

// @req FR-078 — the SmartGift Customer Profile contract remains machine-valid
// while its write approvals and review gates are explicit.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
// @tested tests/unit/customer-data-contract.test.js

describe('FR-078 customer data contract', () => {
  it('validates the candidate contract and preserves the fixed scope', () => {
    const ajv = new Ajv2020({ strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    expect(validate(contract), JSON.stringify(validate.errors)).toBe(true)
    expect(contract.targetSchema.state).toBe('READY_FOR_IMPORT')
    expect(contract.gates.find((gate) => gate.id === 'CDC-G5').status).toBe('COMPLETE')
    expect(contract.gates.find((gate) => gate.id === 'CDC-G4').status).toBe('PENDING')
    expect(contract.scope.tenant.id).toBe('77cdbe70-3111-4a04-922a-8059be99a8b0')
    expect(contract.target.businessId).toBe('834fa869-62f3-431c-a287-e9a95e91175b')
  })

  it('does not authorize writes while required approvals are incomplete', () => {
    expect(contract.status).toBe('CANDIDATE')
    expect(contract.approvals.requiredApprovals.some((approval) => approval.status !== 'APPROVED')).toBe(true)
    expect(contract.scope.historicalWindow.status).toBe('REQUIRED_BEFORE_IMPORT')
  })
})
