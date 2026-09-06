import { createHmac } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  LINE_OA_PROVIDER,
  createLineOaWebhookConnector,
} from '@/platform/integrations/providers/line/line-oa-webhook'

const channelSecret = 'line-channel-secret-for-test'
const scope = {
  tenantId: 'tenant-line-1',
  businessId: 'business-line-1',
  connectionId: 'connection-line-1',
  ingestionRunId: 'run-line-1',
  destination: 'Ulinebotdestination1',
}

function sign(body) {
  return createHmac('sha256', channelSecret).update(Buffer.from(body, 'utf8')).digest('base64')
}

function webhookRequest(body, signature = sign(body)) {
  return new Request('https://zuri.test/api/integrations/line/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-line-signature': signature,
    },
    body,
  })
}

function messageBody(overrides = {}) {
  return JSON.stringify({
    destination: scope.destination,
    events: [
      {
        type: 'message',
        webhookEventId: 'webhook-event-1',
        timestamp: 1760000000000,
        source: { type: 'user', userId: 'Ulineuser1' },
        message: { id: 'message-1', type: 'text', text: 'สวัสดี' },
        replyToken: 'reply-token-must-not-be-stored',
        ...overrides,
      },
    ],
  })
}

describe('LINE OA webhook provider adapter', () => {
  it('implements the provider metadata and webhook connector contract', () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })

    expect(connector.code).toBe(LINE_OA_PROVIDER)
    expect(connector.getCapabilities()).toMatchObject({ webhook: true, pull: false })
    expect(connector.listResources()).toEqual([
      { code: 'WEBHOOK_EVENT', lane: 'CUSTOMER', sourceType: 'WEBHOOK' },
    ])
  })

  it('verifies the exact raw request bytes before parsing JSON', async () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })
    const body = `${messageBody()}\n`

    await expect(connector.verifySignature(webhookRequest(body))).resolves.toBe(true)
    await expect(connector.parseWebhook(webhookRequest(body))).resolves.toHaveLength(1)
  })

  it('rejects an invalid signature before attempting to parse a malformed body', async () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })
    const malformedBody = '{not-json'

    await expect(connector.verifySignature(webhookRequest(malformedBody, sign('{}')))).resolves.toBe(false)
    await expect(connector.parseWebhook(webhookRequest(malformedBody, sign('{}')))).rejects.toThrow(
      'LINE_WEBHOOK_SIGNATURE_INVALID',
    )
  })

  it('rejects a webhook from a different LINE destination', async () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })
    const body = JSON.stringify({ destination: 'Uanotherbot', events: [] })

    await expect(connector.parseWebhook(webhookRequest(body))).rejects.toThrow(
      'LINE_WEBHOOK_DESTINATION_MISMATCH',
    )
  })

  it('normalizes events to the configured scope and removes the transient reply token', async () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })
    const [envelope] = await connector.parseWebhook(webhookRequest(messageBody({ tenantId: 'attacker-supplied' })))

    expect(envelope).toMatchObject({
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      connectionId: scope.connectionId,
      ingestionRunId: scope.ingestionRunId,
      provider: LINE_OA_PROVIDER,
      lane: 'CUSTOMER',
      entityType: 'LINE_MESSAGE',
      externalId: 'webhook-event-1',
      sourceType: 'WEBHOOK',
      schemaVersion: 'line.messaging-api.webhook.v1',
      sourceUri: `line://channel/${scope.destination}`,
    })
    expect(envelope.payload).toMatchObject({
      destination: scope.destination,
      event: { type: 'message', webhookEventId: 'webhook-event-1' },
    })
    expect(envelope.payload.event.replyToken).toBeUndefined()
    expect(envelope.payload.event.tenantId).toBe('attacker-supplied')
  })

  it('maps identity and conversation event classes without writing domain truth', async () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })
    const body = JSON.stringify({
      destination: scope.destination,
      events: [
        { type: 'follow', webhookEventId: 'follow-1', source: { userId: 'U1' } },
        { type: 'join', webhookEventId: 'join-1', source: { groupId: 'G1' } },
      ],
    })

    const envelopes = await connector.parseWebhook(webhookRequest(body))

    expect(envelopes.map((envelope) => envelope.entityType)).toEqual([
      'LINE_IDENTITY',
      'LINE_CONVERSATION',
    ])
  })

  it('persists each event through the generic raw-ingestion boundary and deduplicates replay', async () => {
    const connector = createLineOaWebhookConnector({ channelSecret, scope })
    const stored = new Map()
    const repository = {
      findByIdempotencyKey: vi.fn(async (key) => stored.get(key) ?? null),
      insert: vi.fn(async (row) => {
        const record = { id: `raw-${stored.size + 1}`, ...row }
        stored.set(row.idempotencyKey, record)
        return record
      }),
    }

    const first = await connector.ingestWebhook(webhookRequest(messageBody()), {
      repository,
      now: () => new Date('2026-08-18T00:00:00.000Z'),
    })
    const replay = await connector.ingestWebhook(webhookRequest(messageBody()), {
      repository,
      now: () => new Date('2026-08-18T00:00:01.000Z'),
    })

    expect(first).toMatchObject({ created: 1, unchanged: 0, failed: 0 })
    expect(replay).toMatchObject({ created: 0, unchanged: 1, failed: 0 })
    expect(repository.insert).toHaveBeenCalledTimes(1)
    expect(repository.insert.mock.calls[0][0].payloadJson).not.toContain('reply-token-must-not-be-stored')
  })
})
