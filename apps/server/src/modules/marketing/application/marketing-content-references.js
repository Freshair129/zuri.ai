import prisma from '@/lib/db'
import { z } from 'zod'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'
import { listManagedFileAssets } from '@/modules/project-manager/application/file-asset-service'
import { getProjectRoadmap } from '@/modules/project-manager/application/project-roadmap-read-model'
import {
  assertMarketingReadAccess,
  marketingConflict,
  marketingNotFound,
} from './marketing-authority'

// @req FR-157 — Content reads owner-managed Files metadata and PM execution
// references without copying bytes or creating a second task model.
// @spec SDD-088, SEC-001, SEC-008 — Business + growth scope, exact FileAsset
// snapshots, and PM-owned Project/WorkItem authorization.
// @tested tests/integration/marketing-content-references.test.js

const CONTENT_REFERENCE_LIMIT = 100
const SHA256 = /^[a-f0-9]{64}$/

const assetReferenceSchema = z.object({
  fileId: z.string().min(1),
  fileVersion: z.number().int().positive(),
  sha256: z.string().regex(SHA256),
}).strict()

const productionReferenceSchema = z.object({
  projectId: z.string().min(1),
  workItemId: z.string().min(1),
}).strict()

const projectSelect = {
  id: true,
  code: true,
  name: true,
  status: true,
  deletedAt: true,
  businessId: true,
  business: { select: { id: true, tenantId: true } },
  workspace: { select: { id: true, scopeType: true, businessId: true, tenantId: true, portfolioId: true } },
}

function isNotFound(error) {
  return Number(error?.status) === 404
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isHash(value) {
  return typeof value === 'string' && SHA256.test(value)
}

function unavailableAsset(reasonCode) {
  return { status: 'UNAVAILABLE', reasonCode, file: null }
}

function unavailableProduction(reasonCode) {
  return { status: 'UNAVAILABLE', reasonCode, project: null, workItem: null }
}

function sanitizeFile(asset) {
  return {
    id: asset.id,
    code: asset.code,
    name: asset.name,
    mime: asset.mime,
    size: asset.size,
    version: asset.version,
    sha256: asset.sha256 ?? null,
    state: asset.status ?? asset.state,
    projectId: asset.projectId ?? null,
    workItemId: asset.workItemId ?? null,
  }
}

function sanitizeProject(project) {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
  }
}

function sanitizeWorkItem(item) {
  return {
    id: item.workItemId,
    projectId: item.projectId,
    planId: item.planId,
    containerId: item.containerId,
    code: item.code,
    title: item.title,
    status: item.status,
    subtype: item.subtype,
    startAt: item.startAt,
    targetAt: item.targetAt,
  }
}

function bounded(items) {
  return {
    items: items.slice(0, CONTENT_REFERENCE_LIMIT),
    truncated: items.length > CONTENT_REFERENCE_LIMIT,
  }
}

function parseReference(value, schema) {
  if (value === undefined || value === null) return { value: null, valid: true }
  const parsed = schema.safeParse(value)
  return parsed.success ? { value: parsed.data, valid: true } : { value: null, valid: false }
}

async function loadProject(db, projectId) {
  if (!isText(projectId)) return null
  return db.project.findUnique({ where: { id: projectId }, select: projectSelect })
}

