// @req FR-045 — W0 proves the legacy ProjectFile contract being frozen for migration.
// @spec SDD-023, SEC-007, docs/features/FR-045-managed-local-file-workspace.md
// @tested tests/unit/fr045-w0-contract.test.js
import { describe, expect, it, vi } from 'vitest'
import { zProjectFileInput } from '@/lib/validation/entities'
import { listProjectFiles } from '@/modules/project-manager/application/project-file-service'
import {
  LEGACY_PROJECT_FILE_INPUT,
  LEGACY_PROJECT_FILE_RECORD,
  LEGACY_PROJECT_FILE_ROUTES,
  PROJECT_FILE_MIGRATION_INVARIANTS,
} from '../fixtures/fr045-project-file-contract'

describe('FR-045 W0 legacy ProjectFile contract', () => {
  it('freezes the valid metadata/reference input accepted by FR-037', () => {
    expect(zProjectFileInput.parse(LEGACY_PROJECT_FILE_INPUT)).toEqual(LEGACY_PROJECT_FILE_INPUT)
    expect(() => zProjectFileInput.parse({
      name: 'missing-reference.pdf',
      mime: 'application/pdf',
      size: 1,
    })).toThrow('url or blobRef')
  })

  it('freezes the list response without rewriting legacy fields', async () => {
    const db = {
      project: { findUnique: vi.fn().mockResolvedValue({ id: 'project-uuid-001', deletedAt: null }) },
      projectFile: { findMany: vi.fn().mockResolvedValue([LEGACY_PROJECT_FILE_RECORD]) },
    }

    await expect(listProjectFiles('project-uuid-001', { db })).resolves.toEqual([LEGACY_PROJECT_FILE_RECORD])
    expect(db.projectFile.findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-uuid-001' },
      orderBy: { createdAt: 'desc' },
      include: { workItem: { select: { id: true, code: true, title: true } } },
    })
  })

  it('records the three compatibility routes and lossless migration invariants', () => {
    expect(LEGACY_PROJECT_FILE_ROUTES).toHaveLength(3)
    expect(PROJECT_FILE_MIGRATION_INVARIANTS).toContain('preserve ProjectFile.id as FileAsset.id')
    expect(PROJECT_FILE_MIGRATION_INVARIANTS).toContain('report every rejected or conflicting row; never silently drop it')
  })
})
