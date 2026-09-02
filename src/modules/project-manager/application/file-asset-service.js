// @req FR-045 — SQLite-authoritative managed files, lossless legacy migration and remount metadata.
// @spec SDD-023, BR-010, SEC-007, ADR-016, ZV2-CR-001
// @tested tests/unit/fr045-file-asset-service.test.js, tests/integration/fr045-managed-files.test.js
// @req FR-072 — every FileAsset/mount write refuses unless the viewer owns the
// governing Business; reads stay scoped to visible Businesses.
// @spec SEC-001, SEC-008, BR-001
// @tested tests/integration/fr072-file-asset-authorization.test.js
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from './audit'
import { createLocalFilesystemPort } from '../local-files/filesystem-port'
import { createConfiguredAssetObjectStoragePort } from '@/platform/storage/supabase-object-storage'
import { assertBusinessWritable, assertFileAssetWritable } from './project-authorization'
import {
  buildBusinessFileManagerReadModel,
  buildProjectFileManagerReadModel,
} from './file-manager-read-model'

const win = path.win32
const STORAGE_KINDS = ['LOCAL_FILE', 'MANAGED_BLOB', 'EXTERNAL_URL']

function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) } catch { return false }
}

const fileInput = z.object({
  code: z.string().min(1).optional(),
  businessId: z.string().min(1),
  projectId: z.string().min(1).nullish(),
  workItemId: z.string().min(1).nullish(),
  storageKind: z.enum(STORAGE_KINDS),
  mountId: z.string().min(1).nullish(),
  relativePath: z.string().min(1).nullish(),
  externalUrl: z.string().url().nullish(),
  blobRef: z.string().min(1).nullish(),
  contentBase64: z.string().nullish(),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).nullish(),
  uploadedBy: z.string().min(1).nullish(),
}).superRefine((value, context) => {
  if (value.storageKind === 'LOCAL_FILE' && (!value.mountId || !value.relativePath || !value.contentBase64)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'LOCAL_FILE requires mountId, relativePath and contentBase64' })
  }
  if (value.storageKind === 'EXTERNAL_URL' && !value.externalUrl) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'EXTERNAL_URL requires externalUrl' })
  } else if (value.storageKind === 'EXTERNAL_URL' && !isHttpUrl(value.externalUrl)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'EXTERNAL_URL requires HTTP or HTTPS' })
  }
  if (value.storageKind === 'MANAGED_BLOB' && !value.blobRef) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'MANAGED_BLOB requires blobRef' })
  }
})

// READ-only gate. `visibleBusinessIds` authorizes *seeing* a Business (an
// OWNER or a plain MEMBER Membership both populate it); it is never a
// substitute for `assertBusinessWritable`/`assertFileAssetWritable` below,
// which every write in this file uses instead (FR-072).
function assertVisible(businessId, visibleBusinessIds) {
  if (!Array.isArray(visibleBusinessIds) || !visibleBusinessIds.includes(businessId)) {
    throw new Error('Business access denied (not visible)')
  }
}

async function businessScope(db, businessId, projectId = null, workItemId = null) {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw new Error('Business not found')
  let project = null
  if (projectId) {
    project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, businessId: true, deletedAt: true } })
    if (!project || project.deletedAt || project.businessId !== businessId) throw new Error('Project does not belong to selected Business')
  }
  if (workItemId) {
    const item = await db.workItem.findFirst({ where: { id: workItemId, deletedAt: null, workstream: { projectId } }, select: { id: true } })
    if (!item) throw new Error('Work item must belong to the Project')
  }
  return { business, project }
}

async function nextCode(db, name, explicit) {
  if (explicit) return explicit
  return uniqueHumanCode('FIL', name, async (code) => Boolean(await db.fileAsset.findUnique({ where: { code } })))
}

export function localFileCapability(env = process.env) {
  return env.ZURI_LOCAL_FILE_BRIDGE === '1'
    ? { available: true, reason: null }
    : { available: false, reason: 'Local file bridge is disabled' }
}

