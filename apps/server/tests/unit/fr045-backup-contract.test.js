// @req FR-045 — snapshots preserve portable file metadata and require explicit remount.
// @spec SDD-023, BR-008, ADR-016 D10
// @tested tests/unit/fr045-backup-contract.test.js
import { describe, expect, it, vi } from 'vitest'
import { exportSnapshot, previewSnapshot } from '@/modules/project-manager/application/backup-service'

describe('FR-045 portable backup contract', () => {
  it('exports FileAsset/FileLink and content manifest but excludes absolute mounts', async () => {
    const db = new Proxy({}, {
      get: (_target, model) => ({
        findMany: vi.fn().mockResolvedValue(model === 'fileAsset' ? [{
          id: 'a', businessId: 'business-a', storageKind: 'LOCAL_FILE', relativePath: 'Projects/P/a.txt', sha256: 'abc', size: 1, status: 'ACTIVE',
        }] : model === 'fileLink' ? [{ id: 'l', fileId: 'a', entityType: 'PROJECT', entityId: 'p', relationType: 'OWNER' }] : []),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({}),
      }),
    })
    const snapshot = await exportSnapshot({ db })
    expect(snapshot.tables.fileAsset).toHaveLength(1)
    expect(snapshot.tables.fileLink).toHaveLength(1)
    expect(snapshot.tables.localWorkspaceMount).toBeUndefined()
    expect(snapshot.fileContentManifest).toEqual([expect.objectContaining({ fileId: 'a', contentIncluded: false })])
  })

  it('previews missing Business remounts without rejecting metadata-only restore', () => {
    const snapshot = {
      schemaVersion: '1.0', exportedAt: '2026-01-01T00:00:00.000Z',
      tables: { fileAsset: [{ id: 'a', businessId: 'business-a', storageKind: 'LOCAL_FILE', relativePath: 'a.txt' }] },
      fileContentManifest: [{ fileId: 'a', businessId: 'business-a', relativePath: 'a.txt', contentIncluded: false }],
    }
    expect(previewSnapshot(snapshot, { remounts: [] })).toMatchObject({
      valid: true, mountRequiredBusinessIds: ['business-a'], missingContentFileIds: ['a'],
    })
    expect(previewSnapshot(snapshot, { remounts: [{ businessId: 'business-a', deviceKey: 'new-device', rootPath: 'E:\\zuri' }] }).mountRequiredBusinessIds).toEqual([])
  })
})
