// @req FR-157 — Content UI contracts cover the six approved interfaces,
// Business-safe URLs, immutable revision controls and owner references.
// @spec ZAI:FR-157-NOTE
// @tested tests/unit/marketing-content-ui.test.js

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_FORMATS,
  CONTENT_TABS,
  contentDecisionInput,
  contentAssetApiPath,
  contentAssetPagePath,
  contentBriefApiPath,
  contentBriefPagePath,
  contentCollectionPagePath,
  contentCollectionPath,
  contentLibraryRows,
  contentProductionRows,
  contentVersionDiff,
  emptyContentPayload,
  latestContentPassReview,
  latestContentReview,
  normalizeContentPayload,
  productionStage,
  validateContentPayload,
} from '@/modules/marketing/components/content/content-contract'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const collection = read('src/modules/marketing/components/content/ContentCollection.jsx')
const collectionRoute = read('src/app/(pm)/growth/content/page.jsx')
const contract = read('src/modules/marketing/components/content/content-contract.js')
const form = read('src/modules/marketing/components/content/ContentBriefForm.jsx')
const detail = read('src/modules/marketing/components/content/ContentBriefDetail.jsx')
const asset = read('src/modules/marketing/components/content/ContentAssetDetail.jsx')
const history = read('src/modules/marketing/components/content/ContentVersionHistory.jsx')

const validPayload = {
  ...emptyContentPayload(),
  objective: 'Explain the delivery promise',
  audience: 'Approved corporate buyers',
  message: 'Make gifting easy to plan',
  claims: 'Delivery dates are verified by Commerce evidence',
  shotList: 'Opening, product detail, delivery close',
  acceptanceCriteria: 'Claims and usage rights are reviewed',
  evidenceReference: 'commerce://delivery-window/2026-09',
  format: 'VIDEO',
  channels: ['META_ADS', 'INSTAGRAM'],
  initiativeId: 'initiative-1',
  asset: { fileId: 'file-1' },
  rights: {
    holder: 'Brand team',
    license: 'Owned creative',
    channels: ['META_ADS', 'INSTAGRAM'],
    validFrom: '2026-09-01T00:00:00.000Z',
    validUntil: '2026-10-01T00:00:00.000Z',
    proof: 'rights://release-1',
  },
  production: { projectId: 'project-1', workItemId: 'work-item-1' },
}

describe('FR-157 Content UI contracts', () => {
  it('keeps the three collection tabs and exact page/API helpers separate', () => {
    expect(CONTENT_TABS.map((item) => item.key)).toEqual(['briefs', 'production', 'library'])
    expect(CONTENT_FORMATS.map((item) => item.value)).toEqual(['IMAGE', 'VIDEO', 'COPY', 'CAROUSEL', 'OTHER'])
    expect(contentCollectionPath('business-1')).toBe('/api/growth/content?businessId=business-1')
    expect(contentCollectionPagePath('library')).toBe('/growth/content?tab=library')
    expect(contentBriefApiPath('brief-1', 'business-1')).toBe('/api/growth/content/briefs/brief-1?businessId=business-1')
    expect(contentBriefPagePath('brief-1')).toBe('/growth/content/briefs/brief-1')
    expect(contentAssetApiPath('version-1', 'business-1')).toBe('/api/growth/content/assets/version-1?businessId=business-1')
    expect(contentAssetPagePath('version-1')).toBe('/growth/content/assets/version-1')
  })

  it('validates complete output, rights coverage and PM references', () => {
    expect(validateContentPayload(validPayload, 'Autumn creative brief')).toEqual([])
    expect(validateContentPayload({ ...validPayload, rights: { ...validPayload.rights, channels: ['INSTAGRAM'] } }, 'Brief')).toContain('Usage rights must cover every intended channel.')
    expect(validateContentPayload({ ...validPayload, asset: null, rights: validPayload.rights }, 'Brief')).toContain('Usage rights require a linked source file.')
    expect(validateContentPayload({ ...validPayload, rights: null }, 'Brief')).toContain('Record usage rights before linking a file.')
    expect(validateContentPayload({ ...validPayload, production: { workItemId: 'work-item-1' } }, 'Brief')).toContain('Production reference requires both a Project and a WorkItem.')
    expect(validateContentPayload({ ...validPayload, production: { projectId: 'project-1' } }, 'Brief')).toContain('Production reference requires both a Project and a WorkItem.')
    expect(normalizeContentPayload({ ...emptyContentPayload(), channels: ['META_ADS', 'META_ADS', 'UNKNOWN'] }).channels).toEqual(['META_ADS'])
  })

  it('keeps approval and production projections honest', () => {
    const library = contentLibraryRows({ briefs: [
      { id: 'brief-approved', currentVersion: { id: 'version-approved', payload: validPayload }, approval: { valid: true } },
      { id: 'brief-revoked', currentVersion: { id: 'version-revoked', payload: validPayload }, approval: { valid: false } },
    ] })
    expect(library).toHaveLength(1)
    expect(library[0].assetVersion.id).toBe('version-approved')
    expect(contentProductionRows({ production: [{ id: 'legacy-work-1', status: 'IN_PROGRESS' }], briefs: [{ id: 'brief-ready', references: { production: { status: 'READY', project: { id: 'project-1' }, workItem: { id: 'work-1', status: 'IN_PROGRESS' } } } }, { id: 'brief-unavailable', references: { production: { status: 'UNAVAILABLE', workItem: { id: 'work-2' } } } }] })).toEqual([{ id: 'work-1', status: 'IN_PROGRESS', briefId: 'brief-ready', project: { id: 'project-1' }, projectId: 'project-1' }])
    expect(productionStage('PLANNED')).toBe('PLANNED')
    expect(productionStage('DONE')).toBe('DONE')
    expect(productionStage('UNKNOWN')).toBe('OTHER')
    expect(contentVersionDiff({ message: 'before', asset: null }, { message: 'after', asset: { fileId: 'file-1' } })).toEqual(expect.arrayContaining(['message', 'asset']))
  })

  it('uses the latest exact revision review sequence for approval authority', () => {
    const version = { id: 'version-1', payloadHash: 'hash-1' }
    const brief = {
      reviews: [
        { id: 'review-old-pass', contentVersionId: version.id, payloadHash: version.payloadHash, verdict: 'PASS', sequence: 1, createdAt: '2099-01-01T00:00:00.000Z' },
        { id: 'review-latest-changes', contentVersionId: version.id, payloadHash: version.payloadHash, verdict: 'CHANGES_REQUIRED', sequence: 2, createdAt: '2020-01-01T00:00:00.000Z' },
        { id: 'review-other-version', contentVersionId: 'version-other', payloadHash: version.payloadHash, verdict: 'PASS', sequence: 99 },
      ],
    }
    expect(latestContentReview(brief, version)?.id).toBe('review-latest-changes')
    expect(latestContentPassReview(brief, version)).toBeNull()
  })

  it('serializes review binding only for approval decisions', () => {
    const version = { id: 'version-1', payloadHash: 'hash-1' }
    expect(contentDecisionInput(version, { verdict: 'REJECT', reviewId: 'review-1', rationale: 'Needs changes', expiresAt: '2030-01-01T00:00:00.000Z' })).toEqual({
      contentVersionId: 'version-1',
      payloadHash: 'hash-1',
      verdict: 'REJECT',
      rationale: 'Needs changes',
    })
    expect(contentDecisionInput(version, { verdict: 'APPROVE', reviewId: 'review-1', rationale: 'Approved', expiresAt: '2030-01-01T00:00:00.000Z' })).toEqual({
      contentVersionId: 'version-1',
      payloadHash: 'hash-1',
      verdict: 'APPROVE',
      rationale: 'Approved',
      reviewId: 'review-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
    })
  })
})

