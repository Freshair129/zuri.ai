import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20260818071000_platform_approver_profile.sql',
  'utf8',
)

// @req FR-078 — the named approver profile exists before customer writes.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
// @tested tests/unit/platform-approver-profile-migration.test.js

describe('FR-078 platform approver profile migration', () => {
  it('creates only the global PER-BOSS profile and no organization membership', () => {
    expect(migration).toMatch(/insert into zuri_core\.person\s*\(id, code, display_name, email\)/i)
    expect(migration).toMatch(/c82690eb-84e8-48a8-8a28-fe3d839c2276/i)
    expect(migration).toMatch(/'PER-BOSS'/i)
    expect(migration).toMatch(/'Boss \(บอส\)'/i)
    expect(migration).not.toMatch(/insert into zuri_core\.(membership|role_binding)\b/i)
  })

  it('records the platform-owner audit boundary without raw PII', () => {
    expect(migration).toMatch(/PLATFORM_APPROVER_PROFILE_CREATED/i)
    expect(migration).toMatch(/organizationMembershipCreated', false/i)
    expect(migration).toMatch(/rawPiiStored', false/i)
    expect(migration).toMatch(/insert into supabase_migrations\.schema_migrations/i)
  })
})
