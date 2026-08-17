import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  createSecretManagerPort,
  createSupabaseVaultSecretManagerAdapter,
} from '@/platform/integrations/core/secret-manager'

// @req FR-075 — Supabase Vault is the selected production secret backend and
// the application sees only opaque references and version/expiry metadata.
// @spec ADR-032 D2/D3, ADR-031 D3, SEC-016, SDD-044
// @tested tests/unit/fr075-supabase-vault.test.js

const secretRef = 'supabase-vault:123e4567-e89b-12d3-a456-426614174000'
const scope = { tenantId: 'tenant-a', businessId: 'business-a' }

describe('FR-075 Supabase Vault runtime adapter', () => {
  it('resolves through the private resolver and keeps material non-enumerable', async () => {
    const queryFn = vi.fn(async () => ({ rows: [{
      secret_material: 'provider-secret',
      version: 'credential-v3',
      expires_at: '2026-08-18T13:00:00.000Z',
    }] }))
    const adapter = createSupabaseVaultSecretManagerAdapter({ queryFn })
    const port = createSecretManagerPort({
      runtimeSource: 'PRODUCTION_LINE',
      adapter,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    })

    const result = await port.resolve(secretRef, scope)

    expect(result.material).toBe('provider-secret')
    expect(result.version).toBe('credential-v3')
    expect(JSON.stringify(result)).not.toContain('provider-secret')
    expect(queryFn).toHaveBeenCalledWith(expect.stringContaining('resolve_phase1_line_secret'), [
      secretRef, scope.tenantId, scope.businessId,
    ])
  })

  it('rejects non-Vault references before touching the database', async () => {
    const queryFn = vi.fn()
    const port = createSecretManagerPort({
      runtimeSource: 'PRODUCTION_LINE',
      adapter: createSupabaseVaultSecretManagerAdapter({ queryFn }),
    })

    await expect(port.resolve('secret://legacy-ref', scope)).rejects.toMatchObject({ code: 'NotFound' })
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('fails closed for zero or multiple resolver rows', async () => {
    const queryFn = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ secret_material: 'one', version: 'v1', expires_at: '2026-08-18T13:00:00.000Z' }, { secret_material: 'two', version: 'v2', expires_at: '2026-08-18T13:00:00.000Z' }] })
    const port = createSecretManagerPort({
      runtimeSource: 'PRODUCTION_LINE',
      adapter: createSupabaseVaultSecretManagerAdapter({ queryFn }),
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    })

    await expect(port.resolve(secretRef, scope)).rejects.toMatchObject({ code: 'NotFound' })
    port.clear()
    await expect(port.resolve(secretRef, scope)).rejects.toMatchObject({ code: 'Ambiguous' })
  })

  it('never reuses a scoped secret cache entry for another Business', async () => {
    const queryFn = vi.fn(async (_sql, values) => ({ rows: [{
      secret_material: values[2] === 'business-a' ? 'secret-a' : 'secret-b',
      version: 'credential-v1',
      expires_at: '2026-08-18T13:00:00.000Z',
    }] }))
    const port = createSecretManagerPort({
      runtimeSource: 'PRODUCTION_LINE',
      adapter: createSupabaseVaultSecretManagerAdapter({ queryFn }),
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    })

    await expect(port.resolve(secretRef, { tenantId: 'tenant-a', businessId: 'business-a' })).resolves.toMatchObject({ version: 'credential-v1' })
    await expect(port.resolve(secretRef, { tenantId: 'tenant-a', businessId: 'business-b' })).resolves.toMatchObject({ version: 'credential-v1' })
    expect(queryFn).toHaveBeenCalledTimes(2)
  })
})

describe('FR-075 Supabase Vault migration contract', () => {
  const sql = () => readFileSync('supabase/migrations/20260818050000_phase1_line_supabase_vault_resolver.sql', 'utf8')

  it('keeps Vault plaintext behind a security-definer resolver role', () => {
    const migration = sql()
    expect(migration).toMatch(/create role zuri_line_runtime\s+noinherit\s+nobypassrls\s+nologin/i)
    expect(migration).toMatch(/grant zuri_line_runtime to zuri_line_smartgift_login/i)
    expect(migration).toMatch(/security definer/i)
    expect(migration).toMatch(/has_table_privilege\(current_user, 'vault\.decrypted_secrets', 'select'\)/i)
    expect(migration).toMatch(/vault\.decrypted_secrets/i)
    expect(migration).toMatch(/v\.decrypted_secret/i)
    expect(migration).toMatch(/revoke all on function zuri_core\.resolve_phase1_line_secret/i)
    expect(migration).toMatch(/grant execute on function zuri_core\.resolve_phase1_line_secret/i)
    expect(migration).toMatch(/to zuri_line_runtime/i)
  })

  it('does not grant app, Data API or read-only LINE roles direct Vault view access', () => {
    const migration = sql()
    expect(migration).not.toMatch(/grant\s+select[\s\S]{0,160}vault\.decrypted_secrets/i)
    expect(migration).not.toMatch(/to\s+(?:public|anon|authenticated|service_role|zuri_line_smartgift_ro)\s*;/i)
  })
})
