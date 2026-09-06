import fs from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const schema = JSON.parse(fs.readFileSync('contracts/migrations/smartgift-customer-review-queue-contract.schema.json', 'utf8'))
const contract = JSON.parse(fs.readFileSync('contracts/migrations/smartgift-customer-review-queue-contract.json', 'utf8'))
const migration = fs.readFileSync('supabase/migrations/20260818073000_customer_import_review_queue.sql', 'utf8')

// @req FR-078 — the duplicate review extension is machine-valid, fixed to the
// approved SmartGift scope and remains a no-publish boundary.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033.
// @tested tests/unit/customer-import-review-contract.test.js

describe('FR-078 duplicate review queue contract', () => {
  it('validates the candidate extension without mutating v0.2.0B', () => {
    const ajv = new Ajv2020({ strict: true })
    addFormats(ajv)
    const validate = ajv.compile(schema)
    expect(validate(contract), JSON.stringify(validate.errors)).toBe(true)
    expect(contract.versionId).toBe('VER-SG-CUSTOMER-DATA-CONTRACT-0.3.0B')
    expect(contract.supersedesVersionId).toBe('VER-SG-CUSTOMER-DATA-CONTRACT-0.2.0B')
    expect(contract.status).toBe('CANDIDATE')
    expect(contract.scope.tenantId).toBe('77cdbe70-3111-4a04-922a-8059be99a8b0')
    expect(contract.scope.businessId).toBe('834fa869-62f3-431c-a287-e9a95e91175b')
  })

  it('defines stable IDs, append-only decisions and no raw PII browser boundary', () => {
    expect(contract.reviewQueue.expectedHeldRows).toBe(130)
    expect(contract.reviewQueue.expectedDuplicateGroups).toBe(65)
    expect(contract.reviewQueue.reviewItemId).toContain('customer_import_provenance.id')
    expect(contract.reviewQueue.decisionLedger.appendOnly).toBe(true)
    expect(contract.reviewQueue.privacyBoundary.rawPiiStored).toBe(false)
    expect(contract.reviewQueue.applyBoundary.publishesCustomers).toBe(false)
    expect(contract.reviewQueue.applyBoundary.lineReplay).toBe(false)
  })

  it('creates forced-RLS review tables and grants no Data API path', () => {
    for (const table of ['customer_import_review_case', 'customer_import_review_decision']) {
      expect(migration).toMatch(new RegExp(`create table if not exists zuri_core\\.${table}\\b`, 'i'))
      expect(migration).toMatch(new RegExp(`alter table zuri_core\\.${table} enable row level security`, 'i'))
      expect(migration).toMatch(new RegExp(`alter table zuri_core\\.${table} force row level security`, 'i'))
    }
    expect(migration).toMatch(/add column if not exists review_case_id/i)
    expect(migration).toMatch(/customer_import_review_decision_version_uq/i)
    expect(migration).toMatch(/revoke all on table[\s\S]*from public, anon, authenticated, service_role/i)
    expect(migration).toMatch(/grant select on zuri_core\.[\s\S]*to zuri_app_runtime/i)
    expect(migration).not.toMatch(/grant[\s\S]*\b(?:anon|authenticated|service_role)\b/i)
  })

  it('does not make the migration publish or apply any held row', () => {
    expect(migration).not.toMatch(/insert into zuri_core\.(person|customer)\b/i)
    expect(migration).not.toMatch(/customerRowsWritten',\s*[1-9]/i)
    expect(migration).toMatch(/'heldRowsPublished',\s*0/i)
  })
})
