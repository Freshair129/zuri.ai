import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

import prisma from '@/lib/db'
// @req FR-013 — installation snapshots use preview then explicit confirmation.
// @req FR-075, FR-197 — preview and restore are installation-operator actions,
// and a refused restore must not claim a successful restore audit.
// @req FR-245, FR-248, FR-249 — archive keys/manifests and usage rollups are
// protected evidence during snapshot replacement.
// @spec BR-008, ADR-016 D10, ADR-017 D6, ADR-093 D2-D4, ADR-095 D2-D3,
// SDD-103, SEC-031, SEC-034
// @tested tests/integration/release-safety-backup.test.js
import { computeManifestHash } from '@/modules/crm/chat-evidence-archive-service'
import {
  exportSnapshot,
  importSnapshot,
} from '@/modules/project-manager/application/backup-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import {
  createBusiness,
  createPortfolio,
  createTenant,
  createWorkspace,
} from '../factories/scope'
import { makeDevViewer, makeViewer } from '../factories/viewer'

let protectedFixtureProject

const operator = () => makeDevViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

async function readProtectedRows() {
  const [archiveKeys, manifests, rollups] = await Promise.all([
    prisma.customerArchiveKey.findMany(),
    prisma.archiveManifest.findMany(),
    prisma.usageEventRollup.findMany(),
  ])
  return { archiveKeys, manifests, rollups }
}

function stableRows(rows) {
  return rows
    .map((row) => JSON.parse(JSON.stringify(row)))
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function stableProtectedState(rows) {
  return {
    archiveKeys: stableRows(rows.archiveKeys),
    manifests: stableRows(rows.manifests),
    rollups: stableRows(rows.rollups),
  }
}

// ArchiveManifest.previousManifestId is a real self-FK. Delete children first,
// retrying a blocked parent, so this helper remains valid when the isolated
// database has more than the one-row fixture used by this file.
async function clearArchiveManifests() {
  const pending = new Map((await prisma.archiveManifest.findMany()).map((row) => [row.id, row]))
  while (pending.size) {
    let deleted = false
    for (const row of pending.values()) {
      try {
        await prisma.archiveManifest.delete({ where: { id: row.id } })
        pending.delete(row.id)
        deleted = true
        break
      } catch (error) {
        if (error?.code !== 'P2003') throw error
      }
    }
    if (!deleted) throw new Error('Could not clear the ArchiveManifest self-FK chain')
  }
}

async function clearProtectedRows() {
  await clearArchiveManifests()
  await prisma.customerArchiveKey.deleteMany()
  await prisma.usageEventRollup.deleteMany()
}

async function restoreProtectedRows(saved) {
  await clearProtectedRows()
  for (const row of saved.archiveKeys) await prisma.customerArchiveKey.create({ data: row })

  const pending = new Map(saved.manifests.map((row) => [row.id, row]))
  while (pending.size) {
    const row = [...pending.values()].find((candidate) => (
      candidate.previousManifestId === null
      || candidate.previousManifestId === undefined
      || !pending.has(candidate.previousManifestId)
    ))
    if (!row) throw new Error('Could not restore the ArchiveManifest self-FK chain')
    await prisma.archiveManifest.create({ data: row })
    pending.delete(row.id)
  }
  for (const row of saved.rollups) await prisma.usageEventRollup.create({ data: row })
}

async function withProtectedRowsEmpty(work) {
  const saved = await readProtectedRows()
  await clearProtectedRows()
  try {
    return await work()
  } finally {
    await restoreProtectedRows(saved)
  }
}

function cloneSnapshot(snapshot) {
  return structuredClone(snapshot)
}

function manifest({
  id,
  tenantId = 'tenant-release-safety',
  runId = `run-${id}`,
  previousManifestId = null,
  previousManifestHash = null,
  createdAt = '2026-01-01T00:00:00.000Z',
  filePath = `tenant-release-safety/2026/${id}.zca`,
  fileSha256 = 'a'.repeat(64),
  messageCount = 1,
  messageIdListHash = 'b'.repeat(64),
} = {}) {
  const row = {
    id,
    tenantId,
    runId,
    filePath,
    fileSha256,
    messageCount,
    messageIdListHash,
    previousManifestId,
    previousManifestHash,
    createdAt: new Date(createdAt),
  }
  return { ...row, manifestHash: computeManifestHash(row) }
}

function archiveSnapshotWith(snapshot, manifests) {
  const candidate = cloneSnapshot(snapshot)
  // The archive validator does not require a key row for every synthetic
  // manifest. Keeping an empty, well-typed key family isolates chain failures
  // from customer fixture requirements while preserving the persisted shape.
  candidate.tables.customerArchiveKey = []
  candidate.tables.archiveManifest = manifests
  return candidate
}

async function seedProtectedEvidence() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16)
  const tenantId = `tenant-release-safety-sentinel-${suffix}`
  const customerId = `customer-release-safety-sentinel-${suffix}`
  const manifestRow = manifest({
    id: `manifest-release-safety-sentinel-${suffix}`,
    tenantId,
    runId: `run-release-safety-sentinel-${suffix}`,
    filePath: `${tenantId}/2026/sentinel-${suffix}.zca`,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const keyRow = await prisma.customerArchiveKey.create({
    data: { tenantId, customerId, kekId: 'test-kek', wrappedDek: `test-wrapped-dek-${suffix}` },
  })
  const persistedManifest = await prisma.archiveManifest.create({ data: manifestRow })
  const rollupRow = await prisma.usageEventRollup.create({
    data: {
      date: new Date('2026-01-01T00:00:00.000Z'),
      kind: 'PAGE_VIEW',
      target: `/release-safety-sentinel/${suffix}`,
      count: 11,
    },
  })
  return { keyId: keyRow.id, manifestId: persistedManifest.id, rollupId: rollupRow.id }
}

async function removeProtectedEvidence(seed) {
  await prisma.customerArchiveKey.deleteMany({ where: { id: seed.keyId } })
  await prisma.archiveManifest.deleteMany({ where: { id: seed.manifestId } })
  await prisma.usageEventRollup.deleteMany({ where: { id: seed.rollupId } })
}

async function auditCounts() {
  const [restored, operatorRestore] = await Promise.all([
    prisma.auditEvent.count({ where: { action: 'RESTORED' } }),
    prisma.auditEvent.count({ where: { entityType: 'OPERATOR_ACTION', action: 'BACKUP_RESTORE' } }),
  ])
  return { restored, operatorRestore }
}

async function assertRejectedBeforeDelete(snapshot, expectedError) {
  const beforeProject = await prisma.project.findUnique({
    where: { id: protectedFixtureProject.id },
    select: { id: true, code: true, name: true },
  })
  const beforeAudits = await auditCounts()
  const beforeProtected = stableProtectedState(await readProtectedRows())

  const result = await importSnapshot(snapshot, { confirm: true, viewer: operator() })

  expect(result.restored).toBe(false)
  expect(result.valid).toBe(false)
  expect(result.errors.join(' ')).toMatch(expectedError)
  expect(await prisma.project.findUnique({
    where: { id: protectedFixtureProject.id },
    select: { id: true, code: true, name: true },
  })).toEqual(beforeProject)
  expect(await auditCounts()).toEqual(beforeAudits)
  expect(stableProtectedState(await readProtectedRows())).toEqual(beforeProtected)
}

beforeAll(async () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
  const portfolio = await createPortfolio({ name: `Release safety ${suffix}`, code: `PF-RS-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Release safety tenant ${suffix}`, code: `TNT-RS-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Release safety business ${suffix}`, code: `BUS-RS-${suffix}` })
  const workspace = await createWorkspace({
    name: `Release safety workspace ${suffix}`,
    scopeType: 'BUSINESS',
    businessId: business.id,
    code: `WS-RS-${suffix}`,
  })
  const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  protectedFixtureProject = await createProject({
    workspaceId: workspace.id,
    name: `Protected unrelated project ${suffix}`,
    code: `PRJ-RS-${suffix}`,
  }, { viewer: owner })
})

