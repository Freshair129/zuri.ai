import { z } from 'zod'

import { buildIdempotencyKey, hashPayload } from './idempotency'

// @req FR-081 — every acquisition channel converges on one normalized ingestion
// envelope carrying explicit tenant, connection, provider, lane and external
// identity. A channel adds an adapter, never a second raw-write path.
// @spec BR-002, SEC-002 — the external id is envelope data, never a key, and the
// envelope is strict so an unknown field is rejected rather than carried through.
// @spec docs/domains/integration/features/FR-081-raw-external-ingestion.md
// @tested tests/unit/platform/integration-contracts.test.js

export const DATA_LANES = [
  'ACCOUNTING',
  'SALES',
  'PRODUCTION_SUPPLY',
  'MARKETING',
  'CUSTOMER',
  'BUSINESS',
  // #76 / ADR-038 — external market evidence is cross-domain input for Price,
  // Supplier, Competitive, Demand and Research capabilities. Classifying it as
  // MARKETING or BUSINESS would make the acquisition provenance lie about its
  // semantic lane, so Market Intelligence gets one explicit additive lane while
  // still converging on the same FR-081 raw-ingestion substrate.
  'MARKET_INTELLIGENCE',
]

export const SOURCE_TYPES = ['PULL', 'WEBHOOK', 'FILE', 'MANUAL']

const sha256 = z.string().regex(/^[a-f0-9]{64}$/i, 'must be a SHA-256 hex digest')

export const zIngestionEnvelope = z
  .object({
    tenantId: z.string().min(1),
    businessId: z.string().min(1).nullable().optional(),
    connectionId: z.string().min(1),
    provider: z.string().min(1),
    lane: z.enum(DATA_LANES),
    entityType: z.string().min(1),
    externalId: z.string().min(1),
    sourceType: z.enum(SOURCE_TYPES),
    schemaVersion: z.string().min(1),
    payload: z.unknown(),
    ingestionRunId: z.string().min(1).optional(),
    payloadHash: sha256.optional(),
    idempotencyKey: sha256.optional(),
    receivedAt: z.coerce.date().optional(),
    sourceUri: z.string().min(1).optional(),
  })
  .strict()

export function createIngestionEnvelope(input, { now = () => new Date() } = {}) {
  const parsed = zIngestionEnvelope.parse(input)
  const payloadHash = hashPayload(parsed.payload)
  if (parsed.payloadHash && parsed.payloadHash !== payloadHash) {
    throw new Error('payloadHash does not match payload')
  }

  const idempotencyKey = buildIdempotencyKey({
    tenantId: parsed.tenantId,
    connectionId: parsed.connectionId,
    entityType: parsed.entityType,
    externalId: parsed.externalId,
    payloadHash,
  })
  if (parsed.idempotencyKey && parsed.idempotencyKey !== idempotencyKey) {
    throw new Error('idempotencyKey does not match ingestion identity')
  }

  const envelope = {
    ...parsed,
    payloadHash,
    idempotencyKey,
    receivedAt: parsed.receivedAt ?? now(),
  }

  return zIngestionEnvelope.parse(envelope)
}
