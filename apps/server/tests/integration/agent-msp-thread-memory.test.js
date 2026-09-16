import { describe, expect, it } from 'vitest'
import {
  buildThreadContextPacket,
  createMspThreadMemoryPort,
} from '@/modules/agent/msp-thread-memory-port'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { handleAgentTurn } from '@/modules/agent'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'

// @req FR-025, FR-057, FR-097, FR-148 — the Zuri context seam uses the MSP
// thread contract with stable routing, speaker labels, bounded recent memory
// and deny-by-default private packet selection.
// @spec ADR-044, ADR-045, SDD-030, SEC-013, SEC-018
// @tested this file

const THREAD = {
  threadId: 'thread_PF-MSP-1',
  businessId: 'business_PF-MSP-1',
  audienceKind: 'DIRECT',
}

const THREAD_CONTEXT = {
  thread: THREAD,
  session: { sessionId: 'session_PF-MSP-1' },
  participants: [{ speakerId: 'person_PF-MSP-1', speakerKind: 'HUMAN' }],
  recentExchanges: [{ exchangeId: 'exchange_PF-MSP-1', messages: [{ speakerId: 'person_PF-MSP-1', text: 'สวัสดี' }] }],
  protectedRecords: [{ recordId: 'record_PF-MSP-1', kind: 'CONSTRAINT', body: { text: 'ไม่เปิดเผยข้อมูลส่วนตัวในกลุ่ม' } }],
  threadSummaries: [{ summaryId: 'summary_PF-MSP-1', overlapsRecent: false, summary: { topics: ['onboarding'] } }],
  coverageGap: null,
}

const ALLOWED = {
  authContext: { policy: { decision: 'ALLOW', privateMemoryAllowed: true } },
}

function transportFor({ context = THREAD_CONTEXT } = {}) {
  const calls = []
  const transport = async (name, input) => {
    calls.push({ name, input })
    if (name === 'msp_thread_resolve') return { thread: THREAD, created: false }
    if (name === 'msp_thread_message_append') {
      return {
        message: { messageId: 'message_PF-MSP-1', sequence: 1, exchangeId: 'exchange_PF-MSP-1' },
        session: { sessionId: 'session_PF-MSP-1' },
        deduplicated: false,
      }
    }
    if (name === 'msp_thread_context') return context
    if (name === 'msp_thread_memory_record') return { recordId: 'record_PF-MSP-2' }
    return {}
  }
  transport.calls = calls
  return transport
}

