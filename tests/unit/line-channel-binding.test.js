import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { createConfiguredLineBindingResolver } from '@/modules/agent/line-channel-binding'

// @req FR-052 — production LINE scope is resolved from one active server-owned binding.
// @spec ADR-018, BR-012, SEC-010
// @tested tests/unit/line-channel-binding.test.js

const env = {
  ZURI_LINE_BINDING_ID: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
  ZURI_LINE_BINDING_DESTINATION_SHA256: crypto.createHash('sha256').update('U-smartgift-destination').digest('hex'),
  ZURI_LINE_BINDING_TENANT_ID: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  ZURI_LINE_BINDING_BUSINESS_ID: '834fa869-62f3-431c-a287-e9a95e91175b',
  ZURI_LINE_BINDING_STATUS: 'ACTIVE',
}

describe('LineChannelBindingResolver (FR-052)', () => {
  it('returns immutable Tenant and Business scope for the configured destination', async () => {
    const resolver = createConfiguredLineBindingResolver(env)
    await expect(resolver.resolve({
      bindingId: env.ZURI_LINE_BINDING_ID,
      destination: 'U-smartgift-destination',
    })).resolves.toEqual({
      bindingId: env.ZURI_LINE_BINDING_ID,
      tenantId: env.ZURI_LINE_BINDING_TENANT_ID,
      businessId: env.ZURI_LINE_BINDING_BUSINESS_ID,
    })
  })

  it('fails closed for unknown, inactive or destination-mismatched bindings', async () => {
    const resolver = createConfiguredLineBindingResolver(env)
    await expect(resolver.resolve({ bindingId: 'other', destination: 'U-smartgift-destination' })).rejects.toThrow(/binding/i)
    await expect(resolver.resolve({ bindingId: env.ZURI_LINE_BINDING_ID, destination: 'wrong' })).rejects.toThrow(/binding/i)
    await expect(createConfiguredLineBindingResolver({ ...env, ZURI_LINE_BINDING_STATUS: 'INACTIVE' })
      .resolve({ bindingId: env.ZURI_LINE_BINDING_ID, destination: 'U-smartgift-destination' }))
      .rejects.toThrow(/binding/i)
  })
})
