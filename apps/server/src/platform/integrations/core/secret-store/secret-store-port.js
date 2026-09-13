// @req FR-223 — the SecretStorePort contract: write, activate, revoke and resolve a
//   provider credential through one port whatever store holds it; the vocabulary,
//   the reference grammar and the one bundle schema both stores validate against.
// @spec ADR-089 D1, D2, D5; SDD-097; SEC-030
// @tested tests/unit/integration/secret-store-port.test.js
//
// A reference names its store by prefix, and that is the only way a caller learns
// which store holds a secret:
//
//   supabase-vault:<uuid>     SUPABASE_VAULT    encrypted in the database (Supabase Vault)
//   envelope:<uuid>           ENVELOPE          encrypted in the app (AES-256-GCM envelope)
//   deployment-secret:<name>  DEPLOYMENT_MOUNT  operator's read-only mount, never writable
//
// Every error this port raises carries a stable code and an HTTP status and nothing
// else — never a `cause`, never a value it was given (SEC-030). A caller that needs
// to explain a refusal has the code; a log line that serialises the error has only
// the code.

import { z } from 'zod'
import { INTEGRATION_CREDENTIAL_CREATED_VIA, SECRET_KINDS, SECRET_STORES } from '@/lib/validation/enums'

export const SECRET_REF_PREFIX_BY_STORE = Object.freeze({
  SUPABASE_VAULT: 'supabase-vault',
  ENVELOPE: 'envelope',
  DEPLOYMENT_MOUNT: 'deployment-secret',
})

/** The value of ZURI_SECRET_STORE that selects each writable store. */
export const WRITABLE_STORE_BY_SETTING = Object.freeze({
  'supabase-vault': 'SUPABASE_VAULT',
  envelope: 'ENVELOPE',
})

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const REF_PATTERNS = Object.freeze({
  SUPABASE_VAULT: new RegExp(`^supabase-vault:${UUID}$`, 'i'),
  ENVELOPE: new RegExp(`^envelope:${UUID}$`, 'i'),
  DEPLOYMENT_MOUNT: /^deployment-secret:[A-Za-z0-9_-]{1,100}$/,
})

const STATUS_BY_CODE = Object.freeze({
  CHANNEL_SECRET_SCOPE_MISMATCH: 404,
  CREDENTIAL_NOT_FOUND: 404,
  CHANNEL_SECRET_BUNDLE_INVALID: 400,
  CHANNEL_SECRET_KIND_UNSUPPORTED: 400,
  CREDENTIAL_VALIDATION_CODE_INVALID: 400,
  CREDENTIAL_VERSION_CONFLICT: 409,
  CHANNEL_SECRET_STORE_UNAVAILABLE: 503,
  SECRET_STORE_CONFIGURATION_INVALID: 503,
  CREDENTIAL_ORPHAN_PURGED: 500,
  CREDENTIAL_ORPHAN_PURGE_FAILED: 500,
})

export class SecretStoreError extends Error {
  constructor(code) {
    const known = Object.hasOwn(STATUS_BY_CODE, code) ? code : 'CHANNEL_SECRET_STORE_UNAVAILABLE'
    super(known)
    this.name = 'SecretStoreError'
    this.code = known
    this.status = STATUS_BY_CODE[known]
  }
}

/**
 * Re-raise anything as a SecretStoreError whose code is one this port defines.
 * A database error message is searched for a known code (the store functions raise
 * them by name) and otherwise dropped: its text may quote a parameter.
 */
export function normalizeSecretStoreError(error) {
  if (error instanceof SecretStoreError) return error
  const text = typeof error?.message === 'string' ? error.message : ''
  const code = Object.keys(STATUS_BY_CODE).find(candidate => text.includes(candidate))
  return new SecretStoreError(code ?? 'CHANNEL_SECRET_STORE_UNAVAILABLE')
}

/** The store a reference names, or null when it names none this port knows. */
export function secretStoreForRef(secretRef) {
  if (typeof secretRef !== 'string') return null
  const ref = secretRef.trim()
  return SECRET_STORES.find(store => REF_PATTERNS[store].test(ref)) ?? null
}

export function secretRefFor(store, id) {
  const ref = `${SECRET_REF_PREFIX_BY_STORE[store]}:${id}`
  if (secretStoreForRef(ref) !== store || store === 'DEPLOYMENT_MOUNT') throw new SecretStoreError('CHANNEL_SECRET_STORE_UNAVAILABLE')
  return ref
}

/** The opaque id after the prefix of a writable store's reference. */
export function secretIdFromRef(secretRef, store) {
  if (secretStoreForRef(secretRef) !== store) return null
  return secretRef.trim().slice(SECRET_REF_PREFIX_BY_STORE[store].length + 1).toLowerCase()
}

