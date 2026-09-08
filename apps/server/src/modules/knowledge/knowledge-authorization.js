import prisma from '@/lib/db'
import { assertProjectWritable, requireViewer } from '@/modules/project-manager/application/project-authorization'
import { assertProjectReadable } from '@/modules/project-manager/application/project-inventory-read-model'
import { isApiAccessFor, ownsBusiness, seesBusiness } from '@/modules/identity/viewer-authority'

// @req FR-172 — knowledge admission, retrieval, citation and withdrawal use
// the live Business/Project/FileAsset authority instead of request-selected
// scope or a global role label.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/integration/knowledge-corpus.test.js

const ACTIVE = 'ACTIVE'

function knowledgeError(status, message, code) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function notFound(message = 'Knowledge scope not found', code = 'KNOWLEDGE_SCOPE_NOT_FOUND') {
  return knowledgeError(404, message, code)
}

function cleanId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function actionName(value) {
  const action = cleanId(value)?.toLowerCase()
  return action === 'read' || action === 'write' ? action : null
}

/**
 * Parse the explicit Enterprise API knowledge grants. A malformed setting is
 * deny-by-default; it must never turn a bad deployment value into a wildcard
 * grant. The setting is intentionally not read from the request body.
 */
export function parseKnowledgeApiGrants(env = process.env) {
  const raw = env?.ZURI_KNOWLEDGE_API_GRANTS
  if (raw === undefined || raw === null || raw === '') return []
  let parsed
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((grant) => grant && typeof grant === 'object' && !Array.isArray(grant))
    .map((grant) => ({
      serviceAccountId: cleanId(grant.serviceAccountId),
      tenantId: cleanId(grant.tenantId),
      businessId: cleanId(grant.businessId),
      actions: Array.isArray(grant.actions)
        ? [...new Set(grant.actions.map(actionName).filter(Boolean))]
        : [],
    }))
    .filter((grant) => grant.serviceAccountId && grant.tenantId && grant.businessId && grant.actions.length)
}

/**
 * A service-account viewer has no implicit Business visibility. Its exact
 * tenant, service-account identity and Business/action grant must all match.
 */
export function hasKnowledgeApiGrant(viewer, { tenantId, businessId, action = 'read', env = process.env } = {}) {
  const requestedAction = actionName(action)
  const resolvedTenantId = cleanId(tenantId)
  const resolvedBusinessId = cleanId(businessId)
  if (!requestedAction || !resolvedTenantId || !resolvedBusinessId || viewer?.isApiAccess !== true) return false
  if (!isApiAccessFor(viewer, resolvedTenantId)) return false
  const serviceAccountId = cleanId(viewer.serviceAccountId)
  if (!serviceAccountId) return false
  return parseKnowledgeApiGrants(env).some((grant) =>
    grant.serviceAccountId === serviceAccountId &&
    grant.tenantId === resolvedTenantId &&
    grant.businessId === resolvedBusinessId &&
    grant.actions.includes(requestedAction),
  )
}

function assertBusinessRecord(business, businessId) {
  if (!business || business.id !== businessId || business.status !== ACTIVE) {
    throw notFound('Knowledge Business not found', 'KNOWLEDGE_BUSINESS_NOT_FOUND')
  }
  if (!cleanId(business.tenantId) || business.tenant && business.tenant.status !== undefined && business.tenant.status !== ACTIVE) {
    throw knowledgeError(409, 'Knowledge Business has no tenant scope', 'KNOWLEDGE_BUSINESS_SCOPE_INVALID')
  }
  return business
}

async function loadBusiness(db, businessId) {
  const id = cleanId(businessId)
  if (!id || typeof db?.business?.findUnique !== 'function') {
    throw notFound('Knowledge Business not found', 'KNOWLEDGE_BUSINESS_NOT_FOUND')
  }
  const business = await db.business.findUnique({
    where: { id },
    include: { tenant: { select: { id: true, portfolioId: true, status: true } } },
  })
  return assertBusinessRecord(business, id)
}

/** Resolve a live Business for an internal scope-bound runtime check. */
export async function assertKnowledgeBusinessCurrent(
  businessId,
  { db = prisma } = {},
) {
  return loadBusiness(db, businessId)
}

function canReadBusiness(viewer, business, env) {
  if (viewer?.isApiAccess === true) {
    return hasKnowledgeApiGrant(viewer, { tenantId: business.tenantId, businessId: business.id, action: 'read', env })
  }
  // A platform flag is not a substitute for the resolved visible grant. The
  // resolver supplies all visible Business ids to a platform viewer; a hand
  // built or stale flag therefore fails closed here.
  return seesBusiness(viewer, business.id)
}

