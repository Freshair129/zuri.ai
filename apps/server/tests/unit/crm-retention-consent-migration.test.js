// @req FR-022 — the retention-consent and legal-hold re-seal key tables also
//   upgrade SQLite installations (ADR-093 1.2.0).
// @spec ADR-093 1.2.0
// @tested tests/unit/crm-retention-consent-migration.test.js
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
const SQLITE = 'prisma/migrations/20260927230000_crm_retention_consent_and_hold_key/migration.sql'
const SUPABASE = 'supabase/migrations/20260927230000_crm_retention_consent_and_hold_key.sql'

it('adds consent history with real parents and a unique per-hold key row', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Customer" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Person" ("id" TEXT PRIMARY KEY);
      INSERT INTO "Tenant" VALUES ('tenant');
      INSERT INTO "Customer" VALUES ('customer');
      INSERT INTO "Person" VALUES ('rep');`)
    db.exec(readFileSync(resolve(process.cwd(), SQLITE), 'utf8'))
    const consent = db.prepare('INSERT INTO "CustomerRetentionConsent" ("id","tenantId","customerId","businessId","recordedByPersonId") VALUES (?,?,?,?,?)')
    consent.run('rc', 'tenant', 'customer', 'business', 'rep')
    expect(db.prepare('SELECT "revokedAt" FROM "CustomerRetentionConsent"').get().revokedAt).toBeNull()
    expect(() => consent.run('foreign', 'wrong-tenant', 'customer', 'business', 'rep')).toThrow(/FOREIGN KEY/)
    expect(() => db.exec('DELETE FROM "Person" WHERE "id" = \'rep\'')).toThrow(/FOREIGN KEY/)
    const key = db.prepare('INSERT INTO "LegalHoldArchiveKey" ("id","tenantId","legalHoldId","heldCustomerId","kekId","wrappedDek") VALUES (?,?,?,?,?,?)')
    key.run('k1', 'tenant', 'hold', 'customer', 'v1', 'a.b.c')
    expect(() => key.run('k2', 'tenant', 'hold', 'customer', 'v1', 'a.b.c')).toThrow(/UNIQUE/)
    db.exec('DELETE FROM "Customer" WHERE "id" = \'customer\'')
    expect(db.prepare('SELECT count(*) AS n FROM "CustomerRetentionConsent"').get().n).toBe(0)
  } finally { db.close() }
})

it('the Supabase migration is additive, private to the runtime roles and not applied by itself', () => {
  const sql = readFileSync(resolve(process.cwd(), SUPABASE), 'utf8')
  for (const table of ['CustomerRetentionConsent', 'LegalHoldArchiveKey']) {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`)
    expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
    expect(sql).toContain(`REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role`)
  }
  expect(sql).not.toMatch(/DROP\s+TABLE/i)
})
