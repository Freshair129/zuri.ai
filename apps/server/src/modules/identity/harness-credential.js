import { createHash, randomBytes } from 'node:crypto'
import prisma from '../../lib/db.js'
import { isInstallationOperator } from './viewer-authority.js'
import { recordAudit } from '../project-manager/application/audit.js'

// @req FR-220 — the credential a paired agent harness (Claude Code or Codex)
// presents to report programme usage. The FR-144 edge credential narrowed again:
// same high-entropy secret, SHA-256 lookup hash, display prefix and mint-once
// discipline, but bound to a PERSON and an installation instead of a Business,
// and scoped to exactly one thing — PROGRAMME_USAGE_REPORT (ADR-087 D3).
//
// What it is NOT: it is not a viewer and not a session. `resolveRequestViewer`
// never accepts it, so every route but the usage report endpoint and its whoami
// read treats it exactly as no credential. A stolen copy can at worst send false
// usage, attributed to its person and device, and revoked on its next use.
// @spec ADR-087 D1-D3, SEC-025, SEC-001
// @tested tests/unit/harness-credential.test.js

export const HARNESS_KEY_PREFIX = 'hrnk'
export const HARNESS_SCOPE = 'PROGRAMME_USAGE_REPORT'
export const HARNESS_CREDENTIAL_ENTITY = 'HARNESS_CREDENTIAL'
export const HARNESSES = ['CLAUDE_CODE', 'CODEX']
const KEY_SECRET_BYTES = 32
const KEY_PREFIX_LENGTH = HARNESS_KEY_PREFIX.length + 1 + 8
const KEY_PATTERN = /^Bearer (hrnk_[\w-]{43})$/

const hashKey = (rawKey) => createHash('sha256').update(rawKey, 'utf8').digest('hex')
const failure = (status, message) => Object.assign(new Error(message), { status })
const label = (value, max) => (typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : '')

/**
 * May this signed-in person approve a harness pairing for themselves? An
 * installation operator, or anyone holding a visible Business. A bare signup in
 * the Waiting Room may not, so a public signup cannot pollute the board (D2).
 */
export function mayApproveHarnessPairing(viewer) {
  if (!viewer?.principal?.id) return false
  return isInstallationOperator(viewer) || (viewer.visibleBusinessIds?.length || 0) > 0
}

function view(row, personDisplayName = null) {
  return {
    id: row.id,
    installationId: row.installationId,
    personId: row.personId,
    personDisplayName,
    harness: row.harness,
    deviceLabel: row.deviceLabel,
    osUser: row.osUser,
    keyPrefix: row.keyPrefix,
    status: row.status,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    activatedAt: row.activatedAt?.toISOString?.() ?? row.activatedAt ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString?.() ?? row.lastUsedAt ?? null,
    revokedAt: row.revokedAt?.toISOString?.() ?? row.revokedAt ?? null,
    version: row.version,
  }
}

/**
 * Mint the credential for the person who approved the pairing. The raw key is
 * returned exactly once — never persisted, logged or audited.
 */
export async function mintHarnessCredential({ viewer, harness, deviceLabel, osUser = null, db = prisma } = {}) {
  if (!mayApproveHarnessPairing(viewer)) throw failure(403, 'HARNESS_PAIRING_NOT_ALLOWED')
  if (!HARNESSES.includes(harness)) throw failure(400, 'HARNESS_REQUIRED')
  const device = label(deviceLabel, 80)
  if (!device) throw failure(400, 'HARNESS_DEVICE_LABEL_REQUIRED')
  const operator = isInstallationOperator(viewer)
  const rawKey = `${HARNESS_KEY_PREFIX}_${randomBytes(KEY_SECRET_BYTES).toString('base64url')}`
  const created = await db.harnessCredential.create({
    data: {
      personId: viewer.principal.id,
      harness,
      deviceLabel: device,
      osUser: label(osUser, 80) || null,
      keyHash: hashKey(rawKey),
      keyPrefix: rawKey.slice(0, KEY_PREFIX_LENGTH),
      scope: HARNESS_SCOPE,
      status: operator ? 'ACTIVE' : 'PENDING_ACTIVATION',
      activatedAt: operator ? new Date() : null,
      activatedByPersonId: operator ? viewer.principal.id : null,
    },
  })
  await recordAudit(db, {
    entityType: HARNESS_CREDENTIAL_ENTITY,
    entityId: created.id,
    action: 'MINTED',
    actorId: viewer.principal.id,
    payload: { installationId: created.installationId, harness, deviceLabel: device, status: created.status, keyPrefix: created.keyPrefix },
  })
  return { key: rawKey, credential: view(created, viewer.principal.displayName || null) }
}