describe('Zuri API-010 thread memory adapter', () => {
  it('withholds all private sections for a group or unknown audience even for an allowed principal', () => {
    for (const audienceKind of ['GROUP', 'ROOM', undefined]) {
      const packet = buildThreadContextPacket({ authorization: ALLOWED,
        threadContext: { ...THREAD_CONTEXT, thread: { ...THREAD, audienceKind } } })
      expect(packet.policyDecision).toBe('DENY')
      expect(Object.values(packet.memory).every((items) => items.length === 0)).toBe(true)
    }
  })

  it('preserves partial coverage and mandatory current input/constraints under a byte budget', () => {
    const context = { ...THREAD_CONTEXT, recentExchanges: [
      { exchangeId: 'old', messages: [{ sequence: 3, text: 'large history '.repeat(500) }] },
      { exchangeId: 'current', messages: [{ sequence: 4, text: 'current input' }] },
    ], threadSummaries: [{ summaryId: 'partial', coveredFromSequence: 1, coveredThroughSequence: 3,
      coveredSequences: [1, 3], summary: { topics: ['older prefix'] } }],
    coverageGap: { ranges: [{ fromSequence: 2, throughSequence: 2 }] } }
    const full = buildThreadContextPacket({ authorization: ALLOWED, threadContext: context })
    expect(full.memory.summaries[0].summaryId).toBe('partial')
    expect(full.manifest.coverageGap).toBe(true)
    const packet = buildThreadContextPacket({ authorization: ALLOWED, threadContext: context, maxContextBytes: 2200 })
    expect(Buffer.byteLength(JSON.stringify(packet))).toBeLessThanOrEqual(2200)
    expect(packet.memory.recentExchanges.map((exchange) => exchange.exchangeId)).toEqual(['current'])
    expect(packet.memory.protectedMemory[0].recordId).toBe('record_PF-MSP-1')
    expect(packet.manifest.budget.truncated).toBe(true)
    expect(() => buildThreadContextPacket({ authorization: ALLOWED, threadContext: context, maxContextBytes: 100 })).toThrow(/MANDATORY_BUDGET/)
  })

  it('does not turn general ALLOW into write permission and rejects mismatched signed scope', async () => {
    const transport = transportFor()
    const port = createMspThreadMemoryPort({ transport, serviceKey: 'synthetic-service-key-over-32-bytes' })
    await port.resolveThread({ tenantId: 'tenant', businessId: THREAD.businessId, threadKind: 'DIRECT', audienceKind: 'DIRECT',
      channelType: 'LINE', channelAccountId: 'oa', externalRoomRef: 'dm' })
    const authorization = { authContext: { actor: { principalId: 'person' }, scope: { tenantId: 'tenant', businessId: THREAD.businessId },
      policy: { decision: 'ALLOW', privateMemoryAllowed: true, version: 'v1', mspAuthorization: { read: true, writePrivate: false } } } }
    await port.context({ threadId: THREAD.threadId, authorization, requesterId: 'person' })
    const grant = transport.calls.at(-1).input.access.grant
    expect(grant.readPrivate).toBe(true)
    expect(grant.writePrivate).toBe(false)
    await expect(port.context({ threadId: THREAD.threadId, authorization, requesterId: 'other' })).rejects.toThrow(/SCOPE_MISMATCH/)
    await expect(port.context({ threadId: THREAD.threadId, authorization: { authContext: { ...authorization.authContext,
      scope: { tenantId: 'other', businessId: THREAD.businessId } } } })).rejects.toThrow(/SCOPE_MISMATCH/)
  })

  it('resolves an opaque route and appends a speaker-labelled inbound message', async () => {
    const transport = transportFor()
    const port = createMspThreadMemoryPort({ transport })

    const result = await port.appendInbound({
      route: {
        threadKind: 'GROUP',
        audienceKind: 'GROUP',
        channelType: 'LINE',
        channelAccountId: 'line-account-PF-MSP-1',
        externalRoomRef: 'line-group-PF-MSP-1',
        tenantId: 'tenant-PF-MSP-1',
        businessId: 'business_PF-MSP-1',
      },
      speaker: {
        speakerId: 'person_PF-MSP-1',
        personId: 'person_PF-MSP-1',
        identityAssurance: 'VERIFIED',
      },
      text: 'ซูริ ลงทะเบียน ให้หน่อย',
      sourceEventId: 'line-account-PF-MSP-1:event-PF-MSP-1',
    })

    expect(result.thread.threadId).toBe(THREAD.threadId)
    const resolve = transport.calls.find((call) => call.name === 'msp_thread_resolve')
    expect(resolve.input.external_room_ref).toBe('line-group-PF-MSP-1')
    expect(resolve.input).not.toHaveProperty('vault_id')
    const append = transport.calls.find((call) => call.name === 'msp_thread_message_append')
    expect(append.input.speaker_id).toBe('person_PF-MSP-1')
    expect(append.input.speaker_kind).toBe('HUMAN')
    expect(append.input.identity_assurance).toBe('VERIFIED')
    expect(append.input.source_event_id).toContain('event-PF-MSP-1')
    expect(append.input).not.toHaveProperty('actor')
  })

  it('enforces the six-exchange deployment ceiling', async () => {
    const transport = transportFor()
    const port = createMspThreadMemoryPort({ transport, recentExchangeCount: 6 })

    await expect(port.context({ threadId: THREAD.threadId, recentExchangeCount: 7 })).rejects.toThrow(/ceiling/)
    expect(transport.calls).toHaveLength(0)
  })

  it('keeps private transcript and protected records out of a denied packet', () => {
    const packet = buildThreadContextPacket({
      authorization: { authContext: { policy: { decision: 'DENY', privateMemoryAllowed: false } } },
      threadContext: THREAD_CONTEXT,
      identity: { principalId: 'person_PF-MSP-1', principalType: 'CUSTOMER', verified: false },
      knowledge: { found: false },
    })

    expect(packet.policyDecision).toBe('DENY')
    expect(packet.memory.recentExchanges).toEqual([])
    expect(packet.memory.protectedMemory).toEqual([])
    expect(packet.manifest.withheldPrivateMemory).toBe(true)
  })

  it('keeps participant/speaker memory in an allowed packet', () => {
    const context = {
      ...THREAD_CONTEXT,
      threadSummaries: [
        ...THREAD_CONTEXT.threadSummaries,
        { summaryId: 'summary_PF-MSP-overlap', overlapsRecent: true, summary: { topics: ['duplicate'] } },
      ],
    }
    const packet = buildThreadContextPacket({
      authorization: ALLOWED,
      threadContext: context,
      identity: { principalId: 'person_PF-MSP-1', principalType: 'STAFF', verified: true },
      knowledge: { found: true },
    })

    expect(packet.policyDecision).toBe('ALLOW')
    expect(packet.thread.threadId).toBe(THREAD.threadId)
    expect(packet.memory.recentExchanges[0].messages[0].speakerId).toBe('person_PF-MSP-1')
    expect(packet.memory.protectedMemory[0].kind).toBe('CONSTRAINT')
    expect(packet.memory.summaries.map((summary) => summary.summaryId)).toEqual(['summary_PF-MSP-1', 'summary_PF-MSP-overlap'])
  })

  it('injects only an ALLOW packet into the model prompt', async () => {
    let request
    const model = createModelProviderPort({
      runtimeSource: 'TEST',
      provider: 'ollama',
      model: 'PF-MSP-model',
      baseUrl: 'http://127.0.0.1:11434',
      fetchFn: async (_url, init) => {
        request = JSON.parse(init.body)
        return { ok: true, async json() { return { response: 'คำตอบ' } } }
      },
    })

    await model.generate({
      question: 'ขอข้อมูล',
      evidence: { records: [{ product_code: 'PF-MSP-01' }] },
      contextPacket: buildThreadContextPacket({ authorization: ALLOWED, threadContext: THREAD_CONTEXT }),
    })
    expect(request.prompt).toContain('THREAD CONTEXT PACKET')

    await model.generate({
      question: 'ขอข้อมูล',
      evidence: { records: [{ product_code: 'PF-MSP-01' }] },
      contextPacket: buildThreadContextPacket({
        authorization: { authContext: { policy: { decision: 'DENY', privateMemoryAllowed: false } } },
        threadContext: THREAD_CONTEXT,
      }),
    })
    expect(request.prompt).not.toContain('THREAD CONTEXT PACKET')
  })

  it('records RESOLVED, invokes once, then records SUBMITTED and COMPLETED', async () => {
    const order = []
    const transport = async (name, input) => {
      if (name === 'msp_thread_resolve') return { thread: THREAD, created: false }
      if (name === 'msp_thread_injection_record') {
        order.push(`receipt:${input.state}`)
        return { injectionId: input.injection_id, state: input.state }
      }
      return {}
    }
    const port = createMspThreadMemoryPort({ transport })
    await port.resolveThread({
      threadKind: 'DIRECT', audienceKind: 'DIRECT', channelType: 'LINE',
      channelAccountId: 'line-account-PF-MSP-1', externalRoomRef: 'direct-PF-MSP-1',
      tenantId: 'tenant-PF-MSP-1', businessId: THREAD.businessId,
    })
    const model = {
      provider: 'test', model: 'PF-MSP-receipt',
      async generate() {
        order.push('model:invoked')
        return { provider: 'test', model: 'PF-MSP-receipt', status: 'ok', text: 'รับทราบค่ะ' }
      },
    }
    const wrapped = port.withInjectionReceipt({
      model, contextPacket: buildThreadContextPacket({ authorization: ALLOWED, threadContext: THREAD_CONTEXT }),
      threadId: THREAD.threadId, exchangeId: 'exchange_PF-MSP-1', authorization: ALLOWED,
    })

    await expect(wrapped.generate({ question: 'ขอข้อมูล' })).resolves.toMatchObject({ status: 'ok' })
    expect(order).toEqual(['receipt:RESOLVED', 'model:invoked', 'receipt:SUBMITTED', 'receipt:COMPLETED'])
  })

  it('does not relabel a successful model as FAILED when SUBMITTED receipt persistence is unknown', async () => {
    const states = []
    const transport = async (name, input) => {
      if (name === 'msp_thread_resolve') return { thread: THREAD, created: false }
      if (name === 'msp_thread_injection_record') {
        states.push(input.state)
        if (input.state === 'SUBMITTED') throw new Error('receipt transport unavailable')
        return { injectionId: input.injection_id, state: input.state }
      }
      return {}
    }
    const port = createMspThreadMemoryPort({ transport })
    await port.resolveThread({
      threadKind: 'DIRECT', audienceKind: 'DIRECT', channelType: 'LINE',
      channelAccountId: 'line-account-PF-MSP-1', externalRoomRef: 'direct-PF-MSP-1',
      tenantId: 'tenant-PF-MSP-1', businessId: THREAD.businessId,
    })
    let invocations = 0
    const wrapped = port.withInjectionReceipt({
      model: { provider: 'test', model: 'PF-MSP-receipt', async generate() {
        invocations += 1
        return { status: 'ok', text: 'คำตอบ' }
      } },
      contextPacket: buildThreadContextPacket({ authorization: ALLOWED, threadContext: THREAD_CONTEXT }),
      threadId: THREAD.threadId, exchangeId: 'exchange_PF-MSP-1', authorization: ALLOWED,
    })

    await expect(wrapped.generate({ question: 'ขอข้อมูล' })).rejects.toMatchObject({ code: 'MSP_INJECTION_RECEIPT_UNKNOWN' })
    expect(invocations).toBe(1)
    expect(states).toEqual(['RESOLVED', 'SUBMITTED', 'SUBMITTED'])
    expect(states).not.toContain('FAILED')
  })

  it('does not relabel a successful model as FAILED when COMPLETED receipt persistence is unknown', async () => {
    const states = []
    const transport = async (name, input) => {
      if (name === 'msp_thread_resolve') return { thread: THREAD, created: false }
      if (name === 'msp_thread_injection_record') {
        states.push(input.state)
        if (input.state === 'COMPLETED') throw new Error('receipt transport unavailable')
        return { injectionId: input.injection_id, state: input.state }
      }
      return {}
    }
    const port = createMspThreadMemoryPort({ transport })
    await port.resolveThread({
      threadKind: 'DIRECT', audienceKind: 'DIRECT', channelType: 'LINE',
      channelAccountId: 'line-account-PF-MSP-1', externalRoomRef: 'direct-PF-MSP-1',
      tenantId: 'tenant-PF-MSP-1', businessId: THREAD.businessId,
    })
    const wrapped = port.withInjectionReceipt({
      model: { provider: 'test', model: 'PF-MSP-receipt', async generate() { return { status: 'ok', text: 'คำตอบ' } } },
      contextPacket: buildThreadContextPacket({ authorization: ALLOWED, threadContext: THREAD_CONTEXT }),
      threadId: THREAD.threadId, exchangeId: 'exchange_PF-MSP-1', authorization: ALLOWED,
    })

    await expect(wrapped.generate({ question: 'ขอข้อมูล' })).rejects.toMatchObject({ code: 'MSP_INJECTION_RECEIPT_UNKNOWN' })
    expect(states).toEqual(['RESOLVED', 'SUBMITTED', 'COMPLETED', 'COMPLETED'])
    expect(states).not.toContain('FAILED')
  })

  it('appends the current inbound message before the agent answer uses the packet', async () => {
    const pf = await createPortfolio({ name: 'MSP thread group', code: 'PF-MSP-THREAD' })
    const tenant = await createTenant({ portfolioId: pf.id, name: 'MSP thread tenant', code: 'TNT-MSP-THREAD' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'MSP thread business', code: 'BUS-MSP-THREAD' })
    const lineUserId = 'U-msp-thread-current'
    const seeded = await ingestLineMessage({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId,
      channelAccountId: 'line-account-PF-MSP-THREAD',
      threadId: 'crm-thread-PF-MSP-THREAD',
      text: 'เริ่มต้น',
    })
    const token = await issueLinkToken({ tenantId: tenant.id, personId: seeded.personId })
    await redeemLinkToken({
      tenantId: tenant.id,
      token: token.token,
      lineUserId,
      channelAccountId: 'line-account-PF-MSP-THREAD',
    })

    const transport = transportFor()
    const threadMemory = createMspThreadMemoryPort({ transport })
    let capturedPacket
    const result = await handleAgentTurn(
      {
        tenantId: tenant.id,
        businessId: business.id,
        lineUserId,
        threadId: 'crm-thread-PF-MSP-THREAD',
        text: 'ขอข้อมูลต่อ',
        externalMessageId: 'event-PF-MSP-THREAD',
      },
      {
        threadMemory,
        threadRoute: {
          threadKind: 'DIRECT',
          audienceKind: 'DIRECT',
          channelType: 'LINE',
          channelAccountId: 'line-account-PF-MSP-THREAD',
          externalRoomRef: 'line-group-PF-MSP-THREAD',
        },
        serverScope: {
          transportVerified: true,
          channelAccountId: 'line-account-PF-MSP-THREAD',
          businessId: business.id,
        },
        knowledge: async () => ({ found: false, relations: [] }),
        businessKnowledge: {
          async query() {
            return { records: [{ product_code: 'PF-MSP-01', name: 'สินค้า', sell_price: null, moq: null, currency: 'THB', unit: 'ชิ้น', specification: {}, as_of: '2026-09-08' }] }
          },
        },
        model: {
          provider: 'test',
          model: 'PF-MSP-model',
          async generate(input) {
            capturedPacket = input.contextPacket
            return { provider: 'test', model: 'PF-MSP-model', status: 'ok', text: 'รับทราบค่ะ' }
          },
        },
      },
    )

    expect(result.thread.threadId).toBe(THREAD.threadId)
    expect(result.threadMemory.policyDecision).toBe('ALLOW')
    expect(capturedPacket.thread.threadId).toBe(THREAD.threadId)
    const appends = transport.calls.filter((call) => call.name === 'msp_thread_message_append')
    expect(appends).toHaveLength(2)
    expect(appends[1].input.direction).toBe('OUTBOUND')
    expect(appends[1].input.exchange_id).toBe('exchange_PF-MSP-1')
    expect(appends[1].input.delivery_state).toBe('QUEUED')
    expect(appends[0].input.source_event_id).toContain('event-PF-MSP-THREAD')
  })
})
