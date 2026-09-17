// @req FR-045 — snapshots preserve portable file metadata and require explicit remount.
// @spec SDD-023, BR-008, ADR-016 D10
// @tested tests/unit/fr045-backup-contract.test.js
import { describe, expect, it, vi } from 'vitest'
import { exportSnapshot, GENESIS_RAG17_RECOVERY_MANIFEST_VERSION, KNOWLEDGE_ARTIFACT_STORAGE_RECOVERY_MANIFEST_VERSION, previewImport, previewSnapshot, COMMERCE_BILLING_RECOVERY_MANIFEST_VERSION } from '@/modules/project-manager/application/backup-service'
import { makeOperatorViewer } from '../factories/viewer'

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
    expect(snapshot.genesisRag17Recovery).toEqual({
      schemaVersion: GENESIS_RAG17_RECOVERY_MANIFEST_VERSION,
      requiredTables: ['genesisRag17IngestionIntent', 'genesisRag17SourceMention'],
    })
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
    expect(previewSnapshot(snapshot).warnings).toEqual([
      expect.stringContaining('KNOWLEDGE_ADMISSION_RECOVERY_UNAVAILABLE'),
      expect.stringContaining('GENESISRAG17_RECOVERY_UNAVAILABLE'),
    ])
  })

  it('rejects a new recovery manifest before any restore can delete data when a required table is absent', () => {
    const snapshot = {
      schemaVersion: '1.0',
      genesisRag17Recovery: {
        schemaVersion: GENESIS_RAG17_RECOVERY_MANIFEST_VERSION,
        requiredTables: ['genesisRag17IngestionIntent', 'genesisRag17SourceMention'],
      },
      tables: { genesisRag17IngestionIntent: [] },
    }

    expect(previewSnapshot(snapshot)).toMatchObject({
      valid: false,
      errors: [expect.stringContaining('genesisRag17SourceMention')],
      recovery: { status: 'INVALID' },
    })
  })

  it('keeps an unavailable admission warning beside a complete source recovery manifest', () => {
    const preview = previewSnapshot({
      schemaVersion: '1.0',
      genesisRag17Recovery: {
        schemaVersion: GENESIS_RAG17_RECOVERY_MANIFEST_VERSION,
        requiredTables: ['genesisRag17IngestionIntent', 'genesisRag17SourceMention'],
      },
      tables: { genesisRag17IngestionIntent: [], genesisRag17SourceMention: [] },
    })
    expect(preview).toMatchObject({ valid: true, recovery: { status: 'AVAILABLE' } })
    expect(preview.warnings).toEqual([
      expect.stringContaining('KNOWLEDGE_ADMISSION_RECOVERY_UNAVAILABLE'),
    ])
  })

  it('rejects a declared Commerce recovery manifest with missing tables even on an empty target', async () => {
    const db = new Proxy({}, {
      get: () => ({ count: vi.fn().mockResolvedValue(0) }),
    })
    const snapshot = {
      schemaVersion: '1.0',
      commerceBillingRecovery: {
        schemaVersion: COMMERCE_BILLING_RECOVERY_MANIFEST_VERSION,
        requiredTables: ['businessBillingProfile', 'commerceDocumentSequence', 'commerceDocument'],
      },
      tables: {},
    }

    const preview = await previewImport(snapshot, { db, viewer: makeOperatorViewer() })
    expect(preview).toMatchObject({ valid: false, billingRecovery: { status: 'INVALID' } })
    expect(preview.errors).toEqual(expect.arrayContaining([
      'Commerce billing recovery snapshot is missing required table: businessBillingProfile',
      'Commerce billing recovery snapshot is missing required table: commerceDocumentSequence',
      'Commerce billing recovery snapshot is missing required table: commerceDocument',
    ]))
  })

  it('rejects an object-storage snapshot whose references do not resolve to scoped lineage rows', () => {
    const preview = previewSnapshot({
      schemaVersion: '1.0',
      knowledgeArtifactStorageRecovery: {
        schemaVersion: KNOWLEDGE_ARTIFACT_STORAGE_RECOVERY_MANIFEST_VERSION,
        requiredTables: ['knowledgeArtifactStorage', 'knowledgeArtifactOperation'],
      },
      tables: {
        knowledgeRawArtifact: [],
        knowledgeArtifactStorage: [{ id: 'storage-1', rawArtifactId: 'raw-missing', status: 'READY', sha256: 'a'.repeat(64), objectVersionId: 'version-1' }],
        knowledgeArtifactOperation: [{ id: 'operation-1', storageId: 'storage-missing', idempotencyKey: 'put-1' }],
      },
    })
    expect(preview).toMatchObject({ valid: false, artifactStorageRecovery: { status: 'INVALID' } })
    expect(preview.errors).toEqual(expect.arrayContaining([
      'Knowledge artifact storage storage-1 references missing KnowledgeRawArtifact raw-missing',
      'Knowledge artifact operation operation-1 references missing KnowledgeArtifactStorage storage-missing',
    ]))
  })

  it('rejects storage and operation rows that cross their raw lineage scope', () => {
    const preview = previewSnapshot({
      schemaVersion: '1.0',
      knowledgeArtifactStorageRecovery: {
        schemaVersion: KNOWLEDGE_ARTIFACT_STORAGE_RECOVERY_MANIFEST_VERSION,
        requiredTables: ['knowledgeArtifactStorage', 'knowledgeArtifactOperation'],
      },
      tables: {
        knowledgeRawArtifact: [{ id: 'raw-1', portfolioId: 'p-1', tenantId: 't-1', businessId: 'b-1', workspaceId: 'w-1', agentId: 'a-1', visibility: 'private' }],
        knowledgeArtifactStorage: [{ id: 'storage-1', rawArtifactId: 'raw-1', portfolioId: 'p-1', tenantId: 't-1', businessId: 'b-other', workspaceId: 'w-1', agentId: 'a-1', visibility: 'private', status: 'PENDING', sha256: 'a'.repeat(64) }],
        knowledgeArtifactOperation: [{ id: 'operation-1', storageId: 'storage-1', portfolioId: 'p-1', tenantId: 't-1', businessId: 'b-1', workspaceId: 'w-1', agentId: 'a-1', visibility: 'private', idempotencyKey: 'put-1' }],
      },
    })
    expect(preview).toMatchObject({ valid: false, artifactStorageRecovery: { status: 'INVALID' } })
    expect(preview.errors).toContain('Knowledge artifact storage storage-1 crosses scope at businessId')
    expect(preview.errors).toContain('Knowledge artifact operation operation-1 crosses scope at businessId')
  })
})
