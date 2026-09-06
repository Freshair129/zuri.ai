// @req FR-028 — E2E SmartGift LINE webhook turn: CRM ingest, a grounded business answer, persistence.
// @spec ADR-007 §P7, SDD-026, BR-011, BR-012, FR-052, ADR-063 — server-owned SmartGift turn
//   execution; the knowledge the turn reads is the PUBLIC business-knowledge projection
//   behind the in-memory reader, never a substrate client (ADR-050 D3).
// @tested src/app/api/agent/line-webhook/route.js, src/modules/agent/grounded-business-answer.js

import { describe, it, expect, beforeAll, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createSmartGiftKnowledgeReader } from '../factories/smartgift-knowledge'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { answerBusinessQuestion } from '@/modules/agent/grounded-business-answer'

describe('SmartGift LINE Webhook E2E grounded turn (FR-028 / FR-050 / FR-052)', () => {
  let tenant, business, knowledge

  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'EtohGroup Portfolio', code: 'PF-ETOH-E2E' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'EtohGroup Tenant', code: 'TNT-ETOH-E2E' })
    business = await createBusiness({ tenantId: tenant.id, name: 'SmartGift', code: 'BUS-SG-E2E' })

    // The compliant fixture: the curated catalog as PUBLIC business-knowledge records
    // for this Business, behind the same reader contract the agent consumes in
    // production. Nothing here opens, seeds or searches a substrate (ADR-063 D2a).
    knowledge = createSmartGiftKnowledgeReader(business.id)
  })

  it('successfully processes a customer LINE message for SmartGift end-to-end', async () => {
    const customerLineUserId = 'U_cust_smartgift_001'
    const customerQuestion = 'สนใจสั่งกระบอกน้ำรหัส SG-TM-500 จำนวน 100 ใบ สกรีนโลโก้บริษัท ต้องทำยังไง ใช้เวลากี่วัน?'
    const externalMessageId = 'MSG-SG-E2E-001'
    const bindingId = '84ed2c90-ab44-46f3-9618-1f24df0744b9'

    // Mock model with the น้องกิฟต์ persona. Every number and code it states is present
    // in the question or the evidence packet, so the grounded verifier accepts it as-is.
    const personaText =
      'สวัสดีครับ! น้องกิฟต์ยินดีให้บริการครับ 🎁 กระบอกน้ำสแตนเลส 304 (รหัส SG-TM-500) สั่ง 100 ใบได้เลยครับ ขั้นต่ำอยู่ที่ 50 ชิ้น ผลิตประมาณ 7 วันทำการ และทำ Digital Mockup โลโก้ให้ฟรีภายใน 24 ชม. ครับ'
    const mockModel = {
      provider: 'test',
      model: 'nong-gift-persona',
      generate: vi.fn().mockResolvedValue({ provider: 'test', model: 'nong-gift-persona', status: 'ok', text: personaText }),
    }

    let lastAnswer = null

    // Turn handler wired to the grounded business answer over the in-memory knowledge port
    const smartGiftTurnHandler = async (input) => {
      // 1. Ingest LINE message and resolve customer identity through standard CRM seam
      const inbound = await ingestLineMessage({
        tenantId: input.tenantId,
        businessId: input.businessId,
        lineUserId: input.lineUserId,
        displayName: input.displayName || 'LINE Customer',
        threadId: input.threadId || `TH-${input.lineUserId}`,
        text: input.text,
        externalMessageId: input.externalMessageId,
        correlationId: input.correlationId,
      })

      // 2. Answer from a bounded evidence packet (FR-049) read through the knowledge port
      const answer = await answerBusinessQuestion(
        { tenantId: input.tenantId, businessId: input.businessId, question: input.text },
        { knowledge, model: mockModel },
      )
      lastAnswer = answer

      return {
        inbound,
        identity: { principalType: 'CUSTOMER' },
        response: {
          kind: 'ANSWER',
          text: answer.text,
          skipReply: false,
          evidenceCount: answer.evidence.records.length,
          grounded: answer.grounded,
          principalType: 'CUSTOMER',
        },
      }
    }

    const handler = createLineWebhookPost({
      turnHandler: smartGiftTurnHandler,
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async () => ({
            id: bindingId,
            code: 'LINE-SMARTGIFT-OA',
            tenantId: tenant.id,
            businessId: business.id,
          }),
        },
      }),
    })

    // Execute Webhook POST request with FR-052 server-owned binding format
    const request = new Request('http://local/api/agent/line-webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer binding-bearer-secret-long-enough',
      },
      body: JSON.stringify({
        bindingId,
        destination: 'U-smartgift-oa',
        events: [
          {
            type: 'message',
            source: { userId: customerLineUserId },
            message: { id: externalMessageId, type: 'text', text: customerQuestion },
          },
        ],
      }),
    })

    const response = await handler(request)
    expect(response.status).toBe(200)

    const responseJson = await response.json()
    expect(responseJson.handled).toBe(1)
    expect(responseJson.results.length).toBe(1)

    const turnResult = responseJson.results[0]
    expect(turnResult.ok).toBe(true)
    expect(turnResult.eventId).toBe(externalMessageId)
    expect(turnResult.skipReply).toBe(false)
    expect(turnResult.principalType).toBe('CUSTOMER')

    // The answer was grounded on the catalog record for the code the customer named,
    // read from the PUBLIC projection — and the persona text passed verification intact.
    expect(lastAnswer.grounded).toBe(true)
    expect(lastAnswer.verification.supported).toBe(true)
    expect(lastAnswer.evidence.sensitivity).toBe('PUBLIC')
    expect(lastAnswer.evidence.businessId).toBe(business.id)
    expect(lastAnswer.evidence.records.map((record) => record.product_code)).toEqual(['SG-TM-500'])
    expect(lastAnswer.evidence.records[0].sell_price).toBeNull()
    expect(mockModel.generate).toHaveBeenCalledTimes(1)

    // Verify response content delivered by SmartGift Copilot
    expect(turnResult.response.text).toContain('น้องกิฟต์')
    expect(turnResult.response.text).toContain('กระบอกน้ำสแตนเลส 304')
    expect(turnResult.response.text).toContain('SG-TM-500')
    expect(turnResult.response.text).toContain('7 วันทำการ')

    // Verify message persistence in DB
    const savedMsg = await prisma.message.findFirst({
      where: { externalMessageId },
    })
    expect(savedMsg).not.toBeNull()
    expect(savedMsg.body).toBe(customerQuestion)
  })

  it('serves only this Business: another Business reading the same port gets no SmartGift evidence', async () => {
    const other = await createBusiness({ tenantId: tenant.id, name: 'Not SmartGift', code: 'BUS-OTHER-E2E' })
    const packet = await knowledge.query({
      tenantId: tenant.id,
      businessId: other.id,
      queryId: 'product_detail',
      params: { productCode: 'SG-TM-500' },
      limit: 1,
    })
    expect(packet.records).toEqual([])
  })
})
