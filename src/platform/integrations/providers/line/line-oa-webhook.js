import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

import { createIngestionEnvelope } from '../../core/contracts'
import { hashPayload } from '../../core/idempotency'
import { ingestRawExternalRecord } from '../../core/raw-ingest-service'

// @req FR-052 — provider scope is resolved from the server-owned connection,
// never from tenant/business values supplied by the webhook payload.
// @req FR-081 — LINE is one acquisition channel: a signature-verified event
// becomes a scoped raw record before anything is allowed to translate it.
// @spec SEC-009 — server-only, deny-by-default LINE ingress.
// @spec ADR-007 P1-W5 — zuri-cli remains the sole LINE Reply API owner for the
// pilot; this adapter owns verified ingress evidence only.
// @spec docs/domains/integration/features/FR-081-raw-external-ingestion.md
// Boundary: docs/domains/integration/CHARTER.md
// @tested tests/unit/platform/line-oa-webhook.test.js

export const LINE_OA_PROVIDER = 'LINE_OA'
export const LINE_OA_SCHEMA_VERSION = 'line.messaging-api.webhook.v1'
export const LINE_OA_RESOURCE_TYPE = 'WEBHOOK_EVENT'

const zLineEvent = z
  .object({
    type: z.string().min(1),
    webhookEventId: z.string().min(1).optional(),
    timestamp: z.number().finite().optional(),
    source: z
      .object({
        type: z.string().optional(),
        userId: z.string().optional(),
        groupId: z.string().optional(),
        roomId: z.string().optional(),
      })
      .passthrough()
      .optional(),
    message: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        text: z.string().optional(),
      })
      .passthrough()
      .optional(),
    replyToken: z.string().optional(),
  })
  .passthrough()

const zLineWebhookBody = z
  .object({
    destination: z.string().min(1),
    events: z.array(zLineEvent),
  })
  .passthrough()

const zLineConnectionScope = z.object({
  tenantId: z.string().min(1),
  businessId: z.string().min(1).nullable().optional(),
  connectionId: z.string().min(1),
  ingestionRunId: z.string().min(1).optional(),
  destination: z.string().min(1),
})

const IDENTITY_EVENTS = new Set(['follow', 'unfollow', 'accountLink'])
const CONVERSATION_EVENTS = new Set(['join', 'leave', 'memberJoined', 'memberLeft'])

function assertChannelSecret(channelSecret) {
  if (!String(channelSecret ?? '').trim()) throw new Error('LINE_CHANNEL_SECRET_REQUIRED')
}

function getHeader(request, name) {
  if (!request?.headers) return null
  if (typeof request.headers.get === 'function') return request.headers.get(name)
  return request.headers[name] ?? request.headers[name.toLowerCase()] ?? null
}

async function readRawRequestBytes(request, { clone = false } = {}) {
  if (!request || typeof request.arrayBuffer !== 'function') {
    throw new Error('LINE_WEBHOOK_REQUEST_INVALID')
  }
  const source = clone && typeof request.clone === 'function' ? request.clone() : request
  return Buffer.from(await source.arrayBuffer())
}

function signaturesMatch(bodyBytes, receivedSignature, channelSecret) {
  if (!receivedSignature) return false

  const expected = createHmac('sha256', channelSecret).update(bodyBytes).digest('base64')
  const received = Buffer.from(String(receivedSignature), 'utf8')
  const calculated = Buffer.from(expected, 'utf8')
  return received.length === calculated.length && timingSafeEqual(received, calculated)
}

