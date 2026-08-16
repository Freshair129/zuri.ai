// @req FR-058 — File Manager view switcher: grid/timeline/by-project/preview over
// one canonical asset set, with a mime/state/kind-gated preview eligibility matrix.
// @spec SDD-031, SEC-007
// @tested tests/unit/fr058-file-manager-views-ui.test.js
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  FILE_MANAGER_VIEWS,
  getPreviewEligibility,
  resolveProjectGroups,
  timelineOrderedAssets,
  viewSwitcherButtonProps,
} from '@/modules/project-manager/components/FileManagerViews'
import { buildBusinessFileManagerReadModel, compareAssetsByTimeline } from '@/modules/project-manager/application/file-manager-read-model'
import {
  FILE_MANAGER_ASSETS,
  FILE_MANAGER_BUSINESS_A,
  FILE_MANAGER_CAPABILITY,
  FILE_MANAGER_PROJECTS,
} from '../fixtures/fr045-file-manager-read-model'

const source = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/FileManagerViews.jsx'), 'utf8')
const panel = readFileSync(resolve(process.cwd(), 'src/modules/project-manager/components/ManagedFilesPanel.jsx'), 'utf8')

function businessReadModel() {
  return buildBusinessFileManagerReadModel({
    businessId: FILE_MANAGER_BUSINESS_A.id,
    visibleBusinessIds: [FILE_MANAGER_BUSINESS_A.id],
    projects: FILE_MANAGER_PROJECTS,
    assets: FILE_MANAGER_ASSETS,
    localCapability: FILE_MANAGER_CAPABILITY,
  })
}

