import { randomUUID, createHash, createHmac } from 'node:crypto'

// @req FR-025, FR-057, FR-097, FR-148 — resolve the MSP-owned thread and
// retrieve speaker-labelled session memory through an injected transport.
// @spec ADR-044, ADR-045, SDD-030, SEC-013, SEC-018 — LINE routing is supplied
// by the trusted integration seam; this adapter never resolves a provider id,
// grants access, or accepts a vault/thread choice from message text.
// @tested tests/integration/agent-msp-thread-memory.test.js

const DEFAULT_IDLE_TIMEOUT_MINUTES = 30
const DEFAULT_RECENT_EXCHANGES = 6
const THREAD_KINDS = new Set(['DIRECT', 'GROUP', 'ROOM'])
const SPEAKER_KINDS = new Set(['HUMAN', 'AGENT', 'OPERATOR', 'UNKNOWN'])
const ASSURANCE = new Set(['VERIFIED', 'PENDING', 'UNRESOLVED'])
const DIRECTIONS = new Set(['INBOUND', 'OUTBOUND'])

function resolveCaller(transport) {
  if (typeof transport === 'function') return (name, input) => transport(name, input)
  if (transport && typeof transport.call === 'function') return (name, input) => transport.call(name, input)
  if (transport && typeof transport.request === 'function') return (name, input) => transport.request(name, input)
  throw new Error('createMspThreadMemoryPort: transport must be callable or expose .call/.request')
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`MSP thread memory requires ${name}`)
  return value.trim()
}

function optional(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function bounded(value, ceiling, name) {
  const resolved = value === undefined || value === null ? ceiling : value
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > ceiling) {
    throw new Error(`MSP thread memory ${name} exceeds the deployment policy ceiling`)
  }
  return resolved
}

function enumValue(value, values, name) {
  const normalized = required(value, name).toUpperCase()
  if (!values.has(normalized)) throw new Error(`MSP thread memory ${name} is invalid`)
  return normalized
}

function unwrap(result) {
  return result?.structuredContent ?? result
}

function assertAllowed(authorization) {
  if (
    authorization?.authContext?.policy?.decision !== 'ALLOW' ||
    authorization.authContext.policy.privateMemoryAllowed !== true
  ) return false
  return true
}

function emptyPrivateContext(context) {
  return {
    ...context,
    participants: [],
    recentExchanges: [],
    protectedMemory: [],
    summaries: [],
    protectedRecords: [],
    threadSummaries: [],
    coverageGap: true,
  }
}

function injectionReceiptUnknown(cause) {
  const error = new Error('MSP_INJECTION_RECEIPT_UNKNOWN')
  error.code = 'MSP_INJECTION_RECEIPT_UNKNOWN'
  error.cause = cause
  return error
}

/**
 * Build the only shape handed to a model adapter. The manifest describes what
 * was selected and what was withheld; it is not an authorization input.
 */
