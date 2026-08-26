import { createHash } from 'node:crypto'
import { z } from 'zod'

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { isInstallationOperator, isSotDataPlaneFor, ownsBusiness, ownsTenant, seesBusiness } from '@/modules/identity/viewer-authority'

// @req FR-100 — one generic decision queue: the data plane submits pending
// facts (idempotent, payload-hash versioned), a human decides in the browser
// (audited, immutable rows), and the data plane pulls decided rows by cursor.
// zuri-ai never writes into DuckDB or the graph (ADR-043 interim boundary).
// @spec FR-100, FR-102, BR-002, SEC-002
// @tested tests/unit/sot-decision-service.test.js

export const SOT_DECISION_TYPES = Object.freeze(['PRICE_ROW', 'ENTITY', 'FILE_CLASSIFICATION', 'PHASE_GATE'])
export const SOT_DECISION_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED'])

function serviceError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function requireOperator(viewer) {
  if (!isInstallationOperator(viewer)) throw serviceError(403, 'SoT decision submission requires an installation operator')
}

/**
 * @req FR-102 — the two data-plane verbs (submit, export) accept either a
 * human installation operator (unchanged) or a service-account viewer whose
 * key is bound to exactly this tenantId. Deciding stays operator/owner-only
 * (`requireDecider`) and listing stays visibility-scoped (`requireVisible`) —
 * a data-plane key is not a substitute for either.
 */
function requireDataPlane(viewer, tenantId) {
  if (isInstallationOperator(viewer)) return
  if (isSotDataPlaneFor(viewer, tenantId)) return
  throw serviceError(403, 'SoT decision submission requires an installation operator or an authorized data-plane key for this tenant')
}

function requireDecider(viewer, row) {
  if (isInstallationOperator(viewer)) return
  if (row.businessId ? ownsBusiness(viewer, row.businessId) : ownsTenant(viewer, row.tenantId)) return
  throw serviceError(403, 'Deciding requires owner authority over this decision’s scope')
}

function requireVisible(viewer, businessId) {
  if (!isInstallationOperator(viewer) && !seesBusiness(viewer, businessId)) {
    throw serviceError(404, 'SoT decisions are outside your visible Business scope')
  }
}

/** Canonical, key-sorted serialization so the same payload always hashes the same. */
export function hashSotPayload(payload) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]))
    }
    return value
  }
  return createHash('sha256').update(JSON.stringify(canonical(payload ?? {}))).digest('hex')
}

const zSubmitItem = z.object({
  businessId: z.string().uuid().nullish(),
  decisionType: z.enum(SOT_DECISION_TYPES),
  subjectRef: z.string().trim().min(1).max(500),
  phaseId: z.string().regex(/^P\d{1,2}$/).nullish(),
  payload: z.record(z.unknown()),
}).strict()

export const zSotDecisionSubmit = z.object({
  tenantId: z.string().uuid(),
  submittedBy: z.string().trim().min(1).max(200),
  items: z.array(zSubmitItem).min(1).max(500),
}).strict()

function decisionSummary(row) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    businessId: row.businessId,
    decisionType: row.decisionType,
    subjectRef: row.subjectRef,
    phaseId: row.phaseId,
    payload: JSON.parse(row.payloadJson || '{}'),
    payloadSha256: row.payloadSha256,
    decisionVersion: row.decisionVersion,
    status: row.status,
    submittedBy: row.submittedBy,
    decidedByPersonId: row.decidedByPersonId,
    reason: row.reason,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function submitSotDecisions(input, { viewer, db = prisma } = {}) {
  const parsed = zSotDecisionSubmit.parse(input)
  requireDataPlane(viewer, parsed.tenantId)
  const results = []
  for (const item of parsed.items) {
    const payloadSha256 = hashSotPayload(item.payload)
    const latest = await db.sotDecision.findFirst({
      where: { tenantId: parsed.tenantId, decisionType: item.decisionType, subjectRef: item.subjectRef },
      orderBy: { decisionVersion: 'desc' },
    })
    if (latest && latest.payloadSha256 === payloadSha256) {
      results.push({ subjectRef: item.subjectRef, decisionType: item.decisionType, outcome: 'UNCHANGED', id: latest.id, decisionVersion: latest.decisionVersion, status: latest.status })
      continue
    }
    const created = await db.sotDecision.create({
      data: {
        tenantId: parsed.tenantId,
        businessId: item.businessId ?? null,
        decisionType: item.decisionType,
        subjectRef: item.subjectRef,
        phaseId: item.phaseId ?? null,
        payloadJson: JSON.stringify(item.payload),
        payloadSha256,
        decisionVersion: latest ? latest.decisionVersion + 1 : 1,
        submittedBy: parsed.submittedBy,
      },
    })
    results.push({ subjectRef: item.subjectRef, decisionType: item.decisionType, outcome: 'CREATED', id: created.id, decisionVersion: created.decisionVersion, status: created.status })
  }
  return { results }
}

