// @req FR-045 — reconcile and cache are explicit, audited and rebuildable.
// @spec SDD-023, BR-010, SEC-007
// @tested tests/unit/fr045-reconcile-cache.test.js
import { describe, expect, it, vi } from 'vitest'
import { reconcileLocalFiles, rebuildBusinessFileCache } from '@/modules/project-manager/application/file-reconcile-cache-service'
import { buildBusinessFileManagerReadModel } from '@/modules/project-manager/application/file-manager-read-model'
import { makeViewer } from '../factories/viewer'

const owner = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })

function businessMock() {
  return { findUnique: vi.fn().mockResolvedValue({ id: 'business-a', tenantId: 'tenant-a' }) }
}

describe('FR-045 reconcile and cache', () => {
  it('dry-runs missing/untracked changes and mutates only after confirm', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const db = {
      business: businessMock(),
      localWorkspaceMount: { findUnique: vi.fn().mockResolvedValue({ id: 'mount-a', businessId: 'business-a', rootPath: 'D:\\workspace', status: 'ACTIVE' }) },
      fileAsset: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'a', businessId: 'business-a', storageKind: 'LOCAL_FILE', relativePath: 'Projects/P/file-a.txt', status: 'ACTIVE' },
          { id: 'b', businessId: 'business-a', storageKind: 'LOCAL_FILE', relativePath: 'Projects/P/file-b.txt', status: 'MISSING' },
        ]),
        updateMany,
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn(async (callback) => callback(db)),
    }
    const scan = vi.fn().mockResolvedValue(['Projects/P/file-b.txt', 'Inbox/untracked.pdf'])
    const preview = await reconcileLocalFiles({ businessId: 'business-a', mountId: 'mount-a', confirm: false }, { db, viewer: owner, scan })
    expect(preview).toMatchObject({ confirmed: false, missing: ['a'], restored: ['b'], untracked: ['Inbox/untracked.pdf'] })
    expect(updateMany).not.toHaveBeenCalled()
    const committed = await reconcileLocalFiles({ businessId: 'business-a', mountId: 'mount-a', confirm: true }, { db, viewer: owner, scan })
    expect(committed.confirmed).toBe(true)
    expect(updateMany).toHaveBeenCalledTimes(2)
  })

  it('rebuilds a revisioned cache from the canonical read model via atomic promotion', async () => {
    const db = {
      business: businessMock(),
      localWorkspaceMount: { findUnique: vi.fn().mockResolvedValue({ id: 'mount-a', businessId: 'business-a', rootPath: 'D:\\workspace', status: 'ACTIVE' }) },
      project: { findMany: vi.fn().mockResolvedValue([{ id: 'p', code: 'P', name: 'Transform Co', businessId: 'business-a', deletedAt: null }]) },
      fileAsset: { findMany: vi.fn().mockResolvedValue([{ id: 'a', code: 'A', businessId: 'business-a', projectId: 'p', status: 'ACTIVE', storageKind: 'LOCAL_FILE', name: 'a', mime: 'text/plain', size: 1, version: 1 }]) },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    const port = { stageWrite: vi.fn().mockResolvedValue('tmp'), promote: vi.fn().mockResolvedValue('cache') }
    const result = await rebuildBusinessFileCache({ businessId: 'business-a', mountId: 'mount-a' }, { db, viewer: owner, filesystemPort: port })
    expect(result).toMatchObject({ businessId: 'business-a', assetCount: 1, relativePath: '.zuri/cache/business-overview/files.json' })
    expect(result.sourceRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(port.stageWrite).toHaveBeenCalled()
    expect(port.promote).toHaveBeenCalled()
    const staged = JSON.parse(port.stageWrite.mock.calls[0][0].content.toString())
    // A test only comparing against buildBusinessFileManagerReadModel(...) fed the SAME
    // db mock would still pass even with a too-narrow `select` (both sides would agree on
    // `undefined` projectName) — that's exactly how this defect slipped through before.
    // Assert the cached PROJECT group explicitly carries the real projectName.
    expect(staged.readModel.groups).toContainEqual(expect.objectContaining({
      kind: 'PROJECT', projectId: 'p', projectCode: 'P', projectName: 'Transform Co',
    }))
    expect(db.project.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ name: true }),
    }))
    expect(staged.readModel).toEqual(buildBusinessFileManagerReadModel({
      businessId: 'business-a', visibleBusinessIds: ['business-a'],
      projects: await db.project.findMany(), assets: await db.fileAsset.findMany(),
      localCapability: { available: false, reason: 'Cache projection' },
    }))
  })
})
