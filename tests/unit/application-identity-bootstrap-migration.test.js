import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-076, FR-078 — project verified customer scope and a separate review
// capability into the application RBAC database.
// @spec ADR-033 D8, CDC-SG-CUSTOMER-DATA-001 v0.3.0B.

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260818084047_application_smartgift_identity.sql'),
  'utf8',
)

describe('application identity bootstrap migration', () => {
  it('preserves the canonical customer scope and approver identity', () => {
    expect(migration).toContain('5c621811-7e7a-42dd-ac39-ea9e8416ba98')
    expect(migration).toContain('77cdbe70-3111-4a04-922a-8059be99a8b0')
    expect(migration).toContain('834fa869-62f3-431c-a287-e9a95e91175b')
    expect(migration).toContain('c82690eb-84e8-48a8-8a28-fe3d839c2276')
    expect(migration).toContain("'PER-BOSS'")
    expect(migration).toContain("'MEMBER'")
  })

  it('grants only the Business-scoped customer review role', () => {
    expect(migration).toContain("'CUSTOMER_DATA_REVIEWER'")
    expect(migration).toContain("'BUSINESS'")
    expect(migration).not.toContain("'PRODUCT_OWNER'")
    expect(migration).not.toMatch(/"role"\s*,\s*'OWNER'/i)
    expect(migration).toContain('MIS-SG-CUSTOMER-DATA-BACKFILL-001')
    expect(migration).toContain('ROLE_BINDING_ASSIGNED')
  })
})