export async function createManagedFileAsset(input, {
  db = prisma,
  viewer,
  // A caller whose own domain already authorizes the write under a broader
  // rule (e.g. asset-management's `canWriteAssetIntake`, which also accepts an
  // RBAC permission grant, not only ownership) may pass that predicate so this
  // gate agrees with it instead of re-narrowing to plain ownership.
  authorize,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  const value = fileInput.parse(input)
  await assertBusinessWritable(viewer, value.businessId, { db, ...(authorize ? { authorize } : {}) })
  const { business } = await businessScope(db, value.businessId, value.projectId, value.workItemId)
  const code = await nextCode(db, value.name, value.code)
  const mount = value.storageKind === 'LOCAL_FILE'
    ? await db.localWorkspaceMount.findFirst({ where: { id: value.mountId, businessId: value.businessId, status: 'ACTIVE' } })
    : null
  if (value.storageKind === 'LOCAL_FILE' && !mount) throw new Error('Active local workspace mount not found')

  const content = value.storageKind === 'LOCAL_FILE' ? Buffer.from(value.contentBase64, 'base64') : null
  if (content && content.length !== value.size) throw new Error('Declared size does not match decoded content')
  const sha256 = content ? createHash('sha256').update(content).digest('hex') : (value.sha256 ?? null)
  const status = content ? 'QUARANTINED' : 'ACTIVE'

  const asset = await db.$transaction(async (tx) => {
    const created = await tx.fileAsset.create({ data: {
      code,
      tenantId: business.tenantId,
      businessId: value.businessId,
      projectId: value.projectId ?? null,
      workItemId: value.workItemId ?? null,
      storageKind: value.storageKind,
      relativePath: value.relativePath ?? null,
      externalUrl: value.externalUrl ?? null,
      blobRef: value.blobRef ?? null,
      name: value.name,
      mime: value.mime,
      size: value.size,
      sha256,
      status,
      uploadedBy: value.uploadedBy ?? null,
    } })
    const entityType = value.projectId ? 'PROJECT' : 'BUSINESS'
    const entityId = value.projectId || value.businessId
    await tx.fileLink.create({ data: { fileId: created.id, entityType, entityId, relationType: 'OWNER' } })
    await recordAudit(tx, { entityType: 'FILE_ASSET', entityId: created.id, action: 'CREATED', payload: { code, businessId: value.businessId, projectId: value.projectId || null, storageKind: value.storageKind, status } })
    return created
  })

  if (!content) return asset
  const stagingRoot = win.join(mount.rootPath, '.zuri', 'temp')
  const stagingName = `${asset.id}.tmp`
  try {
    await filesystemPort.stageWrite({ stagingRoot, stagingName, content })
    await filesystemPort.promote({ mountRoot: mount.rootPath, stagingRoot, stagingName, relativePath: value.relativePath })
    return await db.fileAsset.update({ where: { id: asset.id }, data: { status: 'ACTIVE', version: { increment: 1 } } })
  } catch (error) {
    await db.fileAsset.update({ where: { id: asset.id }, data: { status: 'QUARANTINED' } })
    await filesystemPort.cleanupStaged({ stagingRoot, stagingName }).catch(() => {})
    throw error
  }
}

export function legacyFileAssetDto(asset) {
  return {
    id: asset.id,
    code: asset.code,
    projectId: asset.projectId,
    workItemId: asset.workItemId ?? null,
    name: asset.name,
    mime: asset.mime,
    size: asset.size,
    url: asset.externalUrl ?? null,
    blobRef: asset.blobRef ?? (asset.storageKind === 'LOCAL_FILE' ? asset.relativePath : null),
    version: asset.version,
    uploadedBy: asset.uploadedBy ?? null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    workItem: asset.workItem ?? null,
    managedStatus: asset.status,
    storageKind: asset.storageKind,
    relativePath: asset.relativePath ?? null,
    sha256: asset.sha256 ?? null,
  }
}

export async function listManagedFileAssets({ businessId, projectId = null }, {
  db = prisma,
  visibleBusinessIds,
  env = process.env,
} = {}) {
  assertVisible(businessId, visibleBusinessIds)
  const projects = await db.project.findMany({ where: { businessId, deletedAt: null }, select: { id: true, code: true, name: true, businessId: true, deletedAt: true } })
  const assets = await db.fileAsset.findMany({ where: { businessId, deletedAt: null }, orderBy: { code: 'asc' } })
  const args = { businessId, visibleBusinessIds, projects, assets, localCapability: localFileCapability(env) }
  return projectId
    ? buildProjectFileManagerReadModel({ ...args, projectId })
    : buildBusinessFileManagerReadModel(args)
}

export async function upsertLocalWorkspaceMount(input, { db = prisma, viewer } = {}) {
  const value = z.object({ businessId: z.string().min(1), deviceKey: z.string().min(1), rootPath: z.string().min(1) }).parse(input)
  const business = await assertBusinessWritable(viewer, value.businessId, { db })
  if (!win.isAbsolute(value.rootPath)) throw new Error('Mount root must be an absolute Windows path')
  const mount = await db.localWorkspaceMount.upsert({
    where: { businessId_deviceKey: { businessId: value.businessId, deviceKey: value.deviceKey } },
    create: { tenantId: business.tenantId, businessId: value.businessId, deviceKey: value.deviceKey, rootPath: win.normalize(value.rootPath) },
    update: { rootPath: win.normalize(value.rootPath), status: 'ACTIVE', version: { increment: 1 } },
  })
  await recordAudit(db, { entityType: 'LOCAL_WORKSPACE_MOUNT', entityId: mount.id, action: 'REMOUNTED', payload: { businessId: value.businessId, deviceKey: value.deviceKey } })
  return mount
}

export async function listLocalWorkspaceMounts(businessId, { db = prisma, visibleBusinessIds } = {}) {
  assertVisible(businessId, visibleBusinessIds)
  return db.localWorkspaceMount.findMany({ where: { businessId }, orderBy: { deviceKey: 'asc' } })
}

export async function resolveFileAssetContent(fileId, {
  db = prisma,
  visibleBusinessIds,
  filesystemPort = createLocalFilesystemPort(),
  objectStoragePort = null,
} = {}) {
  const asset = await db.fileAsset.findUnique({ where: { id: fileId } })
  if (!asset || asset.deletedAt) throw new Error('File asset not found')
  assertVisible(asset.businessId, visibleBusinessIds)
  if (asset.status !== 'ACTIVE') throw new Error(`File asset is ${asset.status}`)
  if (asset.storageKind === 'MANAGED_BLOB') {
    if (!asset.blobRef) throw new Error('Managed blob reference is missing')
    const port = objectStoragePort || createConfiguredAssetObjectStoragePort()
    const content = await port.get({ ref: asset.blobRef })
    return { asset, content: Buffer.from(content) }
  }
  if (asset.storageKind !== 'LOCAL_FILE' || !asset.relativePath) {
    throw new Error('Only active local files and managed blobs expose managed content')
  }
  const mount = await db.localWorkspaceMount.findFirst({
    where: { businessId: asset.businessId, status: 'ACTIVE' },
    orderBy: { updatedAt: 'desc' },
  })
  if (!mount) throw new Error('Active local workspace mount not found')
  const content = await filesystemPort.read({ mountRoot: mount.rootPath, relativePath: asset.relativePath })
  return { asset, content }
}

/** File management remains the sole writer of managed content metadata. Asset
 * Management supplies an already stored opaque ref plus the server-calculated hash. */
export async function createManagedBlobFileAsset(input, options = {}) {
  return createManagedFileAsset({ ...input, storageKind: 'MANAGED_BLOB' }, options)
}

export async function relinkFileAsset(fileId, { mountId, relativePath }, {
  db = prisma,
  viewer,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  const asset = await db.fileAsset.findUnique({ where: { id: fileId } })
  if (!asset || asset.deletedAt) throw new Error('File asset not found')
  assertFileAssetWritable(viewer, asset)
  if (asset.storageKind !== 'LOCAL_FILE') throw new Error('Only local files can be relinked')
  const mount = await db.localWorkspaceMount.findFirst({ where: { id: mountId, businessId: asset.businessId, status: 'ACTIVE' } })
  if (!mount) throw new Error('Active local workspace mount not found')
  await filesystemPort.stat({ mountRoot: mount.rootPath, relativePath })
  const updated = await db.fileAsset.update({
    where: { id: asset.id },
    data: { relativePath, status: 'ACTIVE', version: { increment: 1 } },
  })
  await recordAudit(db, {
    entityType: 'FILE_ASSET', entityId: asset.id, action: 'RELINKED',
    payload: { businessId: asset.businessId, previousRelativePath: asset.relativePath, relativePath },
  })
  return updated
}

export async function deleteManagedFileAsset(fileId, { db = prisma, viewer } = {}) {
  const asset = await db.fileAsset.findUnique({ where: { id: fileId } })
  if (!asset || asset.deletedAt) throw new Error('File asset not found')
  assertFileAssetWritable(viewer, asset)
  const deleted = await db.fileAsset.update({
    where: { id: fileId },
    data: { deletedAt: new Date(), status: 'MISSING', version: { increment: 1 } },
  })
  await recordAudit(db, {
    entityType: 'FILE_ASSET', entityId: fileId, action: 'DELETED',
    payload: { businessId: asset.businessId, metadataOnly: true },
  })
  return deleted
}

export async function migrateProjectFiles({ confirm = false } = {}, { db = prisma } = {}) {
  const rows = await db.projectFile.findMany({ include: { project: { include: { business: { select: { tenantId: true } } } } } })
  const existing = await db.fileAsset.findMany({ select: { id: true, code: true } })
  const ids = new Set(existing.map((item) => item.id))
  const codes = new Map(existing.map((item) => [item.code, item.id]))
  const accepted = []
  const conflicts = []
  const skipped = []
  for (const row of rows) {
    if (ids.has(row.id)) { skipped.push({ id: row.id, reason: 'already migrated' }); continue }
    if (!row.project?.businessId || !row.project.business?.tenantId) { conflicts.push({ id: row.id, code: row.code, reason: 'Project has no direct Business owner' }); continue }
    if (codes.has(row.code) && codes.get(row.code) !== row.id) { conflicts.push({ id: row.id, code: row.code, reason: 'FileAsset code collision' }); continue }
    accepted.push(row)
  }
  const preview = { source: rows.length, accepted: accepted.length, conflicts: conflicts.length, skipped: skipped.length, conflictRows: conflicts, skippedRows: skipped }
  if (!confirm) return { confirmed: false, ...preview }

  await db.$transaction(async (tx) => {
    for (const row of accepted) {
      await tx.fileAsset.create({ data: {
        id: row.id,
        code: row.code,
        tenantId: row.project.business.tenantId,
        businessId: row.project.businessId,
        projectId: row.projectId,
        workItemId: row.workItemId ?? null,
        storageKind: row.url ? 'EXTERNAL_URL' : 'MANAGED_BLOB',
        externalUrl: row.url ?? null,
        blobRef: row.blobRef ?? null,
        name: row.name,
        mime: row.mime,
        size: row.size,
        status: 'ACTIVE',
        version: row.version,
        uploadedBy: row.uploadedBy ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      } })
      await tx.fileLink.create({ data: { fileId: row.id, entityType: 'PROJECT', entityId: row.projectId, relationType: 'OWNER' } })
    }
    await recordAudit(tx, { entityType: 'PROJECT_FILE_MIGRATION', entityId: 'FR-045', action: 'MIGRATED', payload: preview })
  })
  return { confirmed: true, migrated: accepted.length, conflicts: conflicts.length, skipped: skipped.length, conflictRows: conflicts, skippedRows: skipped }
}