const zListQuery = z.object({
  tenantId: z.string().uuid(),
  businessId: z.string().uuid().optional(),
  status: z.enum(SOT_DECISION_STATUSES).optional(),
  decisionType: z.enum(SOT_DECISION_TYPES).optional(),
  phaseId: z.string().regex(/^P\d{1,2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict()

export async function listSotDecisions(query, { viewer, db = prisma } = {}) {
  const parsed = zListQuery.parse(query)
  requireVisible(viewer, parsed.businessId ?? null)
  const rows = await db.sotDecision.findMany({
    where: {
      tenantId: parsed.tenantId,
      ...(parsed.businessId ? { businessId: parsed.businessId } : {}),
      ...(parsed.status ? { status: parsed.status } : {}),
      ...(parsed.decisionType ? { decisionType: parsed.decisionType } : {}),
      ...(parsed.phaseId ? { phaseId: parsed.phaseId } : {}),
    },
    orderBy: [{ createdAt: 'asc' }],
    take: parsed.limit,
  })
  return { decisions: rows.map(decisionSummary) }
}

export async function countPendingSotDecisionsByPhase(tenantId, { db = prisma } = {}) {
  const grouped = await db.sotDecision.groupBy({
    by: ['phaseId'],
    where: { tenantId, status: 'PENDING', phaseId: { not: null } },
    _count: { _all: true },
  })
  return new Map(grouped.map((g) => [g.phaseId, g._count._all]))
}

const zDecide = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reason: z.string().trim().min(1).max(2000).optional(),
}).strict()

export async function decideSotDecision(decisionId, input, { viewer, db = prisma } = {}) {
  const parsed = zDecide.parse(input)
  if (parsed.decision === 'REJECTED' && !parsed.reason) {
    throw serviceError(400, 'Rejecting requires a reason')
  }
  const row = await db.sotDecision.findUnique({ where: { id: decisionId } })
  if (!row) throw serviceError(404, 'SoT decision not found')
  requireDecider(viewer, row)
  if (row.status !== 'PENDING') throw serviceError(409, 'This decision is already decided; submit a new version to change it')
  const audit = await recordAudit(db, {
    entityType: 'SotDecision',
    entityId: row.id,
    action: `SOT_DECISION_${parsed.decision}`,
    payload: { decisionType: row.decisionType, subjectRef: row.subjectRef, decisionVersion: row.decisionVersion, reason: parsed.reason ?? null },
    // @spec resolveViewer (src/modules/identity/resolve-viewer.js) returns
    //   `{ principal: { id, ... }, ... }`, never a top-level personId — that field
    //   belongs to a different shape entirely (auth-service.js's `actor: { personId }`).
    //   Reading `viewer.personId` here was always undefined through the real route,
    //   so this attestation trail was silently blank in production; found while
    //   building FR-103's customer-consent-service.js, which needed the same field
    //   and got it right the first time.
    actorId: viewer?.principal?.id ?? null,
  })
  const updated = await db.sotDecision.update({
    where: { id: row.id },
    data: {
      status: parsed.decision,
      reason: parsed.reason ?? null,
      decidedByPersonId: viewer?.principal?.id ?? null,
      decidedAt: new Date(),
      auditEventId: audit.id,
    },
  })
  return decisionSummary(updated)
}

const zExportQuery = z.object({
  tenantId: z.string().uuid(),
  since: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
}).strict()

function encodeCursor(row) {
  return `${row.updatedAt.toISOString()}_${row.id}`
}

function decodeCursor(cursor) {
  const at = cursor.lastIndexOf('_')
  if (at <= 0) throw serviceError(400, 'Malformed export cursor')
  const ts = new Date(cursor.slice(0, at))
  if (Number.isNaN(ts.getTime())) throw serviceError(400, 'Malformed export cursor')
  return { ts, id: cursor.slice(at + 1) }
}

/** The data plane's pull: decided rows in stable (updatedAt, id) order. */
export async function exportSotDecisions(query, { viewer, db = prisma } = {}) {
  const parsed = zExportQuery.parse(query)
  requireDataPlane(viewer, parsed.tenantId)
  const after = parsed.since ? decodeCursor(parsed.since) : null
  const rows = await db.sotDecision.findMany({
    where: {
      tenantId: parsed.tenantId,
      status: { in: ['APPROVED', 'REJECTED'] },
      ...(after
        ? { OR: [{ updatedAt: { gt: after.ts } }, { updatedAt: after.ts, id: { gt: after.id } }] }
        : {}),
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: parsed.limit,
  })
  return {
    decisions: rows.map(decisionSummary),
    nextCursor: rows.length ? encodeCursor(rows[rows.length - 1]) : parsed.since ?? null,
  }
}
