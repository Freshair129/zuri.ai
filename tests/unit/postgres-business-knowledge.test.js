import { describe, expect, it, vi } from 'vitest'
import { createPostgresBusinessKnowledgeReader } from '@/modules/knowledge/postgres-business-knowledge'

// @req FR-051 — production knowledge reads carry tenant and Business scope to Postgres.
// @spec SDD-026, SEC-010 — direct least-privilege role; no service-key Data API bypass.
// @tested tests/unit/postgres-business-knowledge.test.js

const row = {
  knowledge_id: 'sg:sku:USB-001', business_id: '834fa869-62f3-431c-a287-e9a95e91175b',
  knowledge_type: 'PRODUCT', product_code: 'USB-001', name: 'USB', category: null,
  description: null, unit: 'piece', sell_price: '120.00', currency: 'THB', moq: 100,
  colors: [], specification: {}, source_ref: 'catalog:usb', source_sha256: 'a'.repeat(64),
  as_of: new Date('2026-08-12T00:00:00Z'), approved_at: new Date('2026-08-14T00:00:00Z'),
  is_active: true, sensitivity: 'PUBLIC', contract_version: '1.0.0',
}

describe('Postgres business-knowledge reader (FR-051)', () => {
  it('uses a registered parameterized query with tenant-leading scope', async () => {
    const queryFn = vi.fn(async () => ({ rows: [row] }))
    const reader = createPostgresBusinessKnowledgeReader({ queryFn })
    const packet = await reader.query({
      tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
      businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
      queryId: 'product_detail', params: { productCode: 'USB-001' }, limit: 1,
    })

    expect(packet.records).toHaveLength(1)
    const [sql, values] = queryFn.mock.calls[0]
    expect(sql).toMatch(/from zuri_core\.business_knowledge/i)
    expect(sql).toMatch(/tenant_id\s*=\s*\$1[\s\S]*business_id\s*=\s*\$2/i)
    expect(sql).not.toContain('USB-001')
    expect(values.slice(0, 3)).toEqual([
      '77cdbe70-3111-4a04-922a-8059be99a8b0',
      '834fa869-62f3-431c-a287-e9a95e91175b',
      'USB-001',
    ])
  })

  it('rejects unsupported query shapes before touching Postgres', async () => {
    const queryFn = vi.fn()
    const reader = createPostgresBusinessKnowledgeReader({ queryFn })
    await expect(reader.query({
      tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
      businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
      queryId: 'raw_sql', params: { sql: 'select * from auth.users' },
    })).rejects.toThrow(/registered query/i)
    expect(queryFn).not.toHaveBeenCalled()
  })
})