/**
 * The credential behind an `Authorization: Bearer hrnk_…` header, or null. A
 * missing, malformed, unknown or revoked key all answer null — the caller maps
 * that to one 401 so the endpoint is no oracle. PENDING_ACTIVATION is returned
 * so the caller can answer 403 with a reason the owner can act on.
 */
export async function authenticateHarnessCredential({ authorization, db = prisma, now = () => new Date() } = {}) {
  const raw = KEY_PATTERN.exec(authorization || '')?.[1]
  if (!raw) return null
  const row = await db.harnessCredential.findUnique({ where: { keyHash: hashKey(raw) } })
  if (!row || row.scope !== HARNESS_SCOPE || row.status === 'REVOKED') return null
  await db.harnessCredential.update({ where: { id: row.id }, data: { lastUsedAt: now() } }).catch(() => {})
  const person = await db.person.findUnique({ where: { id: row.personId }, select: { displayName: true } }).catch(() => null)
  return view(row, person?.displayName || null)
}

export const looksLikeHarnessCredential = (authorization) => KEY_PATTERN.test(authorization || '')

export async function listHarnessCredentials({ viewer, db = prisma } = {}) {
  if (!isInstallationOperator(viewer)) throw failure(404, 'Not found')
  const rows = await db.harnessCredential.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 500 })
  const people = await db.person.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.personId))] } }, select: { id: true, displayName: true } })
  const names = new Map(people.map((p) => [p.id, p.displayName]))
  return { devices: rows.map((row) => view(row, names.get(row.personId) || null)) }
}

/** Operator activates a pending device or revokes any device; effective on its next use. */
export async function decideHarnessCredential({ viewer, id, action, version, reason = null, db = prisma } = {}) {
  if (!isInstallationOperator(viewer)) throw failure(404, 'Not found')
  if (!['activate', 'revoke'].includes(action)) throw failure(400, 'HARNESS_DEVICE_ACTION_INVALID')
  if (!Number.isInteger(version)) throw failure(400, 'HARNESS_DEVICE_VERSION_REQUIRED')
  const row = await db.harnessCredential.findUnique({ where: { id: String(id || '') } })
  if (!row) throw failure(404, 'Not found')
  if (row.version !== version) throw failure(409, 'HARNESS_DEVICE_VERSION_CONFLICT')
  if (row.status === 'REVOKED') throw failure(409, 'HARNESS_DEVICE_REVOKED')
  if (action === 'activate' && row.status !== 'PENDING_ACTIVATION') throw failure(409, 'HARNESS_DEVICE_NOT_PENDING')
  const at = new Date()
  const data = action === 'activate'
    ? { status: 'ACTIVE', activatedAt: at, activatedByPersonId: viewer.principal.id, version: { increment: 1 } }
    : { status: 'REVOKED', revokedAt: at, revokedByPersonId: viewer.principal.id, revokeReason: label(reason, 200) || null, version: { increment: 1 } }
  const updated = await db.harnessCredential.update({ where: { id: row.id }, data })
  await recordAudit(db, {
    entityType: HARNESS_CREDENTIAL_ENTITY,
    entityId: row.id,
    action: action === 'activate' ? 'ACTIVATED' : 'REVOKED',
    actorId: viewer.principal.id,
    reason: action === 'revoke' ? label(reason, 200) || null : null,
    payload: { installationId: row.installationId, deviceLabel: row.deviceLabel, from: row.status, to: updated.status },
  })
  return { device: view(updated) }
}

/** Device label and person name for the installations that sent reports — the board's read port. */
export async function describeHarnessReporters({ installationIds = [], db = prisma } = {}) {
  const ids = [...new Set(installationIds.filter(Boolean))]
  if (!ids.length) return {}
  try {
    const rows = await db.harnessCredential.findMany({ where: { installationId: { in: ids } }, select: { installationId: true, deviceLabel: true, harness: true, personId: true } })
    const people = await db.person.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.personId))] } }, select: { id: true, displayName: true } })
    const names = new Map(people.map((p) => [p.id, p.displayName]))
    return Object.fromEntries(rows.map((r) => [r.installationId, { deviceLabel: r.deviceLabel, harness: r.harness, personDisplayName: names.get(r.personId) || null }]))
  } catch {
    return {}
  }
}
