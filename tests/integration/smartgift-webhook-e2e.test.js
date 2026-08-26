// @req FR-028 — E2E SmartGift LINE Webhook Turn with GenesisBlockDB GraphRAG and Persona.
// @spec ADR-007 §P7, SDD-026, BR-011, BR-012, FR-052 — Server-owned SmartGift turn execution.
// @tested src/app/api/agent/line-webhook/route.js, src/modules/knowledge/smartgift-rag-pipeline.js

import { describe, it, expect, beforeAll, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import {
  seedSmartGiftKnowledge,
  handleSmartGiftCustomerTurn,
} from '@/modules/knowledge/smartgift-rag-pipeline'

describe('SmartGift LINE Webhook E2E GraphRAG Turn (FR-028 / FR-050 / FR-052)', () => {
  let tenant, business, mockDb

  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'EtohGroup Portfolio', code: 'PF-ETOH-E2E' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'EtohGroup Tenant', code: 'TNT-ETOH-E2E' })
    business = await createBusiness({ tenantId: tenant.id, name: 'SmartGift', code: 'BUS-SG-E2E' })

    // Setup in-memory mock DB for GenesisBlockDB
    const nodes = new Map()
    const edges = []
    mockDb = {
      listCollections: vi.fn().mockResolvedValue(['smartgift']),
      createCollection: vi.fn().mockResolvedValue(),
      addNode: vi.fn().mockImplementation(async (node) => {
        nodes.set(node.id, node)
        return { status: 'ok', id: node.id }
      }),
      addEdge: vi.fn().mockImplementation(async (edge) => {
        edges.push(edge)
        return { status: 'ok' }
      }),
      flushIndex: vi.fn().mockResolvedValue({ status: 'ok' }),
      hybridSearch: vi.fn().mockImplementation(async ({ queryVector, k, collection }) => {
        return [
          {
            node: {
              id: 'prod:sg-tumbler-500',
              labels: ['Product', 'SmartGift'],
              props: {
                title: 'กระบอกน้ำสุญญากาศสแตนเลส 304 ขนาด 500ml',
                text: 'กระบอกน้ำเก็บอุณหภูมิร้อน-เย็นได้ 12-24 ชั่วโมง รองรับสกรีนโลโก้ UV หรือเลเซอร์',
                code: 'SG-TM-500',
                moq: 50,
                leadTimeDays: 7,
                printingMethods: 'Laser Engraving, UV Color Print, Silkscreen',
              },
            },
            score: 0.96,
          },
          {
            node: {
              id: 'policy:sg-sample-mockup',
              labels: ['Policy', 'SmartGift'],
              props: {
                title: 'นโยบายการขึ้นตัวอย่างและการทำ Digital Proof',
                text: 'ทำ Digital Mockup ฟรีภายใน 24 ชม.',
              },
            },
            score: 0.85,
          },
        ]
      }),
    }

    // Seed Knowledge
    await seedSmartGiftKnowledge({
      db: mockDb,
      embeddingProvider: async () => [0.9, 0.1, 0.05, 0.0],
    })
  })

  it('successfully processes a customer LINE message for SmartGift end-to-end', async () => {
    const customerLineUserId = 'U_cust_smartgift_001'
    const customerQuestion = 'สนใจสั่งกระบอกน้ำ 100 ใบ สกรีนโลโก้บริษัท ต้องทำยังไง ใช้เวลากี่วัน?'
    const externalMessageId = 'MSG-SG-E2E-001'
    const bindingId = '84ed2c90-ab44-46f3-9618-1f24df0744b9'

    // Mock LLM provider with น้องกิฟต์ persona response
    const mockLlmProvider = vi.fn().mockResolvedValue(
      'สวัสดีครับ! น้องกิฟต์ยินดีให้บริการครับ 🎁 สำหรับกระบอกน้ำสแตนเลส 304 (รหัส SG-TM-500) สั่ง 100 ใบ ขั้นต่ำอยู่ที่ 50 ชิ้น ผลิตเสร็จใน 7 วันทำการ และทำ Digital Mockup โลโก้ฟรีใน 24 ชม. ครับ!'
    )

    // Build custom turn handler wired to SmartGift GraphRAG
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

      // 2. Run SmartGift GraphRAG turn
      const ragTurn = await handleSmartGiftCustomerTurn({
        db: mockDb,
        userMessage: input.text,
        embeddingProvider: async () => [0.9, 0.1, 0.05, 0.0],
        llmProvider: mockLlmProvider,
      })

      return {
        inbound,
        identity: { principalType: 'CUSTOMER' },
        response: {
          kind: 'ANSWER',
          text: ragTurn.responseText,
          skipReply: false,
          evidenceCount: ragTurn.contextItems.length,
          grounded: true,
          principalType: 'CUSTOMER',
        },
      }
    }

    const handler = createLineWebhookPost({
      turnHandler: smartGiftTurnHandler,
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async (input) => ({
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
})