describe('FR-058 File Manager views — UI switcher behaviour', () => {
  describe('each view renders its expected shape', () => {
    it('grid is the current, unchanged behaviour: it maps the assets array straight through with no sort/filter', () => {
      expect(source).toContain('function GridView({ assets, renderAsset })')
      expect(source).toContain('assets.map(renderAsset)')
      // GridView must not call either of the other views' shaping functions.
      const gridBody = source.slice(source.indexOf('function GridView'), source.indexOf('function TimelineView'))
      expect(gridBody).not.toContain('timelineOrderedAssets')
      expect(gridBody).not.toContain('resolveProjectGroups')
    })

    it('timeline view is driven by the read model\'s own compareAssetsByTimeline, not a reimplemented sort', () => {
      expect(source).toContain("import { compareAssetsByTimeline } from '@/modules/project-manager/application/file-manager-read-model'")
      expect(source).toContain('function timelineOrderedAssets(assets)')
      expect(source).toContain('.sort(compareAssetsByTimeline)')
      expect(source).toContain('function TimelineView({ assets, renderAsset })')
      const timelineBody = source.slice(source.indexOf('function TimelineView'), source.indexOf('function ByProjectView'))
      expect(timelineBody).toContain('timelineOrderedAssets(assets)')
      expect(timelineBody).not.toContain('.sort(') // must reuse the helper, not sort inline again
    })

    it('by-project view is driven by the read model\'s existing groups, not a second grouping path', () => {
      expect(source).toContain('function resolveProjectGroups(groups, assets)')
      expect(source).toContain('function ByProjectView({ assets, groups, renderAsset })')
      const byProjectBody = source.slice(source.indexOf('function ByProjectView'), source.indexOf('function TextPreview'))
      expect(byProjectBody).toContain('resolveProjectGroups(groups, assets)')
      // Must join against the assets already in the response — no second fetch API call.
      expect(byProjectBody).not.toMatch(/fetch\(|await api\(/)
    })

    it('a PROJECT group heading renders the project\'s code/name, never the raw projectId uuid', () => {
      const byProjectBody = source.slice(source.indexOf('function ByProjectView'), source.indexOf('function TextPreview'))
      expect(byProjectBody).toContain('`${group.projectCode} · ${group.projectName}`')
      // Must not fall back to interpolating the id itself for a PROJECT group's label.
      expect(byProjectBody).not.toContain('`Project ${group.projectId}`')
    })

    it('preview view renders one gated card per asset via getPreviewEligibility', () => {
      expect(source).toContain('function PreviewView({ assets })')
      expect(source).toContain('function PreviewCard({ asset })')
      const previewCardBody = source.slice(source.indexOf('function PreviewCard'), source.indexOf('function PreviewView'))
      expect(previewCardBody).toContain('getPreviewEligibility(asset)')
    })

    it('ManagedFilesPanel hosts the switcher and passes it the read model\'s assets and groups', () => {
      expect(panel).toContain("import FileManagerViews from './FileManagerViews'")
      expect(panel).toContain('<FileManagerViews')
      expect(panel).toMatch(/groups=\{.*groups.*\}/)
    })
  })

  describe('pure view logic (imported and executed directly)', () => {
    it('timeline view shape: orders assets using the read model\'s own compareAssetsByTimeline', () => {
      const { assets } = businessReadModel()
      const ordered = timelineOrderedAssets(assets)
      expect(ordered.map((a) => a.id)).toEqual([...assets].sort(compareAssetsByTimeline).map((a) => a.id))
      // Newest updatedAt first, per the fixture's strictly-increasing updatedAt values.
      expect(ordered.map((a) => a.id)).toEqual(['asset-project-a-2', 'asset-project-a-1', 'asset-business-a'])
    })

    it('timeline view shape: does not mutate the assets array it was given', () => {
      const { assets } = businessReadModel()
      const before = assets.map((a) => a.id)
      timelineOrderedAssets(assets)
      expect(assets.map((a) => a.id)).toEqual(before)
    })

    it('by-project view shape: resolves the read model\'s existing groups against the same assets array (no duplicated DTOs)', () => {
      const { assets, groups } = businessReadModel()
      const resolved = resolveProjectGroups(groups, assets)

      expect(resolved.map((g) => ({ kind: g.kind, projectId: g.projectId, ids: g.assets.map((a) => a.id) }))).toEqual(
        groups.map((g) => ({ kind: g.kind, projectId: g.projectId, ids: g.assetIds }))
      )
      expect(resolved.map((g) => g.assets.map((a) => a.id))).toEqual([['asset-business-a'], ['asset-project-a-1'], ['asset-project-a-2']])

      // Every resolved asset is the exact same object reference as in the source assets array.
      const byId = new Map(assets.map((a) => [a.id, a]))
      for (const group of resolved) {
        for (const asset of group.assets) expect(asset).toBe(byId.get(asset.id))
      }
    })

    it('by-project view shape: a resolved PROJECT group carries the project\'s code/name through unchanged (no re-derivation)', () => {
      const { assets, groups } = businessReadModel()
      const resolved = resolveProjectGroups(groups, assets)

      const projectGroups = resolved.filter((g) => g.kind === 'PROJECT')
      expect(projectGroups.length).toBeGreaterThan(0)
      for (const group of projectGroups) {
        expect(group.projectCode).toEqual(expect.any(String))
        expect(group.projectName).toEqual(expect.any(String))
      }
      expect(projectGroups.map((g) => [g.projectCode, g.projectName])).toEqual([
        ['PRJ-A1', 'A one'],
        ['PRJ-A2', 'A two'],
      ])

      // The BUSINESS (no-project) group has nothing to name.
      const businessGroup = resolved.find((g) => g.kind === 'BUSINESS')
      expect(businessGroup).toBeDefined()
      expect(businessGroup.projectCode).toBeUndefined()
      expect(businessGroup.projectName).toBeUndefined()
    })

    it('by-project view shape: drops an assetId with no matching asset instead of throwing', () => {
      const resolved = resolveProjectGroups(
        [{ kind: 'BUSINESS', businessId: 'b', projectId: null, assetIds: ['missing-id'] }],
        []
      )
      expect(resolved).toEqual([{ kind: 'BUSINESS', businessId: 'b', projectId: null, assetIds: ['missing-id'], assets: [] }])
    })
  })

  describe('preview eligibility gating', () => {
    const localActive = (mime) => ({ id: 'a1', storageKind: 'LOCAL_FILE', state: 'ACTIVE', mime })

    it('inline-previews a LOCAL_FILE + ACTIVE image via /api/files/{id}/content', () => {
      expect(getPreviewEligibility(localActive('image/png'))).toEqual({ mode: 'image', contentUrl: '/api/files/a1/content' })
    })

    it('inline-previews a LOCAL_FILE + ACTIVE PDF via /api/files/{id}/content', () => {
      expect(getPreviewEligibility(localActive('application/pdf'))).toEqual({ mode: 'pdf', contentUrl: '/api/files/a1/content' })
    })

    it('inline-previews a LOCAL_FILE + ACTIVE text file via /api/files/{id}/content', () => {
      expect(getPreviewEligibility(localActive('text/plain'))).toEqual({ mode: 'text', contentUrl: '/api/files/a1/content' })
    })

    it('falls back to a file-info card with a download link for any other ACTIVE local mime', () => {
      expect(getPreviewEligibility(localActive('application/octet-stream'))).toEqual({
        mode: 'file-info', contentUrl: '/api/files/a1/content',
      })
    })

    it('is ineligible for MANAGED_BLOB regardless of state or mime, and never names the content route', () => {
      const cases = [
        { id: 'b1', storageKind: 'MANAGED_BLOB', state: 'ACTIVE', mime: 'image/png' },
        { id: 'b2', storageKind: 'MANAGED_BLOB', state: 'QUARANTINED', mime: 'application/pdf' },
      ]
      for (const asset of cases) {
        const eligibility = getPreviewEligibility(asset)
        expect(eligibility.mode).toBe('unavailable')
        expect(eligibility.contentUrl).toBeUndefined()
      }
    })

    it('is ineligible for a non-ACTIVE LOCAL_FILE (MISSING or QUARANTINED) and never names the content route', () => {
      for (const state of ['MISSING', 'QUARANTINED']) {
        const eligibility = getPreviewEligibility({ id: 'c1', storageKind: 'LOCAL_FILE', state, mime: 'image/png' })
        expect(eligibility).toEqual({ mode: 'unavailable' })
        expect(eligibility.contentUrl).toBeUndefined()
      }
    })

    it('is a link-out only for EXTERNAL_URL, and is never proxied through the content route', () => {
      const eligibility = getPreviewEligibility({
        id: 'd1', storageKind: 'EXTERNAL_URL', state: 'ACTIVE', mime: 'application/pdf',
        externalUrl: 'https://example.test/file.pdf',
      })
      expect(eligibility).toEqual({ mode: 'external-link', href: 'https://example.test/file.pdf' })
      expect(eligibility.contentUrl).toBeUndefined()
    })

    it('is ineligible for an EXTERNAL_URL asset with no externalUrl', () => {
      expect(getPreviewEligibility({ id: 'd2', storageKind: 'EXTERNAL_URL', state: 'ACTIVE' })).toEqual({ mode: 'unavailable' })
    })

    it('never derives eligibility from a relativePath/filesystem path field', () => {
      const eligibility = getPreviewEligibility({
        id: 'e1', storageKind: 'LOCAL_FILE', state: 'ACTIVE', mime: 'image/png',
        relativePath: 'Business Files/should-not-be-used.png',
      })
      expect(eligibility).toEqual({ mode: 'image', contentUrl: '/api/files/e1/content' })
      expect(JSON.stringify(eligibility)).not.toMatch(/should-not-be-used/)
    })

    it('is ineligible for a null/undefined asset', () => {
      expect(getPreviewEligibility(null)).toEqual({ mode: 'unavailable' })
      expect(getPreviewEligibility(undefined)).toEqual({ mode: 'unavailable' })
    })
  })

  describe('view switcher aria state (NFR-004)', () => {
    it('exposes exactly the four contract views in a stable order', () => {
      expect(FILE_MANAGER_VIEWS.map((v) => v.key)).toEqual(['grid', 'timeline', 'by-project', 'preview'])
    })

    it('marks only the active view as aria-pressed=true, for every possible active view', () => {
      for (const activeKey of FILE_MANAGER_VIEWS.map((v) => v.key)) {
        for (const { key } of FILE_MANAGER_VIEWS) {
          const props = viewSwitcherButtonProps(key, activeKey)
          expect(props['aria-pressed']).toBe(key === activeKey)
          expect(props.type).toBe('button')
        }
      }
    })

    it('the switcher renders keyboard-reachable native <button> elements with aria-pressed wired to viewSwitcherButtonProps', () => {
      expect(source).toContain('function ViewSwitcher({ view, onChange })')
      const switcherBody = source.slice(source.indexOf('function ViewSwitcher'), source.indexOf('function GridView'))
      expect(switcherBody).toContain('<button')
      expect(switcherBody).toContain('{...viewSwitcherButtonProps(key, view)}')
      expect(switcherBody).toContain('role="group"')
      expect(switcherBody).toContain('aria-label="File view"')
    })
  })
})