export function buildThreadContextPacket({
  authorization,
  threadContext,
  identity,
  knowledge,
  recentExchangeCount = DEFAULT_RECENT_EXCHANGES,
  contextId = `context_${randomUUID()}`,
  injectionId = `injection_${randomUUID()}`,
  maxContextBytes = 24000,
} = {}) {
  if (!threadContext || typeof threadContext !== 'object') throw new Error('MSP thread memory context is required')
  const allowed = assertAllowed(authorization) && threadContext.thread?.audienceKind === 'DIRECT'
  const selected = allowed ? threadContext : emptyPrivateContext(threadContext)
  const recent = Array.isArray(selected.recentExchanges) ? selected.recentExchanges : []
  if (allowed && (!Array.isArray(selected.threadSummaries) || !Array.isArray(selected.protectedRecords))) {
    throw new Error('MSP_THREAD_CONTEXT_CONTRACT_MISMATCH')
  }
  const recentSequences = new Set(recent.flatMap((exchange) => exchange.messages ?? []).map((message) => message.sequence))
  const summaries = (selected.threadSummaries ?? []).filter((summary) => {
    if (Array.isArray(summary.coveredSequences)) return summary.coveredSequences.some((sequence) => !recentSequences.has(sequence))
    const from = summary.coveredFromSequence
    const through = summary.coveredThroughSequence
    if (!Number.isInteger(from) || !Number.isInteger(through) || through - from + 1 > recentSequences.size) return true
    for (let sequence = from; sequence <= through; sequence++) if (!recentSequences.has(sequence)) return true
    return false
  })
  const protectedMemory = selected.protectedRecords ?? []
  const participants = Array.isArray(selected.participants) ? selected.participants : []

  const packet = {
    contextId,
    injectionId,
    policyDecision: allowed ? 'ALLOW' : 'DENY',
    thread: {
      threadId: required(selected.thread?.threadId ?? selected.threadId, 'threadId'),
      sessionId: optional(selected.session?.sessionId ?? selected.sessionId),
      businessId: optional(selected.thread?.businessId ?? selected.businessId),
      audienceKind: optional(selected.thread?.audienceKind ?? selected.audienceKind),
    },
    identity: identity
      ? {
          principalId: optional(identity.principalId),
          principalType: optional(identity.principalType),
          verified: identity.verified === true,
        }
      : null,
    memory: {
      participants,
      recentExchanges: recent,
      summaries,
      protectedMemory,
    },
    knowledge: knowledge ?? null,
    manifest: {
      recentExchangeCount,
      effectiveRecentExchangeCount: recent.length,
      summaryCount: summaries.length,
      protectedRecordCount: protectedMemory.length,
      participantCount: participants.length,
      withheldPrivateMemory: !allowed,
      coverageGap: Boolean(selected.coverageGap),
      uncoveredRanges: selected.coverageGap ? [selected.coverageGap] : [],
      omittedRanges: [],
      budget: { maxContextBytes, estimator: 'utf8-bytes-upper-bound', truncated: false },
    },
  }
  if (!Number.isInteger(maxContextBytes) || maxContextBytes < 1) throw new Error('MSP_CONTEXT_BUDGET_INVALID')
  const size = () => Buffer.byteLength(JSON.stringify(packet), 'utf8')
  packet.memory.recentExchanges = [...recent]
  while (size() > maxContextBytes && packet.memory.summaries.length) {
    const removed = packet.memory.summaries.shift()
    packet.manifest.omittedRanges.push({ fromSequence: removed.coveredFromSequence, throughSequence: removed.coveredThroughSequence })
    packet.manifest.budget.truncated = packet.manifest.coverageGap = true
  }
  while (size() > maxContextBytes && packet.memory.recentExchanges.length > 1) {
    const removed = packet.memory.recentExchanges.shift()
    packet.manifest.omittedRanges.push({ exchangeId: removed.exchangeId })
    packet.manifest.budget.truncated = packet.manifest.coverageGap = true
  }
  packet.manifest.effectiveRecentExchangeCount = packet.memory.recentExchanges.length
  packet.manifest.summaryCount = packet.memory.summaries.length
  if (size() > maxContextBytes) throw new Error('MSP_CONTEXT_MANDATORY_BUDGET_EXCEEDED')
  return Object.freeze(packet)
}

