// @req FR-245 — the chat evidence cold archive writer, integrated with the FR-230
//   retention sweep (ADR-093 D2-D4, D6; SDD-103).
// @spec SEC-034, ADR-093 D2, D3, D4, D6; BR-002
// @tested tests/integration/crm-chat-evidence-archive.test.js
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { runRetentionSweep, RETENTION_SWEEP_TOMBSTONE } from '@/modules/crm/retention-sweep-service'
import {
  archiveAndTombstoneTenantMessages,
  verifyManifestChain,
} from '@/modules/crm/chat-evidence-archive-service'
import { openArchiveSegment, openCustomerArchiveKey } from '@/modules/crm/chat-evidence-archive-crypto'
import { RETENTION_DEFAULT_WINDOW_DAYS } from '@/lib/validation/enums'

const DAY_MS = 24 * 60 * 60 * 1000
let sequence = 0
let baseDir

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-cea-'))
})
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

/**
 * A fresh Portfolio → Tenant → Business, isolated to one test. The manifest
 * chain and the archive directory are both per-Tenant, so a test that asserts
 * on "the whole chain" or "everything under this Tenant's directory" needs a
 * Tenant nothing else in this file has ever swept — sharing one Tenant across
 * tests would make an earlier test's manifest (and its now-deleted temp
 * directory) part of a later test's chain.
 */
