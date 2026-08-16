// @req FR-045 — Business and Project File Manager projection is isolated and content is not copied.
// @req FR-058 — assetDto's additive createdAt/updatedAt fields are covered here too.
// @spec SDD-023, ADR-016, SEC-007, SDD-031
// @tested tests/unit/fr045-file-manager-read-model.test.js
import { describe, expect, it } from 'vitest'
import {
  buildBusinessFileManagerReadModel,
  buildProjectFileManagerReadModel,
} from '@/modules/project-manager/application/file-manager-read-model'
import {
  FILE_MANAGER_ASSETS,
  FILE_MANAGER_BUSINESS_A,
  FILE_MANAGER_CAPABILITY,
  FILE_MANAGER_HOSTED_CAPABILITY,
  FILE_MANAGER_PROJECTS,
} from '../fixtures/fr045-file-manager-read-model'

describe('FR-045 File Manager read model', () => {
  const businessInput = () => ({
    businessId: FILE_MANAGER_BUSINESS_A.id,
    visibleBusinessIds: [FILE_MANAGER_BUSINESS_A.id],
    projects: FILE_MANAGER_PROJECTS,
    assets: FILE_MANAGER_ASSETS,
    localCapability: FILE_MANAGER_CAPABILITY,
  })

  it('aggregates selected Business and owned Project assets once without copying content', () => {
    const source = businessInput()
    const result = buildBusinessFileManagerReadModel({
      ...source,
      assets: [source.assets[1], source.assets[0], source.assets[1], ...source.assets.slice(2)],
    })

    expect(result.assets.map((asset) => asset.id)).toEqual([
      'asset-business-a', 'asset-project-a-1', 'asset-project-a-2',
    ])
    expect(result.assets.every((asset) => !('content' in asset))).toBe(true)
    // FR-058: assetDto gains createdAt/updatedAt additively — every pre-existing field unchanged.
    expect(result.assets[0]).toEqual({
      id: 'asset-business-a', code: 'FIL-A-001', businessId: 'business-a', projectId: null, workItemId: null,
      name: 'business-plan.pdf', mime: 'application/pdf', size: 100, storageKind: 'LOCAL_FILE',
      relativePath: 'Business Files/business-plan.pdf', externalUrl: null, blobRef: null, sha256: null,
      state: 'ACTIVE', version: 2, localCapability: FILE_MANAGER_CAPABILITY,
      createdAt: FILE_MANAGER_ASSETS[0].createdAt, updatedAt: FILE_MANAGER_ASSETS[0].updatedAt,
    })
    expect(result.counts).toEqual({ total: 3, ACTIVE: 1, MISSING: 1, QUARANTINED: 1 })
    // FR-058 v1.1.0: a PROJECT group carries the project's human identifiers
    // (projectCode/projectName) additively — the BUSINESS group is unchanged.
    expect(result.groups).toEqual([
      { kind: 'BUSINESS', businessId: 'business-a', projectId: null, assetIds: ['asset-business-a'] },
      {
        kind: 'PROJECT', businessId: 'business-a', projectId: 'project-a-1',
        projectCode: 'PRJ-A1', projectName: 'A one', assetIds: ['asset-project-a-1'],
      },
      {
        kind: 'PROJECT', businessId: 'business-a', projectId: 'project-a-2',
        projectCode: 'PRJ-A2', projectName: 'A two', assetIds: ['asset-project-a-2'],
      },
    ])
    expect(result.localCapability).toEqual(FILE_MANAGER_CAPABILITY)
    expect(source.assets[0].content).toBe('must-not-be-projected')
  })

  it('excludes cross-Business, unknown, and null-owner Project rows', () => {
    const result = buildBusinessFileManagerReadModel(businessInput())

    expect(result.assets.map((asset) => asset.id)).not.toContain('asset-project-b')
    expect(result.assets.map((asset) => asset.id)).not.toContain('asset-project-shared')
    expect(result.assets.map((asset) => asset.id)).not.toContain('asset-unknown-project')
  })

  it('fails closed for an invalid Project owner instead of treating it as Business-owned', () => {
    const result = buildBusinessFileManagerReadModel({
      ...businessInput(),
      assets: [...FILE_MANAGER_ASSETS, {
        id: 'asset-invalid-project-owner', code: 'FIL-A-INVALID', businessId: 'business-a', projectId: '',
        name: 'invalid-owner.pdf', mime: 'application/pdf', size: 1, storageKind: 'LOCAL_FILE', status: 'ACTIVE', version: 1,
      }],
    })

    expect(result.assets.map((asset) => asset.id)).not.toContain('asset-invalid-project-owner')
  })

  it('denies a Business that is not visible to the viewer', () => {
    expect(() => buildBusinessFileManagerReadModel({
      ...businessInput(),
      visibleBusinessIds: [],
    })).toThrow('Business access denied (not visible)')
  })

  it('filters Project File Manager to the opened Project and preserves state and capability', () => {
    const result = buildProjectFileManagerReadModel({
      ...businessInput(),
      projectId: 'project-a-1',
      localCapability: FILE_MANAGER_HOSTED_CAPABILITY,
    })

    expect(result.assets).toEqual([
      expect.objectContaining({ id: 'asset-project-a-1', state: 'MISSING', localCapability: FILE_MANAGER_HOSTED_CAPABILITY }),
    ])
    expect(result.counts).toEqual({ total: 1, ACTIVE: 0, MISSING: 1, QUARANTINED: 0 })
    expect(result.groups).toEqual([
      {
        kind: 'PROJECT', businessId: 'business-a', projectId: 'project-a-1',
        projectCode: 'PRJ-A1', projectName: 'A one', assetIds: ['asset-project-a-1'],
      },
    ])
  })

  it('denies a Project outside the selected Business and remains deterministic', () => {
    const input = businessInput()
    expect(() => buildProjectFileManagerReadModel({ ...input, projectId: 'project-b-1' }))
      .toThrow('Project does not belong to selected Business')

    const ordered = buildBusinessFileManagerReadModel(input)
    const reversed = buildBusinessFileManagerReadModel({ ...input, assets: [...input.assets].reverse() })
    expect(reversed).toEqual(ordered)
  })
})
