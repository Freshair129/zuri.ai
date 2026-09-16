// @req FR-245 — the chat evidence archive's cryptography and manifest chain
//   hashing, tested in isolation from the database and filesystem.
// @spec SEC-034, ADR-093 D4
// @tested tests/unit/crm-chat-evidence-archive-crypto.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ChatEvidenceArchiveCryptoError,
  mintCustomerArchiveKey,
  openArchiveSegment,
  openCustomerArchiveKey,
  resolveArchiveKeyring,
  sealArchiveSegment,
} from '@/modules/crm/chat-evidence-archive-crypto'
import { computeManifestHash, hashMessageIdList, verifyManifestChain } from '@/modules/crm/chat-evidence-archive-service'

const archiveKeyEnv = (extra = {}) => ({ ZURI_ARCHIVE_KEK: randomBytes(32).toString('hex'), ZURI_ARCHIVE_KEK_VERSION: '2', ...extra })

describe('resolveArchiveKeyring — never reads ZURI_SECRET_KEK', () => {
  it('falls back to the fixed development key when ZURI_ARCHIVE_KEK is unset, even if ZURI_SECRET_KEK is set', () => {
    const env = { ZURI_SECRET_KEK: randomBytes(32).toString('hex'), ZURI_SECRET_KEK_VERSION: '1' }
    const keyring = resolveArchiveKeyring(env)
    expect(keyring.current.label).toBe('v0')
  })

  it('refuses in production with no ZURI_ARCHIVE_KEK, regardless of ZURI_SECRET_KEK', () => {
    const env = { NODE_ENV: 'production', ZURI_SECRET_KEK: randomBytes(32).toString('hex') }
    expect(() => resolveArchiveKeyring(env)).toThrow(ChatEvidenceArchiveCryptoError)
  })

  it('uses ZURI_ARCHIVE_KEK when set, labelled by ZURI_ARCHIVE_KEK_VERSION', () => {
    const env = archiveKeyEnv()
    const keyring = resolveArchiveKeyring(env)
    expect(keyring.current.label).toBe('v2')
    expect(keyring.current.key.toString('hex')).toBe(env.ZURI_ARCHIVE_KEK)
  })
})

describe('CustomerArchiveKey wrap/unwrap', () => {
  it('wraps and opens a DEK for the exact Customer/Tenant it was minted for', () => {
    const env = archiveKeyEnv()
    const customerId = randomUUID()
    const tenantId = randomUUID()
    const { row, dek } = mintCustomerArchiveKey({ customerId, tenantId }, env)
    expect(row.kekId).toBe('v2')
    const opened = openCustomerArchiveKey(row, { customerId, tenantId }, env)
    expect(opened.equals(dek)).toBe(true)
  })

  it('refuses to open a row for another Customer or Tenant (CHANNEL-style AAD binding)', () => {
    const env = archiveKeyEnv()
    const customerId = randomUUID()
    const tenantId = randomUUID()
    const { row } = mintCustomerArchiveKey({ customerId, tenantId }, env)
    expect(() => openCustomerArchiveKey(row, { customerId: randomUUID(), tenantId }, env)).toThrow('ARCHIVE_KEY_SCOPE_MISMATCH')
    expect(() => openCustomerArchiveKey(row, { customerId, tenantId: randomUUID() }, env)).toThrow('ARCHIVE_KEY_SCOPE_MISMATCH')
  })

  it('refuses a tampered wrappedDek', () => {
    const env = archiveKeyEnv()
    const customerId = randomUUID()
    const tenantId = randomUUID()
    const { row } = mintCustomerArchiveKey({ customerId, tenantId }, env)
    const parts = row.wrappedDek.split('.')
    const ciphertext = Buffer.from(parts[2], 'base64url')
    ciphertext[0] ^= 1
    const tampered = { ...row, wrappedDek: [parts[0], parts[1], ciphertext.toString('base64url')].join('.') }
    expect(() => openCustomerArchiveKey(tampered, { customerId, tenantId }, env)).toThrow('ARCHIVE_KEY_SCOPE_MISMATCH')
  })

  it('never leaks the raw KEK or DEK bytes into the stored row', () => {
    const env = archiveKeyEnv()
    const { row, dek } = mintCustomerArchiveKey({ customerId: randomUUID(), tenantId: randomUUID() }, env)
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain(env.ZURI_ARCHIVE_KEK)
    expect(serialized).not.toContain(dek.toString('hex'))
    expect(serialized).not.toContain(dek.toString('base64'))
  })
})