async function authorizeProject(viewer, project, db) {
  try {
    await assertProjectReadable(viewer, project, { db })
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}

async function requireBusinessProject({ db, viewer, businessId, tenantId, projectId }) {
  const project = await loadProject(db, projectId)
  if (!project || project.deletedAt || project.businessId !== businessId || project.business?.tenantId !== tenantId || !(await authorizeProject(viewer, project, db))) {
    throw marketingNotFound('Project not found')
  }
  return project
}

async function listProjectsForViewer({ db, viewer, businessId, tenantId }) {
  const rows = await db.project.findMany({
    where: { businessId, deletedAt: null },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    take: CONTENT_REFERENCE_LIMIT + 1,
    select: projectSelect,
  })
  const authorized = []
  for (const project of rows) {
    if (project.business?.tenantId !== tenantId) continue
    if (await authorizeProject(viewer, project, db)) authorized.push(sanitizeProject(project))
  }
  return { items: authorized, sourceHasMore: rows.length > CONTENT_REFERENCE_LIMIT }
}

async function roadmapForProject({ db, viewer, businessId, projectId }) {
  let roadmap
  try {
    roadmap = await getProjectRoadmap(projectId, { db, viewer })
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
  if (!roadmap?.project || roadmap.project.id !== projectId || roadmap.project.businessId !== businessId) return null
  return roadmap
}

async function readAssetReference({ db, businessId, tenantId, reference }) {
  if (!reference.valid) return unavailableAsset('ASSET_REFERENCE_INVALID')
  if (!reference.value) return unavailableAsset('ASSET_REFERENCE_EMPTY')

  const asset = await db.fileAsset.findUnique({
    where: { id: reference.value.fileId },
    select: {
      id: true,
      code: true,
      tenantId: true,
      businessId: true,
      projectId: true,
      workItemId: true,
      name: true,
      mime: true,
      size: true,
      sha256: true,
      status: true,
      version: true,
      deletedAt: true,
    },
  })

  // A missing, deleted, or cross-Business row is deliberately indistinguishable
  // from an absent reference. No owner-controlled identity is returned.
  if (!asset || asset.deletedAt || asset.businessId !== businessId || asset.tenantId !== tenantId) {
    return unavailableAsset('ASSET_REFERENCE_UNAVAILABLE')
  }
  if (asset.version !== reference.value.fileVersion || asset.sha256 !== reference.value.sha256) {
    return unavailableAsset('ASSET_SNAPSHOT_MISMATCH')
  }
  if (asset.status !== 'ACTIVE' || !isHash(asset.sha256)) {
    return unavailableAsset('ASSET_NOT_USABLE')
  }
  return { status: 'READY', reasonCode: null, file: sanitizeFile(asset) }
}

async function readProductionReference({ db, viewer, businessId, reference }) {
  if (!reference.valid) return unavailableProduction('PRODUCTION_REFERENCE_INVALID')
  if (!reference.value) return unavailableProduction('PRODUCTION_REFERENCE_EMPTY')

  const roadmap = await roadmapForProject({
    db,
    viewer,
    businessId,
    projectId: reference.value.projectId,
  })
  if (!roadmap) return unavailableProduction('PRODUCTION_REFERENCE_UNAVAILABLE')

  const item = roadmap.items.find((candidate) =>
    candidate.projectId === reference.value.projectId && candidate.workItemId === reference.value.workItemId
  )
  if (!item) return unavailableProduction('PRODUCTION_REFERENCE_UNAVAILABLE')

  return {
    status: 'READY',
    reasonCode: null,
    project: sanitizeProject(roadmap.project),
    workItem: sanitizeWorkItem(item),
  }
}

/**
 * Resolve current owner metadata for a Content create/revise operation. The
 * caller supplies only a FileAsset id; the server returns the current positive
 * version and hash after the same Business + growth read gate used by reads.
 */
export async function resolveMarketingContentAsset({ viewer, businessId, fileId } = {}, { db = prisma } = {}) {
  const scope = await assertMarketingReadAccess({ db, viewer, businessId })
  if (!isText(fileId)) throw marketingNotFound('File asset not found')

  const asset = await db.fileAsset.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      code: true,
      tenantId: true,
      businessId: true,
      projectId: true,
      workItemId: true,
      name: true,
      mime: true,
      size: true,
      sha256: true,
      status: true,
      version: true,
      deletedAt: true,
    },
  })
  if (!asset || asset.deletedAt || asset.businessId !== businessId || asset.tenantId !== scope.scope.tenantId) {
    throw marketingNotFound('File asset not found')
  }
  if (asset.status !== 'ACTIVE' || !isHash(asset.sha256)) {
    throw marketingConflict('File asset is not usable')
  }
  return sanitizeFile(asset)
}

export async function listMarketingContentReferences({ viewer, businessId, projectId = null } = {}, { db = prisma } = {}) {
  const scope = await assertMarketingReadAccess({ db, viewer, businessId })
  const selectedProjectId = projectId || null
  if (selectedProjectId) await requireBusinessProject({
    db,
    viewer,
    businessId,
    tenantId: scope.scope.tenantId,
    projectId: selectedProjectId,
  })

  const fileReadModel = await listManagedFileAssets(
    { businessId, projectId: selectedProjectId },
    { db, visibleBusinessIds: viewer.visibleBusinessIds },
  )
  const tenantAssets = await db.fileAsset.findMany({
    where: { businessId, tenantId: scope.scope.tenantId, deletedAt: null },
    select: { id: true },
  })
  const tenantAssetIds = new Set(tenantAssets.map((asset) => asset.id))
  const files = fileReadModel.assets.filter((asset) => tenantAssetIds.has(asset.id)).map(sanitizeFile)
  const projectResult = await listProjectsForViewer({ db, viewer, businessId, tenantId: scope.scope.tenantId })
  const roadmap = selectedProjectId
    ? await roadmapForProject({ db, viewer, businessId, projectId: selectedProjectId })
    : null
  const workItems = roadmap?.items?.map(sanitizeWorkItem) || []
  const boundedFiles = bounded(files)
  const boundedProjects = bounded(projectResult.items)
  const boundedWorkItems = bounded(workItems)

  return {
    files: boundedFiles.items,
    projects: boundedProjects.items,
    workItems: boundedWorkItems.items,
    truncated: {
      files: fileReadModel.assets.length > CONTENT_REFERENCE_LIMIT || boundedFiles.truncated,
      projects: projectResult.sourceHasMore || boundedProjects.truncated,
      workItems: boundedWorkItems.truncated,
    },
  }
}

export async function readMarketingContentReferences({
  viewer,
  businessId,
  asset = null,
  production = null,
} = {}, { db = prisma } = {}) {
  const scope = await assertMarketingReadAccess({ db, viewer, businessId })
  const assetReference = parseReference(asset, assetReferenceSchema)
  const productionReference = parseReference(production, productionReferenceSchema)
  const [assetResult, productionResult] = await Promise.all([
    readAssetReference({ db, businessId, tenantId: scope.scope.tenantId, reference: assetReference }),
    readProductionReference({ db, viewer, businessId, reference: productionReference }),
  ])
  return { asset: assetResult, production: productionResult }
}
