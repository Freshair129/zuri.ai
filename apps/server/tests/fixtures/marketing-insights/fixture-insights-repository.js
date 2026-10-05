// SYNTHETIC FIXTURE — not provider data. Every id, name and number here is
// invented for tests (prefix `fx-`); nothing was copied from a Meta account.
//
// An in-memory InsightsRepository + InsightBindingReadPort with the same port
// contract a Postgres adapter must honour: scope-bound reads, snapshot ids,
// and revisions kept per grain.

import { enumerateDays } from '@/modules/marketing/insights/domain/report-window'

export const FX_TENANT = 'fx-tenant-1'
export const FX_BUSINESS = {
  infresh: 'fx-business-infresh',
  glowcea: 'fx-business-glowcea',
  laos: 'fx-business-056laos',
}

export function fixtureBindings() {
  return [
    { bindingId: 'fx-asset-infresh-page-a', brandSlug: 'infresh', tenantId: FX_TENANT, businessId: FX_BUSINESS.infresh, assetKind: 'PAGE', namespace: 'meta.page', displayName: 'FX INFRESH Page A', status: 'ACTIVE', revision: 1 },
    { bindingId: 'fx-asset-infresh-page-b', brandSlug: 'infresh', tenantId: FX_TENANT, businessId: FX_BUSINESS.infresh, assetKind: 'PAGE', namespace: 'meta.page', displayName: 'FX INFRESH Page B', status: 'ACTIVE', revision: 1 },
    { bindingId: 'fx-asset-infresh-ads', brandSlug: 'infresh', tenantId: FX_TENANT, businessId: FX_BUSINESS.infresh, assetKind: 'AD_ACCOUNT', namespace: 'meta.ad_account', displayName: 'FX INFRESH Ads', status: 'ACTIVE', revision: 1 },
    { bindingId: 'fx-asset-glowcea-page', brandSlug: 'glowcea', tenantId: FX_TENANT, businessId: FX_BUSINESS.glowcea, assetKind: 'PAGE', namespace: 'meta.page', displayName: 'FX Glowcea Page', status: 'ACTIVE', revision: 1 },
    { bindingId: 'fx-asset-056laos-page', brandSlug: '056laos', tenantId: FX_TENANT, businessId: FX_BUSINESS.laos, assetKind: 'PAGE', namespace: 'meta.page', displayName: 'FX 056 Laos Page', status: 'ACTIVE', revision: 1 },
    { bindingId: 'fx-asset-056laos-old', brandSlug: '056laos', tenantId: FX_TENANT, businessId: FX_BUSINESS.laos, assetKind: 'PAGE', namespace: 'meta.page', displayName: 'FX 056 Laos Old', status: 'REVOKED', revision: 2 },
  ]
}

/** A deterministic daily row: value = base + day index, per distribution. */
export function dailyRows({ assetId, metricKey, from, to, base = 100, distribution = 'ALL', unit = 'count', revision = 1, fetchedAt = '2026-09-20T19:00:00.000Z', skip = [] }) {
  return enumerateDays(from, to)
    .map((date, index) => ({ date, index }))
    .filter(({ date }) => !skip.includes(date))
    .map(({ date, index }) => ({
      assetId, metricKey, date, distribution, value: base + index, unit, quality: 'OBSERVED', fetchedAt, revision,
    }))
}

export function contentItem(overrides = {}) {
  const metric = (value) => (value === null ? { value: null, quality: 'NOT_SYNCED' } : { value, quality: 'OBSERVED' })
  const { views = 100, interactions = 10, reactions = 5, comments = 3, shares = 2, threeSecViews = 40, watchTime = 1000, organicViews = 70, paidViews = 30, ...rest } = overrides
  return {
    contentId: 'fx-content-1',
    providerPostId: 'fx-post-1',
    assetId: 'fx-asset-infresh-page-a',
    contentType: 'post',
    format: 'photo',
    publishedAt: '2026-09-10T05:00:00.000Z',
    permalink: 'https://www.facebook.com/fx/posts/1',
    thumbnailUrl: 'https://scontent.xx.fbcdn.net/fx/1.jpg',
    metricPeriod: 'LIFETIME_AS_OF_SYNC',
    fetchedAt: '2026-09-20T19:00:00.000Z',
    metrics: {
      views: metric(views), interactions: metric(interactions), reactions: metric(reactions), comments: metric(comments),
      shares: metric(shares), threeSecViews: metric(threeSecViews), watchTime: metric(watchTime),
      organicViews: metric(organicViews), paidViews: metric(paidViews),
    },
    ...rest,
  }
}

export function createFixtureRepository({ observations = [], windowAggregates = [], items = [], snapshots = null, calls = [] } = {}) {
  const snapshotFor = (assetId) => snapshots?.[assetId] ?? {
    snapshotId: `fx-snap-${assetId}-1`, generatedAt: '2026-09-20T19:05:00.000Z', coveredUntil: '2026-09-20', state: 'COMPLETE', partialReason: null,
  }
  const guardSnapshot = (assetId, snapshotId) => {
    const current = snapshotFor(assetId)
    if (snapshotId && snapshotId !== current.snapshotId) {
      const error = new Error('Report snapshot expired')
      error.code = 'SNAPSHOT_EXPIRED'
      error.status = 409
      throw error
    }
    return current
  }
  return {
    calls,
    async readDailyObservations(args) {
      calls.push({ method: 'readDailyObservations', ...args })
      const snapshot = guardSnapshot(args.assetId, args.snapshotId)
      return {
        snapshot,
        observations: observations.filter((row) => row.assetId === args.assetId && args.metricKeys.includes(row.metricKey) && row.date >= args.from && row.date <= args.to),
        windowAggregates: windowAggregates.filter((row) => row.assetId === args.assetId),
      }
    },
    async readContentItems(args) {
      calls.push({ method: 'readContentItems', ...args })
      const snapshot = guardSnapshot(args.assetId, args.snapshotId)
      return { snapshot, items: items.filter((item) => item.assetId === args.assetId) }
    },
  }
}

export function createFixtureBindingPort(bindings = fixtureBindings()) {
  return { async listBindings() { return bindings } }
}
