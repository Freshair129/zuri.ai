// @req FR-157 — Marketing Content exposes Business-scoped briefs, production
// projections, approved asset references and immutable review decisions.
// @spec ZAI:FR-157-NOTE — client actions bind the exact content revision and
// never own PM work or FileAsset bytes.
// @tested tests/unit/marketing-content-ui.test.js

import { PLAN_CHANNELS } from '../marketing-contract'

export const CONTENT_TABS = [
  { key: 'briefs', label: 'Briefs' },
  { key: 'production', label: 'Production' },
  { key: 'library', label: 'Library' },
]

export const CONTENT_FORMATS = [
  { value: 'IMAGE', label: 'Image' },
  { value: 'VIDEO', label: 'Video' },
  { value: 'COPY', label: 'Copy' },
  { value: 'CAROUSEL', label: 'Carousel' },
  { value: 'OTHER', label: 'Other' },
]

export const CONTENT_PHASES = ['DRAFT', 'PRODUCTION', 'REVIEW', 'APPROVED', 'ARCHIVED']
export const PRODUCTION_STAGES = [
  { key: 'READY', label: 'Ready' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'REVIEW', label: 'In review' },
  { key: 'DONE', label: 'Accepted' },
  { key: 'OTHER', label: 'Other status' },
]

export const CONTENT_API_PATH = '/api/growth/content'

function withQuery(path, values) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values || {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, value)
  }
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function contentCollectionPath(businessId) {
  return withQuery(CONTENT_API_PATH, { businessId })
}

export function contentBriefApiPath(briefId, businessId) {
  return withQuery(`${CONTENT_API_PATH}/briefs/${encodeURIComponent(briefId || '')}`, { businessId })
}

export function contentAssetApiPath(assetVersionId, businessId) {
  return withQuery(`${CONTENT_API_PATH}/assets/${encodeURIComponent(assetVersionId || '')}`, { businessId })
}

export function contentReferencesPath(businessId, projectId) {
  return withQuery(`${CONTENT_API_PATH}/references`, { businessId, projectId })
}

export function contentCollectionPagePath(tab = 'briefs', { query = '' } = {}) {
  return withQuery('/growth/content', { tab, q: query })
}

export function contentNewPagePath() {
  return '/growth/content/new'
}

export function contentBriefPagePath(briefId) {
  return `/growth/content/briefs/${encodeURIComponent(briefId || '')}`
}

export function contentAssetPagePath(assetVersionId) {
  return `/growth/content/assets/${encodeURIComponent(assetVersionId || '')}`
}

export function emptyContentPayload() {
  return {
    objective: '',
    audience: '',
    message: '',
    claims: '',
    shotList: '',
    acceptanceCriteria: '',
    evidenceReference: '',
    format: 'IMAGE',
    channels: [],
    initiativeId: null,
    asset: null,
    rights: null,
    production: null,
  }
}

function text(value) {
  return String(value ?? '')
}

function normalizeRights(value) {
  if (!value || typeof value !== 'object') return null
  return {
    holder: text(value.holder),
    license: text(value.license),
    channels: Array.isArray(value.channels) ? [...new Set(value.channels.filter(Boolean))] : [],
    validFrom: text(value.validFrom),
    validUntil: text(value.validUntil),
    proof: text(value.proof),
  }
}

function normalizeAsset(value) {
  if (!value || typeof value !== 'object' || !value.fileId) return null
  return { fileId: text(value.fileId) }
}

function normalizeProduction(value) {
  if (!value || typeof value !== 'object' || (!value.projectId && !value.workItemId)) return null
  return { projectId: text(value.projectId), workItemId: value.workItemId ? text(value.workItemId) : null }
}

export function normalizeContentPayload(payload = {}) {
  const value = { ...emptyContentPayload(), ...(payload || {}) }
  return {
    objective: text(value.objective),
    audience: text(value.audience),
    message: text(value.message),
    claims: text(value.claims),
    shotList: text(value.shotList),
    acceptanceCriteria: text(value.acceptanceCriteria),
    evidenceReference: text(value.evidenceReference),
    format: CONTENT_FORMATS.some((item) => item.value === value.format) ? value.format : 'IMAGE',
    channels: Array.isArray(value.channels) ? [...new Set(value.channels.filter((channel) => PLAN_CHANNELS.some((item) => item.value === channel)))] : [],
    initiativeId: value.initiativeId ? text(value.initiativeId) : null,
    asset: normalizeAsset(value.asset),
    rights: normalizeRights(value.rights),
    production: normalizeProduction(value.production),
  }
}

