// @req FR-293 — only source-bound disposable TEST targets may confirm replace-all.
// @spec ADR-115, SEC-008
// @tested tests/unit/managed-blob-transfer-test-admission.test.js
import { constants as fsConstants } from 'node:fs'
import { open } from 'node:fs/promises'
import { createHash, createPublicKey, verify } from 'node:crypto'
import path from 'node:path'
import { canonicalJSON } from './handoff-contract'

export const MANAGED_BLOB_TRANSFER_TEST_ADMISSION_ENVELOPE = 'managed-blob-transfer-test-admission-envelope.v1'
export const MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS = 'managed-blob-transfer-test-admission.v1'
export const MANAGED_BLOB_TRANSFER_TEST_ADMISSION_MAX_TTL_MS = 15 * 60 * 1000

const MAX_ADMISSION_BYTES = 16 * 1024
const MAX_PUBLIC_KEY_BYTES = 8 * 1024
const HASH = /^[a-f0-9]{64}$/
const REVISION = /^[a-f0-9]{40}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const CLAIM_KEYS = [
  'admissionId', 'databaseName', 'databaseOid', 'environment', 'expiresAt', 'maintenanceMode', 'packageSha256',
  'quiesced', 'schemaVersion', 'sourceEvidenceSha256', 'sourceRevision', 'syntheticDatasetSha256',
  'targetConfigSha256', 'targetFingerprintSha256', 'targetGeneration', 'targetId', 'transferJobId', 'issuedAt',
].sort()
const sha256 = value => createHash('sha256').update(value).digest('hex')

function refused() {
  return Object.assign(new Error('Managed blob transfer TEST admission refused'), {
    status: 503, code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED',
  })
}

function hasKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === expected.join('\0')
}

async function readBoundedRegularFile(filePath, maxBytes) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw refused()
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)
  const handle = await open(filePath, flags)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw refused()
    const bytes = await handle.readFile()
    if (bytes.length <= 0 || bytes.length > maxBytes) throw refused()
    return bytes
  } finally {
    await handle.close()
  }
}

function canonicalInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : null
}

export function managedBlobTransferTestTargetFingerprint(identity) {
  if (identity?.databaseName !== 'zuri_server_test' || !/^\d+$/.test(identity.databaseOid || '')
    || !['127.0.0.1', '::1'].includes(identity.serverAddress)
    || !/^\d+$/.test(identity.systemIdentifier || '') || typeof identity.directory !== 'string') throw refused()
  return sha256(Buffer.from(canonicalJSON({ databaseName: identity.databaseName, databaseOid: identity.databaseOid,
    serverAddress: identity.serverAddress, systemIdentifier: identity.systemIdentifier,
    directorySha256: sha256(Buffer.from(identity.directory)) })))
}

function validateClaims(claims, expected, now, { allowExpired = false } = {}) {
  if (!hasKeys(claims, CLAIM_KEYS)
    || claims.schemaVersion !== MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS
    || claims.environment !== 'TEST' || claims.databaseName !== 'zuri_server_test'
    || !/^\d+$/.test(claims.databaseOid || '') || !UUID.test(claims.transferJobId || '')
    || !UUID.test(claims.admissionId || '') || !HASH.test(claims.targetFingerprintSha256 || '')
    || !HASH.test(claims.syntheticDatasetSha256 || '') || !HASH.test(claims.targetConfigSha256 || '')
    || !HASH.test(claims.sourceEvidenceSha256 || '') || !HASH.test(claims.packageSha256 || '')
    || !REVISION.test(claims.sourceRevision || '') || !Number.isSafeInteger(claims.targetGeneration)
    || claims.targetGeneration < 1 || typeof claims.targetId !== 'string'
    || claims.maintenanceMode !== true || claims.quiesced !== true) throw refused()
  const issuedAt = canonicalInstant(claims.issuedAt), expiresAt = canonicalInstant(claims.expiresAt)
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt
    || expiresAt - issuedAt > MANAGED_BLOB_TRANSFER_TEST_ADMISSION_MAX_TTL_MS
    || issuedAt > now + 30_000 || (!allowExpired && expiresAt <= now)) throw refused()
  if (claims.databaseName !== expected.databaseName || claims.databaseOid !== expected.databaseOid
    || claims.transferJobId !== expected.transferJobId || claims.targetId !== expected.targetId
    || claims.targetFingerprintSha256 !== expected.targetFingerprintSha256
    || claims.targetGeneration !== expected.targetGeneration || claims.targetConfigSha256 !== expected.targetConfigHash
    || claims.sourceRevision !== expected.sourceRevision || claims.packageSha256 !== expected.packageSha256) throw refused()
  return claims
}

// The test harness owns the Ed25519 private key and writes a short-lived,
// package- and target-bound envelope. The app receives only the public key.
// No request field can select the file, key, target, provider, or source claims.
export function createManagedBlobTransferTestAdmissionFromEnvironment(env = process.env, clock = () => Date.now()) {
  const admissionFile = env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE
  const publicKeyFile = env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE
  if (!publicKeyFile || !path.isAbsolute(publicKeyFile)
    || (admissionFile && !path.isAbsolute(admissionFile))) return null
  async function verifyClaims(claims, signatureValue, expected, { allowExpired = false } = {}) {
    const publicKeyBytes = await readBoundedRegularFile(publicKeyFile, MAX_PUBLIC_KEY_BYTES)
    const verifiedClaims = validateClaims(claims, expected, clock(), { allowExpired })
    const signature = Buffer.from(signatureValue || '', 'base64url')
    if (signature.length !== 64 || signature.toString('base64url') !== signatureValue
      || !verify(null, Buffer.from(canonicalJSON(verifiedClaims)), createPublicKey(publicKeyBytes), signature)) throw refused()
    return Object.freeze({ ...verifiedClaims, signature: signatureValue })
  }
  return Object.freeze({
    async authorize(expected) {
      try {
        if (!admissionFile) throw refused()
        const admissionBytes = await readBoundedRegularFile(admissionFile, MAX_ADMISSION_BYTES)
        const raw = admissionBytes.toString('utf8')
        const envelope = JSON.parse(raw)
        if (canonicalJSON(envelope) !== raw
          || !hasKeys(envelope, ['claims', 'schemaVersion', 'signature'].sort())
          || envelope.schemaVersion !== MANAGED_BLOB_TRANSFER_TEST_ADMISSION_ENVELOPE
          || typeof envelope.signature !== 'string') throw refused()
        return await verifyClaims(envelope.claims, envelope.signature, expected)
      } catch {
        throw refused()
      }
    },
    async verifyPersisted(admission, expected) {
      try {
        if (!hasKeys(admission, [...CLAIM_KEYS, 'signature'].sort()) || typeof admission.signature !== 'string') throw refused()
        const claims = Object.fromEntries(Object.entries(admission).filter(([key]) => key !== 'signature'))
        return await verifyClaims(claims, admission.signature, expected, { allowExpired: true })
      } catch {
        throw refused()
      }
    },
  })
}
