import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = fs.readFileSync(
  'scripts/verify-smartgift-customer-profile-target.mjs',
  'utf8',
)

// @req FR-078 — target verification must prove both the empty pre-apply boundary and the applied batch.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
// @tested tests/unit/customer-profile-target-verification.test.js

describe('FR-078 target verification', () => {
  it('supports an explicit post-apply batch verification mode', () => {
    expect(script).toMatch(/--post-apply/)
    expect(script).toMatch(/READ_ONLY_TARGET_POST_APPLY_VERIFICATION/)
    expect(script).toMatch(/applied batch is missing/)
    expect(script).toMatch(/applied customer row count mismatch/)
  })

  it('keeps the pre-apply empty-target assertions', () => {
    expect(script).toMatch(/customer rows were written before approval/)
    expect(script).toMatch(/import ledger rows were written before approval/)
    expect(script).toMatch(/customerRowsWritten: postApplyBatchId \? appliedCounts\.customer_rows : 0/)
  })
})
