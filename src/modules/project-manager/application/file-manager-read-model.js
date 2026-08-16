// @req FR-045 — File Manager aggregates authorized Business and Project assets without copying content.
// @req FR-058 — assetDto gains createdAt/updatedAt; exposes deterministic timeline ordering and by-project groups for the view switcher.
// @spec SDD-023, ADR-016, SEC-007, SDD-031
// @tested tests/unit/fr045-file-manager-read-model.test.js, tests/unit/fr058-file-manager-views-model.test.js

export const FILE_MANAGER_ASSET_STATES = Object.freeze(['ACTIVE', 'MISSING', 'QUARANTINED'])

const stateCounts = () => ({ total: 0, ACTIVE: 0, MISSING: 0, QUARANTINED: 0 })

function visibleBusinessIdsSet(visibleBusinessIds) {
  if (visibleBusinessIds instanceof Set) return visibleBusinessIds
  if (Array.isArray(visibleBusinessIds)) return new Set(visibleBusinessIds)
  throw new Error('visibleBusinessIds must be an Array or Set')
}

function requireVisibleBusiness(businessId, visibleBusinessIds) {
  if (!businessId) throw new Error('businessId is required')
  if (!visibleBusinessIdsSet(visibleBusinessIds).has(businessId)) {
    throw new Error('Business access denied (not visible)')
  }
}

function normalizeLocalCapability(localCapability) {
  return {
    available: Boolean(localCapability?.available),
    reason: localCapability?.reason || null,
  }
}

function compareAssets(left, right) {
  return [left.code || '', left.id || ''].join('|').localeCompare([right.code || '', right.id || ''].join('|'))
}

function assetDto(asset, localCapability) {
  return {
    id: asset.id,
    code: asset.code,
    businessId: asset.businessId,
    projectId: asset.projectId ?? null,
    workItemId: asset.workItemId || null,
    name: asset.name,
    mime: asset.mime,
    size: asset.size,
    storageKind: asset.storageKind,
    relativePath: asset.relativePath || null,
    externalUrl: asset.externalUrl || null,
    blobRef: asset.blobRef || null,
    sha256: asset.sha256 || null,
    state: asset.status,
    version: asset.version,
    localCapability,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  }
}

/**
 * Deterministic timeline ordering (FR-058): most-recently-updated first, ties
 * broken by most-recently-created first, remaining ties broken by the existing
 * compareAssets code|id discipline. Pure function over the DTO list — no new
 * server route or persisted ordering field.
 */
export function compareAssetsByTimeline(left, right) {
  const leftUpdated = new Date(left.updatedAt).getTime()
  const rightUpdated = new Date(right.updatedAt).getTime()
  if (leftUpdated !== rightUpdated) return rightUpdated - leftUpdated

  const leftCreated = new Date(left.createdAt).getTime()
  const rightCreated = new Date(right.createdAt).getTime()
  if (leftCreated !== rightCreated) return rightCreated - leftCreated

  return compareAssets(left, right)
}

function deduplicatedAssets(assets) {
  const byId = new Map()
  for (const asset of assets || []) {
    if (!asset?.id || byId.has(asset.id)) continue
    byId.set(asset.id, asset)
  }
  return [...byId.values()]
}

function countsFor(assets) {
  return assets.reduce((counts, asset) => {
    counts.total += 1
    counts[asset.state] += 1
    return counts
  }, stateCounts())
}

function groupsFor({ businessId, assets, projectsById }) {
  const businessAssetIds = assets.filter((asset) => asset.projectId === null).map((asset) => asset.id)
  const projectAssetIds = new Map()
  for (const asset of assets.filter((asset) => asset.projectId !== null)) {
    const ids = projectAssetIds.get(asset.projectId) || []
    ids.push(asset.id)
    projectAssetIds.set(asset.projectId, ids)
  }

  const groups = []
  if (businessAssetIds.length) {
    groups.push({ kind: 'BUSINESS', businessId, projectId: null, assetIds: businessAssetIds })
  }
  for (const project of [...projectsById.values()].sort((left, right) =>
    [left.code || '', left.id].join('|').localeCompare([right.code || '', right.id].join('|'))
  )) {
    const assetIds = projectAssetIds.get(project.id)
    if (assetIds?.length) {
      // FR-058 §3 (amended): carry the Project's human identifiers on the group so
      // the by-project view never has to render a raw uuid. `project` here is the
      // full record from projectsById — already in hand, so this is additive and
      // costs zero extra queries (see the FR-058 note's "Amendment" section).
      groups.push({
        kind: 'PROJECT', businessId, projectId: project.id,
        projectCode: project.code, projectName: project.name,
        assetIds,
      })
    }
  }
  return groups
}

function projectIndex(projects, businessId) {
  return new Map((projects || [])
    .filter((project) => project?.id && project.businessId === businessId && !project.deletedAt)
    .map((project) => [project.id, project]))
}

function isKnownState(asset) {
  return FILE_MANAGER_ASSET_STATES.includes(asset?.status)
}

function businessScopedAssets({ assets, businessId, projectsById }) {
  return deduplicatedAssets(assets)
    .filter((asset) => {
      if (asset.deletedAt || asset.businessId !== businessId || !isKnownState(asset)) return false
      return asset.projectId == null || projectsById.has(asset.projectId)
    })
    .sort(compareAssets)
}

function readModel({ scope, businessId, projectId = null, assets, projects, localCapability }) {
  const capability = normalizeLocalCapability(localCapability)
  const projectsById = projectIndex(projects, businessId)
  const scopedAssets = businessScopedAssets({ assets, businessId, projectsById })
    .filter((asset) => projectId === null || asset.projectId === projectId)
    .map((asset) => assetDto(asset, capability))

  return {
    scope,
    businessId,
    projectId,
    localCapability: capability,
    assets: scopedAssets,
    counts: countsFor(scopedAssets),
    groups: groupsFor({ businessId, assets: scopedAssets, projectsById }),
    isEmpty: scopedAssets.length === 0,
  }
}

/**
 * Canonical Business File Manager projection. Secondary FileLink rows are not an
 * input to aggregation, so a single FileAsset can only produce one DTO.
 */
export function buildBusinessFileManagerReadModel({ businessId, visibleBusinessIds, projects = [], assets = [], localCapability } = {}) {
  requireVisibleBusiness(businessId, visibleBusinessIds)
  return readModel({ scope: 'BUSINESS', businessId, assets, projects, localCapability })
}

/**
 * Project File Manager projection. The opened Project must be an owned Project
 * of the selected, viewer-visible Business; shared/null-owner Projects fail closed.
 */
export function buildProjectFileManagerReadModel({ businessId, projectId, visibleBusinessIds, projects = [], assets = [], localCapability } = {}) {
  requireVisibleBusiness(businessId, visibleBusinessIds)
  if (!projectId) throw new Error('projectId is required')
  if (!projectIndex(projects, businessId).has(projectId)) {
    throw new Error('Project does not belong to selected Business')
  }
  return readModel({ scope: 'PROJECT', businessId, projectId, assets, projects, localCapability })
}
