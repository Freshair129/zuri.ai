import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20260818072000_customer_profile_contract_receipt.sql',
  'utf8',
)

// @req FR-078 — current contract version must have append-only target-schema evidence.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
// @tested tests/unit/customer-profile-contract-receipt.test.js

describe('FR-078 target-schema contract receipt', () => {
  it('records the 0.2.0B contract without changing customer rows', () => {
    expect(migration).toMatch(/TARGET_SCHEMA_CONTRACT_RECEIPT/i)
    expect(migration).toMatch(/VER-SG-CUSTOMER-DATA-CONTRACT-0\.2\.0B/i)
    expect(migration).toMatch(/customerRowsWritten', 0/i)
    expect(migration).toMatch(/raise exception 'customer rows already exist/i)
  })

  it('is append-only and registered in migration history', () => {
    expect(migration).toMatch(/on conflict \(code\) do nothing/i)
    expect(migration).toMatch(/insert into supabase_migrations\.schema_migrations/i)
    expect(migration).not.toMatch(/update zuri_core\.bootstrap_audit_event/i)
  })
})
