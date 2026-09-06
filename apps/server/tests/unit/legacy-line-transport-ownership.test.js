import { describe, expect, it, vi } from 'vitest'
import { assertLegacyLineTransportOwnership, resolvedLineChannelAccountId } from '@/modules/agent/legacy-line-transport-ownership'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { createLineDeliveryPost } from '@/app/api/agent/line-delivery/route'

// @req FR-149 — ownership fences legacy webhook and receipt effects.
// @spec ADR-061, SEC-001

const { scope } = vi.hoisted(() => ({ scope: { tenantId: 'tenant-1', businessId: 'business-1', channelAccountId: 'binding-1' } }))
vi.mock('@/lib/db', () => ({ default: {} }))
vi.mock('@/modules/agent', () => ({
  createPhase1BusinessAgentPortsFromEnv: vi.fn(), handleAgentTurn: vi.fn(),
  resolvePhase1RequestScope: vi.fn(async () => scope),
}))
const quietLogger = { info() {}, warn() {}, error() {} }
const request = (body) => new Request('http://local/api/agent/line-webhook', { method: 'POST', body: JSON.stringify(body) })

describe('legacy LINE transport ownership fence', () => {
  it('checks authenticated scope and channel namespace or verified destination', async () => {
    const findFirst = vi.fn().mockResolvedValue(null)
    await assertLegacyLineTransportOwnership({ scope, destination: 'Ubot', db: { lineOaAccount: { findFirst } } })
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: scope.tenantId, businessId: scope.businessId, serverEnabled: true, OR: [{ id: 'binding-1' }, { bindingCode: 'binding-1' }, { connection: { externalAccountId: 'Ubot' } }] },
      select: { id: true },
    })
  })

  it('returns 401 to prevent old Edge from sending an error fallback', async () => {
    await expect(assertLegacyLineTransportOwnership({ scope, db: { lineOaAccount: { findFirst: async () => ({ id: 'account-1' }) } } })).rejects.toMatchObject({ message: 'LINE_SERVER_OWNS_TRANSPORT', status: 401 })
  })

  it('uses the same namespace for webhook and delivery, including legacy unbound', () => {
    expect(resolvedLineChannelAccountId(scope)).toBe('binding-1')
    expect(resolvedLineChannelAccountId({ code: 'code', id: 'uuid' })).toBe('code')
    expect(resolvedLineChannelAccountId({ id: 'uuid' })).toBe('uuid')
    expect(resolvedLineChannelAccountId({})).toBe('LEGACY:LINE')
  })

  it('rejects legacy webhook before evidence recording or answer generation', async () => {
    const turnHandler = vi.fn()
    const evidenceRecorderFactory = vi.fn()
    const ownershipGuard = vi.fn(async () => { throw Object.assign(new Error('LINE_SERVER_OWNS_TRANSPORT'), { status: 401 }) })
    const handler = createLineWebhookPost({ runtimeFactory: async () => ({}), ownershipGuard, turnHandler, evidenceRecorderFactory, logger: quietLogger })
    const response = await handler(request({ destination: 'Ubot', events: [{ type: 'message', source: { userId: 'Uuser' }, message: { type: 'text', id: 'M1', text: 'hello' } }] }))
    expect(response.status).toBe(401)
    expect(turnHandler).not.toHaveBeenCalled()
    expect(evidenceRecorderFactory).not.toHaveBeenCalled()
  })

  it('rejects legacy receipts before CRM writes', async () => {
    const recorder = vi.fn()
    const ownershipGuard = vi.fn(async () => { throw Object.assign(new Error('LINE_SERVER_OWNS_TRANSPORT'), { status: 401 }) })
    const handler = createLineDeliveryPost({ runtimeFactory: async () => ({}), ownershipGuard, recorder, logger: quietLogger })
    const response = await handler(request({ destination: 'Ubot', deliveries: [{ inboundMessageId: 'in-1', text: 'hello' }] }))
    expect(response.status).toBe(401)
    expect(recorder).not.toHaveBeenCalled()
  })

  it('passes both business and account scope to the receipt writer', async () => {
    const recorder = vi.fn().mockResolvedValue({ conversationId: 'conv-1', messageId: 'out-1', created: true })
    const handler = createLineDeliveryPost({ runtimeFactory: async () => ({}), ownershipGuard: async () => {}, recorder, logger: quietLogger })
    const response = await handler(request({ deliveries: [{ inboundMessageId: 'in-1', text: 'hello' }] }))
    expect(response.status).toBe(200)
    expect(recorder).toHaveBeenCalledWith(expect.objectContaining({ tenantId: scope.tenantId, businessId: scope.businessId, channelAccountId: scope.channelAccountId }))
  })
})