export function createMspThreadMemoryPort({
  transport,
  actor = 'zuri-line-agent',
  idleTimeoutMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES,
  recentExchangeCount = DEFAULT_RECENT_EXCHANGES,
  serviceKey = null,
  maxContextBytes = 24000,
} = {}) {
  const rawCall = resolveCaller(transport)
  const routes = new Map()
  async function callTool(name, input, claims = {}) {
    // Remove undefined fields before hashing; JSON-RPC drops them on the wire.
    const payload = JSON.parse(JSON.stringify(input))
    if (!serviceKey) return rawCall(name, payload) // injected test transport only; server rejects unsigned requests
    if (serviceKey.length < 32) throw new Error('MSP_THREAD_SERVICE_KEY_REQUIRED')
    const grant = { ...claims, operation: name, expiresAt: Date.now() + 60_000,
      payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }
    return rawCall(name, { ...payload, access: { grant,
      signature: createHmac('sha256', serviceKey).update(JSON.stringify(grant)).digest('hex') } })
  }
  function claimsFor(threadId, authorization, principalId) {
    const route = routes.get(threadId) ?? {}
    const auth = authorization?.authContext
    if (serviceKey && assertAllowed(authorization) && (auth.scope?.tenantId !== route.tenantId ||
        (auth.scope?.businessId ?? null) !== route.businessId || (principalId && auth.actor?.principalId !== principalId))) {
      throw new Error('MSP_AUTHORIZATION_SCOPE_MISMATCH')
    }
    const direct = route.audienceKind === 'DIRECT' && assertAllowed(authorization)
    return { ...route, principalId: auth?.actor?.principalId ?? principalId ?? actor,
      policyRevision: auth?.policy?.version ?? authorization?.policy?.version ?? 'default',
      readPrivate: direct && auth?.policy?.mspAuthorization?.read === true,
      writePrivate: direct && auth?.policy?.mspAuthorization?.writePrivate === true }
  }
  const idleCeiling = bounded(idleTimeoutMinutes, Number.MAX_SAFE_INTEGER, 'idleTimeoutMinutes')
  const recentCeiling = bounded(recentExchangeCount, Number.MAX_SAFE_INTEGER, 'recentExchangeCount')

  async function resolveThread({
    threadKind,
    channelType,
    channelAccountId,
    externalRoomRef,
    tenantId,
    businessId = null,
    audienceKind = threadKind,
    now,
  } = {}) {
    const kind = enumValue(threadKind, THREAD_KINDS, 'threadKind')
    const audience = enumValue(audienceKind, THREAD_KINDS, 'audienceKind')
    const result = unwrap(await callTool('msp_thread_resolve', {
      actor: required(actor, 'actor'),
      thread_kind: kind,
      audience_kind: audience,
      channel_type: required(channelType, 'channelType'),
      channel_account_id: required(channelAccountId, 'channelAccountId'),
      external_room_ref: required(externalRoomRef, 'externalRoomRef'),
      tenant_id: required(tenantId, 'tenantId'),
      business_id: optional(businessId),
      now,
    }, { tenantId, businessId: optional(businessId), channelAccountId, externalRoomRef,
      audienceKind: audience, principalId: actor, policyRevision: 'route-v1' }))
    if (!result?.thread?.threadId) throw new Error('MSP thread resolver returned no thread')
    routes.set(result.thread.threadId, { tenantId, businessId: optional(businessId), channelAccountId, externalRoomRef, audienceKind: audience })
    return result
  }

  async function appendMessage({
    threadId,
    sessionId = null,
    exchangeId = null,
    messageId = null,
    sourceEventId = null,
    speakerId,
    speakerKind,
    personId = null,
    identityAssurance,
    direction,
    text,
    occurredAt,
    receivedAt,
    replyToMessageId = null,
    deliveryState,
    policyRevision = 'default',
    now,
    idleTimeoutMinutes: requestedIdleTimeout,
    authorization,
    requesterId,
  } = {}) {
    const kind = enumValue(speakerKind, SPEAKER_KINDS, 'speakerKind')
    const assurance = enumValue(identityAssurance, ASSURANCE, 'identityAssurance')
    const messageDirection = enumValue(direction, DIRECTIONS, 'direction')
    const result = unwrap(await callTool('msp_thread_message_append', {
      thread_id: required(threadId, 'threadId'),
      speaker_id: required(speakerId, 'speakerId'),
      speaker_kind: kind,
      identity_assurance: assurance,
      direction: messageDirection,
      text: required(text, 'text'),
      idle_timeout_minutes: bounded(requestedIdleTimeout, idleCeiling, 'idleTimeoutMinutes'),
      policy_revision: required(policyRevision, 'policyRevision'),
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(exchangeId ? { exchange_id: exchangeId } : {}),
      ...(messageId ? { message_id: messageId } : {}),
      ...(sourceEventId ? { source_event_id: sourceEventId } : {}),
      ...(personId ? { person_id: personId } : {}),
      ...(occurredAt ? { occurred_at: occurredAt } : {}),
      ...(receivedAt ? { received_at: receivedAt } : {}),
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      ...(deliveryState ? { delivery_state: deliveryState } : {}),
      ...(now ? { now } : {}),
    }, claimsFor(threadId, authorization, requesterId ?? speakerId)))
    if (!result?.message?.messageId || !result?.session?.sessionId) {
      throw new Error('MSP thread message append returned no message/session')
    }
    return result
  }

  async function appendInbound({ route, speaker, text, sourceEventId, messageId, now, ...message } = {}) {
    const resolved = await resolveThread(route)
    const appended = await appendMessage({
      threadId: resolved.thread.threadId,
      speakerId: speaker?.speakerId,
      speakerKind: speaker?.speakerKind ?? 'HUMAN',
      personId: speaker?.personId,
      identityAssurance: speaker?.identityAssurance ?? 'UNRESOLVED',
      direction: 'INBOUND',
      text,
      sourceEventId,
      messageId,
      now,
      ...message,
    })
    return { ...appended, thread: resolved.thread, created: resolved.created }
  }

  async function context({ threadId, recentExchangeCount: requestedRecent, currentExchangeId, authorization, requesterId, now } = {}) {
    const result = unwrap(await callTool('msp_thread_context', {
      thread_id: required(threadId, 'threadId'),
      recent_exchange_count: bounded(requestedRecent, recentCeiling, 'recentExchangeCount'),
      ...(currentExchangeId ? { current_exchange_id: currentExchangeId } : {}),
      ...(now ? { now } : {}),
    }, claimsFor(threadId, authorization, requesterId)))
    if (!result?.thread?.threadId) throw new Error('MSP thread context returned no thread')
    return result
  }

  async function recordProtectedMemory({
    threadId,
    sessionId,
    kind,
    assertedBySpeakerId,
    subjectPersonId,
    scope = {},
    body,
    sourceMessageRefs,
    supersedesRecordId,
    status,
    verificationState,
    now,
    authorization,
  } = {}) {
    const result = unwrap(await callTool('msp_thread_memory_record', {
      thread_id: required(threadId, 'threadId'),
      kind,
      asserted_by_speaker_id: required(assertedBySpeakerId, 'assertedBySpeakerId'),
      scope,
      body,
      source_message_refs: sourceMessageRefs,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(subjectPersonId ? { subject_person_id: subjectPersonId } : {}),
      ...(supersedesRecordId ? { supersedes_record_id: supersedesRecordId } : {}),
      ...(status ? { status } : {}),
      ...(verificationState ? { verification_state: verificationState } : {}),
      ...(now ? { now } : {}),
    }, claimsFor(threadId, authorization, assertedBySpeakerId)))
    if (!result?.recordId) throw new Error('MSP protected memory record returned no record')
    return result
  }

  function withInjectionReceipt({ model, contextPacket, threadId, exchangeId, authorization, requesterId }) {
    if (!contextPacket || contextPacket.policyDecision !== 'ALLOW') return model
    const packetHash = createHash('sha256').update(JSON.stringify(contextPacket)).digest('hex')
    const receipt = { thread_id: threadId, exchange_id: exchangeId, injection_id: contextPacket.injectionId,
      packet_hash: packetHash, policy_revision: authorization.authContext.policy.version ?? 'default',
      model_ref: `${model.provider ?? 'configured'}:${model.model ?? 'configured'}` }
    const record = (state) => callTool('msp_thread_injection_record', { ...receipt, state }, claimsFor(threadId, authorization, requesterId))
    const recordWithRetry = async (state) => {
      try {
        await record(state)
        return { ok: true }
      } catch (firstError) {
        // A single same-state replay is idempotent at API-010 and distinguishes a
        // lost response from a rejected write without turning receipt persistence
        // into a general retry loop.
        try {
          await record(state)
          return { ok: true }
        } catch (secondError) {
          return { ok: false, error: secondError ?? firstError }
        }
      }
    }
    return { ...model, async generate(input) {
      const resolved = await recordWithRetry('RESOLVED')
      if (!resolved.ok) throw injectionReceiptUnknown(resolved.error)

      // Invoke before persisting SUBMITTED. API-010 defines SUBMITTED as
      // "adapter invoked"; the settled wrapper consumes a rejection immediately
      // while the receipt write is in flight.
      let pending
      try {
        pending = Promise.resolve(model.generate(input))
      } catch (error) {
        pending = Promise.reject(error)
      }
      const settled = pending.then((value) => ({ value }), (error) => ({ error }))
      const submitted = await recordWithRetry('SUBMITTED')
      const result = await settled

      if (!submitted.ok) {
        const terminal = result.error || result.value?.status !== 'ok' ? await recordWithRetry('FAILED') : null
        if (result.error) {
          if (!terminal?.ok) throw injectionReceiptUnknown(submitted.error)
          throw result.error
        }
        if (result.value?.status !== 'ok') {
          if (!terminal?.ok) throw injectionReceiptUnknown(submitted.error)
          return result.value
        }
        // The model returned OK, but MSP has no durable SUBMITTED/COMPLETED
        // evidence. Do not relabel it FAILED or allow a caller to retry effects.
        throw injectionReceiptUnknown(submitted.error)
      }

      if (result.error) {
        const failed = await recordWithRetry('FAILED')
        if (!failed.ok) throw injectionReceiptUnknown(failed.error)
        throw result.error
      }

      const finalState = result.value?.status === 'ok' ? 'COMPLETED' : 'FAILED'
      const terminal = await recordWithRetry(finalState)
      if (!terminal.ok) throw injectionReceiptUnknown(terminal.error)
      return result.value
    } }
  }

  async function recordDelivery({ route, inboundMessageId, text, receiptId, providerRef, outcome = 'ACCEPTED' }) {
    return unwrap(await callTool('msp_thread_delivery_record', {
      inbound_message_id: inboundMessageId,
      source_event_id: `${required(inboundMessageId, 'inboundMessageId')}:assistant`,
      receipt_id: required(receiptId, 'receiptId'), outcome, text: required(text, 'text'),
      ...(providerRef ? { provider_ref: providerRef } : {}),
    }, { tenantId: required(route.tenantId, 'tenantId'), businessId: optional(route.businessId),
      channelAccountId: required(route.channelAccountId, 'channelAccountId'), externalRoomRef: required(route.externalRoomRef, 'externalRoomRef'),
      principalId: actor, policyRevision: 'line-delivery-v1', deliveryWriter: true }))
  }

  return {
    resolveThread,
    appendMessage,
    appendInbound,
    context,
    recordProtectedMemory,
    recordDelivery,
    withInjectionReceipt,
    buildContextPacket: (input) => buildThreadContextPacket({ ...input, maxContextBytes }),
    policy: { idleTimeoutMinutes: idleCeiling, recentExchangeCount: recentCeiling },
  }
}

export { DEFAULT_IDLE_TIMEOUT_MINUTES, DEFAULT_RECENT_EXCHANGES }
