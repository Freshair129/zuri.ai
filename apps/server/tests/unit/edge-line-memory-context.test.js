import { describe, it, expect, vi } from 'vitest'
import { createEdgeLineMemoryContext } from '@/modules/agent/edge-line-memory-context'

// @req FR-232, FR-234
// @spec ADR-091 D7, SDD-100, SEC-018
// @tested this file
function fixture() {
  const account = { id: 'oa', tenantId: 't', businessId: 'b', serverEnabled: true, transportMode: 'CLOUD', status: 'CONNECTED', transportEpoch: 2 }
  const job = { id: 'job', tenantId: 't', businessId: 'b', channelAccountId: 'oa', sourceUserId: 'provider-user',
    eventId: 'event', audienceKind: 'DIRECT', status: 'CLAIMED', version: 3, transportEpoch: 2,
    memorySyncOptIn: true, answerDeadlineAt: new Date(Date.now() + 40000).toISOString(), account,
    inbound: { id: 'inbound', body: 'question', conversation: { channel: 'LINE', tenantId: 't', businessId: 'b', channelAccountId: 'oa', externalThreadId: 'provider-room' } } }
  const authContext = { actor: { principalId: 'person' }, scope: { tenantId: 't', businessId: 'b' },
    policy: { decision: 'ALLOW', privateMemoryAllowed: true, mspAuthorization: { read: true } } }
  const context = { authContext, identity: { principalId: 'person', verified: true },
    thread: { threadId: 'msp-thread', businessId: 'b', audienceKind: 'DIRECT' },
    threadMemory: { policyDecision: 'ALLOW', identity: { principalId: 'person' },
      thread: { threadId: 'msp-thread', businessId: 'b', audienceKind: 'DIRECT' },
      memory: { recentExchanges: [{ exchangeId: 'exchange', messages: [{ text: 'recall' }] }] } } }
  const threadMemory = { appendMessage: vi.fn(async () => ({ message: { exchangeId: 'exchange' } })) }
  const contextAssembler = vi.fn(async () => context)
  const authorizationResolver = vi.fn(async () => ({ authContext }))
  const memoryStateReader = vi.fn(async () => job)
  return { job, context, threadMemory, contextAssembler, authorizationResolver, memoryStateReader }
}
describe('Edge ephemeral authorized MSP context', () => {
  it('bounds a stalled context read and never starts an append after the deadline', async () => {
    const f = fixture()
    f.contextAssembler.mockImplementation(() => new Promise(() => {}))
    await expect(createEdgeLineMemoryContext(f)(f.job, { ...f, budgetMs: 20 })).rejects.toMatchObject({ code: 'LINE_MEMORY_DEADLINE_EXCEEDED' })
    expect(f.threadMemory.appendMessage).not.toHaveBeenCalled()
  })
  it('reads from MSP only with persisted optin and emits bounded opaque context', async () => {
    const f = fixture()
    const build = createEdgeLineMemoryContext(f)
    expect(await build({ ...f.job, memorySyncOptIn: false })).toBeNull()
    expect(f.contextAssembler).not.toHaveBeenCalled()
    const packet = await build(f.job, f)
    expect(packet).toMatchObject({ schemaVersion: 'line-memory-context.v1', threadId: 'msp-thread', audienceKind: 'DIRECT' })
    expect(packet.slices[0].text).toContain('recall')
    expect(JSON.stringify(packet)).not.toContain('provider-user')
    expect(JSON.stringify(packet)).not.toContain('provider-room')
    expect(f.threadMemory.appendMessage).toHaveBeenCalledWith(expect.objectContaining({ sourceEventId: 'oa:event', messageId: 'inbound' }))
  })
  it('fences erased/stale jobs and consent or person revocation before returning content', async () => {
    const f = fixture()
    const build = createEdgeLineMemoryContext(f)
    f.memoryStateReader.mockResolvedValueOnce({ ...f.job, errorCode: 'PDPA_ERASURE' })
    await expect(build(f.job, f)).rejects.toMatchObject({ code: 'LINE_MEMORY_JOB_FENCED' })
    f.authorizationResolver.mockResolvedValueOnce({ authContext: { ...f.context.authContext, actor: { principalId: 'relinked-person' } } })
    await expect(build(f.job, f)).rejects.toMatchObject({ code: 'LINE_MEMORY_POLICY_REVOKED' })
    f.authorizationResolver.mockResolvedValueOnce({ authContext: { ...f.context.authContext, policy: { privateMemoryAllowed: false } } })
    await expect(build(f.job, f)).rejects.toMatchObject({ code: 'LINE_MEMORY_POLICY_REVOKED' })
  })
  it('requires live state and deadline, withholds group memory, caps payload', async () => {
    const f = fixture()
    const build = createEdgeLineMemoryContext(f)
    await expect(build(f.job)).rejects.toMatchObject({ code: 'LINE_MEMORY_STATE_READER_REQUIRED' })
    await expect(build({ ...f.job, answerDeadlineAt: '2000-01-01T00:00:00Z' }, f)).rejects.toMatchObject({ code: 'LINE_MEMORY_DEADLINE_EXCEEDED' })
    expect(await build({ ...f.job, audienceKind: 'GROUP' }, f)).toBeNull()
    expect(f.threadMemory.appendMessage).not.toHaveBeenCalled()
    f.context.threadMemory.memory.recentExchanges = Array.from({ length: 60 }, (_, i) => ({ exchangeId: String(i), messages: [{ text: 'ก'.repeat(300) }] }))
    const packet = await build(f.job, f)
    expect(Buffer.byteLength(JSON.stringify(packet.slices))).toBeLessThanOrEqual(6000)
    expect(packet.slices.length).toBeLessThanOrEqual(24)
  })
})
