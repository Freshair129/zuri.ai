// @req FR-226 — static guarantees of design migration 2: live-only uniqueness, a
//   backfill that hashes the destination and never stores it, and the private-table
//   block. The PostgreSQL suite executes it.
// @spec ADR-089 D6; BR-002; ADR-057
// @tested tests/unit/integration/channel-account-claim-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const [file] = fs.readdirSync(dir).filter(name => name.endsWith('_channel_account_claim.sql'))
const sql = fs.readFileSync(path.join(dir, file), 'utf8')

describe('migration 2 — ChannelAccountClaim', () => {
  it('is one transaction, additive, and says it is not applied', () => {
    expect(sql).toMatch(/NOT APPLIED by the change that writes it/)
    expect(sql).toMatch(/^BEGIN;$/m)
    expect(sql).toMatch(/^COMMIT;$/m)
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
    expect(sql).not.toMatch(/UPDATE\s+"IntegrationConnection"/i)
  })

  it('holds a bot unique only among live claims', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "ChannelAccountClaim_provider_externalAccountHash_key"\s+ON "ChannelAccountClaim"\("provider", "externalAccountHash"\)\s+WHERE "releasedAt" IS NULL;/)
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ChannelAccountClaim_connectionId_key"')
  })

  it('backfills by sha256 of the destination, one claim per destination, without a raw id column', () => {
    expect(sql).toContain("encode(sha256(convert_to(c.\"externalAccountId\", 'UTF8')), 'hex')")
    expect(sql).toContain('SELECT DISTINCT ON (candidate."hash")')
    expect(sql).toContain('ON CONFLICT DO NOTHING')
    const tableDdl = sql.slice(sql.indexOf('CREATE TABLE'), sql.indexOf(');', sql.indexOf('CREATE TABLE')))
    expect(tableDdl).not.toMatch(/externalAccountId|destination/)
    expect(sql).toContain('RAISE NOTICE \'CHANNEL_ACCOUNT_CLAIM_BACKFILL')
  })

  it('is a private table', () => {
    expect(sql).toContain('ALTER TABLE "ChannelAccountClaim" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('CREATE POLICY zuri_app_runtime_all ON "ChannelAccountClaim"')
    expect(sql).toContain('REVOKE ALL ON TABLE "ChannelAccountClaim" FROM public, anon, authenticated, service_role')
  })
})
