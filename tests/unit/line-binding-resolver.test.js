import { describe, expect, it, vi } from 'vitest'
import { createPostgresLineBindingResolver, hashBindingSecret } from '@/modules/agent/line-binding-resolver'

// @req FR-052 — LINE scope resolves from an active server-owned binding.
// @spec SDD-026, SEC-010 — client tenant/business claims are never authority.
// @tested tests/unit/line-binding-resolver.test.js

const pepper = 'p'.repeat(32)
const credential = 'binding-token-with-at-least-thirty-two-characters'
const destination = 'Udestination-smartgift'

describe('LINE binding resolver (FR-052)', () => {
  it('hashes bearer and destination and returns only database-owned scope', async () => {
    const queryFn = vi.fn(async (_sql, values) => ({ rows: [{
      id: values[0], tenant_id: '77cdbe70-3111-4a04-922a-8059be99a8b0',
      business_id: '834fa869-62f3-431c-a287-e9a95e91175b', code: 'LINE-SMARTGIFT-OA',
    }] }))
    const resolver = createPostgresLineBindingResolver({ queryFn, pepper })
    const binding = await resolver.resolve({
      bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
      destination,
      authorization: `Bearer ${credential}`,
    })

    expect(binding).toEqual({
      id: '84ed2c90-ab44-46f3-9618-1f24df0744b9', code: 'LINE-SMARTGIFT-OA',
      channelAccountId: 'LINE-SMARTGIFT-OA',
      tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
      businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
    })
    const [sql, values] = queryFn.mock.calls[0]
    expect(sql).toMatch(/from zuri_core\.line_channel_binding/i)
    expect(values).toEqual([
      '84ed2c90-ab44-46f3-9618-1f24df0744b9',
      hashBindingSecret(pepper, credential),
      hashBindingSecret(pepper, destination),
    ])
    expect(JSON.stringify(queryFn.mock.calls)).not.toContain(credential)
    expect(JSON.stringify(queryFn.mock.calls)).not.toContain(destination)
  })

  it('fails before querying for missing or weak credentials', async () => {
    const queryFn = vi.fn()
    const resolver = createPostgresLineBindingResolver({ queryFn, pepper })
    await expect(resolver.resolve({ bindingId: 'x', destination, authorization: '' })).rejects.toThrow(/unauthorized/i)
    await expect(resolver.resolve({ bindingId: 'x', destination, authorization: 'Bearer short' })).rejects.toThrow(/unauthorized/i)
    expect(queryFn).not.toHaveBeenCalled()
  })

  it('fails closed when no active binding matches every hash', async () => {
    const resolver = createPostgresLineBindingResolver({ queryFn: async () => ({ rows: [] }), pepper })
    await expect(resolver.resolve({
      bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9', destination,
      authorization: `Bearer ${credential}`,
    })).rejects.toThrow(/unauthorized/i)
  })
})
