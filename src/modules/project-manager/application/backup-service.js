// @req FR-013 - snapshot export/import with preview and confirmation.
// @req FR-045 - portable FileAsset metadata, optional content and explicit remount gaps.
// @req FR-075 - restore is an installation-wide operation and requires operator
// authority. This is what took /api/backup/import off the route-viewer baseline.
// The route was unrepayable for as long as the only holdable authority was
// per-Business: importSnapshot deletes and replaces every Portfolio, Tenant,
// Business, identity and audit row, so owning every Business that exists today
// still says nothing about the rows a snapshot introduces. The answer was to
// name the capability, not to compose a bigger loop over ownsBusiness.
// @spec BR-008, SDD-023, ADR-016 D10
// @spec SEC-008
// @tested tests/integration/backup.test.js, tests/unit/fr045-backup-contract.test.js
// @tested tests/integration/fr075-restore-authorization.test.js
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit } from './audit'
import { createLocalFilesystemPort } from '../local-files/filesystem-port'
import { requireViewer } from './project-authorization'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'

/**
 * Guard for both entry points below.
 *
 * The preview is guarded as well as the restore, deliberately: it returns a row
 * count for every table across every tenant, which is the same disclosure the
 * restore guard would otherwise hand out for free. FR-065 made the identical
 * call for the import dry run — "a read-only preview of another scope's contents
 * is the leak the commit guard would otherwise still allow."
 */
function assertRestoreOperator(viewer) {
  requireViewer(viewer, 'backup restore')
  if (!isInstallationOperator(viewer)) {
    const error = new Error(
      'Restoring a snapshot replaces every tenant in this installation. It requires ' +
      'operator authority (a platform grant, or the local installation session) — ' +
      'owning Businesses does not confer it, however many.'
    )
    error.status = 403
    throw error
  }
}

export const SNAPSHOT_SCHEMA_VERSION = '1.0'

// Parents precede children for restore; reverse order is used for deletion.
const SNAPSHOT_MODELS = [
  'portfolio', 'integrationProvider', 'tenant', 'legalEntity', 'legalEntityIdentifier', 'business', 'branch',
  // @req FR-081 — the ingestion tables hang off a connection, so they restore after
  // it and delete before the Tenant/Business they reference. The three integration
  // metadata models were absent from this list entirely; a restore silently dropped
  // them, which the new foreign keys turn from invisible data loss into a hard error.
  'integrationConnection', 'integrationCredential', 'ingestionRun', 'rawExternalRecord',
  'syncCursor', 'externalEntityRef', 'deadLetterRecord',
  'person', 'membership', 'workspace', 'project', 'workstream', 'workContainer', 'workItem',
  'milestone', 'gate', 'dependency', 'repository', 'projectRepository',
  'projectFile', 'fileAsset', 'fileLink',
  'externalRef', 'externalIdentity', 'identityLinkToken',
  'customer', 'conversation', 'message', 'auditEvent',
]

function localAssets(snapshot) {
  return (snapshot?.tables?.fileAsset || []).filter((asset) => asset.storageKind === 'LOCAL_FILE' && asset.relativePath)
}

function contentManifest(snapshot) {
  return Array.isArray(snapshot?.fileContentManifest) ? snapshot.fileContentManifest : []
}

export async function exportSnapshot({
  db = prisma,
  includeBinaryContent = false,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  const snapshot = { schemaVersion: SNAPSHOT_SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables: {} }
  for (const model of SNAPSHOT_MODELS) snapshot.tables[model] = await db[model].findMany()

  const mounts = includeBinaryContent
    ? await db.localWorkspaceMount.findMany({ where: { status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } })
    : []
  const mountByBusiness = new Map()
  for (const mount of mounts) if (!mountByBusiness.has(mount.businessId)) mountByBusiness.set(mount.businessId, mount)
  snapshot.fileContentManifest = []
  for (const asset of localAssets(snapshot)) {
    const entry = {
      fileId: asset.id, businessId: asset.businessId, relativePath: asset.relativePath,
      sha256: asset.sha256 || null, size: asset.size, contentIncluded: false,
    }
    if (includeBinaryContent) {
      const mount = mountByBusiness.get(asset.businessId)
      if (mount) {
        try {
          const content = await filesystemPort.read({ mountRoot: mount.rootPath, relativePath: asset.relativePath })
          entry.contentIncluded = true
          entry.contentBase64 = content.toString('base64')
        } catch (error) {
          entry.contentError = error?.message || 'Content unavailable'
        }
      } else entry.contentError = 'Active remount unavailable'
    }
    snapshot.fileContentManifest.push(entry)
  }
  await recordAudit(db, {
    entityType: 'SNAPSHOT', entityId: 'local', action: 'EXPORTED',
    payload: { counts: Object.fromEntries(Object.entries(snapshot.tables).map(([key, rows]) => [key, rows.length])), includeBinaryContent },
  })
  return snapshot
}

export function previewSnapshot(snapshot, { remounts = [] } = {}) {
  const errors = []
  if (!snapshot || typeof snapshot !== 'object') errors.push('Snapshot is not an object')
  else {
    if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) errors.push(`Unsupported snapshot schemaVersion: ${snapshot.schemaVersion} (expected ${SNAPSHOT_SCHEMA_VERSION})`)
    if (!snapshot.tables || typeof snapshot.tables !== 'object') errors.push('Snapshot has no tables')
  }
  if (errors.length) return { valid: false, errors, counts: null }
  const counts = Object.fromEntries(SNAPSHOT_MODELS.map((model) => [model, Array.isArray(snapshot.tables[model]) ? snapshot.tables[model].length : 0]))
  const remounted = new Set(remounts.map((mount) => mount.businessId))
  const businessIds = [...new Set(localAssets(snapshot).map((asset) => asset.businessId))]
  const included = new Set(contentManifest(snapshot).filter((entry) => entry.contentIncluded).map((entry) => entry.fileId))
  return {
    valid: true, errors: [], counts, exportedAt: snapshot.exportedAt || null,
    mountRequiredBusinessIds: businessIds.filter((businessId) => !remounted.has(businessId)).sort(),
    missingContentFileIds: localAssets(snapshot).filter((asset) => !included.has(asset.id)).map((asset) => asset.id).sort(),
  }
}

