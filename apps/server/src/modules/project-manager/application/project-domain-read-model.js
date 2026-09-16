import { z } from 'zod'
import prisma from '@/lib/db'
import { activeWorkstream } from './active-filters'
import { assertProjectRoadmapReadable } from './project-roadmap-read-model'
import { resolveProjectDomain } from '../project-domain-catalog'

// @req FR-251 — an authorized Project receives a read-only Execution Domains
// projection from the existing FR-070 Workstream bindings.
// @spec FR-070, SDD-039, ADR-025
// @tested tests/unit/project-domain-read-model.test.js, tests/integration/project-domain-view.test.js

export const PROJECT_DOMAIN_VIEW_SCHEMA_VERSION = '1.0'

const DOMAIN_EVIDENCE_STATUSES = ['PLANNED', 'IMPLEMENTED', 'VERIFIED', 'DEPLOYED', 'ACTIVATED', 'UNKNOWN']

const zArtifactRef = z.object({
  artifactId: z.string().uuid(),
  revision: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

const zDomainEvidence = z.object({
  status: z.enum(DOMAIN_EVIDENCE_STATUSES),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  environment: z.string().min(1).max(512),
  observedAt: z.string().datetime(),
  artifact: zArtifactRef.optional(),
}).strict()

export const zDomainViewError = z.object({
  code: z.string().min(1).max(512),
  message: z.string().min(1).max(1000),
  requestId: z.string().uuid(),
  retryable: z.boolean(),
}).strict()

export const zDomainRow = z.object({
  domainId: z.string().min(1).max(512),
  label: z.string().min(1).max(160),
  mappingState: z.enum(['MAPPED', 'UNMAPPED']),
  ownership: z.object({
    primaryWorkstreamCount: z.number().int().nonnegative(),
    supportingWorkstreamCount: z.number().int().nonnegative(),
    technicalOwnerIds: z.array(z.string().min(1).max(128)),
  }).strict(),
  work: z.object({
    uniqueWorkCount: z.number().int().nonnegative(),
    workstreamCount: z.number().int().nonnegative(),
  }).strict(),
  featureIds: z.array(z.string().uuid()).max(0),
  featureState: z.literal('NOT_BOUND'),
  blockerState: z.literal('UNAVAILABLE'),
  blockerCount: z.null(),
  contractState: z.literal('UNAVAILABLE'),
  gapState: z.literal('UNAVAILABLE'),
  evidence: z.array(zDomainEvidence).max(0),
}).strict()

export const zProjectDomainView = z.object({
  schemaVersion: z.literal(PROJECT_DOMAIN_VIEW_SCHEMA_VERSION),
  projectId: z.string().uuid(),
  snapshotId: z.null(),
  snapshotState: z.literal('UNAVAILABLE'),
  observedAt: z.string().datetime(),
  totalUniqueWorkCount: z.number().int().nonnegative(),
  unboundWorkstreamCount: z.number().int().nonnegative(),
  domains: z.array(zDomainRow),
}).strict()

function projectNotFound() {
  return Object.assign(new Error('Project not found'), { status: 404 })
}

function isActiveWorkstream(workstream) {
  return Boolean(workstream?.id) && workstream.deletedAt == null && workstream.status !== 'ARCHIVED'
}

function parseSupportingDomainIds(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? (() => {
        try {
          return JSON.parse(value)
        } catch {
          return []
        }
      })()
      : []
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((id) => typeof id === 'string' && id.length > 0))]
}

