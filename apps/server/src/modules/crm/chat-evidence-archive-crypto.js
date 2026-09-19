// @req FR-245 — the chat evidence archive's cryptography (ADR-093 D4; SEC-034).
//   Same construction `envelope-secret-store.js` already uses for
//   IntegrationSecretEnvelope — AES-256-GCM, a KEK/DEK hierarchy, additional
//   authenticated data that binds scope into the ciphertext — deliberately
//   under a SEPARATE key-encryption key, `ZURI_ARCHIVE_KEK`, so this module
//   never reads or accepts `ZURI_SECRET_KEK`. Compromising one secret store
//   must never open the other.
// @spec SEC-034, ADR-093 D4, D6
// @tested tests/unit/crm-chat-evidence-archive-crypto.test.js
//
// Key hierarchy (mirrors envelope-secret-store.js's ADR-089 D1 shape):
//
//   KEK  ZURI_ARCHIVE_KEK (64 hex) labelled v<ZURI_ARCHIVE_KEK_VERSION>, retired
//        keys ZURI_ARCHIVE_KEK_V<n> open only. Never stored, never exported.
//   DEK  32 random bytes per Customer, stored only wrapped: AES-256-GCM under
//        the KEK, AAD = ['CustomerArchiveKey', customerId, tenantId, kekLabel].
//        One row per Customer (CustomerArchiveKey), created lazily.
//   ct   AES-256-GCM(DEK, gzip(JSON Lines)), AAD = ['ChatEvidenceArchiveSegment',
//        tenantId, customerId, runId].
//
// The segment AAD binds the exact Customer, Tenant and archive run a segment
// was sealed for. Decrypting it under any other Customer's DEK fails
// authentication at the cipher — GCM refuses before a single plaintext byte is
// produced — rather than merely being "not currently attempted": there is no
// code path, correct or buggy, that can turn another Customer's key plus this
// ciphertext into this Customer's messages. The same is true of the AAD alone:
// the right key with a relabelled customerId/tenantId/runId also fails.
//
// Outside production a missing KEK falls back to a fixed development key
// labelled v0, and production refuses every v0 segment or wrapped key — the
// same ADR-088/ADR-089 rule, so a development database restored into
// production cannot open (and, symmetrically, a production wrapped key can
// never silently resolve against the fixed development key).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEX_KEY = /^[a-f0-9]{64}$/i
const KEK_LABEL = /^v(0|[1-9]\d{0,5})$/
const DEVELOPMENT_KEK = createHash('sha256').update('zuri-ai:ChatEvidenceArchive:development-only').digest()

export class ChatEvidenceArchiveCryptoError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ChatEvidenceArchiveCryptoError'
    this.code = code
  }
}

function unavailable() {
  return new ChatEvidenceArchiveCryptoError('ARCHIVE_KEK_UNAVAILABLE')
}

/**
 * The KEKs this deployment may use for the chat evidence archive. Deliberately
 * reads only `ZURI_ARCHIVE_KEK*` — never `ZURI_SECRET_KEK`, the credential
 * vault's own KEK (ADR-093 D4: "never under ZURI_SECRET_KEK").
 */
export function resolveArchiveKeyring(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const raw = env.ZURI_ARCHIVE_KEK
  const versionText = String(env.ZURI_ARCHIVE_KEK_VERSION ?? '1')
  const retired = (version) => {
    const value = env[`ZURI_ARCHIVE_KEK_V${version}`]
    return typeof value === 'string' && HEX_KEY.test(value) ? Buffer.from(value, 'hex') : null
  }
  if (raw === undefined || raw === '') {
    if (production) throw unavailable()
    return {
      current: { label: 'v0', key: DEVELOPMENT_KEK },
      keyFor: (label) => (label === 'v0' ? DEVELOPMENT_KEK : retired(Number(label.slice(1)))),
    }
  }
  if (!HEX_KEY.test(raw) || !/^[1-9]\d{0,5}$/.test(versionText)) throw unavailable()
  const current = { label: `v${versionText}`, key: Buffer.from(raw, 'hex') }
  return {
    current,
    keyFor(label) {
      if (label === current.label) return current.key
      if (label === 'v0') return production ? null : DEVELOPMENT_KEK
      return retired(Number(label.slice(1)))
    },
  }
}

function aad(parts) {
  return Buffer.from(JSON.stringify(parts), 'utf8')
}

