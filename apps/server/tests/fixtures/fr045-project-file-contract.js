// @req FR-045 — W0 freezes the legacy ProjectFile boundary before additive migration.
// @spec SDD-023, docs/features/FR-045-managed-local-file-workspace.md
// @tested tests/unit/fr045-w0-contract.test.js

export const LEGACY_PROJECT_FILE_INPUT = Object.freeze({
  code: 'FIL-LEGACY-001',
  workItemId: 'work-item-001',
  name: 'legacy-report.pdf',
  mime: 'application/pdf',
  size: 4096,
  url: null,
  blobRef: 'local:legacy-report',
  uploadedBy: 'person-001',
})

export const LEGACY_PROJECT_FILE_RECORD = Object.freeze({
  id: 'file-uuid-001',
  code: 'FIL-LEGACY-001',
  projectId: 'project-uuid-001',
  workItemId: 'work-item-001',
  name: 'legacy-report.pdf',
  mime: 'application/pdf',
  size: 4096,
  url: null,
  blobRef: 'local:legacy-report',
  version: 1,
  uploadedBy: 'person-001',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  workItem: {
    id: 'work-item-001',
    code: 'WIT-001',
    title: 'Prepare legacy report',
  },
})

export const LEGACY_PROJECT_FILE_ROUTES = Object.freeze([
  { method: 'GET', path: '/api/projects/[id]/files', success: 'ProjectFile[]' },
  { method: 'POST', path: '/api/projects/[id]/files', success: 'ProjectFile' },
  { method: 'DELETE', path: '/api/projects/[id]/files/[fileId]', success: '{ id }' },
])

export const PROJECT_FILE_MIGRATION_INVARIANTS = Object.freeze([
  'preserve ProjectFile.id as FileAsset.id',
  'preserve code, projectId, workItemId, name, mime, size, url, blobRef, version, uploadedBy and timestamps',
  'create exactly one Project ownership/link for each accepted source row',
  'report every rejected or conflicting row; never silently drop it',
  'leave the legacy routes readable during the compatibility window',
])