function bindingId(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isCountableWorkItem(item, workstreamId) {
  if (!item || typeof item.id !== 'string' || item.id.length === 0) return false
  if (item.deletedAt != null || item.workstreamId !== workstreamId) return false
  // WorkContainer has no deletedAt. A linked container is countable only when
  // its own Workstream matches the item's Workstream; a missing relation is a
  // malformed link and is excluded rather than being silently reassigned.
  if (item.containerId != null && item.container?.workstreamId !== workstreamId) return false
  return true
}

function sortedStrings(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function newDomainStats() {
  return {
    primaryWorkstreamIds: new Set(),
    supportingWorkstreamIds: new Set(),
    workstreamIds: new Set(),
    workItemIds: new Set(),
    technicalOwnerIds: new Set(),
  }
}

function ensureDomainStats(statsById, domainId) {
  if (!statsById.has(domainId)) statsById.set(domainId, newDomainStats())
  return statsById.get(domainId)
}

function workstreamItems(workstream) {
  const seen = new Set()
  for (const item of Array.isArray(workstream.items) ? workstream.items : []) {
    if (!isCountableWorkItem(item, workstream.id) || seen.has(item.id)) continue
    seen.add(item.id)
  }
  return seen
}

/**
 * Pure projection. Authorization and database reads belong to
 * `getProjectDomainView`; this function only consumes already-read rows.
 */
export function buildProjectDomainView({ project, workstreams = [], now = new Date() } = {}) {
  const statsById = new Map()
  const totalWorkItemIds = new Set()
  let unboundWorkstreamCount = 0

  const activeRows = workstreams.filter(isActiveWorkstream)
  for (const workstream of activeRows) {
    const primaryDomainId = bindingId(workstream.primaryDomainId)
    const supportingDomainIds = parseSupportingDomainIds(workstream.supportingDomainIdsJson)
      .filter((domainId) => domainId !== primaryDomainId)
    const memberships = []

    if (primaryDomainId) memberships.push({ domainId: primaryDomainId, role: 'PRIMARY' })
    else unboundWorkstreamCount += 1

    const membershipIds = new Set(primaryDomainId ? [primaryDomainId] : [])
    for (const domainId of supportingDomainIds) {
      if (membershipIds.has(domainId)) continue
      membershipIds.add(domainId)
      memberships.push({ domainId, role: 'SUPPORTING' })
    }

    const itemIds = workstreamItems(workstream)
    for (const itemId of itemIds) totalWorkItemIds.add(itemId)

    const technicalOwnerId = bindingId(workstream.technicalOwnerDomainId)
    for (const { domainId, role } of memberships) {
      const stats = ensureDomainStats(statsById, domainId)
      stats.workstreamIds.add(workstream.id)
      if (role === 'PRIMARY') stats.primaryWorkstreamIds.add(workstream.id)
      else stats.supportingWorkstreamIds.add(workstream.id)
      for (const itemId of itemIds) stats.workItemIds.add(itemId)
      if (technicalOwnerId) stats.technicalOwnerIds.add(technicalOwnerId)
    }
  }

  const observedAt = new Date(typeof now === 'function' ? now() : now).toISOString()
  const result = {
    schemaVersion: PROJECT_DOMAIN_VIEW_SCHEMA_VERSION,
    projectId: project.id,
    snapshotId: null,
    snapshotState: 'UNAVAILABLE',
    observedAt,
    totalUniqueWorkCount: totalWorkItemIds.size,
    unboundWorkstreamCount,
    domains: sortedStrings(statsById.keys()).map((domainId) => {
      const stats = statsById.get(domainId)
      const catalog = resolveProjectDomain(domainId)
      return {
        domainId,
        label: catalog.label,
        mappingState: catalog.mappingState,
        ownership: {
          primaryWorkstreamCount: stats.primaryWorkstreamIds.size,
          supportingWorkstreamCount: stats.supportingWorkstreamIds.size,
          technicalOwnerIds: sortedStrings(stats.technicalOwnerIds),
        },
        work: {
          uniqueWorkCount: stats.workItemIds.size,
          workstreamCount: stats.workstreamIds.size,
        },
        featureIds: [],
        featureState: 'NOT_BOUND',
        blockerState: 'UNAVAILABLE',
        blockerCount: null,
        contractState: 'UNAVAILABLE',
        gapState: 'UNAVAILABLE',
        evidence: [],
      }
    }),
  }
  return zProjectDomainView.parse(result)
}

export async function getProjectDomainView(projectId, { db = prisma, viewer, now = new Date() } = {}) {
  if (!projectId) throw new Error('projectId is required')
  if (!z.string().uuid().safeParse(projectId).success) throw projectNotFound()

  // This is the only lookup before authorization. No Workstream, container or
  // WorkItem aggregate is read until the existing roadmap policy accepts the
  // Project and its Business/Workspace hierarchy.
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      business: { select: { id: true, tenantId: true } },
      workspace: { select: { id: true, scopeType: true, businessId: true, tenantId: true, portfolioId: true } },
    },
  })
  const scope = await assertProjectRoadmapReadable(viewer, project, { db })
  const workstreams = await db.workstream.findMany({
    where: { projectId, ...activeWorkstream() },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    include: {
      items: {
        where: { deletedAt: null },
        orderBy: [{ id: 'asc' }],
        include: { container: { select: { workstreamId: true } } },
      },
    },
  })
  // `scope` is intentionally consumed only by the authorization seam above;
  // this DTO does not expose a second scope vocabulary or grant field.
  void scope
  return buildProjectDomainView({ project, workstreams, now })
}
