import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { assertLineRuntimeDatabaseUrl, createPostgresBusinessKnowledgeReader } from '@/modules/knowledge/postgres-business-knowledge'

// @req FR-051 — tenant-bound knowledge uses a parameterized private-schema query.
// @spec SDD-026, SEC-010
// @tested tests/unit/postgres-business-knowledge.test.js

const row = {
  knowledge_id: 'sg:sku:USB-001', tenant_id: 'tenant-1', business_id: 'business-1', knowledge_type: 'PRODUCT',
  product_code: 'USB-001', name: 'USB', category: null, description: null, unit: null,
  sell_price: null, currency: null, moq: null, colors: [], specification: {}, source_ref: 'catalog:usb',
  source_sha256: 'a'.repeat(64), as_of: new Date('2026-08-12T00:00:00Z'),
  approved_at: new Date('2026-08-14T00:00:00Z'), is_active: true, sensitivity: 'PUBLIC', contract_version: '1.0.0',
}

describe('Postgres business knowledge (FR-051)', () => {
  it('uses fixed zuri_core SQL and server-bound Tenant/Business parameters', async () => {
    const queryFn = vi.fn(async () => ({ rows: [row] }))
    const reader = createPostgresBusinessKnowledgeReader({ tenantId: 'tenant-1', businessId: 'business-1', queryFn })
    const packet = await reader.query({ businessId: 'business-1', queryId: 'product_detail', params: { productCode: 'USB-001' }, limit: 1 })
    expect(packet.records).toHaveLength(1)
    const [sql, params] = queryFn.mock.calls[0]
    expect(sql).toMatch(/from zuri_core\.business_knowledge/i)
    expect(sql).not.toMatch(/\bpublic\./i)
    expect(sql).toContain('$1')
    expect(params.slice(0, 2)).toEqual(['tenant-1', 'business-1'])
  })

  it('rejects caller scope mismatch before querying', async () => {
    const queryFn = vi.fn()
    const reader = createPostgresBusinessKnowledgeReader({ tenantId: 'tenant-1', businessId: 'business-1', queryFn })
    await expect(reader.query({ businessId: 'business-2', queryId: 'product_detail', params: { productCode: 'USB-001' } })).rejects.toThrow(/scope/i)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('accepts only a scope-bound read role on a Postgres URL', () => {
    expect(assertLineRuntimeDatabaseUrl('postgresql://zuri_line_smartgift_ro:x@db/zuri')).toContain('zuri_line_smartgift_ro')
    expect(() => assertLineRuntimeDatabaseUrl('https://zuri_line_smartgift_ro:x@db/zuri')).toThrow(/invalid/i)
    expect(() => assertLineRuntimeDatabaseUrl('postgresql://zuri_migrator:x@db/zuri')).toThrow(/role/i)
  })

  it('has a private tenant-aware migration with no broad read grant', () => {
    const migrations = fs.readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
      .filter((name) => name.endsWith('_business_knowledge.sql'))
    expect(migrations).toHaveLength(1)
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', migrations[0]), 'utf8')
    expect(sql).toMatch(/create schema if not exists zuri_core/i)
    expect(sql).toMatch(/zuri_core\.business_knowledge/i)
    expect(sql).toMatch(/tenant_id text not null/i)
    expect(sql).toMatch(/foreign key \(tenant_id, business_id\)/i)
    expect(sql).toMatch(/enable row level security/i)
    expect(sql).toMatch(/force row level security/i)
    expect(sql).toMatch(/revoke all .* anon/i)
    expect(sql).toMatch(/revoke all .* authenticated/i)
    expect(sql).toMatch(/revoke all .* service_role/i)
    expect(sql).not.toMatch(/grant select .* service_role/i)
    expect(sql).not.toMatch(/public\.business_knowledge/i)
    expect(sql).not.toMatch(/pgvector|vector\s*\(/i)
    expect(sql).not.toMatch(/customer_email|buy_price|margin_pct|invoice/i)
  })
})