export function validateContentPayload(payload, title = '') {
  const value = normalizeContentPayload(payload)
  const errors = []
  if (!text(title).trim()) errors.push('Give this brief a title.')
  if (text(title).length > 200) errors.push('Brief title must be 200 characters or fewer.')
  const fields = [
    ['objective', 'Describe the objective.'],
    ['audience', 'Describe the audience.'],
    ['message', 'Write the primary message.'],
    ['claims', 'Record the claims to verify.'],
    ['shotList', 'Add a shot list or content outline.'],
    ['acceptanceCriteria', 'Define acceptance criteria.'],
    ['evidenceReference', 'Add an evidence reference.'],
  ]
  for (const [key, message] of fields) {
    if (!value[key].trim()) errors.push(message)
    if (value[key].length > 4000) errors.push(`${key} must be 4000 characters or fewer.`)
  }
  if (!value.channels.length) errors.push('Choose at least one channel.')

  if (value.asset) {
    if (!value.rights) errors.push('Record usage rights before linking a file.')
    const rights = value.rights
    if (!text(rights?.holder).trim()) errors.push('Record the rights holder.')
    if (!text(rights?.license).trim()) errors.push('Record the usage license.')
    if (!rights?.validFrom || !rights?.validUntil) errors.push('Record the rights validity window.')
    if (!text(rights?.proof).trim()) errors.push('Record a rights proof reference.')
    const from = new Date(rights?.validFrom || '').getTime()
    const until = new Date(rights?.validUntil || '').getTime()
    if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until) errors.push('Rights valid-from must be before valid-until.')
    const rightsChannels = new Set(rights?.channels || [])
    if (value.channels.some((channel) => !rightsChannels.has(channel))) errors.push('Usage rights must cover every intended channel.')
  } else if (value.rights) {
    errors.push('Usage rights require a linked source file.')
  }

  if (value.production && (!value.production.projectId || !value.production.workItemId)) errors.push('Production reference requires both a Project and a WorkItem.')
  return errors
}

export function currentContentVersion(brief) {
  if (brief?.currentVersion) return brief.currentVersion
  return [...(brief?.versions || [])].sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0))[0] || null
}

export function contentVersionPayload(version) {
  return normalizeContentPayload(version?.payload || {})
}

export function contentVersionDiff(before = {}, after = {}) {
  const left = normalizeContentPayload(before)
  const right = normalizeContentPayload(after)
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
}

export function contentBriefRows(data) {
  return Array.isArray(data?.briefs) ? data.briefs : []
}

export function contentProductionRows(data) {
  if (!Array.isArray(data?.briefs)) return []
  return data.briefs.flatMap((brief) => {
    const production = brief?.references?.production
    if (production?.status !== 'READY' || !production.workItem) return []
    return [{
      ...production.workItem,
      briefId: brief.id,
      project: production.project || null,
      projectId: production.project?.id || brief?.currentVersion?.payload?.production?.projectId || null,
    }]
  })
}

export function contentLibraryRows(data) {
  if (!Array.isArray(data?.briefs)) return []
  return data.briefs
    .filter((brief) => brief?.approval?.valid === true)
    .map((brief) => ({ ...brief, assetVersion: currentContentVersion(brief) }))
    .filter((brief) => brief.assetVersion?.payload?.asset?.fileId)
}

function reviewSequence(review) {
  const value = Number(review?.sequence)
  return Number.isFinite(value) ? value : -1
}

export function latestContentReview(brief, version) {
  return [...(brief?.reviews || [])]
    .filter((review) => review.contentVersionId === version?.id && review.payloadHash === version?.payloadHash)
    .sort((left, right) => reviewSequence(right) - reviewSequence(left))[0] || null
}

export function latestContentPassReview(brief, version) {
  const review = latestContentReview(brief, version)
  return review?.verdict === 'PASS' ? review : null
}

export function productionStage(status) {
  const normalized = text(status).toUpperCase()
  if (normalized === 'PLANNED') return 'READY'
  if (PRODUCTION_STAGES.some((stage) => stage.key === normalized)) return normalized
  return 'OTHER'
}

export function productionStageLabel(status) {
  return PRODUCTION_STAGES.find((stage) => stage.key === productionStage(status))?.label || 'Other status'
}

export function formatContentDate(value, fallback = 'Date unavailable') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : fallback
}

export function formatContentDateTime(value, fallback = 'Date unavailable') {
  if (!value) return fallback
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : fallback
}

export function contentFormatLabel(value) {
  return CONTENT_FORMATS.find((item) => item.value === value)?.label || value || 'Format unavailable'
}

export function contentChannelLabel(value) {
  return PLAN_CHANNELS.find((item) => item.value === value)?.label || value || 'Channel unavailable'
}

export function contentApprovalLabel(approval) {
  if (approval?.valid === true) return 'Approved and usable'
  if (approval?.reasonCode) return `Unavailable: ${String(approval.reasonCode).replace(/_/g, ' ').toLowerCase()}`
  return 'Approval unavailable'
}

export function contentOwnerLabel(row) {
  return row?.owner?.displayName || row?.createdBy?.displayName || row?.createdBy || row?.ownerName || 'Owner unavailable'
}

export function fileSurfacePath(fileId) {
  return fileId ? `/files?asset=${encodeURIComponent(fileId)}` : null
}
