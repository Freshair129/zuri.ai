import { createIngestionEnvelope } from './contracts'
import { stableStringify } from './idempotency'

// @req FR-081 — raw ingestion persists source payloads verbatim and never writes
// domain truth. A known idempotency key returns UNCHANGED instead of inserting.
// @spec BR-002 — translation into business entities is a separate, later path.
// @spec docs/domains/integration/features/FR-081-raw-external-ingestion.md
// @tested tests/unit/platform/raw-ingest-service.test.js

export async function ingestRawExternalRecord(input, { repository, now } = {}) {
  if (!repository || typeof repository.findByIdempotencyKey !== 'function' || typeof repository.insert !== 'function') {
    throw new Error('raw ingestion repository is required')
  }

  const envelope = createIngestionEnvelope(input, { now })
  const existing = await repository.findByIdempotencyKey(envelope.idempotencyKey)
  if (existing) {
    return { status: 'UNCHANGED', rawRecord: existing, envelope }
  }

  const rawRecord = await repository.insert({
    tenantId: envelope.tenantId,
    businessId: envelope.businessId ?? null,
    connectionId: envelope.connectionId,
    ingestionRunId: envelope.ingestionRunId ?? null,
    provider: envelope.provider,
    lane: envelope.lane,
    entityType: envelope.entityType,
    externalId: envelope.externalId,
    sourceType: envelope.sourceType,
    sourceUri: envelope.sourceUri ?? null,
    schemaVersion: envelope.schemaVersion,
    payloadJson: stableStringify(envelope.payload),
    payloadHash: envelope.payloadHash,
    idempotencyKey: envelope.idempotencyKey,
    receivedAt: envelope.receivedAt,
    processingStatus: 'RECEIVED',
  })

  return { status: 'CREATED', rawRecord, envelope }
}
