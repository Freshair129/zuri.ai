// @req FR-223 — the envelope store: the SecretStorePort for self-host, generic
//   Postgres and SQLite dev/test, where encryption happens in the app and the
//   database holds only ciphertext.
// @req FR-242, FR-273 — resolve() also serves OAUTH_CLIENT, MODEL_PROVIDER_KEY
//   and NOTION_OAUTH_TOKEN, scoped by the credential's stored secretKind
//   (cross-kind refusal) instead of the LINE-only provider/destination check,
//   which stays exactly as it was for LINE_CHANNEL. write() refuses a kind that
//   disagrees with an existing credential's stored secretKind, live or dead,
//   before sealing any material — a connectionId's kind cannot be silently
//   switched by a plain write (CREDENTIAL_KIND_MISMATCH).
// @spec ADR-089 D1, D5; ADR-109 D1; SDD-097; SDD-101; SEC-030; SEC-033; SEC-037
// @tested tests/unit/integration/envelope-secret-store.test.js, tests/integration/credential-vault-lifecycle.test.js,
//   tests/integration/credential-vault-provider-kinds-lifecycle.test.js,
//   tests/integration/notion-oauth-webhook.test.js
//
// Key hierarchy (ADR-089 D1, design §4.1):
//
//   KEK  ZURI_SECRET_KEK (64 hex) labelled v<ZURI_SECRET_KEK_VERSION>, retired keys
//        ZURI_SECRET_KEK_V<n> open only. Never stored, never exported.
//   DEK  32 random bytes per secret, stored only wrapped: AES-256-GCM under the KEK,
//        AAD = [envelope row id, kek label].
//   ct   AES-256-GCM(DEK, bundle JSON), AAD = [envelope row id, Tenant, Business,
//        connection, credential version].
//
// The AAD is built from the *caller's* scope and the version row, never from the
// envelope row: an envelope copied onto another connection's credential, or opened
// on behalf of another Tenant or Business, fails authentication and is refused as
// CHANNEL_SECRET_SCOPE_MISMATCH rather than decrypted.
//
// Lifecycle semantics are the same as the Supabase Vault functions
// (20260914140200_channel_secret_vault_functions.sql); the shared contract suite
// runs against both. Metadata changes commit first; purging material is a second
// step per version, so a purge that fails leaves the version REVOKED, REJECTED or
// SUPERSEDED — never PURGED — for a reconciler (ADR-089 D5).
//
// Outside production a missing KEK falls back to a fixed development key labelled
// v0, and production refuses every v0 envelope — the ADR-088 MFA seal's rule, so a
// development database restored into production cannot open.

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { INTEGRATION_CREDENTIAL_PURGEABLE_VERSION_STATUSES, INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES } from '@/lib/validation/enums'
import {
  RESOLVABLE_SECRET_KINDS,
  SecretStoreError,
  displayHintFor,
  normalizeSecretStoreError,
  parseCreatedVia,
  parseRevokeReason,
  parseSecretBundle,
  parseStoreScope,
  parseValidationCode,
  parseVersionNumber,
  secretIdFromRef,
  secretRefFor,
  secretStoreForRef,
  serializeSecretBundle,
} from './secret-store-port'

const ALGORITHM = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16
const HEX_KEY = /^[a-f0-9]{64}$/i
const KEK_LABEL = /^v(0|[1-9]\d{0,5})$/
const DEVELOPMENT_KEK = createHash('sha256').update('zuri-ai:IntegrationSecretEnvelope:development-only').digest()
const RESOLVE_WINDOW_MS = 5 * 60_000
const TX = { timeout: 15000, maxWait: 5000 }

function unavailable() {
  return new SecretStoreError('CHANNEL_SECRET_STORE_UNAVAILABLE')
}

