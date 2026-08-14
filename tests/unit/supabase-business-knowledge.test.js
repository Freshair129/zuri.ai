import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createSupabaseBusinessKnowledgeReader } from '@/modules/knowledge/supabase-business-knowledge'
import { PUBLIC_BUSINESS_KNOWLEDGE_FIELDS } from '@/modules/knowledge/business-contract'

// @req FR-047 — Supabase is a server-only adapter for the same curated read contract.
// @spec SDD-025, SEC-009
// @tested tests/unit/supabase-business-knowledge.test.js

const apiRecord = {
  knowledge_id: 'sg:sku:USB-001', business_id: 'smartgift', knowledge_type: 'PRODUCT',
  product_code: 'USB-001', name: 'แฟลชไดรฟ์ไม้', category: 'USB', description: null,
  unit: 'ชิ้น', sell_price: 120, currency: 'THB', moq: 100, colors: ['ไม้'],
  specification: { capacity: '32GB' }, source_ref: 'catalog:usb', source_sha256: 'a'.repeat(64),
  as_of: '2026-08-12T00:00:00.000Z', approved_at: '2026-08-14T00:00:00.000Z',
  is_active: true, sensitivity: 'PUBLIC', contract_version: '1.0.0',
}

describe('Supabase business-knowledge adapter (FR-047)', () => {
  it('uses a fixed select allowlist and server-owned business/public filters', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([apiRecord]), { status: 200 }))
    const reader = createSupabaseBusinessKnowledgeReader({
      supabaseUrl: 'https://example.supabase.co',
      secretKey: 'server-secret',
      fetchFn,
    })
    const packet = await reader.query({ businessId: 'smartgift', queryId: 'product_detail', params: { productCode: 'USB-001' }, limit: 1 })

    expect(packet.records).toHaveLength(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toContain(`select=${PUBLIC_BUSINESS_KNOWLEDGE_FIELDS.join('%2C')}`)
    expect(url).toContain('business_id=eq.smartgift')
    expect(url).toContain('sensitivity=eq.PUBLIC')
    expect(url).toContain('is_active=eq.true')
    expect(init.headers.apikey).toBe('server-secret')
    expect(JSON.stringify(packet)).not.toContain('server-secret')
  })

  it('rejects unsupported queries before any network call', async () => {
    const fetchFn = vi.fn()
    const reader = createSupabaseBusinessKnowledgeReader({ supabaseUrl: 'https://example.supabase.co', secretKey: 'x', fetchFn })
    await expect(reader.query({ businessId: 'smartgift', queryId: 'raw_sql', params: { sql: 'select * from customer' } })).rejects.toThrow(/registered query/i)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('has a migration that enables RLS and exposes no public role', () => {
    const migrations = fs.readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
      .filter((name) => name.endsWith('_business_knowledge.sql'))
    expect(migrations).toHaveLength(1)
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', migrations[0]), 'utf8')
    expect(sql).toMatch(/enable row level security/i)
    expect(sql).toMatch(/revoke all .* anon/i)
    expect(sql).toMatch(/revoke all .* authenticated/i)
    expect(sql).toMatch(/grant select .* service_role/i)
    expect(sql).not.toMatch(/pgvector|vector\s*\(/i)
    expect(sql).not.toMatch(/customer_email|buy_price|margin_pct|invoice/i)
  })
})