// The one bundle this wave accepts (ADR-089 D3). Channel ID is not secret; the
// secret is 32 lowercase hex; a long-lived token is an explicit override only.
export const LINE_CHANNEL_ID_PATTERN = /^[0-9]{6,20}$/
export const LINE_CHANNEL_SECRET_PATTERN = /^[0-9a-f]{32}$/
export const LINE_CHANNEL_ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9+/=_-]{40,4096}$/

const zLineChannelBundle = z.object({
  channelId: z.string().regex(LINE_CHANNEL_ID_PATTERN),
  channelSecret: z.string().regex(LINE_CHANNEL_SECRET_PATTERN),
  channelAccessToken: z.string().regex(LINE_CHANNEL_ACCESS_TOKEN_PATTERN).optional(),
}).strict()

/**
 * Validate a bundle for its kind and return a canonical copy whose every field is
 * non-enumerable, so the object cannot leak through JSON, a spread or a logger.
 * Throws CHANNEL_SECRET_BUNDLE_INVALID without saying which field failed.
 */
export function parseSecretBundle(kind, bundle) {
  if (kind !== 'LINE_CHANNEL') {
    throw new SecretStoreError(SECRET_KINDS.includes(kind) ? 'CHANNEL_SECRET_KIND_UNSUPPORTED' : 'CHANNEL_SECRET_BUNDLE_INVALID')
  }
  const parsed = zLineChannelBundle.safeParse(bundle)
  if (!parsed.success) throw new SecretStoreError('CHANNEL_SECRET_BUNDLE_INVALID')
  const sealed = {}
  for (const key of ['channelId', 'channelSecret', 'channelAccessToken']) {
    if (parsed.data[key] !== undefined) Object.defineProperty(sealed, key, { value: parsed.data[key], enumerable: false })
  }
  return Object.freeze(sealed)
}

/** Canonical JSON of a parsed bundle, fixed key order — the only form a store keeps. */
export function serializeSecretBundle(bundle) {
  const plain = { channelId: bundle.channelId, channelSecret: bundle.channelSecret }
  if (bundle.channelAccessToken !== undefined) plain.channelAccessToken = bundle.channelAccessToken
  return JSON.stringify(plain)
}

/** Last four characters of the non-secret identifier (ADR-089 D2) — never of a secret. */
export function displayHintFor(kind, bundle) {
  return kind === 'LINE_CHANNEL' ? bundle.channelId.slice(-4) : null
}

const zScope = z.object({
  tenantId: z.string().min(1).max(200),
  businessId: z.string().min(1).max(200),
  connectionId: z.string().min(1).max(200),
}).passthrough()

export function parseStoreScope(scope) {
  const parsed = zScope.safeParse(scope)
  if (!parsed.success) throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
  return parsed.data
}

export function parseCreatedVia(createdVia) {
  if (!INTEGRATION_CREDENTIAL_CREATED_VIA.includes(createdVia) || createdVia === 'BACKFILL') {
    throw new SecretStoreError('CHANNEL_SECRET_BUNDLE_INVALID')
  }
  return createdVia
}

const VALIDATION_CODE = /^[A-Z0-9_:]{1,80}$/
export function parseValidationCode(code) {
  if (typeof code !== 'string' || !VALIDATION_CODE.test(code)) throw new SecretStoreError('CREDENTIAL_VALIDATION_CODE_INVALID')
  return code
}

export function parseVersionNumber(value) {
  if (!Number.isInteger(value) || value < 1) throw new SecretStoreError('CREDENTIAL_VERSION_CONFLICT')
  return value
}

export function parseRevokeReason(reason) {
  const text = typeof reason === 'string' ? reason.trim() : ''
  return (text || 'REVOKED').slice(0, 200)
}

const PORT_METHODS = ['write', 'activate', 'revoke', 'resolve']

/**
 * Assert an object implements the SecretStorePort. Every writable store exposes:
 *
 *   write({ tenantId, businessId, connectionId, kind, bundle, expiresAt, actorPersonId, createdVia })
 *     → { secretRef, versionNumber }                          new version, PENDING_VALIDATION
 *   activate({ tenantId, businessId, connectionId, versionNumber, validationCode })
 *     → { secretRef, versionNumber, supersededCount, purgeFailedCount }
 *   revoke({ tenantId, businessId, connectionId, reason, versionNumber? })
 *     → { credentialStatus, revokedCount, purgedCount, purgeFailedCount }
 *       with versionNumber: rejects that pending version only
 *   resolve(secretRef, { tenantId, businessId, connectionId, destination })
 *     → { material, version, expiresAt }                      raw; the dispatcher normalises it
 */
export function assertSecretStorePort(store) {
  if (!store || !SECRET_STORES.includes(store.store) || store.store === 'DEPLOYMENT_MOUNT'
    || PORT_METHODS.some(method => typeof store[method] !== 'function')) {
    throw new SecretStoreError('SECRET_STORE_CONFIGURATION_INVALID')
  }
  return store
}
