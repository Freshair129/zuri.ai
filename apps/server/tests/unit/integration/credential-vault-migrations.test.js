// @req FR-223 — static guarantees of design migrations 1, 3 and 4 that CI checks on
//   every run (the PostgreSQL suite that executes them needs a disposable cluster).
// @spec ADR-089 D1, D5; SDD-097; SEC-030; ADR-057
// @tested tests/unit/integration/credential-vault-migrations.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const read = suffix => {
  const matches = fs.readdirSync(DIR).filter(name => name.endsWith(suffix))
  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(DIR, matches[0]), 'utf8')
}

const lifecycle = read('_integration_credential_lifecycle.sql')
const functions = read('_channel_secret_vault_functions.sql')
const envelope = read('_integration_secret_envelope.sql')
const bodyOf = name => {
  const start = functions.indexOf(`create or replace function zuri_core.${name}(`)
  expect(start).toBeGreaterThan(-1)
  return functions.slice(start, functions.indexOf('$function$;', start))
}

describe('every migration is a release artifact, not an apply', () => {
  it('says it is not applied and runs in one transaction', () => {
    for (const sql of [lifecycle, functions, envelope]) {
      expect(sql).toMatch(/NOT APPLIED by the change that writes it/)
      expect(sql).toMatch(/^begin;$/im)
      expect(sql).toMatch(/^commit;$/im)
    }
  })
})

describe('migrations 1 and 4 — private tables and additive columns', () => {
  it('only add, never drop or rewrite a reference or status', () => {
    for (const sql of [lifecycle, envelope]) {
      expect(sql).not.toMatch(/\bdrop\s+(table|column)\b/i)
      expect(sql).not.toMatch(/set\s+"secretRef"/i)
      expect(sql).not.toMatch(/set\s+"status"/i)
    }
    for (const column of ['secretStore', 'secretKind', 'displayHint', 'lastValidatedAt', 'lastValidationCode', 'revokedAt', 'revokeReason']) {
      expect(lifecycle).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`)
    }
  })

  it('give each new table forced RLS, the runtime policy, and no Data API role', () => {
    for (const [sql, table] of [[lifecycle, 'IntegrationCredentialVersion'], [envelope, 'IntegrationSecretEnvelope']]) {
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(sql).toContain(`CREATE POLICY zuri_app_runtime_all ON "${table}"`)
      expect(sql).toContain(`REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role`)
    }
  })

  it('declares no column that could hold material', () => {
    const columns = sql => [...sql.matchAll(/^\s+"(\w+)" [A-Z]/gm)].map(m => m[1])
    for (const name of [...columns(lifecycle), ...columns(envelope)]) {
      expect(name).not.toMatch(/^(secret|channelSecret|accessToken|token|material|plaintext|bundle|fingerprint)$/i)
    }
  })
})

describe('migration 3 — the Vault functions', () => {
  const names = ['channel_secret_purge_version', 'channel_secret_write', 'channel_secret_activate', 'channel_secret_revoke', 'channel_secret_resolve']

  it('are all SECURITY DEFINER with search_path pinned to pg_catalog, pg_temp', () => {
    for (const name of names) {
      const body = bodyOf(name)
      expect(body).toMatch(/security definer/)
      expect(body).toMatch(/set search_path = pg_catalog, pg_temp/)
    }
  })

  it('raise only fixed codes, never a formatted message that could quote a parameter', () => {
    const raises = [...functions.matchAll(/raise exception '([^']*)'(.*);/g)]
    expect(raises.length).toBeGreaterThan(5)
    for (const [, message, rest] of raises) {
      expect(message).toMatch(/^[A-Z_]+(: [a-z0-9 ._,]+)?$/)
      expect(rest.trim()).toBe('')
    }
  })

  it('re-prove the connection scope from rows in every writer, and the destination in resolve', () => {
    for (const name of ['channel_secret_write', 'channel_secret_activate', 'channel_secret_revoke']) {
      const body = bodyOf(name)
      expect(body).toContain('c."tenantId" = p_tenant_id')
      expect(body).toContain('c."businessId" = p_business_id')
      expect(body).toContain("raise exception 'CHANNEL_SECRET_SCOPE_MISMATCH'")
    }
    const resolve = bodyOf('channel_secret_resolve')
    for (const clause of ['c."externalAccountId" = p_destination', 'p."code" = \'LINE_OA\'', 'd.name like \'zuri:%:\' || p_connection_id', "interval '5 minutes'"]) {
      expect(resolve).toContain(clause)
    }
  })

  it('grant execute to the two vault roles only, enter them without inheritance, and leave the Phase-1 resolver alone', () => {
    const grants = [...functions.matchAll(/^grant execute on function zuri_core\.(\w+)\([^)]*\)\s+to (\w+);$/gm)].map(m => [m[1], m[2]])
    expect(grants).toEqual([
      ['channel_secret_write', 'zuri_channel_vault_writer'],
      ['channel_secret_activate', 'zuri_channel_vault_writer'],
      ['channel_secret_revoke', 'zuri_channel_vault_writer'],
      ['channel_secret_resolve', 'zuri_channel_vault_reader'],
    ])
    expect(functions).toContain('with inherit false, set true')
    expect(functions).toMatch(/create role zuri_channel_vault_writer noinherit nobypassrls nologin/)
    expect(functions).not.toMatch(/grant [^;]* on (schema|table|all tables in schema) vault/i)
    const statements = functions.split('\n').filter(line => !line.trim().startsWith('--'))
    expect(statements.filter(line => line.includes('resolve_phase1_line_secret'))).toEqual([])
  })
})
