import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-094, FR-095, FR-096, FR-097, FR-098 — the production migration preserves
// the canonical IAM schema and keeps identity tables out of the exposed Data API.
// @spec ADR-045 D1-D6, SDD-052, BR-020, SEC-018
// @tested tests/unit/canonical-iam-migration.test.js

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260822195424_canonical_iam_phase0.sql',
)

function migrationSql() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8')
}

describe('canonical IAM Supabase migration', () => {
  it('adds the revocable membership lifecycle without rewriting existing identity rows', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/begin;[\s\S]*alter table "Membership"[\s\S]*add column if not exists "status" text not null default 'ACTIVE'/i)
    expect(sql).toMatch(/add column if not exists "updatedAt" timestamp\(3\) not null default current_timestamp/i)
    expect(sql).toMatch(/add column if not exists "version" integer not null default 1/i)
    expect(sql).toMatch(/Membership_personId_status_idx/i)
    expect(sql).toMatch(/Membership_tenantId_status_idx/i)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
  })

  it('creates persisted sessions with hashed-token uniqueness and revocation fields', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/create table if not exists "Session"/i)
    expect(sql).toMatch(/"tokenHash" text not null/i)
    expect(sql).toMatch(/"status" text not null default 'ACTIVE'/i)
    expect(sql).toMatch(/"revokedAt" timestamp\(3\)/i)
    expect(sql).toMatch(/"revokeReason" text/i)
    expect(sql).toMatch(/Session_tokenHash_key/i)
    expect(sql).toMatch(/foreign key \("personId"\) references "Person" \("id"\)/i)
  })

  it('creates tenant-scoped channel identity lifecycle and namespace uniqueness', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/create table if not exists "ChannelIdentity"/i)
    for (const field of ['tenantId', 'channel', 'channelAccountId', 'providerSubject', 'status', 'verifiedAt', 'linkedAt', 'revokedAt']) {
      expect(sql).toMatch(new RegExp(`"${field}"`, 'i'))
    }
    expect(sql).toMatch(/default 'PENDING'/i)
    expect(sql).toMatch(/ChannelIdentity_tenantId_channel_channelAccountId_providerS_key/i)
    expect(sql).toMatch(/on "ChannelIdentity" \("tenantId", "channel", "channelAccountId", "providerSubject"\)/i)
    expect(sql).toMatch(/foreign key \("tenantId"\) references "Tenant" \("id"\)/i)
  })

  it('forces RLS and does not grant Data API or service-role table access', () => {
    const sql = migrationSql()

    for (const table of ['Membership', 'Session', 'ChannelIdentity']) {
      expect(sql).toMatch(new RegExp(`alter table "${table}" enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table "${table}" force row level security`, 'i'))
    }
    expect(sql).toMatch(/revoke all on table "Membership", "Session", "ChannelIdentity"[\s\S]*from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/insert\s+into\s+supabase_migrations\.schema_migrations/i)
    expect(sql).not.toMatch(/(?:service_role_key|reply_token|message_body|raw_secret|secret_value)/i)
  })
})
