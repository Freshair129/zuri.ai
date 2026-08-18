import { createHash } from 'node:crypto'

// @req FR-081 — replay-safe ingestion identity: tenant, connection, entity type,
// external id and a canonical payload hash, so re-delivering the same event is
// recognised rather than duplicated.
// @spec BR-002 — an external id contributes to the identity but is never itself a key.
// @spec docs/domains/integration/features/FR-081-raw-external-ingestion.md
// @tested tests/unit/platform/integration-contracts.test.js

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`
}

export function stableStringify(value) {
  const result = canonicalize(value)
  return result === undefined ? 'null' : result
}

export function hashPayload(payload) {
  return createHash('sha256').update(stableStringify(payload)).digest('hex')
}

export function buildIdempotencyKey({ tenantId, connectionId, entityType, externalId, payloadHash }) {
  const identity = [tenantId, connectionId, entityType, externalId, payloadHash]
    .map((value) => String(value))
    .join('\u001f')

  return createHash('sha256').update(identity).digest('hex')
}
