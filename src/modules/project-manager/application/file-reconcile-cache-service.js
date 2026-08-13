// @req FR-045 — explicit reconcile and revisioned disposable cache over canonical SQLite metadata.
// @spec SDD-023, BR-010, SEC-007, ADR-016 D5/D6
// @tested tests/unit/fr045-reconcile-cache.test.js
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { recordAudit } from './audit'
import { buildBusinessFileManagerReadModel } from './file-manager-read-model'
import { createLocalFilesystemPort } from '../local-files/filesystem-port'
import { normalizeClientRelativePath, resolveContainedPath } from '../local-files/path-security'

const win = path.win32

function assertVisible(businessId, visibleBusinessIds) {
  if (!visibleBusinessIds?.includes(businessId)) throw new Error('Business access denied (not visible)')
}

async function activeMount(db, mountId, businessId) {
  const mount = await db.localWorkspaceMount.findUnique({ where: { id: mountId } })
  if (!mount || mount.businessId !== businessId || mount.status !== 'ACTIVE') throw new Error('Active local workspace mount not found')
  return mount
}

export async function scanLocalFiles(mountRoot, { fs = fsPromises } = {}) {
  const found = []
  const walk = async (absoluteDir, relativeDir = '') => {
    const entries = await fs.readdir(absoluteDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!relativeDir && entry.name === '.zuri') continue
      if (entry.isSymbolicLink?.()) continue
      const relative = normalizeClientRelativePath(relativeDir ? `${relativeDir}/${entry.name}` : entry.name)
      if (entry.isDirectory()) {
        const contained = await resolveContainedPath({ mountRoot, relativePath: relative, realpath: fs.realpath })
        await walk(contained.absolutePath, relative)
      } else if (entry.isFile()) {
        await resolveContainedPath({ mountRoot, relativePath: relative, realpath: fs.realpath })
        found.push(relative)
      }
    }
  }
  await walk(win.normalize(mountRoot))
  return found.sort((a, b) => a.localeCompare(b))
}

export async function reconcileLocalFiles({ businessId, mountId, confirm = false }, {
  db = prisma,
  visibleBusinessIds,
  scan = scanLocalFiles,
} = {}) {
  assertVisible(businessId, visibleBusinessIds)
  const mount = await activeMount(db, mountId, businessId)
  const assets = await db.fileAsset.findMany({ where: { businessId, storageKind: 'LOCAL_FILE', deletedAt: null } })
  const observed = await scan(mount.rootPath)
  const observedByKey = new Map(observed.map((item) => [item.toLocaleLowerCase('en-US'), item]))
  const trackedByKey = new Map(assets.filter((asset) => asset.relativePath).map((asset) => [normalizeClientRelativePath(asset.relativePath).toLocaleLowerCase('en-US'), asset]))
  const missing = assets.filter((asset) => asset.relativePath && !observedByKey.has(normalizeClientRelativePath(asset.relativePath).toLocaleLowerCase('en-US')) && asset.status !== 'MISSING').map((asset) => asset.id)
  const restored = assets.filter((asset) => asset.relativePath && observedByKey.has(normalizeClientRelativePath(asset.relativePath).toLocaleLowerCase('en-US')) && asset.status === 'MISSING').map((asset) => asset.id)
  const untracked = observed.filter((relative) => !trackedByKey.has(relative.toLocaleLowerCase('en-US')))
  const result = { confirmed: false, businessId, mountId, missing, restored, untracked }
  if (!confirm) return result

  await db.$transaction(async (tx) => {
    if (missing.length) await tx.fileAsset.updateMany({ where: { id: { in: missing } }, data: { status: 'MISSING', version: { increment: 1 } } })
    if (restored.length) await tx.fileAsset.updateMany({ where: { id: { in: restored } }, data: { status: 'ACTIVE', version: { increment: 1 } } })
    await recordAudit(tx, { entityType: 'FILE_RECONCILE', entityId: mountId, action: 'RECONCILED', payload: { businessId, missing, restored, untracked } })
  })
  return { ...result, confirmed: true }
}

export async function rebuildBusinessFileCache({ businessId, mountId }, {
  db = prisma,
  visibleBusinessIds,
  filesystemPort = createLocalFilesystemPort(),
} = {}) {
  assertVisible(businessId, visibleBusinessIds)
  const mount = await activeMount(db, mountId, businessId)
  const [projects, assets] = await Promise.all([
    db.project.findMany({ where: { businessId, deletedAt: null }, select: { id: true, code: true, businessId: true, deletedAt: true } }),
    db.fileAsset.findMany({ where: { businessId, deletedAt: null }, orderBy: { code: 'asc' } }),
  ])
  const readModel = buildBusinessFileManagerReadModel({ businessId, visibleBusinessIds, projects, assets, localCapability: { available: false, reason: 'Cache projection' } })
  const canonicalJson = JSON.stringify(readModel)
  const sourceRevision = createHash('sha256').update(canonicalJson).digest('hex')
  const payload = Buffer.from(JSON.stringify({ sourceRevision, generatedAt: new Date().toISOString(), readModel }, null, 2))
  const relativePath = '.zuri/cache/business-overview/files.json'
  const stagingRoot = win.join(mount.rootPath, '.zuri', 'temp')
  const stagingName = `cache-${randomUUID()}.tmp`
  await filesystemPort.stageWrite({ stagingRoot, stagingName, content: payload })
  await filesystemPort.promote({ mountRoot: mount.rootPath, stagingRoot, stagingName, relativePath })
  await recordAudit(db, { entityType: 'FILE_CACHE', entityId: businessId, action: 'REBUILT', payload: { sourceRevision, assetCount: readModel.assets.length } })
  return { businessId, mountId, sourceRevision, assetCount: readModel.assets.length, relativePath }
}
