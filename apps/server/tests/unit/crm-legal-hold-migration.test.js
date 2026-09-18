// @req FR-245 — the CRM legal-hold peer schema also upgrades SQLite installations.
// @spec ADR-093; docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/unit/crm-legal-hold-migration.test.js
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')

it('adds hold evidence without losing parents and enforces recording-person retention', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Customer" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "Person" ("id" TEXT PRIMARY KEY);
      INSERT INTO "Tenant" VALUES ('tenant');
      INSERT INTO "Customer" VALUES ('customer');
      INSERT INTO "Person" VALUES ('reviewer');`)
    db.exec(readFileSync(resolve(process.cwd(), 'prisma/migrations/20260916160000_crm_customer_legal_hold/migration.sql'), 'utf8'))
    const insert = db.prepare('INSERT INTO "CustomerLegalHold" ("id","tenantId","customerId","reason","endDate","recordedByPersonId") VALUES (?,?,?,?,?,?)')
    insert.run('hold', 'tenant', 'customer', 'CASE-TEST', '2027-01-01 00:00:00', 'reviewer')
    expect(db.prepare('SELECT count(*) AS n FROM "Customer"').get().n).toBe(1)
    expect(db.prepare('SELECT "createdAt" FROM "CustomerLegalHold"').get().createdAt).toBeTruthy()
    expect(() => insert.run('foreign', 'wrong-tenant', 'customer', 'CASE-TEST', '2027-01-01', 'reviewer')).toThrow(/FOREIGN KEY/)
    expect(() => db.exec('DELETE FROM "Person" WHERE "id" = \'reviewer\'')).toThrow(/FOREIGN KEY/)
    db.exec('DELETE FROM "Customer" WHERE "id" = \'customer\'')
    expect(db.prepare('SELECT count(*) AS n FROM "CustomerLegalHold"').get().n).toBe(0)
    expect(db.prepare('SELECT count(*) AS n FROM "Person"').get().n).toBe(1)
  } finally { db.close() }
})
