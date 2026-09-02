// @req FR-045 — managed assets and legacy migration are lossless and Business scoped.
// @spec SDD-023, BR-010, SEC-007, ADR-016
// @tested tests/unit/fr045-file-asset-service.test.js
import { describe, expect, it, vi } from 'vitest'
import { makeViewer, makeOperatorViewer } from '../factories/viewer'
import {
  createManagedFileAsset,
  deleteManagedFileAsset,
  legacyFileAssetDto,
  listManagedFileAssets,
  migrateProjectFiles,
  upsertLocalWorkspaceMount,
  relinkFileAsset,
  resolveFileAssetContent,
} from '@/modules/project-manager/application/file-asset-service'

const owner = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })
// @req FR-072, FR-075 — migrateProjectFiles is a global, cross-tenant
// operation and requires installation-operator authority, not per-Business
// ownership; the authorization-specific cases live in
// tests/integration/fr072-files-migrate-authorization.test.js.
const operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

function migrationDb() {
  const tx = {
    fileAsset: { create: vi.fn(async ({ data }) => data) },
    fileLink: { create: vi.fn(async ({ data }) => data) },
    auditEvent: { create: vi.fn(async () => ({})) },
  }
  return {
    projectFile: { findMany: vi.fn().mockResolvedValue([{
      id: 'legacy-id', code: 'FIL-OLD', projectId: 'project-a', workItemId: null,
      name: 'old.pdf', mime: 'application/pdf', size: 5, url: 'https://example.test/old.pdf',
      blobRef: null, version: 2, uploadedBy: 'person-a', createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-02'), project: { id: 'project-a', businessId: 'business-a', business: { tenantId: 'tenant-a' } },
    }]) },
    fileAsset: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: tx.fileAsset.create,
    },
    fileLink: tx.fileLink,
    auditEvent: tx.auditEvent,
    $transaction: vi.fn(async (callback) => callback(tx)),
    tx,
  }
}

