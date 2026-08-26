import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// @req FR-071 — SmartGift document intake has one deterministic active primary
// receiver and remains a server-owned, no-secret staging connection.
// @spec docs/domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md,
// SEC-001, SEC-008
// @tested tests/unit/smartgift-document-intake-migration.test.js

const migration = readFileSync(
  'supabase/migrations/20260820212547_smartgift_document_intake_connection.sql',
  'utf8',
)
const migrationFiles = readdirSync('supabase/migrations')
  .filter((file) => file.endsWith('.sql'))
  .map((file) => join('supabase/migrations', file))

describe('FR-071 SmartGift document intake bootstrap migration', () => {
  it('provisions the provider and active primary connection for the approved Business', () => {
    expect(migration).toContain('SMARTGIFT_DOCUMENT_INTAKE')
    expect(migration).toContain('DATA_DOCUMENT_INGESTION')
    expect(migration).toContain('smartgift.document-intake.v1')
    expect(migration).toContain("'834fa869-62f3-431c-a287-e9a95e91175b'")
    expect(migration).toContain("'77cdbe70-3111-4a04-922a-8059be99a8b0'")
    expect(migration).toContain('"IntegrationConnection_document_intake_active_primary_key"')
    expect(migration).toContain("'DOCUMENT_INTAKE_CONNECTION_PROVISIONED'")
  })

  it('does not create a credential or expose the application tables through Data API grants', () => {
    expect(migration).not.toMatch(/INSERT INTO\s+"IntegrationCredential"|secretRef|secret_ref|api[_-]?key|service[_-]?role/i)
    expect(migration).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*\b(?:anon|authenticated)\b/i)
    expect(migration).toContain('canonicalWrite":false')
  })

  it('is idempotent and fails closed on an identity/connection mismatch', () => {
    expect(migration).toMatch(/ON CONFLICT \("code"\) DO UPDATE/i)
    expect(migration).toMatch(/ON CONFLICT \("id"\) DO NOTHING/i)
    expect(migration).toContain('SMARTGIFT_DOCUMENT_INTAKE_BUSINESS_MISSING')
    expect(migration).toContain('SMARTGIFT_DOCUMENT_INTAKE_CONNECTION_MISMATCH')
  })

  it('leaves migration history to the Supabase CLI', () => {
    for (const file of migrationFiles) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/insert\s+into\s+supabase_migrations\.schema_migrations/i)
    }
  })
})