export async function previewImport(snapshot, { remounts = [], db = prisma, viewer } = {}) {
  assertRestoreOperator(viewer)
  const base = previewSnapshot(snapshot, { remounts })
  if (!base.valid) return base
  const current = {}
  for (const model of SNAPSHOT_MODELS) current[model] = await db[model].count()
  return { ...base, current, wouldReplace: Object.values(current).some((count) => count > 0) }
}

export async function importSnapshot(snapshot, {
  confirm = false,
  remounts = [],
  db = prisma,
  viewer,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  assertRestoreOperator(viewer)
  const preview = await previewImport(snapshot, { remounts, db, viewer })
  if (!preview.valid) return { restored: false, ...preview }
  if (!confirm) return { restored: false, needsConfirmation: true, ...preview }
  for (const mount of remounts) {
    if (!mount.businessId || !mount.deviceKey || !path.win32.isAbsolute(mount.rootPath || '')) throw new Error('Each remount requires businessId, deviceKey and an absolute Windows rootPath')
  }

  await db.$transaction(async (tx) => {
    await tx.localWorkspaceMount.deleteMany()
    for (const model of [...SNAPSHOT_MODELS].reverse()) await tx[model].deleteMany()
    for (const model of SNAPSHOT_MODELS) {
      for (const row of snapshot.tables[model] || []) await tx[model].create({ data: row })
    }
    for (const mount of remounts) {
      const business = await tx.business.findUnique({ where: { id: mount.businessId }, select: { tenantId: true } })
      if (!business) throw new Error(`Remount Business not found: ${mount.businessId}`)
      await tx.localWorkspaceMount.create({ data: { tenantId: business.tenantId, businessId: mount.businessId, deviceKey: mount.deviceKey, rootPath: path.win32.normalize(mount.rootPath) } })
    }
    await recordAudit(tx, { entityType: 'SNAPSHOT', entityId: 'local', action: 'RESTORED', payload: { exportedAt: snapshot.exportedAt || null, counts: preview.counts } })
  })

  const remountByBusiness = new Map(remounts.map((mount) => [mount.businessId, mount]))
  const manifestByFile = new Map(contentManifest(snapshot).map((entry) => [entry.fileId, entry]))
  const unresolvedContentFileIds = []
  for (const asset of localAssets(snapshot)) {
    const mount = remountByBusiness.get(asset.businessId)
    const manifest = manifestByFile.get(asset.id)
    let active = false
    if (mount && manifest?.contentIncluded && manifest.contentBase64) {
      const stagingRoot = path.win32.join(mount.rootPath, '.zuri', 'temp')
      const stagingName = `restore-${randomUUID()}.tmp`
      await filesystemPort.stageWrite({ stagingRoot, stagingName, content: Buffer.from(manifest.contentBase64, 'base64') })
      await filesystemPort.promote({ mountRoot: mount.rootPath, stagingRoot, stagingName, relativePath: asset.relativePath })
      active = true
    } else if (mount) {
      try {
        await filesystemPort.stat({ mountRoot: mount.rootPath, relativePath: asset.relativePath })
        active = true
      } catch { /* missing content is reported, not guessed */ }
    }
    if (!active) unresolvedContentFileIds.push(asset.id)
    await db.fileAsset.update({ where: { id: asset.id }, data: { status: active ? 'ACTIVE' : 'MISSING' } })
  }
  return { restored: true, counts: preview.counts, unresolvedContentFileIds }
}