function lineEntityType(eventType) {
  if (IDENTITY_EVENTS.has(eventType)) return 'LINE_IDENTITY'
  if (CONVERSATION_EVENTS.has(eventType)) return 'LINE_CONVERSATION'
  if (eventType === 'message') return 'LINE_MESSAGE'
  return `LINE_${eventType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
}

function redactTransientFields(event) {
  const { replyToken: _replyToken, ...safeEvent } = event
  return safeEvent
}

function externalEventId(event, safeEvent) {
  if (event.webhookEventId) return event.webhookEventId
  if (event.message?.id) return event.message.id
  return `event-hash:${hashPayload(safeEvent)}`
}

function assertDestination(body, scope) {
  if (body.destination !== scope.destination) {
    throw new Error('LINE_WEBHOOK_DESTINATION_MISMATCH')
  }
}

function parseWebhookBody(rawBody) {
  let value
  try {
    value = JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw new Error('LINE_WEBHOOK_PAYLOAD_INVALID')
  }

  try {
    return zLineWebhookBody.parse(value)
  } catch {
    throw new Error('LINE_WEBHOOK_PAYLOAD_INVALID')
  }
}

async function readVerifiedBody(request, channelSecret, scope) {
  const bodyBytes = await readRawRequestBytes(request)
  const signature = getHeader(request, 'x-line-signature')
  if (!signaturesMatch(bodyBytes, signature, channelSecret)) {
    throw new Error('LINE_WEBHOOK_SIGNATURE_INVALID')
  }

  const body = parseWebhookBody(bodyBytes)
  assertDestination(body, scope)
  return body
}

export function normalizeLineWebhookEvent(
  { body, event, scope, receivedAt },
  { now } = {},
) {
  const parsedScope = zLineConnectionScope.parse(scope)
  const parsedBody = zLineWebhookBody.parse(body)
  const parsedEvent = zLineEvent.parse(event)
  assertDestination(parsedBody, parsedScope)

  const safeEvent = redactTransientFields(parsedEvent)
  return createIngestionEnvelope(
    {
      tenantId: parsedScope.tenantId,
      businessId: parsedScope.businessId ?? null,
      connectionId: parsedScope.connectionId,
      ...(parsedScope.ingestionRunId ? { ingestionRunId: parsedScope.ingestionRunId } : {}),
      provider: LINE_OA_PROVIDER,
      lane: 'CUSTOMER',
      entityType: lineEntityType(parsedEvent.type),
      externalId: externalEventId(parsedEvent, safeEvent),
      sourceType: 'WEBHOOK',
      schemaVersion: LINE_OA_SCHEMA_VERSION,
      payload: {
        destination: parsedBody.destination,
        event: safeEvent,
      },
      ...(receivedAt ? { receivedAt } : {}),
      sourceUri: `line://channel/${parsedBody.destination}`,
    },
    { now },
  )
}

export function createLineOaWebhookConnector({ channelSecret, scope }) {
  assertChannelSecret(channelSecret)
  const parsedScope = zLineConnectionScope.parse(scope)

  async function parseEnvelopes(request, { now } = {}) {
    const body = await readVerifiedBody(request, channelSecret, parsedScope)
    return body.events.map((event) => normalizeLineWebhookEvent({ body, event, scope: parsedScope }, { now }))
  }

  return {
    code: LINE_OA_PROVIDER,

    getCapabilities() {
      return { webhook: true, pull: false, file: false, manual: false }
    },

    listResources() {
      return [{ code: LINE_OA_RESOURCE_TYPE, lane: 'CUSTOMER', sourceType: 'WEBHOOK' }]
    },

    async healthCheck(connection) {
      const active = !connection?.status || connection.status === 'ACTIVE'
      return {
        provider: LINE_OA_PROVIDER,
        connectionId: connection?.id ?? parsedScope.connectionId,
        status: active ? 'READY' : 'NOT_READY',
      }
    },

    async verifySignature(request) {
      const bodyBytes = await readRawRequestBytes(request, { clone: true })
      return signaturesMatch(bodyBytes, getHeader(request, 'x-line-signature'), channelSecret)
    },

    async parseWebhook(request) {
      return parseEnvelopes(request)
    },

    async ingestWebhook(request, { repository, now } = {}) {
      const envelopes = await parseEnvelopes(request, { now })
      const outcomes = await Promise.all(
        envelopes.map(async (envelope) => {
          const result = await ingestRawExternalRecord(envelope, { repository, now })
          return { status: result.status, externalId: envelope.externalId, rawRecord: result.rawRecord }
        }),
      )

      return {
        provider: LINE_OA_PROVIDER,
        destination: parsedScope.destination,
        received: outcomes.length,
        created: outcomes.filter((outcome) => outcome.status === 'CREATED').length,
        unchanged: outcomes.filter((outcome) => outcome.status === 'UNCHANGED').length,
        failed: 0,
        events: outcomes,
      }
    },
  }
}
