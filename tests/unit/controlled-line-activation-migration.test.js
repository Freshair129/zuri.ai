import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-055 — controlled activation has a dedicated least-privilege database boundary.
// @spec NFR-013, SDD-028, SEC-012 — exact-scope CAS support and append-only redacted receipts.
// @tested tests/unit/controlled-line-activation-migration.test.js

const RESERVED = Object.freeze({
  supabaseProjectRef: 'qcnmhyglarzcpudjorzc',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
  bindingCode: 'LINE-SMARTGIFT-OA',
})

function activationMigration() {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(dir)
    .filter((name) => name.endsWith('_controlled_line_activation.sql'))
  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(dir, matches[0]), 'utf8')
}

describe('controlled LINE activation migration (FR-055)', () => {
  it('creates separated operator privilege and login roles without privileged attributes', () => {
    const sql = activationMigration()

    expect(sql).toMatch(/create role zuri_line_activation_operator\s+noinherit\s+nobypassrls\s+nologin/i)
    expect(sql).toMatch(/create role zuri_line_activation_login\s+login\s+noinherit\s+nobypassrls/i)
    expect(sql).toMatch(/grant zuri_line_activation_operator to zuri_line_activation_login/i)
    expect(sql).toMatch(/ACTIVATION_ROLE_SECURITY_MISMATCH/i)
    expect(sql).not.toMatch(/(?:password|service_role_key|authorization\s+bearer)/i)
  })

  it('limits binding reads and column updates to the exact reserved SmartGift binding', () => {
    const sql = activationMigration()

    expect(sql).toMatch(/create policy line_smartgift_activation_binding_select[\s\S]*for select[\s\S]*to zuri_line_activation_operator/i)
    expect(sql).toMatch(/create policy line_smartgift_activation_binding_update[\s\S]*for update[\s\S]*to zuri_line_activation_operator[\s\S]*using\s*\([\s\S]*with check\s*\(/i)
    for (const value of [RESERVED.tenantId, RESERVED.businessId, RESERVED.bindingId, RESERVED.bindingCode]) {
      expect(sql.match(new RegExp(value, 'gi'))?.length ?? 0).toBeGreaterThanOrEqual(2)
    }
    expect(sql).toMatch(/provider\s*=\s*'LINE'/i)
    expect(sql).toMatch(/grant update\s*\(\s*external_channel_id_hash\s*,\s*credential_hash\s*,\s*status\s*,\s*valid_from\s*,\s*expires_at\s*,\s*updated_at\s*,\s*version\s*\)\s*on zuri_core\.line_channel_binding\s*to zuri_line_activation_operator/i)
    expect(sql).not.toMatch(/grant\s+(?:all|update)\s+on zuri_core\.line_channel_binding\s+to zuri_line_activation_operator/i)
  })

  it('adds a forced-RLS append-only event with exact ancestry and idempotent correlations', () => {
    const sql = activationMigration()

    expect(sql).toMatch(/create table if not exists zuri_core\.line_activation_event/i)
    expect(sql).toMatch(/foreign key\s*\(tenant_id,\s*business_id,\s*binding_id\)\s*references zuri_core\.line_channel_binding\s*\(tenant_id,\s*business_id,\s*id\)/i)
    expect(sql).toContain(RESERVED.supabaseProjectRef)
    expect(sql).toMatch(/correlation_id text not null[\s\S]{0,180}\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$/i)
    expect(sql).toMatch(/event_type[\s\S]{0,180}'ACTIVATION'[\s\S]{0,180}'ROLLBACK'[\s\S]{0,180}'CANARY_TRANSPORT'/i)
    expect(sql).toMatch(/receipt_state text not null constraint line_activation_event_receipt_state_value_check check/i)
    expect(sql).toMatch(/constraint line_activation_event_semantics_check check[\s\S]*ACTIVATION[\s\S]*ROLLBACK[\s\S]*EVIDENCE_VERIFIED[\s\S]*CANARY_TRANSPORT[\s\S]*GENERATED[\s\S]*ACCEPTED_BY_LINE[\s\S]*DISPLAYED_UNKNOWN[\s\S]*READ_UNKNOWN/i)
    expect(sql).toMatch(/create unique index[\s\S]*on zuri_core\.line_activation_event\s*\(correlation_id\)[\s\S]*where event_type in \('ACTIVATION', 'ROLLBACK'\)/i)
    expect(sql).toMatch(/unique\s*\(correlation_id,\s*event_type,\s*receipt_state\)/i)
    expect(sql).toMatch(/constraint line_activation_event_transport_check check[\s\S]*GENERATED[\s\S]*line_acceptance_class is null[\s\S]*ACCEPTED_BY_LINE[\s\S]*DISPLAYED_UNKNOWN[\s\S]*READ_UNKNOWN[\s\S]*transport_artifact_sha256 is not null[\s\S]*line_acceptance_class = 'HTTP_2XX'/i)
    for (const field of ['canary_plan_sha256', 'golden_report_sha256', 'isolation_report_sha256', 'transport_artifact_sha256', 'actor_fingerprint']) {
      expect(sql).toMatch(new RegExp(`${field}\\s+text[\\s\\S]{0,120}\\^\\[0-9a-f\\]\\{64\\}\\$`, 'i'))
    }
    for (const field of ['provider_id', 'model_id', 'approval_ref']) {
      expect(sql).toMatch(new RegExp(`${field}\\s+text not null check \\(char_length\\(${field}\\) between 1 and 200\\)`, 'i'))
    }
    expect(sql).toMatch(/alter table zuri_core\.line_activation_event enable row level security/i)
    expect(sql).toMatch(/alter table zuri_core\.line_activation_event force row level security/i)
    expect(sql).toMatch(/grant insert, select on zuri_core\.line_activation_event to zuri_line_activation_operator/i)
    expect(sql).not.toMatch(/grant\s+(?:all|update|delete)[\s\S]{0,100}line_activation_event\s+to zuri_line_activation_operator/i)
  })

  it('keeps activation private and excludes raw secret or customer payload columns', () => {
    const sql = activationMigration()

    expect(sql).toMatch(/revoke all on zuri_core\.line_activation_event from public, anon, authenticated, service_role, zuri_app_runtime, zuri_line_smartgift_ro, zuri_line_smartgift_login/i)
    expect(sql).toMatch(/revoke update on zuri_core\.line_channel_binding from public, anon, authenticated, service_role, zuri_app_runtime, zuri_line_smartgift_ro, zuri_line_smartgift_login/i)
    expect(sql).not.toMatch(/security definer/i)
    expect(sql).not.toMatch(/\b(?:raw_secret|destination|reply_token|authorization_header|message_body|customer_data|pii)\b/i)
    expect(sql).not.toMatch(/create\s+(?:or replace\s+)?function/i)
    expect(sql).not.toMatch(/alter\s+table\s+zuri_core\.line_channel_binding[\s\S]{0,100}(?:drop|status[^;]*check)/i)
  })
})