function canWriteBusiness(viewer, business, env) {
  if (viewer?.isApiAccess === true) {
    return hasKnowledgeApiGrant(viewer, { tenantId: business.tenantId, businessId: business.id, action: 'write', env })
  }
  return ownsBusiness(viewer, business.id)
}

/** Authorize a live Business for knowledge reads. */
export async function assertKnowledgeBusinessReadable(
  viewer,
  businessId,
  { db = prisma, env = process.env } = {},
) {
  requireViewer(viewer, 'assertKnowledgeBusinessReadable')
  const business = await loadBusiness(db, businessId)
  if (!canReadBusiness(viewer, business, env)) {
    throw notFound('Knowledge Business not found', 'KNOWLEDGE_BUSINESS_NOT_FOUND')
  }
  return business
}

/** Authorize a live Business for knowledge writes/publication/withdrawal. */
export async function assertKnowledgeBusinessWritable(
  viewer,
  businessId,
  { db = prisma, env = process.env } = {},
) {
  requireViewer(viewer, 'assertKnowledgeBusinessWritable')
  const business = await loadBusiness(db, businessId)
  if (!canWriteBusiness(viewer, business, env)) {
    throw notFound('Knowledge Business not found', 'KNOWLEDGE_BUSINESS_NOT_FOUND')
  }
  return business
}

async function loadProject(db, projectId) {
  const id = cleanId(projectId)
  if (!id || typeof db?.project?.findUnique !== 'function') {
    throw notFound('Knowledge Project not found', 'KNOWLEDGE_PROJECT_NOT_FOUND')
  }
  const project = await db.project.findUnique({
    where: { id },
    include: {
      workspace: true,
      business: { select: { id: true, tenantId: true, status: true } },
    },
  })
  if (!project || project.deletedAt || project.id !== id) {
    throw notFound('Knowledge Project not found', 'KNOWLEDGE_PROJECT_NOT_FOUND')
  }
  if (!cleanId(project.businessId)) {
    throw knowledgeError(
      403,
      'Knowledge Project must belong to a Business; shared Projects cannot back a corpus',
      'KNOWLEDGE_PROJECT_BUSINESS_REQUIRED',
    )
  }
  return project
}

function ensureProjectBelongsToBusiness(project, business) {
  if (project.businessId !== business.id) {
    throw notFound('Knowledge Project not found', 'KNOWLEDGE_PROJECT_NOT_FOUND')
  }
  if (project.business && (project.business.id !== business.id || project.business.tenantId !== business.tenantId || project.business.status !== undefined && project.business.status !== ACTIVE)) {
    throw notFound('Knowledge Project not found', 'KNOWLEDGE_PROJECT_NOT_FOUND')
  }
  if (project.workspace?.businessId && project.workspace.businessId !== business.id) {
    throw notFound('Knowledge Project not found', 'KNOWLEDGE_PROJECT_NOT_FOUND')
  }
  if (project.workspace?.tenantId && project.workspace.tenantId !== business.tenantId) {
    throw notFound('Knowledge Project not found', 'KNOWLEDGE_PROJECT_NOT_FOUND')
  }
}

async function loadLiveFileAsset(db, fileAssetId) {
  const id = cleanId(fileAssetId)
  if (!id || typeof db?.fileAsset?.findUnique !== 'function') {
    throw notFound('Knowledge FileAsset not found', 'KNOWLEDGE_FILE_ASSET_NOT_FOUND')
  }
  const asset = await db.fileAsset.findUnique({ where: { id } })
  if (!asset || asset.id !== id || asset.deletedAt || asset.status !== ACTIVE) {
    throw notFound('Knowledge FileAsset not found', 'KNOWLEDGE_FILE_ASSET_NOT_FOUND')
  }
  return asset
}

async function assertAssetRelation(asset, access, { viewer, action, db, env }) {
  if (asset.businessId !== access.business.id || asset.tenantId !== access.business.tenantId) {
    throw notFound('Knowledge FileAsset not found', 'KNOWLEDGE_FILE_ASSET_NOT_FOUND')
  }
  if (access.project) {
    if (asset.projectId !== access.project.id) {
      throw notFound('Knowledge FileAsset not found', 'KNOWLEDGE_FILE_ASSET_NOT_FOUND')
    }
    return
  }
  if (!asset.projectId) return

  // A Business corpus may contain a file that currently belongs to a Project.
  // Resolve that Project now so deletion or reassignment cannot leave an old
  // citation readable through the broader Business scope.
  const fileProject = await loadProject(db, asset.projectId)
  ensureProjectBelongsToBusiness(fileProject, access.business)
  const apiGrant = viewer?.isApiAccess === true && hasKnowledgeApiGrant(viewer, {
    tenantId: access.business.tenantId,
    businessId: access.business.id,
    action,
    env,
  })
  if (!apiGrant) {
    if (action === 'write') await assertProjectWritable(viewer, fileProject.id, { db, notFoundMessage: 'Knowledge Project not found' })
    else await assertProjectReadable(viewer, fileProject, { db })
  }
}