describe('archive segment sealing — the exit criterion: another Customer\'s key must fail, cryptographically', () => {
  it('opens for the exact Tenant/Customer/run it was sealed for', () => {
    const tenantId = randomUUID()
    const customerId = randomUUID()
    const runId = 'run-1'
    const dek = randomBytes(32)
    const plaintext = Buffer.from('gzip-bytes-stand-in', 'utf8')
    const segment = sealArchiveSegment({ dek, tenantId, customerId, runId, plaintext })
    const opened = openArchiveSegment(segment, { dek, tenantId, customerId, runId })
    expect(opened.equals(plaintext)).toBe(true)
  })

  it('decrypting Customer A\'s segment with Customer B\'s key fails — not "unsupported", refused at the cipher', () => {
    const tenantId = randomUUID()
    const customerA = randomUUID()
    const customerB = randomUUID()
    const runId = 'run-1'
    const dekA = randomBytes(32)
    const dekB = randomBytes(32) // a different Customer's real, validly-generated key
    const plaintext = Buffer.from('customer A\'s gzip bytes', 'utf8')
    const segment = sealArchiveSegment({ dek: dekA, tenantId, customerId: customerA, runId, plaintext })

    // Wrong key entirely (the realistic cross-Customer attempt).
    expect(() => openArchiveSegment(segment, { dek: dekB, tenantId, customerId: customerA, runId })).toThrow('ARCHIVE_SEGMENT_SCOPE_MISMATCH')
    // Right key, but claiming another Customer's scope in the AAD — also refused,
    // because the AAD is not ambient trust in the caller's claim.
    expect(() => openArchiveSegment(segment, { dek: dekA, tenantId, customerId: customerB, runId })).toThrow('ARCHIVE_SEGMENT_SCOPE_MISMATCH')
  })

  it('refuses a segment opened for another Tenant or another run', () => {
    const tenantId = randomUUID()
    const customerId = randomUUID()
    const runId = 'run-1'
    const dek = randomBytes(32)
    const segment = sealArchiveSegment({ dek, tenantId, customerId, runId, plaintext: Buffer.from('x') })
    expect(() => openArchiveSegment(segment, { dek, tenantId: randomUUID(), customerId, runId })).toThrow('ARCHIVE_SEGMENT_SCOPE_MISMATCH')
    expect(() => openArchiveSegment(segment, { dek, tenantId, customerId, runId: 'run-2' })).toThrow('ARCHIVE_SEGMENT_SCOPE_MISMATCH')
  })

  it('refuses tampered ciphertext', () => {
    const tenantId = randomUUID()
    const customerId = randomUUID()
    const runId = 'run-1'
    const dek = randomBytes(32)
    const segment = sealArchiveSegment({ dek, tenantId, customerId, runId, plaintext: Buffer.from('hello') })
    const flipped = Buffer.from(segment.ciphertext, 'base64')
    flipped[0] ^= 1
    expect(() => openArchiveSegment({ ...segment, ciphertext: flipped.toString('base64') }, { dek, tenantId, customerId, runId }))
      .toThrow('ARCHIVE_SEGMENT_SCOPE_MISMATCH')
  })
})

describe('manifest chain hashing', () => {
  it('is deterministic regardless of message id order', () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    expect(hashMessageIdList(ids)).toBe(hashMessageIdList([...ids].reverse()))
  })

  it('changes if any id changes', () => {
    const ids = [randomUUID(), randomUUID()]
    const other = [...ids.slice(0, 1), randomUUID()]
    expect(hashMessageIdList(ids)).not.toBe(hashMessageIdList(other))
  })

  it('computeManifestHash changes if any bound field changes', () => {
    const base = {
      tenantId: 't1', runId: 'r1', filePath: 't1/2026/r1.zca', fileSha256: 'a'.repeat(64),
      messageCount: 3, messageIdListHash: 'b'.repeat(64), previousManifestHash: null,
    }
    const baseline = computeManifestHash(base)
    for (const field of Object.keys(base)) {
      if (field === 'previousManifestHash') continue
      const mutated = { ...base, [field]: `${base[field]}-changed` }
      expect(computeManifestHash(mutated)).not.toBe(baseline)
    }
    expect(computeManifestHash({ ...base, previousManifestHash: 'c'.repeat(64) })).not.toBe(baseline)
  })

  it('exit criterion: a tampered manifest row breaks the chain, at exactly the tampered row', async () => {
    const tenantId = randomUUID()
    const first = { tenantId, runId: 'r1', filePath: 't/2026/r1.zca', fileSha256: 'a'.repeat(64), messageCount: 1, messageIdListHash: 'x'.repeat(64), previousManifestHash: null }
    first.id = 'm1'
    first.manifestHash = computeManifestHash(first)
    const second = { tenantId, runId: 'r2', filePath: 't/2026/r2.zca', fileSha256: 'b'.repeat(64), messageCount: 2, messageIdListHash: 'y'.repeat(64), previousManifestHash: first.manifestHash }
    second.id = 'm2'
    second.manifestHash = computeManifestHash(second)

    const cleanDb = { archiveManifest: { findMany: async () => [first, second] } }
    expect(await verifyManifestChain(cleanDb, tenantId)).toEqual({ valid: true })

    // Tamper the FIRST row's recorded file hash without recomputing its manifestHash
    // (exactly what an attacker editing the database, rather than the file, would do).
    const tamperedFirst = { ...first, fileSha256: 'c'.repeat(64) }
    const tamperedDb = { archiveManifest: { findMany: async () => [tamperedFirst, second] } }
    const result = await verifyManifestChain(tamperedDb, tenantId)
    expect(result.valid).toBe(false)
    expect(result.brokenAtManifestId).toBe('m1')
    expect(result.reason).toBe('MANIFEST_HASH_MISMATCH')
  })

  it('detects a broken previous-hash link even when both rows are individually self-consistent', async () => {
    const tenantId = randomUUID()
    const first = { tenantId, runId: 'r1', filePath: 't/2026/r1.zca', fileSha256: 'a'.repeat(64), messageCount: 1, messageIdListHash: 'x'.repeat(64), previousManifestHash: null }
    first.id = 'm1'
    first.manifestHash = computeManifestHash(first)
    // Second row claims a previousManifestHash that does not match the first row's
    // actual hash, but its OWN manifestHash is internally consistent with that claim.
    const second = { tenantId, runId: 'r2', filePath: 't/2026/r2.zca', fileSha256: 'b'.repeat(64), messageCount: 2, messageIdListHash: 'y'.repeat(64), previousManifestHash: 'd'.repeat(64) }
    second.id = 'm2'
    second.manifestHash = computeManifestHash(second)
    const db = { archiveManifest: { findMany: async () => [first, second] } }
    const result = await verifyManifestChain(db, tenantId)
    expect(result.valid).toBe(false)
    expect(result.brokenAtManifestId).toBe('m2')
    expect(result.reason).toBe('PREVIOUS_HASH_MISMATCH')
  })
})