async function freshScope(label) {
  const suffix = randomUUID().slice(0, 8)
  const pf = await createPortfolio({ name: `CEA ${label} ${suffix}`, code: `PF-CEA-${suffix}` })
  const tenant = await createTenant({ portfolioId: pf.id, name: `CEA ${label} Tenant`, code: `TNT-CEA-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'ร้านหลักฐาน', code: `BUS-CEA-${suffix}` })
  return { tenant, business }
}

async function backdatedMessage({ tenant, business, ageDays, threadId, externalMessageId, text }) {
  const id = ++sequence
  const result = await ingestLineMessage({
    tenantId: tenant.id, businessId: business.id, lineUserId: `U-cea-${id}`,
    threadId: threadId ?? `TH-CEA-${id}`, text: text ?? `evidence ${id}`, externalMessageId: externalMessageId ?? `MI-CEA-${id}`,
  })
  await prisma.message.update({ where: { id: result.messageId }, data: { createdAt: new Date(Date.now() - ageDays * DAY_MS) } })
  return result
}

const candidateFor = (messageId) => prisma.message.findUnique({
  where: { id: messageId },
  select: {
    id: true, conversationId: true, direction: true, body: true, contentKind: true, sessionId: true, createdAt: true, externalMessageId: true,
    conversation: { select: { id: true, customerId: true, businessId: true } },
    attachments: true,
  },
})

const PAST = RETENTION_DEFAULT_WINDOW_DAYS.MESSAGE_BODY_AND_ATTACHMENTS + 1

describe('Chat evidence archive writer (FR-245, ADR-093)', () => {
  it('acceptance: writes, verifies and chains the archive, and tombstones only after', async () => {
    const { tenant, business } = await freshScope('acceptance')
    const message = await backdatedMessage({ tenant, business, ageDays: PAST, text: 'สัญญาลดราคาที่ต้องเก็บไว้เป็นหลักฐาน' })
    const before = await prisma.message.findUnique({ where: { id: message.messageId } })
    expect(before.body).not.toBe(RETENTION_SWEEP_TOMBSTONE)

    const result = await runRetentionSweep({ now: new Date(), baseDir })
    const counts = result.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS
    expect(counts.redactedMessages).toBeGreaterThanOrEqual(1)
    const manifestRef = counts.manifests.find((m) => m.tenantId === tenant.id)
    expect(manifestRef).toBeTruthy()
    expect((counts.archiveFailures ?? []).some((f) => f.tenantId === tenant.id)).toBe(false)

    const manifest = await prisma.archiveManifest.findUnique({ where: { id: manifestRef.manifestId } })
    expect(manifest.tenantId).toBe(tenant.id)
    expect(manifest.previousManifestId).toBeNull()
    expect(manifest.previousManifestHash).toBeNull()
    expect(manifest.messageCount).toBeGreaterThanOrEqual(1)

    // The file on disk really exists and really hashes to what the manifest claims.
    const filePath = path.join(baseDir, manifest.filePath)
    const bytes = await fs.readFile(filePath)
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.fileSha256)

    // Only now — after the file was written, read back and verified — is the
    // message body actually gone.
    const after = await prisma.message.findUnique({ where: { id: message.messageId } })
    expect(after.body).toBe(RETENTION_SWEEP_TOMBSTONE)
    expect(after.id).toBe(before.id)
    expect(after.direction).toBe(before.direction)

    // And the archive genuinely holds the original content, decryptable with
    // this Customer's own key.
    const lines = bytes.toString('utf8').trim().split('\n')
    const header = JSON.parse(lines[0])
    expect(header.tenantId).toBe(tenant.id)
    const segmentLine = lines.slice(1).find((line) => JSON.parse(line).customerId === message.customerId)
    expect(segmentLine).toBeTruthy()
    const segment = JSON.parse(segmentLine)
    const keyRow = await prisma.customerArchiveKey.findUnique({ where: { customerId: message.customerId } })
    expect(keyRow).toBeTruthy()
    const dek = openCustomerArchiveKey(keyRow, { customerId: message.customerId, tenantId: tenant.id })
    const gzipped = openArchiveSegment(segment, { dek, tenantId: tenant.id, customerId: message.customerId, runId: header.runId })
    const plaintext = gunzipSync(gzipped).toString('utf8')
    const archivedLines = plaintext.trim().split('\n').map((l) => JSON.parse(l))
    const archivedLine = archivedLines.find((l) => l.messageId === message.messageId)
    expect(archivedLine).toBeTruthy()
    expect(archivedLine.body).toBe('สัญญาลดราคาที่ต้องเก็บไว้เป็นหลักฐาน')
    expect(archivedLine.tenantId).toBe(tenant.id)
    expect(archivedLine.customerId).toBe(message.customerId)
  })

  it('chains a second run to the first, and verifyManifestChain confirms it end to end (including the files on disk)', async () => {
    const { tenant, business } = await freshScope('chain')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    const first = await runRetentionSweep({ now: new Date(), baseDir })
    const firstManifestId = first.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.manifests.find((m) => m.tenantId === tenant.id).manifestId

    await backdatedMessage({ tenant, business, ageDays: PAST })
    const second = await runRetentionSweep({ now: new Date(Date.now() + 1000), baseDir })
    const secondManifestId = second.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.manifests.find((m) => m.tenantId === tenant.id).manifestId

    const firstManifest = await prisma.archiveManifest.findUnique({ where: { id: firstManifestId } })
    const secondManifest = await prisma.archiveManifest.findUnique({ where: { id: secondManifestId } })
    expect(secondManifest.previousManifestId).toBe(firstManifest.id)
    expect(secondManifest.previousManifestHash).toBe(firstManifest.manifestHash)

    const chain = await verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true })
    expect(chain).toEqual({ valid: true })
  })

  it('exit criterion: tampering an archived file after the fact breaks the chain', async () => {
    const { tenant, business } = await freshScope('tamper')
    await backdatedMessage({ tenant, business, ageDays: PAST })
    const result = await runRetentionSweep({ now: new Date(), baseDir })
    const manifestRef = result.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS.manifests.find((m) => m.tenantId === tenant.id)
    const manifest = await prisma.archiveManifest.findUnique({ where: { id: manifestRef.manifestId } })

    // Nothing wrong yet.
    expect(await verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true })).toEqual({ valid: true })

    // An edit to the file on disk, made after archiving — the database row is
    // untouched, only the evidence itself changed.
    const filePath = path.join(baseDir, manifest.filePath)
    await fs.appendFile(filePath, 'TAMPERED\n')

    const chain = await verifyManifestChain(prisma, tenant.id, { baseDir, checkFiles: true })
    expect(chain).toEqual({ valid: false, brokenAtManifestId: manifest.id, reason: 'ARCHIVE_FILE_TAMPERED' })
  })

  it('fail-closed at the sweep level: a Tenant whose archive step fails keeps its content untouched while every other Tenant still archives', async () => {
    const healthy = await freshScope('fail-closed-healthy')
    const broken = await freshScope('fail-closed-broken')

    const brokenMessage = await backdatedMessage({ tenant: broken.tenant, business: broken.business, ageDays: PAST, text: 'ไม่ควรถูกลบ' })

    // Seed a CustomerArchiveKey row for that Customer that names a DIFFERENT
    // (but real — the FK requires an existing Tenant) Tenant than the one
    // that actually owns this Customer. This is the exact shape a scope
    // mismatch takes: a row that exists but cannot be honestly opened for the
    // Tenant asking. getOrCreateCustomerArchiveKeyDek must refuse this rather
    // than silently minting a second key or opening the wrong one.
    await prisma.customerArchiveKey.create({
      data: { customerId: brokenMessage.customerId, tenantId: healthy.tenant.id, kekId: 'v0', wrappedDek: 'x.y.z' },
    })

    const healthyMessage = await backdatedMessage({ tenant: healthy.tenant, business: healthy.business, ageDays: PAST, text: 'evidence that should archive fine' })

    const result = await runRetentionSweep({ now: new Date(), baseDir })
    const counts = result.countsByClass.MESSAGE_BODY_AND_ATTACHMENTS

    expect(counts.archiveFailures).toEqual(
      expect.arrayContaining([expect.objectContaining({ tenantId: broken.tenant.id, reason: 'ARCHIVE_KEY_SCOPE_MISMATCH' })]),
    )
    expect(counts.manifests.some((m) => m.tenantId === healthy.tenant.id)).toBe(true)

    const brokenAfter = await prisma.message.findUnique({ where: { id: brokenMessage.messageId } })
    expect(brokenAfter.body).toBe('ไม่ควรถูกลบ') // untouched — never tombstoned
    expect(await prisma.archiveManifest.findFirst({ where: { tenantId: broken.tenant.id } })).toBeNull()

    const healthyAfter = await prisma.message.findUnique({ where: { id: healthyMessage.messageId } })
    expect(healthyAfter.body).toBe(RETENTION_SWEEP_TOMBSTONE)
  })

  it('fail-closed at the writer level: a filesystem failure during the archive write leaves every candidate message untouched', async () => {
    const { tenant, business } = await freshScope('write-fails')
    const message = await backdatedMessage({ tenant, business, ageDays: PAST, text: 'must survive a failed archive write' })
    const candidate = await candidateFor(message.messageId)

    // Block the exact directory the writer needs to mkdir into, with a plain
    // file instead of a directory — a deterministic, portable way to make the
    // write fail before any file is created.
    const year = String(new Date().getUTCFullYear())
    await fs.mkdir(path.join(baseDir, tenant.id), { recursive: true })
    await fs.writeFile(path.join(baseDir, tenant.id, year), 'not a directory')

    await expect(archiveAndTombstoneTenantMessages(prisma, { tenantId: tenant.id, candidates: [candidate], now: new Date(), baseDir }))
      .rejects.toThrow()

    const after = await prisma.message.findUnique({ where: { id: message.messageId } })
    expect(after.body).toBe('must survive a failed archive write')
    // No manifest row was ever inserted for this Tenant — the transaction
    // that would have created one never ran.
    expect(await prisma.archiveManifest.count({ where: { tenantId: tenant.id } })).toBe(0)
  })

  it('never overwrites an existing archive file, even across two different messages', async () => {
    const { tenant, business } = await freshScope('no-overwrite')
    const first = await backdatedMessage({ tenant, business, ageDays: PAST, text: 'first run holds this' })
    const now = new Date()
    const fixedRunId = `fixed-run-${randomUUID()}`
    const result = await archiveAndTombstoneTenantMessages(prisma, {
      tenantId: tenant.id, candidates: [await candidateFor(first.messageId)], now, baseDir, runId: fixedRunId,
    })
    expect(result.archived).toBe(true)
    const finalPath = path.join(baseDir, result.manifest.filePath)
    const originalBytes = await fs.readFile(finalPath)

    // A second, unrelated message archived with the SAME runId (the collision
    // this guard exists for, however it arises) must refuse rather than
    // silently replace the first run's evidence.
    const second = await backdatedMessage({ tenant, business, ageDays: PAST, text: 'second message must not evict the first' })
    await expect(archiveAndTombstoneTenantMessages(prisma, {
      tenantId: tenant.id, candidates: [await candidateFor(second.messageId)], now, baseDir, runId: fixedRunId,
    })).rejects.toThrow('ARCHIVE_FILE_ALREADY_EXISTS')

    // The original file is byte-for-byte unchanged, and the second message was
    // never tombstoned by the refused attempt.
    expect(await fs.readFile(finalPath)).toEqual(originalBytes)
    const secondAfter = await prisma.message.findUnique({ where: { id: second.messageId } })
    expect(secondAfter.body).toBe('second message must not evict the first')
  })
})
