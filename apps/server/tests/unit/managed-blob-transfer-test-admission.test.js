// @req FR-293 — TEST admission is source-, package-, generation- and target-bound.
// @spec ADR-115, SEC-008
// @tested tests/unit/managed-blob-transfer-test-admission.test.js
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJSON } from '@/modules/project-manager/application/handoff-contract'
import { createManagedBlobTransferTestAdmissionFromEnvironment,
  MANAGED_BLOB_TRANSFER_TEST_ADMISSION_ENVELOPE, MANAGED_BLOB_TRANSFER_TEST_ADMISSION_MAX_TTL_MS,
  MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS, managedBlobTransferTestTargetFingerprint }
  from '@/modules/project-manager/application/managed-blob-transfer-test-admission'

const sha = value => createHash('sha256').update(value).digest('hex')
const now = Date.parse('2026-11-02T00:00:00.000Z')
let root

async function admissionFixture(overrides = {}) {
  root = await mkdtemp(path.join(tmpdir(), 'zuri-transfer-admission-'))
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const admissionFile = path.join(root, 'admission.json')
  const publicKeyFile = path.join(root, 'admission-public.pem')
  await writeFile(publicKeyFile, publicKey.export({ type: 'spki', format: 'pem' }))
  const claims = {
    schemaVersion: MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS, environment: 'TEST', databaseName: 'zuri_server_test',
    databaseOid: '16384', transferJobId: randomUUID(),
    targetId: 'embedded-postgres:0123456789abcdef', targetFingerprintSha256: 'a'.repeat(64), targetGeneration: 7,
    syntheticDatasetSha256: 'b'.repeat(64), sourceRevision: 'c'.repeat(40), targetConfigSha256: 'd'.repeat(64),
    sourceEvidenceSha256: 'e'.repeat(64), packageSha256: 'f'.repeat(64), maintenanceMode: true, quiesced: true,
    admissionId: randomUUID(), issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MANAGED_BLOB_TRANSFER_TEST_ADMISSION_MAX_TTL_MS).toISOString(),
    ...overrides,
  }
  const signature = sign(null, Buffer.from(canonicalJSON(claims)), privateKey).toString('base64url')
  const envelope = { schemaVersion: MANAGED_BLOB_TRANSFER_TEST_ADMISSION_ENVELOPE, claims, signature }
  await writeFile(admissionFile, canonicalJSON(envelope))
  return { env: { ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE: admissionFile,
    ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE: publicKeyFile }, claims,
    envelope, admissionFile, expected: { databaseName: claims.databaseName, databaseOid: claims.databaseOid,
      transferJobId: claims.transferJobId, targetId: claims.targetId,
      targetFingerprintSha256: claims.targetFingerprintSha256, targetGeneration: claims.targetGeneration,
      targetConfigHash: claims.targetConfigSha256, sourceRevision: claims.sourceRevision,
      packageSha256: claims.packageSha256 } }
}

afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = null })

describe('managed blob transfer TEST admission', () => {
  it('keeps the admitted target identity stable across a PostgreSQL process restart but changes for another cluster', () => {
    const identity = { databaseName: 'zuri_server_test', databaseOid: '16384', serverAddress: '127.0.0.1',
      systemIdentifier: '7421654902367012345', directory: '/var/lib/postgresql/data',
      startedAt: new Date('2026-11-02T00:00:00.000Z') }
    const fingerprint = managedBlobTransferTestTargetFingerprint(identity)
    expect(managedBlobTransferTestTargetFingerprint({ ...identity, startedAt: new Date('2026-11-02T00:05:00.000Z') }))
      .toBe(fingerprint)
    expect(managedBlobTransferTestTargetFingerprint({ ...identity, systemIdentifier: '7421654902367012346' }))
      .not.toBe(fingerprint)
  })

  it('accepts a signed, unexpired envelope only for its exact target, generation, profile, source and package', async () => {
    const fixture = await admissionFixture()
    const admission = createManagedBlobTransferTestAdmissionFromEnvironment(fixture.env, () => now)
    await expect(admission.authorize(fixture.expected)).resolves.toMatchObject({
      schemaVersion: MANAGED_BLOB_TRANSFER_TEST_ADMISSION_CLAIMS,
      admissionId: fixture.claims.admissionId, signature: expect.any(String),
    })
  })

  it('refuses a valid signature for a different package', async () => {
    const fixture = await admissionFixture()
    const admission = createManagedBlobTransferTestAdmissionFromEnvironment(fixture.env, () => now)
    await expect(admission.authorize({ ...fixture.expected, packageSha256: sha('other-package') }))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED', status: 503 })
  })

  it('refuses a modified signature and a different target generation', async () => {
    const fixture = await admissionFixture()
    const admission = createManagedBlobTransferTestAdmissionFromEnvironment(fixture.env, () => now)
    await expect(admission.authorize({ ...fixture.expected, targetGeneration: fixture.expected.targetGeneration + 1 }))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED' })
    fixture.envelope.signature = `${fixture.envelope.signature[0] === 'A' ? 'B' : 'A'}${fixture.envelope.signature.slice(1)}`
    await writeFile(fixture.admissionFile, canonicalJSON(fixture.envelope))
    await expect(admission.authorize(fixture.expected))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED' })
  })

  it('refuses an expired signed envelope and an incomplete runtime configuration', async () => {
    const fixture = await admissionFixture({ expiresAt: new Date(now - 1).toISOString() })
    const admission = createManagedBlobTransferTestAdmissionFromEnvironment(fixture.env, () => now)
    await expect(admission.authorize(fixture.expected))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED' })
    expect(createManagedBlobTransferTestAdmissionFromEnvironment({
      ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE: fixture.env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE,
    })).toBeNull()
  })

  it('revalidates a persisted signature after expiry only for the original database and claimed job', async () => {
    const fixture = await admissionFixture()
    const admission = createManagedBlobTransferTestAdmissionFromEnvironment(fixture.env, () => now)
    const persisted = await admission.authorize(fixture.expected)
    const afterExpiry = createManagedBlobTransferTestAdmissionFromEnvironment(fixture.env,
      () => now + MANAGED_BLOB_TRANSFER_TEST_ADMISSION_MAX_TTL_MS + 1)

    await expect(afterExpiry.authorize(fixture.expected))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED' })
    await expect(afterExpiry.verifyPersisted(persisted, fixture.expected)).resolves.toEqual(persisted)
    await expect(afterExpiry.verifyPersisted(persisted, { ...fixture.expected, databaseOid: '16385' }))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED' })
    await expect(afterExpiry.verifyPersisted(persisted, { ...fixture.expected, transferJobId: randomUUID() }))
      .rejects.toMatchObject({ code: 'MANAGED_BLOB_TRANSFER_NOT_ADMITTED' })
  })
})
