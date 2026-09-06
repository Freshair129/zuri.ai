import prisma from '@/lib/db'

import { resolveLineOaConnection } from '../../core/integration-registry'
import { ingestRawExternalRecord } from '../../core/raw-ingest-service'
import { createPrismaRawRecordRepository } from '../../core/raw-record-repository'
import { LINE_OA_PROVIDER, normalizeLineWebhookEvent } from './line-oa-webhook'

// @req FR-081 — the LINE ingress converges on the one normalized ingestion envelope
//   instead of keeping a second, route-local idea of what a LINE event is.
// @req FR-028, FR-052 — evidence is recorded under the Tenant/Business the
//   server-owned binding already proved, never under scope taken from the payload.
// @spec BR-009, SDD-009 — a channel is added as an adapter, never as a second raw
//   write path. This deliberately reuses `normalizeLineWebhookEvent` rather than
//   normalizing again: convergence means one normalizer, not two that agree today.
// @spec SEC-001 — the repository is bound to one tenant/connection scope and refuses
//   a row outside it, rather than filtering after the write.
// @spec docs/domains/integration/features/FR-081-raw-external-ingestion.md
// Boundary: docs/domains/integration/CHARTER.md
// @tested tests/integration/line-oa-evidence-convergence.test.js
//
// WHY THIS SITS BESIDE THE TURN RATHER THAN REPLACING IT
// -----------------------------------------------------
// The live LINE path writes business truth (Customer/Conversation/Message) through
// `ingestLineMessage`. FR-081 raw evidence is a different thing: the payload verbatim,
// before anything interprets it. Recording it first means a turn that fails — bad
// model, missing knowledge, a bug in the answer policy — still leaves a replayable
// record of exactly what LINE sent. That is the whole point of the substrate, and it
// is why evidence is written BEFORE the turn and never inside its transaction.

/**
 * Build the evidence recorder for one webhook batch, or `null` when this LINE channel
 * has no `LINE_OA` IntegrationConnection yet.
 *
 * `null` is a configuration answer, not a failure: a deployment that has not
 * provisioned the connection keeps working exactly as before. Once the connection
 * exists, evidence becomes required — see `recordLineOaEvidence`.
 *
 * @returns {Promise<null | { connectionId: string, record: Function }>}
 */
export async function createLineOaEvidenceRecorder({
  db = prisma,
  tenantId,
  businessId = null,
  destination,
} = {}) {
  if (!tenantId || !destination) return null

  const connection = await resolveLineOaConnection({ db, tenantId, businessId, destination })
  if (!connection) return null

  const scope = {
    tenantId,
    businessId: businessId ?? null,
    connectionId: connection.id,
    destination,
  }
  const repository = createPrismaRawRecordRepository(db, {
    tenantId,
    businessId: businessId ?? null,
    connectionId: connection.id,
    provider: LINE_OA_PROVIDER,
  })

  return {
    connectionId: connection.id,

    /**
     * Persist one LINE event as raw evidence.
     *
     * The envelope carries only `{ destination, event }` with the transient
     * `replyToken` stripped by `normalizeLineWebhookEvent` — the binding id and the
     * caller's bearer never reach persistence.
     *
     * @returns {Promise<{status:'CREATED'|'UNCHANGED', rawRecordId, externalId, entityType}>}
     */
    async record({ body, event }, { now } = {}) {
      const envelope = normalizeLineWebhookEvent({ body, event, scope }, { now })
      const result = await ingestRawExternalRecord(envelope, { repository, now })
      return {
        status: result.status,
        rawRecordId: result.rawRecord.id,
        externalId: envelope.externalId,
        entityType: envelope.entityType,
      }
    },
  }
}
