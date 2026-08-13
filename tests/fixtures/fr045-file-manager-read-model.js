// @req FR-045 — fixture data for Business and Project File Manager projections.
// @spec SDD-023, ADR-016
// @tested tests/unit/fr045-file-manager-read-model.test.js

export const FILE_MANAGER_BUSINESS_A = Object.freeze({ id: 'business-a', code: 'BIZ-A', name: 'Business A' })
export const FILE_MANAGER_BUSINESS_B = Object.freeze({ id: 'business-b', code: 'BIZ-B', name: 'Business B' })

export const FILE_MANAGER_PROJECTS = Object.freeze([
  { id: 'project-a-1', code: 'PRJ-A1', name: 'A one', businessId: 'business-a' },
  { id: 'project-a-2', code: 'PRJ-A2', name: 'A two', businessId: 'business-a' },
  { id: 'project-b-1', code: 'PRJ-B1', name: 'B one', businessId: 'business-b' },
  { id: 'project-shared', code: 'PRJ-SHARED', name: 'Shared work', businessId: null },
])

export const FILE_MANAGER_ASSETS = Object.freeze([
  {
    id: 'asset-business-a', code: 'FIL-A-001', businessId: 'business-a', projectId: null,
    name: 'business-plan.pdf', mime: 'application/pdf', size: 100, storageKind: 'LOCAL_FILE',
    relativePath: 'Business Files/business-plan.pdf', status: 'ACTIVE', version: 2,
    fileLinks: [{ entityType: 'BUSINESS', entityId: 'business-a' }], content: 'must-not-be-projected',
  },
  {
    id: 'asset-project-a-1', code: 'FIL-A-002', businessId: 'business-a', projectId: 'project-a-1',
    name: 'delivery.zip', mime: 'application/zip', size: 200, storageKind: 'LOCAL_FILE',
    relativePath: 'Projects/PRJ-A1/Deliverables/delivery.zip', status: 'MISSING', version: 1,
    fileLinks: [
      { entityType: 'PROJECT', entityId: 'project-a-1' },
      { entityType: 'WORK_ITEM', entityId: 'work-a-1' },
    ],
  },
  {
    id: 'asset-project-a-2', code: 'FIL-A-003', businessId: 'business-a', projectId: 'project-a-2',
    name: 'review.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 300,
    storageKind: 'MANAGED_BLOB', blobRef: 'local:review', status: 'QUARANTINED', version: 3,
  },
  {
    id: 'asset-project-b', code: 'FIL-B-001', businessId: 'business-b', projectId: 'project-b-1',
    name: 'other-business.pdf', mime: 'application/pdf', size: 400, storageKind: 'EXTERNAL_URL',
    externalUrl: 'https://example.test/other-business.pdf', status: 'ACTIVE', version: 1,
  },
  {
    id: 'asset-project-shared', code: 'FIL-S-001', businessId: 'business-a', projectId: 'project-shared',
    name: 'shared.pdf', mime: 'application/pdf', size: 500, storageKind: 'LOCAL_FILE',
    relativePath: 'Projects/SHARED/shared.pdf', status: 'ACTIVE', version: 1,
  },
  {
    id: 'asset-unknown-project', code: 'FIL-A-004', businessId: 'business-a', projectId: 'project-unknown',
    name: 'unknown.pdf', mime: 'application/pdf', size: 600, storageKind: 'LOCAL_FILE',
    relativePath: 'Projects/UNKNOWN/unknown.pdf', status: 'ACTIVE', version: 1,
  },
])

export const FILE_MANAGER_CAPABILITY = Object.freeze({ available: true, reason: null })
export const FILE_MANAGER_HOSTED_CAPABILITY = Object.freeze({ available: false, reason: 'HOSTED_MODE' })
