// @req FR-038 — profile read and owner-governed Membership role/domain grants.
// @spec SDD-017, SEC-003, docs/features/FR-038-profile-and-permissions.md
// @tested tests/unit/profile-permission-service.test.js
import prisma from '@/lib/db'
import { z } from 'zod'
import { DOMAINS } from '@/config/domains'
import { zMembershipRole } from '@/lib/validation/enums'
import { resolveViewer } from './resolve-viewer'
import { recordAudit } from '@/modules/project-manager/application/audit'

const DOMAIN_KEYS = DOMAINS.map((domain) => domain.key)
const zPermissionUpdate = z.object({
  membershipId: z.string().min(1),
  role: zMembershipRole,
  domainKeys: z.array(z.enum(DOMAIN_KEYS)).default([]),
})

function parseDomainKeys(json) {
  try {
    const keys = JSON.parse(json || '[]')
    return Array.isArray(keys) ? keys.filter((key) => DOMAIN_KEYS.includes(key)) : []
  } catch {
    return []
  }
}

async function ownerViewer(resolve) {
  const viewer = await resolve()
  if (viewer.role !== 'OWNER') {
    const error = new Error('Owner permission is required')
    error.status = 403
    throw error
  }
  return viewer
}

export async function getMyProfile({ db = prisma, resolve = resolveViewer } = {}) {
  const viewer = await resolve({ db })
  const identities = await db.externalIdentity.findMany({
    where: { personId: viewer.principal.id, revokedAt: null },
    select: { provider: true, linkedAt: true, verifiedAt: true },
  })
  return { ...viewer, identities, session: { type: 'LOCAL_DEMO', active: true } }
}

export async function listUserPermissions({ db = prisma, resolve = resolveViewer } = {}) {
  const viewer = await ownerViewer(() => resolve({ db }))
  const memberships = await db.membership.findMany({
    where: { OR: [{ businessId: { in: viewer.visibleBusinessIds } }, { businessId: null }] },
    orderBy: { createdAt: 'asc' },
    include: { person: { select: { id: true, code: true, displayName: true, email: true } }, business: { select: { id: true, code: true, name: true } } },
  })
  return memberships.map((membership) => ({ ...membership, domainKeys: parseDomainKeys(membership.domainKeysJson) }))
}

export async function updateUserPermissions(input, { db = prisma, resolve = resolveViewer } = {}) {
  const data = zPermissionUpdate.parse(input)
  const viewer = await ownerViewer(() => resolve({ db }))
  const membership = await db.membership.findUnique({ where: { id: data.membershipId } })
  if (!membership || (membership.businessId && !viewer.visibleBusinessIds.includes(membership.businessId))) {
    const error = new Error('Membership is outside your visible scope')
    error.status = 404
    throw error
  }
  const updated = await db.membership.update({
    where: { id: membership.id },
    data: { role: data.role, domainKeysJson: JSON.stringify(data.domainKeys) },
  })
  await recordAudit(db, {
    entityType: 'MEMBERSHIP', entityId: membership.id, action: 'PERMISSIONS_UPDATED',
    payload: { role: data.role, domainKeys: data.domainKeys }, actorId: viewer.principal.id,
  })
  return { ...updated, domainKeys: data.domainKeys }
}