describe('FR-157 Content UI integration seams', () => {
  it('uses one URL tab row, real record links and no fixture fallback', () => {
    expect(collection).toContain('<MarketingTabs')
    expect(collection).toContain('contentBriefPagePath')
    expect(collection).toContain('contentAssetPagePath')
    expect(collection).toContain('marketing-content-production-board')
    expect(collection).toContain('marketing-content-library')
    expect(contract).toContain('approval?.valid === true')
    expect(collection).not.toContain('Autumn Gift Edit')
    expect(collection).not.toContain('WI-118')
  })

  it('keeps tab focus and collection identity stable across URL sections', () => {
    expect(collectionRoute).toContain("key={businessId || 'no-business'}")
    expect(collection).toContain("{tab === 'briefs' && <label")
    expect(collection).toContain('productionRowKey')
    expect(collection).not.toContain('key={item.workItemId || item.id}')
  })

  it('keeps create and revise fields owner-scoped and sends intent references only', () => {
    expect(form).toContain('contentReferencesPath')
    expect(form).toContain('growthCampaignsPath')
    expect(form).toContain('Source file (optional)')
    expect(form).toContain('Production Project (optional)')
    expect(form).toContain('Production task (optional)')
    expect(form).toContain('rights')
    expect(form).toContain('Owner:')
    expect(form).not.toContain('fileVersion:')
    expect(form).not.toContain('sha256:')
  })

  it('guards detail identity and exposes review, decision, archive and owner surfaces', () => {
    expect(detail).toContain('value.id && value.id !== briefId')
    expect(detail).toContain('value.businessId && value.businessId !== businessId')
    expect(detail).toContain("action, ...extra")
    expect(detail).toContain("mutate('review'")
    expect(detail).toContain("mutate('decide'")
    expect(detail).toContain("mutate('archive'")
    expect(detail).toContain('marketing-content-review')
    expect(detail).toContain('marketing-content-decision')
    expect(detail).toContain('Independent review requires another real user')
    expect(detail).toContain('Archive brief')
  })

  it('addresses asset detail by immutable MarketingContentVersion and does not fake preview bytes', () => {
    expect(asset).toContain('contentAssetApiPath')
    expect(asset).toContain('MarketingContentVersion')
    expect(asset).toContain('Open Files to inspect the authorized source record')
    expect(asset).toContain('fileSurfacePath')
    expect(asset).toContain('historical content revision')
    expect(asset).not.toContain('<img')
    expect(history).toContain('Before:')
    expect(history).toContain('After:')
    expect(history).toContain('contentVersionId')
    expect(history).not.toContain('[object Object]')
  })
})
