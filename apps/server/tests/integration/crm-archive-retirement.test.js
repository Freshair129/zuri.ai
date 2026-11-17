// @req FR-245, SEC-034 — format-4 retirement files authorize deletion of only
//   earlier, same-Tenant archive files in the manifest chain (ADR-093 D5 P1-P6).
// @spec ADR-093 D5 (1.3.0), SDD-103, SEC-001
// @tested tests/integration/crm-archive-retirement.test.js
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeManifestHash, hashMessageIdList, verifyManifestChain } from '@/modules/crm/chat-evidence-archive-service'

let baseDir
beforeEach(async () => { baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zuri-archive-retirement-')) })
afterEach(async () => {
  if (baseDir && path.resolve(baseDir).startsWith(path.resolve(os.tmpdir()))) await fs.rm(baseDir, { recursive: true, force: true })
})

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const fakeDb = (rows) => ({ archiveManifest: { findMany: async () => [...rows].reverse() } })

async function writeRelative(relativePath, content) {
  const absolute = path.join(baseDir, relativePath)
  await fs.mkdir(path.dirname(absolute), { recursive: true })
  await fs.writeFile(absolute, content)
  return absolute
}

async function appendArchive({ tenantId, previous = null, filePath, id = randomUUID(), runId = `archive-${id}`, content = `archive bytes ${id}\n`, messageCount = 1 }) {
  await writeRelative(filePath, content)
  const manifest = {
    id, tenantId, runId, filePath, fileSha256: sha256(content), messageCount,
    messageIdListHash: hashMessageIdList(Array.from({ length: messageCount }, (_value, index) => `message-${id}-${index}`)),
    previousManifestId: previous?.id ?? null,
    previousManifestHash: previous?.manifestHash ?? null,
    createdAt: new Date(Date.UTC(2026, 0, Number(String(id).replace(/\D/g, '').slice(-1)) || 1)),
  }
  manifest.manifestHash = computeManifestHash(manifest)
  return manifest
}

function retirementHeader({ tenantId, runId, retired = [], ...overrides }) {
  return {
    v: 4,
    kind: 'RETIREMENT',
    tenantId,
    runId,
    createdAt: '2026-11-13T00:00:00.000Z',
    reason: 'RETENTION_EXPIRED',
    retentionYears: 10,
    retired,
    ...overrides,
  }
}

async function appendRetirement({ tenantId, previous, retired, headerOverrides = {}, id = randomUUID(), runId = `retire-${id}`, filePath = `${tenantId}/2026/${runId}.zcr` }) {
  const header = retirementHeader({ tenantId, runId, retired, ...headerOverrides })
  const content = `${JSON.stringify(header)}\n`
  await writeRelative(filePath, content)
  const manifest = {
    id, tenantId, runId, filePath, fileSha256: sha256(content), messageCount: 0,
    messageIdListHash: hashMessageIdList([]),
    previousManifestId: previous?.id ?? null,
    previousManifestHash: previous?.manifestHash ?? null,
    createdAt: new Date('2026-11-13T00:00:00.000Z'),
  }
  manifest.manifestHash = computeManifestHash(manifest)
  return { manifest, header, content }
}

async function expectInvalidChain(chainPromise, { brokenAtManifestId, reason }) {
  const chain = await chainPromise
  expect({
    valid: chain.valid,
    brokenAtManifestId: chain.brokenAtManifestId,
    reason: chain.reason,
  }).toEqual({ valid: false, brokenAtManifestId, reason })
}

const retirementEntry = (manifest) => ({
  manifestId: manifest.id,
  runId: manifest.runId,
  filePath: manifest.filePath,
  fileSha256: manifest.fileSha256,
  manifestHash: manifest.manifestHash,
  messageCount: manifest.messageCount,
  messageIdListHash: manifest.messageIdListHash,
})

describe('verifyManifestChain format-4 retirement rules', () => {
  it('accepts a verified retirement and exempts only its named archive row from file checks', async () => {
    const tenantId = 'tenant-retire-valid'
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca` })
    const retirement = await appendRetirement({ tenantId, previous: archive, retired: [retirementEntry(archive)] })
    await fs.unlink(path.join(baseDir, archive.filePath))

    await expect(verifyManifestChain(fakeDb([archive, retirement.manifest]), tenantId, { baseDir, checkFiles: true }))
      .resolves.toEqual({ valid: true, retiredManifestIds: [archive.id] })
  })

  it('reports the excused archive as missing when its retirement file is absent', async () => {
    const tenantId = 'tenant-retire-missing-proof'
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca` })
    const retirement = await appendRetirement({ tenantId, previous: archive, retired: [retirementEntry(archive)] })
    await fs.unlink(path.join(baseDir, archive.filePath))
    await fs.unlink(path.join(baseDir, retirement.manifest.filePath))

    await expectInvalidChain(verifyManifestChain(fakeDb([archive, retirement.manifest]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: archive.id, reason: 'ARCHIVE_FILE_MISSING',
    })
  })

  it('reports a present retirement file whose bytes no longer match its row as tampered', async () => {
    const tenantId = 'tenant-retire-tampered-proof'
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca` })
    const retirement = await appendRetirement({ tenantId, previous: archive, retired: [retirementEntry(archive)] })
    await fs.appendFile(path.join(baseDir, retirement.manifest.filePath), 'tampered\n')

    await expectInvalidChain(verifyManifestChain(fakeDb([archive, retirement.manifest]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: retirement.manifest.id, reason: 'ARCHIVE_FILE_TAMPERED',
    })
  })

  it('rejects a retirement entry with the wrong manifest hash', async () => {
    const tenantId = 'tenant-retire-wrong-hash'
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca` })
    const entry = { ...retirementEntry(archive), manifestHash: 'f'.repeat(64) }
    const retirement = await appendRetirement({ tenantId, previous: archive, retired: [entry] })

    await expectInvalidChain(verifyManifestChain(fakeDb([archive, retirement.manifest]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: retirement.manifest.id, reason: 'RETIREMENT_INVALID',
    })
  })

  it('rejects an entry that names a later chain row', async () => {
    const tenantId = 'tenant-retire-later-row'
    const earlier = await appendArchive({ tenantId, filePath: `${tenantId}/2026/earlier.zca`, id: 'archive-1' })
    const laterPath = `${tenantId}/2026/later.zca`
    const laterContent = 'future archive bytes\n'
    const laterEntry = {
      manifestId: 'archive-2', runId: 'archive-2', filePath: laterPath,
      fileSha256: sha256(laterContent), manifestHash: 'a'.repeat(64), messageCount: 1,
      messageIdListHash: hashMessageIdList(['future-message']),
    }
    const retirement = await appendRetirement({ tenantId, previous: earlier, retired: [laterEntry] })
    const later = await appendArchive({ tenantId, previous: retirement.manifest, filePath: laterPath, id: 'archive-2', runId: 'archive-2', content: laterContent })

    await expectInvalidChain(verifyManifestChain(fakeDb([earlier, retirement.manifest, later]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: retirement.manifest.id, reason: 'RETIREMENT_INVALID',
    })
  })

  it('rejects an entry that names a manifest from another Tenant', async () => {
    const tenantId = 'tenant-retire-scope'
    const other = await appendArchive({ tenantId: 'tenant-other', filePath: 'tenant-other/2026/other.zca' })
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca` })
    const retirement = await appendRetirement({ tenantId, previous: archive, retired: [retirementEntry(other)] })

    await expectInvalidChain(verifyManifestChain(fakeDb([archive, retirement.manifest]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: retirement.manifest.id, reason: 'RETIREMENT_INVALID',
    })
  })

  it('rejects an entry that names an earlier retirement row', async () => {
    const tenantId = 'tenant-retire-of-retirement'
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca`, id: 'archive-base' })
    const first = await appendRetirement({
      tenantId, previous: archive, retired: [retirementEntry(archive)], id: 'retirement-1', runId: 'retirement-1',
    })
    const second = await appendRetirement({
      tenantId, previous: first.manifest, retired: [retirementEntry(first.manifest)], id: 'retirement-2', runId: 'retirement-2',
    })

    await expectInvalidChain(verifyManifestChain(fakeDb([archive, first.manifest, second.manifest]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: second.manifest.id, reason: 'RETIREMENT_INVALID',
    })
  })

  it('keeps an ordinary missing archive file invalid when no retirement entry names it', async () => {
    const tenantId = 'tenant-retire-no-proof'
    const archive = await appendArchive({ tenantId, filePath: `${tenantId}/2026/archive.zca` })
    await fs.unlink(path.join(baseDir, archive.filePath))

    await expectInvalidChain(verifyManifestChain(fakeDb([archive]), tenantId, { baseDir, checkFiles: true }), {
      brokenAtManifestId: archive.id, reason: 'ARCHIVE_FILE_MISSING',
    })
  })
})