describe('FR-045 FileAsset service', () => {
  it('dry-runs then commits a lossless ProjectFile migration with the same UUID', async () => {
    const db = migrationDb()
    const preview = await migrateProjectFiles({ confirm: false }, { db, viewer: operator })
    expect(preview).toMatchObject({ confirmed: false, accepted: 1, conflicts: 0 })
    expect(db.$transaction).not.toHaveBeenCalled()

    const committed = await migrateProjectFiles({ confirm: true }, { db, viewer: operator })
    expect(committed).toMatchObject({ confirmed: true, migrated: 1, conflicts: 0 })
    expect(db.tx.fileAsset.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: 'legacy-id', code: 'FIL-OLD', projectId: 'project-a', tenantId: 'tenant-a',
      businessId: 'business-a', storageKind: 'EXTERNAL_URL', externalUrl: 'https://example.test/old.pdf', version: 2,
    }) })
    expect(db.tx.fileLink.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      fileId: 'legacy-id', entityType: 'PROJECT', entityId: 'project-a', relationType: 'OWNER',
    }) })
  })

  it('reports a Project without direct Business ownership instead of silently dropping it', async () => {
    const db = migrationDb()
    db.projectFile.findMany.mockResolvedValue([{
      id: 'shared', code: 'FIL-SHARED', projectId: 'shared-project', name: 'x', mime: 'text/plain', size: 1,
      version: 1, project: { id: 'shared-project', businessId: null, business: null },
    }])
    await expect(migrateProjectFiles({ confirm: false }, { db, viewer: operator })).resolves.toMatchObject({ accepted: 0, conflicts: 1 })
  })

  it('creates external metadata only inside a visible Business and preserves the legacy DTO', async () => {
    const db = {
      business: { findUnique: vi.fn().mockResolvedValue({ id: 'business-a', tenantId: 'tenant-a' }) },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-a', businessId: 'business-a', deletedAt: null }) },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({ id: 'asset-a', version: 1, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), ...data })),
      },
      fileLink: { create: vi.fn().mockResolvedValue({}) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback) => callback(db)),
    }
    const asset = await createManagedFileAsset({
      code: 'FIL-A', businessId: 'business-a', projectId: 'project-a', storageKind: 'EXTERNAL_URL',
      name: 'brief.pdf', mime: 'application/pdf', size: 10, externalUrl: 'https://example.test/brief.pdf',
    }, { db, viewer: owner })
    expect(asset).toMatchObject({ businessId: 'business-a', projectId: 'project-a', status: 'ACTIVE' })
    expect(legacyFileAssetDto(asset)).toMatchObject({ id: 'asset-a', url: 'https://example.test/brief.pdf', blobRef: null })
    await expect(createManagedFileAsset({
      code: 'FIL-BAD', businessId: 'business-a', projectId: 'project-a', storageKind: 'EXTERNAL_URL',
      name: 'bad', mime: 'text/plain', size: 0, externalUrl: 'file:///C:/secret.txt',
    }, { db, viewer: owner })).rejects.toThrow('HTTP or HTTPS')
  })

  it('leaves failed local promotion quarantined and cleans staging', async () => {
    const updates = []
    const db = {
      business: { findUnique: vi.fn().mockResolvedValue({ id: 'business-a', tenantId: 'tenant-a' }) },
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-a', businessId: 'business-a', deletedAt: null }) },
      localWorkspaceMount: { findFirst: vi.fn().mockResolvedValue({ id: 'mount-a', businessId: 'business-a', rootPath: 'D:\\workspace', status: 'ACTIVE' }) },
      fileAsset: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }) => ({ id: 'asset-local', version: 1, createdAt: new Date(), updatedAt: new Date(), ...data })),
        update: vi.fn(async ({ data }) => { updates.push(data); return data }),
      },
      fileLink: { create: vi.fn().mockResolvedValue({}) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback) => callback(db)),
    }
    const port = {
      stageWrite: vi.fn().mockResolvedValue('D:\\workspace\\.zuri\\temp\\asset-local.tmp'),
      promote: vi.fn().mockRejectedValue(new Error('disk full')),
      cleanupStaged: vi.fn().mockResolvedValue(undefined),
    }
    await expect(createManagedFileAsset({
      code: 'FIL-LOCAL', businessId: 'business-a', projectId: 'project-a', storageKind: 'LOCAL_FILE',
      mountId: 'mount-a', relativePath: 'Projects/P-A/Documents/file.txt', contentBase64: 'aGVsbG8=',
      name: 'file.txt', mime: 'text/plain', size: 5,
    }, { db, viewer: owner, filesystemPort: port })).rejects.toThrow('disk full')
    expect(updates).toContainEqual(expect.objectContaining({ status: 'QUARANTINED' }))
    expect(port.cleanupStaged).toHaveBeenCalled()
  })

  it('remounts one Business/device mapping without changing file identity', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'mount-a', businessId: 'business-a', deviceKey: 'desktop-a', rootPath: 'E:\\zuri' })
    const db = {
      business: { findUnique: vi.fn().mockResolvedValue({ id: 'business-a', tenantId: 'tenant-a' }) },
      localWorkspaceMount: { upsert },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await expect(upsertLocalWorkspaceMount({ businessId: 'business-a', deviceKey: 'desktop-a', rootPath: 'E:\\zuri' }, { db, viewer: owner }))
      .resolves.toMatchObject({ rootPath: 'E:\\zuri' })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId_deviceKey: { businessId: 'business-a', deviceKey: 'desktop-a' } },
    }))
  })

  it('authorizes content, explicit relink and metadata-only delete through the managed model', async () => {
    const update = vi.fn(async ({ data }) => ({ id: 'asset-a', ...data }))
    const db = {
      fileAsset: { findUnique: vi.fn().mockResolvedValue({ id: 'asset-a', businessId: 'business-a', storageKind: 'LOCAL_FILE', relativePath: 'old.txt', status: 'ACTIVE', name: 'old.txt' }), update },
      localWorkspaceMount: { findFirst: vi.fn().mockResolvedValue({ id: 'mount-a', businessId: 'business-a', rootPath: 'D:\\workspace', status: 'ACTIVE' }) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    const filesystemPort = { read: vi.fn().mockResolvedValue(Buffer.from('ok')), stat: vi.fn().mockResolvedValue({ size: 2 }) }
    await expect(resolveFileAssetContent('asset-a', { db, visibleBusinessIds: ['business-a'], filesystemPort })).resolves.toMatchObject({ content: Buffer.from('ok') })
    await expect(relinkFileAsset('asset-a', { mountId: 'mount-a', relativePath: 'new.txt' }, { db, viewer: owner, filesystemPort })).resolves.toMatchObject({ relativePath: 'new.txt', status: 'ACTIVE' })
    await expect(deleteManagedFileAsset('asset-a', { db, viewer: owner })).resolves.toMatchObject({ status: 'MISSING' })
    expect(filesystemPort.stat).toHaveBeenCalledWith({ mountRoot: 'D:\\workspace', relativePath: 'new.txt' })
  })

  it('selects Project name so the by-project group heading is never "code · undefined"', async () => {
    const projectRow = { id: 'project-a', code: 'PRJ-A', name: 'Transform Co', businessId: 'business-a', deletedAt: null }
    const assetRow = {
      id: 'asset-a', code: 'FIL-A', businessId: 'business-a', projectId: 'project-a', workItemId: null,
      deletedAt: null, status: 'ACTIVE', name: 'brief.pdf', mime: 'application/pdf', size: 10,
      storageKind: 'EXTERNAL_URL', externalUrl: 'https://example.test/brief.pdf', blobRef: null,
      relativePath: null, sha256: null, version: 1, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-02'),
    }
    const db = {
      project: { findMany: vi.fn().mockResolvedValue([projectRow]) },
      fileAsset: { findMany: vi.fn().mockResolvedValue([assetRow]) },
    }

    const businessView = await listManagedFileAssets({ businessId: 'business-a' }, { db, visibleBusinessIds: ['business-a'] })
    // A test asserting only projectCode would still pass on the pre-fix `select`
    // (which carried code but not name) — the group must carry the real name too.
    expect(businessView.groups).toContainEqual(expect.objectContaining({
      kind: 'PROJECT', projectId: 'project-a', projectCode: 'PRJ-A', projectName: 'Transform Co',
    }))
    expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ name: true }),
    }))

    // The Project File Manager page's own entry point (projectId set) goes through the
    // same query — it must resolve the name too, not just avoid throwing.
    const projectView = await listManagedFileAssets({ businessId: 'business-a', projectId: 'project-a' }, { db, visibleBusinessIds: ['business-a'] })
    expect(projectView.groups).toContainEqual(expect.objectContaining({
      kind: 'PROJECT', projectId: 'project-a', projectCode: 'PRJ-A', projectName: 'Transform Co',
    }))
  })
})
