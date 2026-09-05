// @req FR-147 — the read-only binding status contract: scoped by Tenant,
//   Business and code taken from the caller's row; selects no hash column;
//   answers ACTIVE, NOT_ACTIVE, NO_BINDING or UNKNOWN and nothing finer.
// @spec FR-052, SEC-010, ADR-060 D3
// @tested tests/unit/line-binding-status.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  LINE_BINDING_STATUS,
  createLineBindingStatusReaderFromEnv,
  createPostgresLineBindingStatusReader,
  readLineBindingStatusLabel,
} from '@/modules/agent/line-binding-status'

const scope = { tenantId: 'tenant-1', businessId: 'business-1', code: 'oa-main-binding' }

describe('FR-147 LINE binding status reader', () => {
  it('reads by tenant, business and code, and selects state columns only', async () => {
    const queryFn = vi.fn(async () => ({ rows: [{
      code: 'oa-main-binding', status: 'ACTIVE', valid_from: '2026-09-01T00:00:00Z', expires_at: null, rotated_at: null, version: 3,
      // A driver could hand back extra columns; the contract must not forward them.
      credential_hash: 'deadbeef', external_channel_id_hash: 'cafebabe',
    }] }))
    const reader = createPostgresLineBindingStatusReader({ queryFn })
    const row = await reader.read(scope)

    expect(row).toEqual({ code: 'oa-main-binding', status: 'ACTIVE', validFrom: '2026-09-01T00:00:00Z', expiresAt: null, rotatedAt: null, version: 3 })
    expect(JSON.stringify(row)).not.toMatch(/hash|deadbeef|cafebabe/)
    const [sql, values] = queryFn.mock.calls[0]
    expect(sql).toMatch(/from zuri_core\.line_channel_binding/i)
    expect(sql).toMatch(/tenant_id = \$1/)
    expect(sql).toMatch(/business_id = \$2/)
    expect(sql).toMatch(/code = \$3/)
    expect(sql).not.toMatch(/credential_hash|external_channel_id_hash|update|insert|delete/i)
    expect(values).toEqual(['tenant-1', 'business-1', 'oa-main-binding'])
  })

  it('returns null when the read role sees no row, and refuses a malformed scope before querying', async () => {
    const queryFn = vi.fn(async () => ({ rows: [] }))
    const reader = createPostgresLineBindingStatusReader({ queryFn })
    expect(await reader.read(scope)).toBeNull()
    await expect(reader.read({ ...scope, tenantId: '' })).rejects.toThrow()
    await expect(reader.read({ ...scope, extra: 'x' })).rejects.toThrow()
    expect(queryFn).toHaveBeenCalledTimes(1)
    expect(() => createPostgresLineBindingStatusReader({})).toThrow(/QUERY_FUNCTION_REQUIRED/)
  })

  it('labels: NO_BINDING without a code, UNKNOWN without a reader, ACTIVE only for a visible ACTIVE row', async () => {
    expect(await readLineBindingStatusLabel(null, { ...scope, code: null })).toBe(LINE_BINDING_STATUS.NO_BINDING)
    expect(await readLineBindingStatusLabel(null, scope)).toBe(LINE_BINDING_STATUS.UNKNOWN)

    const active = createPostgresLineBindingStatusReader({ queryFn: async () => ({ rows: [{ code: scope.code, status: 'ACTIVE' }] }) })
    expect(await readLineBindingStatusLabel(active, scope)).toBe(LINE_BINDING_STATUS.ACTIVE)

    const none = createPostgresLineBindingStatusReader({ queryFn: async () => ({ rows: [] }) })
    expect(await readLineBindingStatusLabel(none, scope)).toBe(LINE_BINDING_STATUS.NOT_ACTIVE)

    // A wider future policy must not promote a non-active row through this label.
    const pending = createPostgresLineBindingStatusReader({ queryFn: async () => ({ rows: [{ code: scope.code, status: 'PENDING' }] }) })
    expect(await readLineBindingStatusLabel(pending, scope)).toBe(LINE_BINDING_STATUS.NOT_ACTIVE)
  })

  it('is absent unless the LINE runtime database is configured, and never builds a pool in tests', () => {
    expect(createLineBindingStatusReaderFromEnv({})).toBeNull()
    expect(createLineBindingStatusReaderFromEnv({ ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true' })).toBeNull()
    expect(createLineBindingStatusReaderFromEnv({ ZURI_LINE_DB_URL: 'postgresql://x' })).toBeNull()
    const injected = createLineBindingStatusReaderFromEnv({}, { queryFn: async () => ({ rows: [] }) })
    expect(typeof injected?.read).toBe('function')
  })
})
