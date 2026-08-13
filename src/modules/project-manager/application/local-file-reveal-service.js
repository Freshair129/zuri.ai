// @req FR-045 — local-only, authorized reveal capability with hosted deny-by-default.
// @spec SEC-007, SDD-023, ADR-016 D7/D8
// @tested tests/unit/fr045-reveal.test.js
import { spawn } from 'node:child_process'
import prisma from '@/lib/db'
import { recordAudit } from './audit'
import { resolveContainedPath } from '../local-files/path-security'
import fsPromises from 'node:fs/promises'

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function validateLocalRequest({ requestUrl, origin, intent }, env) {
  if (env.ZURI_LOCAL_FILE_BRIDGE !== '1') throw new Error('Local file bridge is disabled')
  if (intent !== 'reveal') throw new Error('Explicit reveal intent is required')
  const request = new URL(requestUrl)
  if (!LOOPBACK.has(request.hostname)) throw new Error('Local file bridge requires loopback')
  if (!origin) throw new Error('Local file bridge requires same-origin request')
  const originUrl = new URL(origin)
  if (originUrl.origin !== request.origin || !LOOPBACK.has(originUrl.hostname)) {
    throw new Error('Local file bridge requires same-origin loopback request')
  }
}

async function launchExplorer(absolutePath) {
  const child = spawn('explorer.exe', ['/select,', absolutePath], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  })
  child.unref()
}

export async function revealFileAsset(fileId, requestContext, {
  db = prisma,
  visibleBusinessIds,
  env = process.env,
  launcher = launchExplorer,
  realpath = fsPromises.realpath,
} = {}) {
  validateLocalRequest(requestContext, env)
  const asset = await db.fileAsset.findUnique({ where: { id: fileId } })
  if (!asset || asset.deletedAt) throw new Error('File asset not found')
  if (!visibleBusinessIds?.includes(asset.businessId)) throw new Error('Business access denied (not visible)')
  if (asset.storageKind !== 'LOCAL_FILE' || !asset.relativePath) throw new Error('File asset is not a local file')
  if (asset.status !== 'ACTIVE') throw new Error(`File asset is ${asset.status}`)
  const mount = await db.localWorkspaceMount.findFirst({ where: { businessId: asset.businessId, status: 'ACTIVE' }, orderBy: { updatedAt: 'desc' } })
  if (!mount) throw new Error('Active local workspace mount not found')
  const target = await resolveContainedPath({ mountRoot: mount.rootPath, relativePath: asset.relativePath, realpath })
  await launcher(target.absolutePath)
  await recordAudit(db, { entityType: 'FILE_ASSET', entityId: asset.id, action: 'REVEALED', payload: { businessId: asset.businessId } })
  return { revealed: true, fileId: asset.id }
}
