// @req FR-NEW — static guarantees of 20260915000000_credential_vault_provider_kinds.sql
//   that CI checks on every run (the PostgreSQL suite that executes it needs a
//   disposable cluster): it is additive, never edits the LINE channel functions,
//   and the new functions raise only fixed codes and re-prove scope from rows.
// @spec ADR-089 §4.8 phase 7; SDD-097; SEC-030; ADR-057
// @tested tests/unit/integration/credential-vault-provider-kinds-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const DIR = path.join(process.cwd(), 'supabase', 'migrations')
const read = suffix => {
  const matches = fs.readdirSync(DIR).filter(name => name.endsWith(suffix))
  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(DIR, matches[0]), 'utf8')
}

const lineFunctions = read('_channel_secret_vault_functions.sql')
const providerFunctions = read('_credential_vault_provider_kinds.sql')
const bodyOf = name => {
  const start = providerFunctions.indexOf(`create or replace function zuri_core.${name}(`)
  expect(start).toBeGreaterThan(-1)
  return providerFunctions.slice(start, providerFunctions.indexOf('$function$;', start))
}

describe('the migration is a release artifact, not an apply, and runs in one transaction', () => {
  it('says it is not applied and runs in one transaction', () => {
    expect(providerFunctions).toMatch(/NOT APPLIED by the change that writes it/)
    expect(providerFunctions).toMatch(/^begin;$/im)
    expect(providerFunctions).toMatch(/^commit;$/im)
  })
})

describe('the LINE channel functions file is not modified by this migration', () => {
  it('the migration never redefines a channel_secret_* function', () => {
    for (const name of ['channel_secret_write', 'channel_secret_activate', 'channel_secret_revoke', 'channel_secret_resolve']) {
      expect(providerFunctions).not.toContain(`create or replace function zuri_core.${name}(`)
    }
  })

  it('the LINE functions file still contains the LINE-specific clauses unchanged (byte-identical enforcement)', () => {
    expect(lineFunctions).toContain('p."code" = \'LINE_OA\'')
    expect(lineFunctions).toContain('c."externalAccountId" = p_destination')
    expect(lineFunctions).not.toContain('provider_secret_write')
    expect(lineFunctions).not.toContain('provider_secret_resolve')
  })
})

describe('the new functions', () => {
  const names = ['provider_secret_write', 'provider_secret_resolve']

  it('are all SECURITY DEFINER with search_path pinned to pg_catalog, pg_temp', () => {
    for (const name of names) {
      const body = bodyOf(name)
      expect(body).toMatch(/security definer/)
      expect(body).toMatch(/set search_path = pg_catalog, pg_temp/)
    }
  })

  it('raise only fixed codes, never a formatted message that could quote a parameter', () => {
    const raises = [...providerFunctions.matchAll(/raise exception '([^']*)'(.*);/g)]
    expect(raises.length).toBeGreaterThan(3)
    for (const [, message, rest] of raises) {
      expect(message).toMatch(/^[A-Z_]+(: [a-z0-9 ._,]+)?$/)
      expect(rest.trim()).toBe('')
    }
  })

  it('refuse LINE_CHANNEL and anything else in write, and never return a LINE_CHANNEL row from resolve', () => {
    const write = bodyOf('provider_secret_write')
    expect(write).toContain("if p_kind not in ('OAUTH_CLIENT', 'MODEL_PROVIDER_KEY') then")
    expect(write).toContain("raise exception 'CHANNEL_SECRET_KIND_UNSUPPORTED'")
    const resolve = bodyOf('provider_secret_resolve')
    expect(resolve).toContain("if p_kind not in ('OAUTH_CLIENT', 'MODEL_PROVIDER_KEY') then")
    expect(resolve).toContain('cr."secretKind" = p_kind')
  })

  it('re-prove the connection scope from rows in write, and never invent a destination or provider-code check in resolve', () => {
    const write = bodyOf('provider_secret_write')
    expect(write).toContain('c."tenantId" = p_tenant_id')
    expect(write).toContain('c."businessId" = p_business_id')
    expect(write).toContain("raise exception 'CHANNEL_SECRET_SCOPE_MISMATCH'")
    const resolve = bodyOf('provider_secret_resolve')
    expect(resolve).toContain('c."tenantId" = p_tenant_id')
    expect(resolve).toContain('c."businessId" = p_business_id')
    expect(resolve).not.toContain('externalAccountId')
    expect(resolve).not.toContain("p.\"code\"")
  })

  it('grant execute to the two existing vault roles only, and touch no other role', () => {
    const grants = [...providerFunctions.matchAll(/^grant execute on function zuri_core\.(\w+)\([^)]*\)\s+to (\w+);$/gm)].map(m => [m[1], m[2]])
    expect(grants).toEqual([
      ['provider_secret_write', 'zuri_channel_vault_writer'],
      ['provider_secret_resolve', 'zuri_channel_vault_reader'],
    ])
    expect(providerFunctions).not.toMatch(/create role/i)
    expect(providerFunctions).not.toMatch(/grant [^;]* on (schema|table|all tables in schema) vault/i)
  })

  it('reuse the LINE channel purge helper rather than duplicating it', () => {
    expect(bodyOf('provider_secret_write')).toContain('zuri_core.channel_secret_purge_version')
    expect(providerFunctions).not.toContain('create or replace function zuri_core.channel_secret_purge_version')
  })
})