/** The KEKs this deployment may use; throws CHANNEL_SECRET_STORE_UNAVAILABLE when unusable. */
export function resolveEnvelopeKeyring(env = process.env) {
  const production = env.NODE_ENV === 'production'
  const raw = env.ZURI_SECRET_KEK
  const versionText = String(env.ZURI_SECRET_KEK_VERSION ?? '1')
  const retired = (version) => {
    const value = env[`ZURI_SECRET_KEK_V${version}`]
    return typeof value === 'string' && HEX_KEY.test(value) ? Buffer.from(value, 'hex') : null
  }
  if (raw === undefined || raw === '') {
    if (production) throw unavailable()
    return {
      current: { label: 'v0', key: DEVELOPMENT_KEK },
      keyFor: label => (label === 'v0' ? DEVELOPMENT_KEK : retired(Number(label.slice(1)))),
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

function contentAad({ id, tenantId, businessId, connectionId, versionNumber }) {
  return aad(['IntegrationSecretEnvelope', id, tenantId, businessId ?? '', connectionId, versionNumber])
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
 * Seal one bundle for one envelope row. Returns the row's columns; the DEK is
 * wiped before returning and the plaintext never enters the result.
 */
export function sealSecretEnvelope({ id, tenantId, businessId, connectionId, versionNumber, plaintext }, env = process.env) {
  const { current } = resolveEnvelopeKeyring(env)
  const dek = randomBytes(32)
  try {
    const content = gcmSeal(dek, Buffer.from(plaintext, 'utf8'), contentAad({ id, tenantId, businessId, connectionId, versionNumber }))
    const wrapped = gcmSeal(current.key, dek, aad(['IntegrationSecretEnvelope.dek', id, current.label]))
    return {
      id,
      tenantId,
      businessId,
      connectionId,
      kekId: current.label,
      wrappedDek: [wrapped.nonce, wrapped.tag, wrapped.ciphertext].map(b => b.toString('base64url')).join('.'),
      iv: content.nonce.toString('base64'),
      tag: content.tag.toString('base64'),
      ciphertext: content.ciphertext.toString('base64'),
      aadVersion: versionNumber,
    }
  } finally {
    dek.fill(0)
  }
}

/**
 * Open an envelope row for a scope and version the caller proved from its own rows.
 * Authentication failure — a foreign Tenant, Business, connection or version, or any
 * tampering — is CHANNEL_SECRET_SCOPE_MISMATCH; an unknown key is STORE_UNAVAILABLE.
 */
export function openSecretEnvelope(row, { tenantId, businessId, connectionId, versionNumber }, env = process.env) {
  const keyring = resolveEnvelopeKeyring(env)
  if (!row || typeof row.kekId !== 'string' || !KEK_LABEL.test(row.kekId)) throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
  const kek = keyring.keyFor(row.kekId)
  if (!kek) throw unavailable()
  const parts = String(row.wrappedDek ?? '').split('.')
  if (parts.length !== 3) throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
  let dek
  try {
    const [nonce, tag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'))
    dek = gcmOpen(kek, { nonce, tag, ciphertext }, aad(['IntegrationSecretEnvelope.dek', row.id, row.kekId]))
    const plaintext = gcmOpen(dek, {
      nonce: Buffer.from(row.iv, 'base64'),
      tag: Buffer.from(row.tag, 'base64'),
      ciphertext: Buffer.from(row.ciphertext, 'base64'),
    }, contentAad({ id: row.id, tenantId, businessId, connectionId, versionNumber }))
    return plaintext.toString('utf8')
  } catch {
    throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
  } finally {
    dek?.fill(0)
  }
}

async function scopedConnection(tx, { tenantId, businessId, connectionId }) {
  const connection = await tx.integrationConnection.findUnique({ where: { id: connectionId } })
  if (!connection || connection.tenantId !== tenantId || connection.businessId !== businessId
    || connection.authorizationType !== 'SECRET_MANAGER') {
    throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
  }
  return connection
}

export function createEnvelopeSecretStore({ db = prisma, env = process.env, now = () => new Date() } = {}) {
  // Fail at composition, not at the first owner's write, when the key is unusable.
  resolveEnvelopeKeyring(env)

  /** Delete one version's envelope and mark it PURGED; false when it could not. */
  async function purgeVersion(version) {
    if (secretStoreForRef(version.secretRef) !== 'ENVELOPE') return false
    try {
      await db.$transaction(async tx => {
        await tx.integrationSecretEnvelope.deleteMany({ where: { id: secretIdFromRef(version.secretRef, 'ENVELOPE') } })
        await tx.integrationCredentialVersion.update({ where: { id: version.id }, data: { status: 'PURGED', purgedAt: now() } })
      }, TX)
      return true
    } catch {
      return false
    }
  }

  async function purgeAll(versions) {
    let purgedCount = 0
    let purgeFailedCount = 0
    for (const version of versions) {
      if (secretStoreForRef(version.secretRef) !== 'ENVELOPE') continue
      if (await purgeVersion(version)) purgedCount += 1
      else purgeFailedCount += 1
    }
    return { purgedCount, purgeFailedCount }
  }

  async function guarded(work) {
    try {
      return await work()
    } catch (error) {
      throw normalizeSecretStoreError(error)
    }
  }

  return Object.freeze({
    store: 'ENVELOPE',

    async write({ tenantId, businessId, connectionId, kind, bundle, expiresAt = null, actorPersonId = null, createdVia }) {
      const scope = parseStoreScope({ tenantId, businessId, connectionId })
      const parsed = parseSecretBundle(kind, bundle)
      parseCreatedVia(createdVia)
      const hint = displayHintFor(kind, parsed)
      return guarded(async () => {
        const superseded = []
        const result = await db.$transaction(async tx => {
          await scopedConnection(tx, scope)
          const credential = await tx.integrationCredential.findUnique({ where: { connectionId }, include: { versions: true } })
          // A connection's kind never changes underneath its credential by a plain
          // write, live or dead: refused before any material is sealed or a version
          // row is touched, in both the "rotate" and "replace a dead row" branches
          // below. Revoke first, or use a fresh connection, to change kind.
          if (credential && credential.secretKind !== kind) throw new SecretStoreError('CREDENTIAL_KIND_MISMATCH')
          const versionNumber = (credential?.version ?? 0) + 1
          const id = randomUUID()
          const secretRef = secretRefFor('ENVELOPE', id)
          await tx.integrationSecretEnvelope.create({
            data: {
              ...sealSecretEnvelope({ id, ...scope, versionNumber, plaintext: serializeSecretBundle(kind, parsed) }, env),
              expiresAt,
            },
          })
          const at = now()
          if (!credential) {
            const created = await tx.integrationCredential.create({
              data: {
                connectionId, secretRef, secretStore: 'ENVELOPE', secretKind: kind, status: 'PENDING_VALIDATION',
                displayHint: hint, expiresAt, version: 1,
              },
            })
            await tx.integrationCredentialVersion.create({
              data: {
                credentialId: created.id, tenantId, businessId, versionNumber: 1, secretRef, secretStore: 'ENVELOPE',
                status: 'PENDING_VALIDATION', displayHint: hint, createdById: actorPersonId, createdVia,
              },
            })
            return { secretRef, versionNumber: 1 }
          }
          // A newer write supersedes a pending one that never validated.
          for (const pending of credential.versions.filter(v => v.status === 'PENDING_VALIDATION')) {
            await tx.integrationCredentialVersion.update({
              where: { id: pending.id },
              data: { status: 'REJECTED', revokedAt: at, reason: 'SUPERSEDED_BY_NEWER_WRITE' },
            })
            superseded.push(pending)
          }
          if (credential.versions.length === 0) {
            // A credential written before version history existed (the mount path).
            await tx.integrationCredentialVersion.create({
              data: {
                credentialId: credential.id, tenantId, businessId, versionNumber: credential.version,
                secretRef: credential.secretRef, secretStore: credential.secretStore,
                status: INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES.includes(credential.status) ? 'ACTIVE' : 'REVOKED',
                createdVia: 'BACKFILL', createdAt: credential.createdAt,
              },
            })
          }
          const resolvable = INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES.includes(credential.status)
          const moved = await tx.integrationCredential.updateMany({
            where: { id: credential.id, version: credential.version },
            data: resolvable
              ? { status: 'ROTATING', version: versionNumber }
              : {
                  secretRef, secretStore: 'ENVELOPE', secretKind: kind, status: 'PENDING_VALIDATION', displayHint: hint,
                  expiresAt, revokedAt: null, revokeReason: null, version: versionNumber,
                },
          })
          if (moved.count !== 1) throw new SecretStoreError('CREDENTIAL_VERSION_CONFLICT')
          await tx.integrationCredentialVersion.create({
            data: {
              credentialId: credential.id, tenantId, businessId, versionNumber, secretRef, secretStore: 'ENVELOPE',
              status: 'PENDING_VALIDATION', displayHint: hint, createdById: actorPersonId, createdVia,
            },
          })
          return { secretRef, versionNumber }
        }, TX)
        await purgeAll(superseded)
        return result
      })
    },

    async activate({ tenantId, businessId, connectionId, versionNumber, validationCode }) {
      const scope = parseStoreScope({ tenantId, businessId, connectionId })
      parseVersionNumber(versionNumber)
      parseValidationCode(validationCode)
      return guarded(async () => {
        const previous = []
        const result = await db.$transaction(async tx => {
          await scopedConnection(tx, scope)
          const credential = await tx.integrationCredential.findUnique({ where: { connectionId }, include: { versions: true } })
          if (!credential) throw new SecretStoreError('CREDENTIAL_NOT_FOUND')
          const pending = credential.versions.find(v => v.versionNumber === versionNumber && v.status === 'PENDING_VALIDATION')
          if (!pending || credential.version !== versionNumber) throw new SecretStoreError('CREDENTIAL_VERSION_CONFLICT')
          const at = now()
          const active = credential.versions.filter(v => v.status === 'ACTIVE' && v.id !== pending.id)
          const moved = await tx.integrationCredential.updateMany({
            where: { id: credential.id, version: credential.version },
            data: {
              secretRef: pending.secretRef, secretStore: pending.secretStore, status: 'ACTIVE', displayHint: pending.displayHint,
              lastValidatedAt: at, lastValidationCode: validationCode, revokedAt: null, revokeReason: null,
              ...(active.length > 0 ? { rotatedAt: at } : {}),
            },
          })
          if (moved.count !== 1) throw new SecretStoreError('CREDENTIAL_VERSION_CONFLICT')
          await tx.integrationCredentialVersion.update({ where: { id: pending.id }, data: { status: 'ACTIVE', activatedAt: at } })
          for (const old of active) {
            const here = secretStoreForRef(old.secretRef) === 'ENVELOPE'
            await tx.integrationCredentialVersion.update({
              where: { id: old.id },
              data: { status: 'SUPERSEDED', supersededAt: at, ...(here ? {} : { reason: 'MATERIAL_OUTSIDE_THIS_STORE' }) },
            })
            previous.push(old)
          }
          return { secretRef: pending.secretRef, versionNumber, supersededCount: active.length }
        }, TX)
        const { purgeFailedCount } = await purgeAll(previous)
        return { ...result, supersededRefs: previous.map(v => v.secretRef), purgeFailedCount }
      })
    },

    async revoke({ tenantId, businessId, connectionId, reason, versionNumber = null }) {
      const scope = parseStoreScope({ tenantId, businessId, connectionId })
      const why = parseRevokeReason(reason)
      if (versionNumber !== null) parseVersionNumber(versionNumber)
      return guarded(async () => {
        const toPurge = []
        const result = await db.$transaction(async tx => {
          await scopedConnection(tx, scope)
          const credential = await tx.integrationCredential.findUnique({ where: { connectionId }, include: { versions: true } })
          if (!credential) throw new SecretStoreError('CREDENTIAL_NOT_FOUND')
          const at = now()
          if (versionNumber !== null) {
            const pending = credential.versions.find(v => v.versionNumber === versionNumber && v.status === 'PENDING_VALIDATION')
            if (!pending) throw new SecretStoreError('CREDENTIAL_VERSION_CONFLICT')
            await tx.integrationCredentialVersion.update({ where: { id: pending.id }, data: { status: 'REJECTED', revokedAt: at, reason: why } })
            let credentialStatus = credential.status
            if (credential.status === 'ROTATING') credentialStatus = 'ACTIVE'
            else if (credential.status === 'PENDING_VALIDATION' && credential.secretRef === pending.secretRef) credentialStatus = 'REVOKED'
            if (credentialStatus !== credential.status) {
              await tx.integrationCredential.update({
                where: { id: credential.id },
                data: credentialStatus === 'REVOKED'
                  ? { status: 'REVOKED', revokedAt: at, revokeReason: why, version: { increment: 1 } }
                  : { status: credentialStatus },
              })
            }
            toPurge.push(pending)
            return { credentialStatus, revokedCount: 1 }
          }
          if (credential.status !== 'REVOKED') {
            await tx.integrationCredential.update({
              where: { id: credential.id },
              data: { status: 'REVOKED', revokedAt: at, revokeReason: why, version: { increment: 1 } },
            })
          }
          const live = credential.versions.filter(v => INTEGRATION_CREDENTIAL_PURGEABLE_VERSION_STATUSES.includes(v.status))
          for (const version of live) {
            if (version.status !== 'REVOKED') {
              await tx.integrationCredentialVersion.update({ where: { id: version.id }, data: { status: 'REVOKED', revokedAt: at, reason: why } })
            }
            toPurge.push(version)
          }
          return { credentialStatus: 'REVOKED', revokedCount: live.length }
        }, TX)
        const purged = await purgeAll(toPurge)
        return { ...result, ...purged, revokedRefs: toPurge.map(v => v.secretRef) }
      })
    },

    // `kind` defaults to LINE_CHANNEL so every existing caller (the LINE runtime,
    // the dispatching manager, every test that predates FR-242) is unaffected: it
    // gets exactly today's checks — destination required, provider must be
    // LINE_OA. A caller resolving OAUTH_CLIENT, MODEL_PROVIDER_KEY or
    // NOTION_OAUTH_TOKEN material passes its kind explicitly; the credential's
    // stored `secretKind` must
    // equal it, which is the cross-kind refusal (a MODEL_PROVIDER_KEY ref never
    // resolves as LINE_CHANNEL or vice versa) — and neither new kind has a
    // provider-code allow-list, since no fixed provider list exists for them yet
    // (documented choice, not an oversight; see FR-242 draft notes).
    async resolve(secretRef, { tenantId, businessId, connectionId, destination, kind = 'LINE_CHANNEL' } = {}) {
      const id = secretIdFromRef(secretRef, 'ENVELOPE')
      if (!id || !RESOLVABLE_SECRET_KINDS.includes(kind)) throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
      if (kind === 'LINE_CHANNEL' && (typeof destination !== 'string' || !destination)) {
        throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
      }
      const scope = parseStoreScope({ tenantId, businessId, connectionId })
      return guarded(async () => {
        const at = now()
        const ref = secretRefFor('ENVELOPE', id)
        const credential = await db.integrationCredential.findFirst({
          where: { secretRef: ref, connectionId: scope.connectionId, secretKind: kind, status: { in: INTEGRATION_CREDENTIAL_RESOLVABLE_STATUSES } },
          include: { connection: { include: { provider: true } }, versions: { where: { secretRef: ref, status: 'ACTIVE' } } },
        })
        const connection = credential?.connection
        if (!credential || !connection || connection.tenantId !== scope.tenantId || connection.businessId !== scope.businessId
          || connection.status !== 'ACTIVE' || connection.authorizationType !== 'SECRET_MANAGER'
          || (kind === 'LINE_CHANNEL' && connection.provider?.code !== 'LINE_OA')
          || (destination !== undefined && destination !== null && connection.externalAccountId !== destination)
          || (credential.expiresAt && credential.expiresAt.getTime() <= at.getTime())
          || credential.versions.length !== 1) {
          throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
        }
        const row = await db.integrationSecretEnvelope.findUnique({ where: { id } })
        if (!row || row.connectionId !== scope.connectionId) throw new SecretStoreError('CHANNEL_SECRET_SCOPE_MISMATCH')
        const [version] = credential.versions
        const material = openSecretEnvelope(row, { ...scope, versionNumber: version.versionNumber }, env)
        const cap = at.getTime() + RESOLVE_WINDOW_MS
        const result = {
          version: `credential-v${version.versionNumber}`,
          expiresAt: new Date(credential.expiresAt ? Math.min(credential.expiresAt.getTime(), cap) : cap),
        }
        Object.defineProperty(result, 'material', { value: material, enumerable: false })
        return result
      })
    },
  })
}
