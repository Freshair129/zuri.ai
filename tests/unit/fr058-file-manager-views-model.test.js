// @req FR-058 — File Manager switchable views: deterministic timeline ordering, additive assetDto
// fields, and the by-project grouping shape the UI view switcher consumes.
// @spec SDD-031, SDD-023, ADR-016
// @tested tests/unit/fr058-file-manager-views-model.test.js
import { describe, expect, it } from 'vitest'
import {
  buildBusinessFileManagerReadModel,
  buildProjectFileManagerReadModel,
  compareAssetsByTimeline,
} from '@/modules/project-manager/application/file-manager-read-model'
import {
  FILE_MANAGER_ASSETS,
  FILE_MANAGER_BUSINESS_A,
  FILE_MANAGER_CAPABILITY,
  FILE_MANAGER_PROJECTS,
} from '../fixtures/fr045-file-manager-read-model'

describe('FR-058 File Manager views — read model contract', () => {
  const businessInput = () => ({
    businessId: FILE_MANAGER_BUSINESS_A.id,
    visibleBusinessIds: [FILE_MANAGER_BUSINESS_A.id],
    projects: FILE_MANAGER_PROJECTS,
    assets: FILE_MANAGER_ASSETS,
    localCapability: FILE_MANAGER_CAPABILITY,
  })

  describe('timeline ordering (compareAssetsByTimeline)', () => {
    it('orders by most-recently-updated first', () => {
      const older = { id: 'a', code: 'A', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
      const newer = { id: 'b', code: 'B', updatedAt: '2026-01-02T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
      expect([older, newer].sort(compareAssetsByTimeline)).toEqual([newer, older])
      expect([newer, older].sort(compareAssetsByTimeline)).toEqual([newer, older])
    })

    it('breaks a tied updatedAt by most-recently-created first', () => {
      const olderCreated = { id: 'a', code: 'A', updatedAt: '2026-01-05T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
      const newerCreated = { id: 'b', code: 'B', updatedAt: '2026-01-05T00:00:00.000Z', createdAt: '2026-01-03T00:00:00.000Z' }
      expect([olderCreated, newerCreated].sort(compareAssetsByTimeline)).toEqual([newerCreated, olderCreated])
      expect([newerCreated, olderCreated].sort(compareAssetsByTimeline)).toEqual([newerCreated, olderCreated])
    })

    it('breaks a fully tied updatedAt/createdAt pair using the existing compareAssets [code, id] discipline', () => {
      const sameTimestamps = { updatedAt: '2026-01-05T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }
      const first = { id: 'id-z', code: 'AAA', ...sameTimestamps }
      const second = { id: 'id-a', code: 'ZZZ', ...sameTimestamps }
      // compareAssets sorts by "code|id" ascending via localeCompare, so 'AAA|id-z' sorts before 'ZZZ|id-a'.
      expect([second, first].sort(compareAssetsByTimeline)).toEqual([first, second])
      expect([first, second].sort(compareAssetsByTimeline)).toEqual([first, second])
    })

    it('produces the same total order regardless of input order (deterministic, not row-order-dependent)', () => {
      const result = buildBusinessFileManagerReadModel(businessInput())
      const forward = [...result.assets].sort(compareAssetsByTimeline)
      const reversed = [...result.assets].reverse().sort(compareAssetsByTimeline)
      const shuffled = [result.assets[2], result.assets[0], result.assets[1]].sort(compareAssetsByTimeline)

      expect(forward.map((asset) => asset.id)).toEqual(reversed.map((asset) => asset.id))
      expect(forward.map((asset) => asset.id)).toEqual(shuffled.map((asset) => asset.id))
      // Fixture updatedAt values are strictly increasing with array index, so newest-first
      // means the timeline is the exact reverse of the grid (code|id ascending) order.
      expect(forward.map((asset) => asset.id)).toEqual([
        'asset-project-a-2', 'asset-project-a-1', 'asset-business-a',
      ])
    })
  })

  describe('assetDto additive fields', () => {
    it('adds createdAt/updatedAt while leaving every pre-existing field byte-identical', () => {
      const result = buildBusinessFileManagerReadModel(businessInput())

      // Same expected shape the FR-045 read model produced before FR-058, field for field,
      // proving the change is strictly additive for the same input.
      expect(result.assets.map(({ createdAt, updatedAt, ...preExisting }) => preExisting)).toEqual([
        {
          id: 'asset-business-a', code: 'FIL-A-001', businessId: 'business-a', projectId: null, workItemId: null,
          name: 'business-plan.pdf', mime: 'application/pdf', size: 100, storageKind: 'LOCAL_FILE',
          relativePath: 'Business Files/business-plan.pdf', externalUrl: null, blobRef: null, sha256: null,
          state: 'ACTIVE', version: 2, localCapability: FILE_MANAGER_CAPABILITY,
        },
        {
          id: 'asset-project-a-1', code: 'FIL-A-002', businessId: 'business-a', projectId: 'project-a-1', workItemId: null,
          name: 'delivery.zip', mime: 'application/zip', size: 200, storageKind: 'LOCAL_FILE',
          relativePath: 'Projects/PRJ-A1/Deliverables/delivery.zip', externalUrl: null, blobRef: null, sha256: null,
          state: 'MISSING', version: 1, localCapability: FILE_MANAGER_CAPABILITY,
        },
        {
          id: 'asset-project-a-2', code: 'FIL-A-003', businessId: 'business-a', projectId: 'project-a-2', workItemId: null,
          name: 'review.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 300,
          storageKind: 'MANAGED_BLOB', relativePath: null, externalUrl: null, blobRef: 'local:review', sha256: null,
          state: 'QUARANTINED', version: 3, localCapability: FILE_MANAGER_CAPABILITY,
        },
      ])

      expect(result.assets.map((asset) => asset.createdAt)).toEqual([
        FILE_MANAGER_ASSETS[0].createdAt, FILE_MANAGER_ASSETS[1].createdAt, FILE_MANAGER_ASSETS[2].createdAt,
      ])
      expect(result.assets.map((asset) => asset.updatedAt)).toEqual([
        FILE_MANAGER_ASSETS[0].updatedAt, FILE_MANAGER_ASSETS[1].updatedAt, FILE_MANAGER_ASSETS[2].updatedAt,
      ])
    })
  })

  describe('by-project grouping shape', () => {
    it('exposes the existing BUSINESS/PROJECT groups verbatim, including a no-project (BUSINESS-only) asset', () => {
      const result = buildBusinessFileManagerReadModel({
        ...businessInput(),
        assets: [FILE_MANAGER_ASSETS[0]], // asset-business-a: projectId === null
      })

      expect(result.groups).toEqual([
        { kind: 'BUSINESS', businessId: 'business-a', projectId: null, assetIds: ['asset-business-a'] },
      ])
    })

    it('groups match the contract shape and resolve against the same assets array (no second fetch, no duplicated DTO)', () => {
      const result = buildBusinessFileManagerReadModel(businessInput())

      // FR-058 v1.1.0: PROJECT groups additionally carry projectCode/projectName so
      // the by-project view never has to render a raw uuid.
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

      const byId = new Map(result.assets.map((asset) => [asset.id, asset]))
      for (const group of result.groups) {
        for (const assetId of group.assetIds) {
          const asset = byId.get(assetId)
          expect(asset).toBeDefined()
          expect(asset.businessId).toBe(group.businessId)
          expect(asset.projectId).toBe(group.projectId)
        }
      }
      // Resolving groups must not have produced a second/duplicated asset object per id.
      expect(byId.size).toBe(result.assets.length)
    })

    it('omits a PROJECT group for a project with zero assets and produces no BUSINESS group when scoped to a Project', () => {
      const result = buildProjectFileManagerReadModel({
        ...businessInput(),
        projectId: 'project-a-1',
      })

      expect(result.groups).toEqual([
        {
          kind: 'PROJECT', businessId: 'business-a', projectId: 'project-a-1',
          projectCode: 'PRJ-A1', projectName: 'A one', assetIds: ['asset-project-a-1'],
        },
      ])
      expect(result.groups.some((group) => group.kind === 'BUSINESS')).toBe(false)
    })

    it('a BUSINESS (no-project) group carries no projectCode/projectName — there is no project to name', () => {
      const result = buildBusinessFileManagerReadModel({
        ...businessInput(),
        assets: [FILE_MANAGER_ASSETS[0]], // asset-business-a: projectId === null
      })

      const businessGroup = result.groups.find((group) => group.kind === 'BUSINESS')
      expect(businessGroup).toBeDefined()
      expect(businessGroup).not.toHaveProperty('projectCode')
      expect(businessGroup).not.toHaveProperty('projectName')
    })
  })
})
