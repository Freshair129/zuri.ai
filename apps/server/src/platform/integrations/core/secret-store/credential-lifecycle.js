// @req FR-223 — the credential lifecycle over any SecretStorePort: store a validated
//   bundle as a new version and activate it, compensate a write whose follow-up
//   failed, revoke with the account fenced first, and mark restored credentials for
//   re-entry.
// @spec ADR-089 D5; ADR-053 D3 (compensation); SEC-030
// @tested tests/integration/credential-vault-lifecycle.test.js
//
// Order and why (ADR-089 D5, D7):
//
//   * Validation happens before this module is called, on the bundle in memory, so a
//     rejected bundle is never stored. `storeValidatedCredential` writes the version
//     PENDING_VALIDATION and activates it with the validation code it was given.
//   * Everything the caller still has to do after activation — the connection's
//     account row, an audit — runs in `afterActivate`. If the activation or that step
//     fails, the stored material is purged by compensation: a pending version is
//     rejected (a rotation falls back to the version that was live), and a
//     first credential that did activate is revoked. A purge that itself fails is
//     reported as CREDENTIAL_ORPHAN_PURGE_FAILED and leaves a REVOKED/REJECTED row
//     for a reconciler, never a live orphan.
//   * Revocation fences first (the caller's `fence`, e.g. the account's epoch bump)
//     and revokes second: if the store call then fails, the account is already
//     stopped — the failure direction is closed, not open.
//   * Rotation never bumps a transport epoch; queued work keeps flowing (D5).
//
// Audit payloads are built only by `credentialAuditPayload`, an allow-list: no
// reference, fingerprint or material ever reaches an audit row.

import { SecretStoreError, normalizeSecretStoreError } from './secret-store-port'

/** The only shape a credential audit payload may take (design §4.6). */
export function credentialAuditPayload({
  businessId, connectionId, credentialVersion = null, secretStore = null, displayHint = null,
  validationCode = null, via = null, outcome = null, purgedCount = null, purgeFailedCount = null,
}) {
  const payload = { businessId, connectionId }
  const optional = { credentialVersion, secretStore, displayHint, validationCode, via, outcome, purgedCount, purgeFailedCount }
  for (const [key, value] of Object.entries(optional)) if (value !== null && value !== undefined) payload[key] = value
  return payload
}

async function compensate(store, scope, written, activated) {
  try {
    const result = activated && activated.supersededCount === 0
      ? await store.revoke({ ...scope, reason: 'COMPENSATION_AFTER_FAILED_WRITE' })
      : activated
        ? null
        : await store.revoke({ ...scope, reason: 'COMPENSATION_AFTER_FAILED_WRITE', versionNumber: written.versionNumber })
    if (!result) return { outcome: 'NOT_PURGED_ROTATION_ACTIVE', purgeFailedCount: 0, purgedCount: 0 }
    return {
      outcome: result.purgeFailedCount > 0 ? 'CREDENTIAL_ORPHAN_PURGE_FAILED' : 'CREDENTIAL_ORPHAN_PURGED',
      purgedCount: result.purgedCount,
      purgeFailedCount: result.purgeFailedCount,
    }
  } catch {
    return { outcome: 'CREDENTIAL_ORPHAN_PURGE_FAILED', purgedCount: 0, purgeFailedCount: 1 }
  }
}

/**
 * Write a validated bundle as a new version, activate it, then run `afterActivate`.
 *
 * @returns {Promise<{secretRef, versionNumber, supersededCount, purgeFailedCount, supersededRefs?}>}
 */
export async function storeValidatedCredential({
  store, tenantId, businessId, connectionId, kind, bundle, validationCode,
  actorPersonId = null, createdVia = 'BROWSER_MFA', expiresAt = null,
  afterActivate = null, onCompensation = null, onInvalidate = null,
}) {
  const scope = { tenantId, businessId, connectionId }
  const written = await store.write({ ...scope, kind, bundle, expiresAt, actorPersonId, createdVia })
  let activated = null
  try {
    activated = await store.activate({ ...scope, versionNumber: written.versionNumber, validationCode })
    const result = { ...written, ...activated }
    if (typeof onInvalidate === 'function') await onInvalidate({ connectionId, refs: [result.secretRef, ...(activated.supersededRefs ?? [])] })
    if (typeof afterActivate === 'function') await afterActivate(result)
    return result
  } catch (error) {
    const compensation = await compensate(store, scope, written, activated)
    if (typeof onInvalidate === 'function') await Promise.resolve(onInvalidate({ connectionId, refs: [written.secretRef] })).catch(() => {})
    if (typeof onCompensation === 'function') {
      await Promise.resolve(onCompensation({ ...compensation, versionNumber: written.versionNumber })).catch(() => {})
    }
    const normalized = normalizeSecretStoreError(error)
    // A lost race is the caller's to retry; anything else is reported as what
    // compensation did about it.
    if (normalized.code === 'CREDENTIAL_VERSION_CONFLICT') throw normalized
    if (compensation.outcome === 'NOT_PURGED_ROTATION_ACTIVE') throw normalized
    throw new SecretStoreError(compensation.outcome)
  }
}

/**
 * Revoke a connection's credential: `fence` first, then purge every version.
 * `fence` receives nothing secret and should stop the account (ADR-061 D7).
 */
export async function revokeCredential({ store, tenantId, businessId, connectionId, reason, fence = null, onInvalidate = null }) {
  const scope = { tenantId, businessId, connectionId }
  if (typeof fence === 'function') await fence(scope)
  const result = await store.revoke({ ...scope, reason })
  if (typeof onInvalidate === 'function') await onInvalidate({ connectionId, refs: result.revokedRefs ?? [] })
  return result
}

/**
 * A restored snapshot cannot be trusted to hold live material (ADR-089 D5): every
 * credential that is not already REVOKED becomes REENTRY_REQUIRED, which no store
 * resolves, and the owner must enter the secret again.
 */
export async function markCredentialsReentryRequired(db, { connectionIds = null } = {}) {
  const where = { status: { notIn: ['REVOKED', 'REENTRY_REQUIRED'] } }
  if (Array.isArray(connectionIds)) where.connectionId = { in: connectionIds }
  const { count } = await db.integrationCredential.updateMany({
    where,
    data: { status: 'REENTRY_REQUIRED', version: { increment: 1 } },
  })
  return count
}
