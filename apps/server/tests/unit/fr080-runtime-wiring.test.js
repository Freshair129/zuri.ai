import { describe, expect, it, vi } from 'vitest'

import { createPhase1BusinessAgentPortsFromEnv } from '@/modules/agent/phase1-runtime'

// @req FR-080 — production Phase 1 composes Supabase Vault automatically from
// server-side resolver transport; no raw model credential is needed.
// @spec ADR-031 D1/D3, ADR-032 D2/D3, SDD-044, SEC-016
// @tested tests/unit/fr080-runtime-wiring.test.js

describe('FR-080 production runtime wiring', () => {
  it('creates the Supabase Vault manager automatically for PRODUCTION_LINE', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString()
    const connectionResolver = vi.fn(async () => ({
      tenantId: 'tenant-a', businessId: 'business-a', purpose: 'PHASE1_LINE_LLM',
      status: 'ACTIVE', role: 'PRIMARY', provider: { code: 'openai' },
      metadataJson: JSON.stringify({ model: 'gpt-test' }),
      credential: { secretRef: 'supabase-vault:123e4567-e89b-12d3-a456-426614174000' },
    }))
    const secretQueryFn = vi.fn(async () => ({ rows: [{
      secret_material: 'provider-secret', version: 'credential-v1', expires_at: expiresAt,
    }] }))

    const ports = createPhase1BusinessAgentPortsFromEnv({
      NODE_ENV: 'production',
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      ZURI_PHASE1_RUNTIME_SOURCE: 'PRODUCTION_LINE',
      ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
      ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
    }, {
      queryFn: vi.fn(),
      secretQueryFn,
      connectionResolver,
      fetchFn: vi.fn(),
    })

    const model = await ports.resolveModel({ tenantId: 'tenant-a', businessId: 'business-a' })

    expect(model).toMatchObject({ provider: 'openai', model: 'gpt-test' })
    expect(secretQueryFn).toHaveBeenCalledWith(expect.stringContaining('resolve_phase1_line_secret'), [
      'supabase-vault:123e4567-e89b-12d3-a456-426614174000', 'tenant-a', 'business-a',
    ])
  })

  it('does not reuse the read-only query injection for production secret resolution', () => {
    expect(() => createPhase1BusinessAgentPortsFromEnv({
      NODE_ENV: 'production',
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true',
      ZURI_PHASE1_RUNTIME_SOURCE: 'PRODUCTION_LINE',
      ZURI_LINE_DB_URL: 'postgresql://zuri_line_smartgift_login:password@db.qcnmhyglarzcpudjorzc.supabase.co:5432/postgres',
      ZURI_LINE_BINDING_HASH_PEPPER: 'p'.repeat(32),
    }, { queryFn: vi.fn() })).toThrow('SUPABASE_VAULT_QUERY_NOT_CONFIGURED')
  })
})