function dekWrapAad({ customerId, tenantId, kekLabel }) {
  return aad(['CustomerArchiveKey', customerId, tenantId, kekLabel])
}

function segmentAad({ tenantId, customerId, runId }) {
  return aad(['ChatEvidenceArchiveSegment', tenantId, customerId, runId])
}

function gcmSeal(key, plaintext, additionalData) {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(additionalData)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return { nonce, tag: cipher.getAuthTag(), ciphertext }
}

function gcmOpen(key, { nonce, tag, ciphertext }, additionalData) {
  const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES })
  decipher.setAAD(additionalData)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

/**
 * Mint a fresh 32-byte data key for one Customer, wrapped under the current
 * archive KEK. Returns the `CustomerArchiveKey` row's columns; the plaintext
 * DEK is returned alongside it (the caller needs it immediately, to seal this
 * run's segment) and is the caller's responsibility to wipe when done.
 */
export function mintCustomerArchiveKey({ customerId, tenantId }, env = process.env) {
  const { current } = resolveArchiveKeyring(env)
  const dek = randomBytes(32)
  const wrapped = gcmSeal(current.key, dek, dekWrapAad({ customerId, tenantId, kekLabel: current.label }))
  return {
    row: {
      customerId,
      tenantId,
      kekId: current.label,
      wrappedDek: [wrapped.nonce, wrapped.tag, wrapped.ciphertext].map((b) => b.toString('base64url')).join('.'),
    },
    dek,
  }
}

/**
 * Unwrap a stored `CustomerArchiveKey` row's DEK for this exact Customer and
 * Tenant. A row copied onto another Customer's id, or opened for another
 * Tenant, fails authentication and is refused as ARCHIVE_KEY_SCOPE_MISMATCH
 * rather than decrypted — the AAD carries no ambient trust in the caller's
 * claimed scope, only what the row itself can prove.
 */
export function openCustomerArchiveKey(row, { customerId, tenantId }, env = process.env) {
  const keyring = resolveArchiveKeyring(env)
  if (!row || typeof row.kekId !== 'string' || !KEK_LABEL.test(row.kekId)) {
    throw new ChatEvidenceArchiveCryptoError('ARCHIVE_KEY_SCOPE_MISMATCH')
  }
  const kek = keyring.keyFor(row.kekId)
  if (!kek) throw unavailable()
  const parts = String(row.wrappedDek ?? '').split('.')
  if (parts.length !== 3) throw new ChatEvidenceArchiveCryptoError('ARCHIVE_KEY_SCOPE_MISMATCH')
  try {
    const [nonce, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'))
    return gcmOpen(kek, { nonce, tag, ciphertext }, dekWrapAad({ customerId, tenantId, kekLabel: row.kekId }))
  } catch {
    throw new ChatEvidenceArchiveCryptoError('ARCHIVE_KEY_SCOPE_MISMATCH')
  }
}

/**
 * Seal one Customer's plaintext segment (already gzipped by the caller) under
 * their DEK, bound to this exact Tenant/Customer/run.
 */
export function sealArchiveSegment({ dek, tenantId, customerId, runId, plaintext }) {
  const sealed = gcmSeal(dek, plaintext, segmentAad({ tenantId, customerId, runId }))
  return {
    customerId,
    iv: sealed.nonce.toString('base64'),
    tag: sealed.tag.toString('base64'),
    ciphertext: sealed.ciphertext.toString('base64'),
  }
}

/**
 * Open one Customer's segment with an already-unwrapped DEK. The AAD binds
 * exactly the scope this call claims: a DEK belonging to a different Customer,
 * or the right DEK opened against a relabelled tenantId/customerId/runId, both
 * fail GCM authentication before any plaintext is produced.
 */
export function openArchiveSegment(segment, { dek, tenantId, customerId, runId }) {
  try {
    const nonce = Buffer.from(segment.iv, 'base64')
    const tag = Buffer.from(segment.tag, 'base64')
    const ciphertext = Buffer.from(segment.ciphertext, 'base64')
    return gcmOpen(dek, { nonce, tag, ciphertext }, segmentAad({ tenantId, customerId, runId }))
  } catch {
    throw new ChatEvidenceArchiveCryptoError('ARCHIVE_SEGMENT_SCOPE_MISMATCH')
  }
}
