import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-103 — the SEC-005 consent columns land safely on an existing, populated
// Customer table in both datastores. Static contract test only, matching
// sot-decision-migration.test.js — no Supabase CLI is available in this
// workspace to prove the Postgres side live.
// @spec SDD-053, BR-002
// @tested tests/unit/customer-consent-migration.test.js

const SQLITE_PATH = path.join(
  process.cwd(), 'prisma', 'migrations', '20260826080000_add_customer_consent', 'migration.sql',
)
const POSTGRES_PATH = path.join(process.cwd(), 'supabase', 'migrations', '20260826080000_customer_consent.sql')

const read = (p) => fs.readFileSync(p, 'utf8')

describe('FR-103 sqlite (db push) migration artifact', () => {
  it('adds every consent column additively, defaulted to PENDING', () => {
    const sql = read(SQLITE_PATH)
    expect(sql).toMatch(/ALTER TABLE "Customer" ADD COLUMN "consentStatus" TEXT NOT NULL DEFAULT 'PENDING'/)
    expect(sql).toMatch(/ALTER TABLE "Customer" ADD COLUMN "consentRecordedAt" DATETIME/)
    expect(sql).toMatch(/ALTER TABLE "Customer" ADD COLUMN "consentRecordedByPersonId" TEXT/)
    expect(sql).toMatch(/ALTER TABLE "Customer" ADD COLUMN "consentNote" TEXT/)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
  })

  it('backfills existing rows to GRANDFATHERED, never leaves them PENDING', () => {
    const sql = read(SQLITE_PATH)
    expect(sql).toMatch(/UPDATE "Customer" SET "consentStatus" = 'GRANDFATHERED' WHERE "consentStatus" = 'PENDING'/)
  })

  it('indexes consentStatus for the console list/filter path', () => {
    const sql = read(SQLITE_PATH)
    expect(sql).toMatch(/CREATE INDEX "Customer_consentStatus_idx" ON "Customer"\("consentStatus"\)/)
  })
})

describe('FR-103 Postgres/Supabase migration', () => {
  it('adds every consent column additively, idempotently, with the attester FK', () => {
    const sql = read(POSTGRES_PATH)
    expect(sql).toMatch(/alter table "Customer" add column if not exists "consentStatus" text not null default 'PENDING'/)
    expect(sql).toMatch(/alter table "Customer" add column if not exists "consentRecordedAt" timestamptz/)
    expect(sql).toMatch(/"consentRecordedByPersonId" text\s+references "Person"\("id"\) on delete set null/)
    expect(sql).toMatch(/alter table "Customer" add column if not exists "consentNote" text/)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
  })

  it('backfills existing rows to GRANDFATHERED, never leaves them PENDING', () => {
    const sql = read(POSTGRES_PATH)
    expect(sql).toMatch(/update "Customer" set "consentStatus" = 'GRANDFATHERED' where "consentStatus" = 'PENDING'/)
  })

  it('does not grant the Data API roles anything new — RLS on Customer is already the blanket policy', () => {
    const sql = read(POSTGRES_PATH)
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)/i)
    expect(sql).not.toMatch(/create policy/i)
  })
})