/**
 * Resolve the live Business plus optional Project access. Project corpus
 * identity requires the direct Project.businessId; the read guard's historical
 * ownerless shared-project branch is deliberately excluded by loadProject.
 */
export async function resolveKnowledgeScope({
  viewer,
  businessId,
  projectId = null,
  action = 'read',
  db = prisma,
  env = process.env,
} = {}) {
  requireViewer(viewer, 'resolveKnowledgeScope')
  const requestedAction = actionName(action)
  if (!requestedAction) throw knowledgeError(400, 'Knowledge scope action is invalid', 'KNOWLEDGE_SCOPE_ACTION_INVALID')
  const business = requestedAction === 'write'
    ? await assertKnowledgeBusinessWritable(viewer, businessId, { db, env })
    : await assertKnowledgeBusinessReadable(viewer, businessId, { db, env })
  const resolvedProjectId = cleanId(projectId)
  if (!resolvedProjectId) return { business, project: null }

  const project = await loadProject(db, resolvedProjectId)
  ensureProjectBelongsToBusiness(project, business)
  const apiGrant = viewer?.isApiAccess === true && hasKnowledgeApiGrant(viewer, {
    tenantId: business.tenantId,
    businessId: business.id,
    action: requestedAction,
    env,
  })
  if (!apiGrant) {
    if (requestedAction === 'write') {
      await assertProjectWritable(viewer, project.id, { db, notFoundMessage: 'Knowledge Project not found' })
    } else {
      await assertProjectReadable(viewer, project, { db })
    }
  }
  return { business, project }
}

/**
 * Check the current Project ancestry for an internal, scope-bound operation.
 * Runtime publication already carries a non-serializable capability, so this
 * helper verifies liveness and Business ownership without inventing a viewer.
 */
export async function assertKnowledgeProjectCurrent(
  projectId,
  businessId,
  { db = prisma } = {},
) {
  const business = await loadBusiness(db, businessId)
  const project = await loadProject(db, projectId)
  ensureProjectBelongsToBusiness(project, business)
  return { business, project }
}

/** Resolve a live FileAsset and enforce its current Business/project relation. */
export async function assertKnowledgeFileReadable(
  viewer,
  fileAssetId,
  { businessId, projectId = null, db = prisma, env = process.env } = {},
) {
  requireViewer(viewer, 'assertKnowledgeFileReadable')
  const access = await resolveKnowledgeScope({ viewer, businessId, projectId, action: 'read', db, env })
  const asset = await loadLiveFileAsset(db, fileAssetId)
  await assertAssetRelation(asset, access, { viewer, action: 'read', db, env })
  return { asset, ...access }
}

/** Write counterpart used when a source admission names an existing asset. */
export async function assertKnowledgeFileWritable(
  viewer,
  fileAssetId,
  { businessId, projectId = null, db = prisma, env = process.env } = {},
) {
  requireViewer(viewer, 'assertKnowledgeFileWritable')
  const access = await resolveKnowledgeScope({ viewer, businessId, projectId, action: 'write', db, env })
  const asset = await loadLiveFileAsset(db, fileAssetId)
  await assertAssetRelation(asset, access, { viewer, action: 'write', db, env })
  return { asset, ...access }
}

/**
 * Check the current FileAsset and Project relation for an internal,
 * scope-bound runtime operation. The runtime has already proved the exact
 * execution scope through its non-serializable capability, so this helper
 * deliberately checks liveness and ownership without inventing a viewer.
 */
export async function assertKnowledgeFileCurrent(
  fileAssetId,
  { businessId, projectId = null, db = prisma } = {},
) {
  const business = await loadBusiness(db, businessId)
  const asset = await loadLiveFileAsset(db, fileAssetId)
  if (asset.businessId !== business.id || asset.tenantId !== business.tenantId) {
    throw notFound('Knowledge FileAsset not found', 'KNOWLEDGE_FILE_ASSET_NOT_FOUND')
  }
  const requestedProjectId = cleanId(projectId)
  if (requestedProjectId) {
    const project = await loadProject(db, requestedProjectId)
    ensureProjectBelongsToBusiness(project, business)
    if (asset.projectId !== project.id) throw notFound('Knowledge FileAsset not found', 'KNOWLEDGE_FILE_ASSET_NOT_FOUND')
    return { asset, business, project }
  }
  if (asset.projectId) {
    const project = await loadProject(db, asset.projectId)
    ensureProjectBelongsToBusiness(project, business)
    return { asset, business, project }
  }
  return { asset, business, project: null }
}

export { knowledgeError }
