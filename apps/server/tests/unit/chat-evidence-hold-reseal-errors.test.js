// @req FR-022, SEC-034 — rollback cleanup receives the exact archive file
//   identity after any failure that happens after a legal-hold re-seal writes.
// @spec ADR-093 D6; SEC-034
// @tested tests/unit/chat-evidence-hold-reseal-errors.test.js
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeArchiveFile } from '@/modules/crm/chat-evidence-archive-service'
import { resealErasedEvidenceUnderLegalHolds } from '@/modules/crm/chat-evidence-hold-reseal-service'

let baseDir

beforeEach(async () => {
  baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-hold-reseal-errors-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) {
    await fs.rm(baseDir, { recursive: true, force: true })
  }
})

function fakeErasureTransaction({ tenantId, erasedCustomerId, heldCustomerId, conversationId, speakerIdentityId, speakerPersonId, holdId, speakerAt, messageAt }) {
  return {
    _activeProvider: 'sqlite',
    customerRetentionConsent: {
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn().mockResolvedValue({ tenantId, customerId: heldCustomerId, revokedAt: null }),
    },
    conversation: {
      findMany: vi.fn().mockResolvedValue([{ id: conversationId, customerId: erasedCustomerId }]),
    },
    message: {
      findMany: vi.fn(async ({ where }) => where.direction === 'INBOUND'
        ? [{ conversationId, authorChannelIdentityId: speakerIdentityId, createdAt: speakerAt }]
        : [{ conversationId }]),
    },
    channelIdentity: {
      findMany: vi.fn().mockResolvedValue([{ id: speakerIdentityId, personId: speakerPersonId }]),
    },
    customer: {
      findMany: vi.fn(async ({ where }) => where.id
        ? [{ id: heldCustomerId, tenantId }]
        : [{ id: heldCustomerId, personId: speakerPersonId }]),
      findFirst: vi.fn().mockResolvedValue({ deletedAt: null }),
    },
    customerLegalHold: {
      findFirst: vi.fn().mockResolvedValue({ id: holdId, tenantId, customerId: heldCustomerId, endDate: new Date('2099-01-01T00:00:00.000Z') }),
    },
    archiveManifest: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockRejectedValue(new Error('manifest read failed after archive write')),
    },
    legalHoldArchiveKey: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    auditEvent: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

describe('FR-022 legal-hold re-seal file error propagation', () => {
  it('attaches rollback cleanup metadata when archiveManifest.findFirst fails after the file write', async () => {
    const tenantId = `tenant-${randomUUID()}`
    const erasedCustomerId = `erased-${randomUUID()}`
    const heldCustomerId = `held-${randomUUID()}`
    const conversationId = `conversation-${randomUUID()}`
    const speakerIdentityId = `identity-${randomUUID()}`
    const speakerPersonId = `person-${randomUUID()}`
    const holdId = `hold-${randomUUID()}`
    const now = new Date('2026-10-23T12:00:00.000Z')
    const messageAt = new Date(now.getTime() - 5_000)
    const tx = fakeErasureTransaction({
      tenantId, erasedCustomerId, heldCustomerId, conversationId, speakerIdentityId, speakerPersonId, holdId,
      speakerAt: new Date(messageAt.getTime() - 1_000), messageAt,
    })
    const capturedLines = [{
      id: `message-${randomUUID()}`,
      conversationId,
      direction: 'INBOUND',
      body: 'captured held evidence',
      contentKind: 'TEXT',
      sessionId: null,
      createdAt: messageAt,
      externalMessageId: `external-${randomUUID()}`,
      authorChannelIdentityId: speakerIdentityId,
      conversation: { id: conversationId, customerId: erasedCustomerId, businessId: `business-${randomUUID()}` },
      attachments: [],
    }]

    let caught
    try {
      await resealErasedEvidenceUnderLegalHolds(tx, {
        tenantId,
        erasedCustomerIds: [erasedCustomerId],
        speakerChannelIdentityIds: [speakerIdentityId],
        capturedLines,
        now,
        env: { NODE_ENV: 'test' },
        baseDir,
        includeArchivedCustomerLines: false,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ message: 'manifest read failed after archive write' })
    expect(caught.archiveFile).toMatchObject({
      runId: expect.any(String),
      relativePath: expect.stringMatching(new RegExp(`^${tenantId}/2026/.*\\.zca$`)),
      baseDir,
    })
    await expect(fs.stat(path.join(baseDir, caught.archiveFile.relativePath))).resolves.toBeTruthy()
  })

  it('attaches rollback cleanup metadata when final-file verification fails after rename', async () => {
    const tenantId = `tenant-${randomUUID()}`
    const runId = `run-${randomUUID()}`
    const now = new Date('2026-10-23T12:00:00.000Z')
    const finalPath = path.join(baseDir, tenantId, '2026', `${runId}.zca`)
    const originalReadFile = fs.readFile.bind(fs)
    vi.spyOn(fs, 'readFile').mockImplementation(async (filePath, ...args) => {
      if (path.resolve(String(filePath)) === path.resolve(finalPath)) return Buffer.from('altered after rename')
      return originalReadFile(filePath, ...args)
    })

    let caught
    try {
      await writeArchiveFile({
        baseDir,
        tenantId,
        runId,
        now,
        header: { v: 3, tenantId, runId, createdAt: now.toISOString() },
        segments: [],
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ code: 'ARCHIVE_FILE_VERIFICATION_FAILED' })
    expect(caught.archiveFile).toEqual({ runId, relativePath: `${tenantId}/2026/${runId}.zca`, baseDir })
    await expect(fs.stat(finalPath)).resolves.toBeTruthy()
  })
})