describe('migration — CustomerArchiveKey, ArchiveManifest (exit criterion: written, not applied)', () => {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const [file] = fs.readdirSync(dir).filter((name) => name.endsWith('_crm_chat_evidence_archive.sql'))
  // @req SEC-034 — TASK-ZAI-113 adds ArchiveManifest.fileDeletedAt via a SEPARATE,
  // later migration (never by editing this one — migrations are additive) rather
  // than by amending this file. Every field-containment check below reads the
  // concatenation of both files, so a column declared in either satisfies it; the
  // more specific checks (FKs, indexes) still only need to be true of one or the
  // other, which concatenation does not break.
  const [legalHoldFile] = fs.readdirSync(dir).filter((name) => name.endsWith('_crm_archive_legal_hold.sql'))
  const sql = (file ? fs.readFileSync(path.join(dir, file), 'utf8') : '')
    + (legalHoldFile ? fs.readFileSync(path.join(dir, legalHoldFile), 'utf8') : '')
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

  function modelFields(modelName) {
    const body = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1]
    return body.split('\n')
      .map((line) => /^\s+(\w+)\s+\w/.exec(line)?.[1])
      .filter(Boolean)
      .filter((name) => !['tenant', 'customer', 'previousManifest', 'nextManifests'].includes(name))
  }

  it('exists, is additive and idempotent, and is unapplied', () => {
    expect(file).toBeTruthy()
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/)
    expect(sql).toMatch(/NOT APPLIED to production by this change/)
  })

  it('creates every column each model declares, with FKs, forced RLS and runtime-only grants', () => {
    for (const model of ['CustomerArchiveKey', 'ArchiveManifest']) {
      for (const field of modelFields(model)) expect(sql).toContain(`"${field}"`)
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
      expect(sql).toContain(`ALTER TABLE "${model}" FORCE ROW LEVEL SECURITY`)
      expect(sql).toContain(`REVOKE ALL ON TABLE "${model}" FROM public, anon, authenticated, service_role`)
      expect(sql).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${model}" TO zuri_app_runtime, zuri_web_login`)
    }
  })

  it('declares no foreign key to Tenant or Customer — the IntegrationSecretEnvelope precedent, so a backup restore of those tables never fails on this excluded one', () => {
    expect(sql).not.toContain('REFERENCES "Tenant"("id")')
    expect(sql).not.toContain('REFERENCES "Customer"("id")')
    const customerArchiveKeyBody = /model CustomerArchiveKey \{([\s\S]*?)\n\}/.exec(schema)[1]
    const archiveManifestBody = /model ArchiveManifest \{([\s\S]*?)\n\}/.exec(schema)[1]
    expect(customerArchiveKeyBody).not.toMatch(/@relation\(fields: \[(tenantId|customerId)\]/)
    expect(archiveManifestBody).not.toMatch(/@relation\(fields: \[tenantId\]/)
  })

  it('does declare the self-referential chain link as a real foreign key — both ends are this same excluded table', () => {
    expect(schema).toMatch(/previousManifest ArchiveManifest\?\s+@relation\("ArchiveManifestChain", fields: \[previousManifestId\], references: \[id\]\)/)
    expect(sql).toContain('FOREIGN KEY ("previousManifestId") REFERENCES "ArchiveManifest"("id")')
  })

  it('enforces one key per Customer and one run id per Tenant', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "CustomerArchiveKey_customerId_key" ON "CustomerArchiveKey"("customerId")')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ArchiveManifest_tenantId_runId_key" ON "ArchiveManifest"("tenantId", "runId")')
  })
})