describe('release safety: protected backup evidence', () => {
  it('allows wholly omitted archive and rollup families on an empty protected target with explicit UNAVAILABLE state', async () => {
    await withProtectedRowsEmpty(async () => {
      expect(await prisma.customerArchiveKey.count()).toBe(0)
      expect(await prisma.archiveManifest.count()).toBe(0)
      expect(await prisma.usageEventRollup.count()).toBe(0)

      const snapshot = await exportSnapshot()
      delete snapshot.tables.customerArchiveKey
      delete snapshot.tables.archiveManifest
      delete snapshot.tables.usageEventRollup

      const result = await importSnapshot(snapshot, { confirm: false, viewer: operator() })

      expect(result.restored).toBe(false)
      expect(result.needsConfirmation).toBe(true)
      expect(result.valid).toBe(true)
      expect(result.archiveRecovery).toMatchObject({ status: 'UNAVAILABLE' })
      expect(result.usageEventRollupRecovery).toMatchObject({ status: 'UNAVAILABLE' })
      expect(result.warnings).toEqual(expect.arrayContaining([
        expect.stringContaining('CHAT_EVIDENCE_ARCHIVE_RECOVERY_UNAVAILABLE'),
        expect.stringContaining('USAGE_EVENT_ROLLUP_RECOVERY_UNAVAILABLE'),
      ]))
      expect(result.current.customerArchiveKey).toBe(0)
      expect(result.current.archiveManifest).toBe(0)
      expect(result.current.usageEventRollup).toBe(0)

      const confirmed = await importSnapshot(snapshot, { confirm: true, viewer: operator() })
      expect(confirmed.restored).toBe(true)
      expect(confirmed.archiveRecovery.status).toBe('UNAVAILABLE')
      expect(confirmed.usageEventRollupRecovery.status).toBe('UNAVAILABLE')
      expect(await readProtectedRows()).toEqual({ archiveKeys: [], manifests: [], rollups: [] })
      expect(await prisma.project.findUnique({ where: { id: protectedFixtureProject.id } })).toBeTruthy()
    })
  })

  it.each([
    {
      name: 'one-sided archive family',
      mutate: (snapshot) => { delete snapshot.tables.archiveManifest },
      expected: /partial archive family/i,
    },
    {
      name: 'malformed archive member',
      mutate: (snapshot) => { snapshot.tables.customerArchiveKey = { rows: [] } },
      expected: /customerArchiveKey must be an array/i,
    },
    {
      name: 'malformed rollup member',
      mutate: (snapshot) => { snapshot.tables.usageEventRollup = { rows: [] } },
      expected: /usageEventRollup must be an array/i,
    },
  ])('refuses $name even when the protected target is empty', async ({ mutate, expected }) => {
    await withProtectedRowsEmpty(async () => {
      const snapshot = await exportSnapshot()
      mutate(snapshot)

      const result = await importSnapshot(snapshot, { confirm: true, viewer: operator() })

      expect(result.restored).toBe(false)
      expect(result.valid).toBe(false)
      expect(result.errors.join(' ')).toMatch(expected)
      expect(await prisma.project.findUnique({ where: { id: protectedFixtureProject.id } })).toBeTruthy()
    })
  })

  it('refuses a row inserted after an unavailable archive preview inside the real transaction boundary', async () => {
    await withProtectedRowsEmpty(async () => {
      const snapshot = await exportSnapshot()
      delete snapshot.tables.customerArchiveKey
      delete snapshot.tables.archiveManifest
      const beforeProject = await prisma.project.findUnique({ where: { id: protectedFixtureProject.id } })
      const beforeAudits = await auditCounts()
      const customerId = 'customer-release-safety-archive-toctou'
      const originalTransaction = prisma.$transaction.bind(prisma)
      let injected = false
      const guardedDb = new Proxy(prisma, {
        get(target, property, receiver) {
          if (property !== '$transaction') return Reflect.get(target, property, receiver)
          return async (callback, options) => {
            if (!injected) {
              await prisma.customerArchiveKey.create({
                data: { tenantId: 'tenant-release-safety-toctou', customerId, kekId: 'test-kek', wrappedDek: 'test-wrapped-dek' },
              })
              injected = true
            }
            return originalTransaction(callback, options)
          }
        },
      })

      try {
        const result = await importSnapshot(snapshot, { confirm: true, viewer: operator(), db: guardedDb })

        expect(result.restored).toBe(false)
        expect(result.errorCode).toBe('BACKUP_ARCHIVE_RECOVERY_LIVE_DATA_APPEARED')
        expect(result.errors.join(' ')).toMatch(/archive recovery became unavailable/i)
        expect(await prisma.customerArchiveKey.findUnique({ where: { customerId } })).toBeTruthy()
        expect(await prisma.project.findUnique({ where: { id: protectedFixtureProject.id } })).toEqual(beforeProject)
        expect(await auditCounts()).toEqual(beforeAudits)
      } finally {
        await prisma.customerArchiveKey.deleteMany({ where: { customerId } })
      }
    })
  })

  it('refuses a row inserted after an unavailable rollup preview inside the real transaction boundary', async () => {
    await withProtectedRowsEmpty(async () => {
      const snapshot = await exportSnapshot()
      delete snapshot.tables.usageEventRollup
      const beforeProject = await prisma.project.findUnique({ where: { id: protectedFixtureProject.id } })
      const beforeAudits = await auditCounts()
      const originalTransaction = prisma.$transaction.bind(prisma)
      let injected = false
      const guardedDb = new Proxy(prisma, {
        get(target, property, receiver) {
          if (property !== '$transaction') return Reflect.get(target, property, receiver)
          return async (callback, options) => {
            if (!injected) {
              await prisma.usageEventRollup.create({
                data: {
                  date: new Date('2026-02-03T00:00:00.000Z'),
                  kind: 'ACTION',
                  target: 'release-safety-toctou',
                  count: 7,
                },
              })
              injected = true
            }
            return originalTransaction(callback, options)
          }
        },
      })

      try {
        const result = await importSnapshot(snapshot, { confirm: true, viewer: operator(), db: guardedDb })

        expect(result.restored).toBe(false)
        expect(result.errorCode).toBe('BACKUP_USAGE_ROLLUP_RECOVERY_LIVE_DATA_APPEARED')
        expect(result.errors.join(' ')).toMatch(/rollup recovery became unavailable/i)
        expect(await prisma.usageEventRollup.count({ where: { target: 'release-safety-toctou' } })).toBe(1)
        expect(await prisma.project.findUnique({ where: { id: protectedFixtureProject.id } })).toEqual(beforeProject)
        expect(await auditCounts()).toEqual(beforeAudits)
      } finally {
        await prisma.usageEventRollup.deleteMany({ where: { target: 'release-safety-toctou' } })
      }
    })
  })

  it('confirms a child-before-parent archive input with equal timestamps by restoring the FK parent first', async () => {
    await withProtectedRowsEmpty(async () => {
      const snapshot = await exportSnapshot()
      const tenantId = 'tenant-release-safety-ordering'
      const sameTimestamp = '2026-03-03T03:03:03.000Z'
      const parent = manifest({
        id: 'manifest-release-safety-ordering-parent-zz',
        tenantId,
        runId: 'run-release-safety-ordering-parent',
        filePath: `${tenantId}/2026/parent.zca`,
        createdAt: sameTimestamp,
      })
      const child = manifest({
        id: 'manifest-release-safety-ordering-child-aa',
        tenantId,
        runId: 'run-release-safety-ordering-child',
        filePath: `${tenantId}/2026/child.zca`,
        previousManifestId: parent.id,
        previousManifestHash: parent.manifestHash,
        createdAt: sameTimestamp,
      })
      const candidate = archiveSnapshotWith(snapshot, [child, parent])

      const result = await importSnapshot(candidate, { confirm: true, viewer: operator() })

      expect(result.restored).toBe(true)
      const rows = await prisma.archiveManifest.findMany({
        where: { id: { in: [parent.id, child.id] } },
      })
      expect(rows).toHaveLength(2)
      expect(rows.find((row) => row.id === parent.id)).toMatchObject({
        previousManifestId: null,
        previousManifestHash: null,
        createdAt: new Date(sameTimestamp),
      })
      expect(rows.find((row) => row.id === child.id)).toMatchObject({
        previousManifestId: parent.id,
        previousManifestHash: parent.manifestHash,
        createdAt: new Date(sameTimestamp),
      })
    })
  })

  it.each([
    {
      name: 'tampered self hash',
      build: (root) => [{ ...root, filePath: `${root.filePath}.tampered` }],
      expected: /not self-consistent/i,
    },
    {
      name: 'predecessor hash mismatch',
      build: (root) => [
        root,
        manifest({
          id: 'manifest-release-safety-hash-mismatch',
          tenantId: root.tenantId,
          previousManifestId: root.id,
          previousManifestHash: '0'.repeat(64),
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      expected: /predecessor hash does not match/i,
    },
    {
      name: 'branching chain',
      build: (root) => [
        root,
        manifest({
          id: 'manifest-release-safety-branch-a',
          tenantId: root.tenantId,
          previousManifestId: root.id,
          previousManifestHash: root.manifestHash,
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
        manifest({
          id: 'manifest-release-safety-branch-b',
          tenantId: root.tenantId,
          previousManifestId: root.id,
          previousManifestHash: root.manifestHash,
          createdAt: '2026-01-03T00:00:00.000Z',
        }),
      ],
      expected: /multiple successors/i,
    },
    {
      name: 'multiple roots',
      build: (root) => [
        root,
        manifest({
          id: 'manifest-release-safety-second-root',
          tenantId: root.tenantId,
          runId: 'run-release-safety-second-root',
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      expected: /must have exactly one root/i,
    },
    {
      name: 'self-cycle',
      build: () => [manifest({
        id: 'manifest-release-safety-self-cycle',
        previousManifestId: 'manifest-release-safety-self-cycle',
        previousManifestHash: null,
      })],
      expected: /points to itself|chain contains a cycle/i,
    },
    {
      name: 'cross-Tenant predecessor',
      build: (root) => [
        root,
        manifest({
          id: 'manifest-release-safety-cross-tenant',
          tenantId: 'tenant-release-safety-foreign',
          previousManifestId: root.id,
          previousManifestHash: root.manifestHash,
          createdAt: '2026-01-02T00:00:00.000Z',
        }),
      ],
      expected: /another Tenant|exactly one root/i,
    },
  ])('refuses $name before the first destructive write', async ({ build, expected }) => {
    const sentinel = await seedProtectedEvidence()
    try {
      const snapshot = await exportSnapshot()
      const root = manifest({ id: 'manifest-release-safety-root' })
      await assertRejectedBeforeDelete(archiveSnapshotWith(snapshot, build(root)), expected)
    } finally {
      await removeProtectedEvidence(sentinel)
    }
  })
})
