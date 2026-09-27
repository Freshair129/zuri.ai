// Marketing Insights (S6) — brand/asset scope. A brand slug is a selector,
// never a grant: the answer is the intersection of server-owned asset
// bindings with what the authenticated viewer may read. Pure.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-03 brands/auth, R-08 page/ad-account selection), SEC-001, BR-002
// @tested tests/unit/marketing/insights/brand-scope.test.js

/** Contract §4 slugs, kept as the baseline aliases. */
export const BRAND_SLUGS = Object.freeze(['infresh', 'glowcea', '056laos'])

export const ASSET_KINDS = Object.freeze(['PAGE', 'AD_ACCOUNT'])
// Provider namespaces keep a Page id and an ad-account id from ever being
// confused for one another (R-08). Tranche 1 reports Pages only.
export const ASSET_NAMESPACES = Object.freeze({ PAGE: 'meta.page', AD_ACCOUNT: 'meta.ad_account' })
export const REPORTABLE_ASSET_KINDS = Object.freeze(['PAGE'])

export class InsightScopeError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'InsightScopeError'
    this.code = code
    this.status = status
  }
}

// One shape for "no such brand", "brand you may not read" and "asset not in
// that brand", so a caller cannot enumerate brands by probing.
export function scopeNotFound() {
  return new InsightScopeError('SCOPE_NOT_FOUND', 'Insights scope not found', 404)
}

/**
 * @param {object} args
 * @param {string} args.brand requested slug
 * @param {string|null} args.assetId requested binding id (optional)
 * @param {Array<object>} args.bindings server-owned bindings (never client input)
 * @param {(binding) => boolean} args.canRead the viewer's current authority
 * @returns {{ brand, asset, assets }}
 */
export function resolveInsightScope({ brand, assetId = null, bindings = [], canRead } = {}) {
  if (typeof canRead !== 'function') throw new Error('resolveInsightScope requires a canRead predicate')
  if (!BRAND_SLUGS.includes(brand)) throw scopeNotFound()

  const assets = bindings
    .filter((binding) => binding.brandSlug === brand
      && binding.status === 'ACTIVE'
      && REPORTABLE_ASSET_KINDS.includes(binding.assetKind)
      && binding.namespace === ASSET_NAMESPACES[binding.assetKind])
    .filter((binding) => canRead(binding))
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)) || String(a.bindingId).localeCompare(String(b.bindingId)))

  if (assets.length === 0) throw scopeNotFound()

  // A report is always for one exact asset. Summing several Pages would be a
  // different, unreviewed metric (and wrong for unique counts).
  const asset = assetId === null ? assets[0] : assets.find((binding) => binding.bindingId === assetId)
  if (!asset) throw scopeNotFound()

  return {
    brand,
    asset,
    assets: assets.map((binding) => ({
      assetId: binding.bindingId,
      assetKind: binding.assetKind,
      displayName: binding.displayName,
    })),
  }
}

/** Brands the viewer can open, for a selector. Denied brands are absent, not hidden. */
export function listReadableBrands({ bindings = [], canRead } = {}) {
  const readable = new Set()
  for (const binding of bindings) {
    if (binding.status === 'ACTIVE' && REPORTABLE_ASSET_KINDS.includes(binding.assetKind)
      && BRAND_SLUGS.includes(binding.brandSlug) && canRead(binding)) {
      readable.add(binding.brandSlug)
    }
  }
  return BRAND_SLUGS.filter((slug) => readable.has(slug))
}
