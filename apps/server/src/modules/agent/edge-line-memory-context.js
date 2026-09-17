import { assembleAgentContext } from './context'
import { createHash } from 'node:crypto'
import { resolveAgentAuthorization } from './auth-context'
import { createPhase1BusinessAgentPortsFromEnv } from './phase1-runtime'
import { memoryRoute, memoryServerScope, assertMemoryContextRoute, assertMemoryJobLive, mspPacketSlices } from './server-line-answer'

// @req FR-232, FR-234 — ephemeral, consent-gated MemoryOS context for a claimed
// Edge turn. MSP remains the memory authority; this module persists no packet.
// @spec ADR-091 D7, SDD-100, SEC-018
// @tested tests/unit/edge-line-memory-context.test.js
const fail = code => { throw Object.assign(new Error(code), { code }) }

export function createEdgeLineMemoryContext({ env = process.env, threadMemory,
  runtimeFactory = createPhase1BusinessAgentPortsFromEnv,
  contextAssembler = assembleAgentContext, authorizationResolver = resolveAgentAuthorization } = {}) {
  return async (job, { memoryStateReader, budgetMs = 3000, onContextResolved } = {}) => {
    if (job.memorySyncOptIn !== true) return null
    if (typeof memoryStateReader !== 'function') fail('LINE_MEMORY_STATE_READER_REQUIRED')
    if (!Number.isFinite(budgetMs) || budgetMs < 1 || budgetMs > 5000) fail('LINE_MEMORY_BUDGET_INVALID')
    const deadline = Math.min(Date.now() + budgetMs, Date.parse(job.answerDeadlineAt ?? job.replyExpiresAt))
    if (!Number.isFinite(deadline)) fail('LINE_MEMORY_DEADLINE_REQUIRED')
    const within = async operation => {
      if (Date.now() >= deadline) fail('LINE_MEMORY_DEADLINE_EXCEEDED')
      let timer
      try {
        return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('LINE_MEMORY_DEADLINE_EXCEEDED'),
            { code: 'LINE_MEMORY_DEADLINE_EXCEEDED' })), Math.max(1, deadline - Date.now()))
        })])
      } finally { clearTimeout(timer) }
    }
    const check = async () => {
      if (Date.now() >= deadline) fail('LINE_MEMORY_DEADLINE_EXCEEDED')
      await within(() => assertMemoryJobLive(job, memoryStateReader))
      if (Date.now() >= deadline) fail('LINE_MEMORY_DEADLINE_EXCEEDED')
    }
    await check()
    const route = memoryRoute(job)
    // Private memory is never exported to group/room or unresolved identity.
    if (route.audienceKind !== 'DIRECT') return null
    const ports = threadMemory ? null : await within(() => runtimeFactory({ ...env, ZURI_MSP_THREAD_MEMORY_ENABLED: 'true',
      ZURI_MSP_TIMEOUT_MS: String(Math.min(750, budgetMs)) }, { bindingRequired: false }))
    const port = threadMemory ?? ports?.threadMemory
    if (!port) fail('LINE_MEMORY_NOT_CONFIGURED')
    const serverScope = memoryServerScope(job, route)
    const input = { tenantId: job.tenantId, businessId: job.businessId, lineUserId: job.sourceUserId,
      threadId: route.externalRoomRef, eventId: job.eventId, serverScope, threadMemory: port,
      threadRoute: route, knowledge: async () => ({ found: false, relations: [] }) }
    const first = await within(() => contextAssembler({ ...input, deferThreadRecall: true }))
    assertMemoryContextRoute(first, route)
    await check()
    if (!first.identity?.verified || first.authContext?.policy?.privateMemoryAllowed !== true) return null
    const appended = await within(() => port.appendMessage({ threadId: first.thread.threadId,
      speakerId: first.identity.principalId, personId: first.identity.principalId,
      speakerKind: 'HUMAN', identityAssurance: 'VERIFIED', direction: 'INBOUND',
      text: job.inbound.body, messageId: job.inbound.id, sourceEventId: `${route.channelAccountId}:${job.eventId}`,
      authorization: { authContext: first.authContext }, requesterId: first.identity.principalId }))
    if (!appended?.message?.exchangeId) fail('LINE_MEMORY_APPEND_UNAVAILABLE')
    await check()
    const context = await within(() => contextAssembler({ ...input, deferThreadRecall: false, currentExchangeId: appended.message.exchangeId }))
    assertMemoryContextRoute(context, route, { requirePacket: true })
    await check()
    const current = await within(() => authorizationResolver({ ...input, serverScope }))
    if (current.authContext?.scope?.tenantId !== job.tenantId || current.authContext?.scope?.businessId !== job.businessId
      || current.authContext?.actor?.principalId !== first.identity.principalId
      || current.authContext?.policy?.privateMemoryAllowed !== true || current.authContext.policy.mspAuthorization?.read !== true
      || context.threadMemory?.policyDecision !== 'ALLOW') fail('LINE_MEMORY_POLICY_REVOKED')
    await check()
    const slices = []
    const closedSequences = new Set()
    for (const slice of mspPacketSlices(context.threadMemory)) {
      if (slices.length >= 24) break
      if (slice.sequence && closedSequences.has(slice.sequence)) continue
      const candidate = { ...slice, text: typeof slice.text === 'string' ? slice.text : JSON.stringify(slice.text) }
      if (Buffer.byteLength(JSON.stringify([...slices, candidate]), 'utf8') > 6000) {
        if (slice.sequence) closedSequences.add(slice.sequence)
        continue
      }
      slices.push(candidate)
    }
    const contextHash = createHash('sha256').update(JSON.stringify({ threadId: context.thread.threadId, slices })).digest('hex')
    // Server-only continuation; never serialize authorization or this port to Edge.
    onContextResolved?.({ port, threadId: context.thread.threadId, exchangeId: appended.message.exchangeId,
      authorization: current, requesterId: first.identity.principalId, slices })
    return { schemaVersion: 'line-memory-context.v1', threadId: context.thread.threadId, audienceKind: 'DIRECT', contextHash,
      expiresAt: new Date(Math.min(Date.now() + 30000, Date.parse(job.answerDeadlineAt ?? job.replyExpiresAt))).toISOString(), slices }
  }
}
