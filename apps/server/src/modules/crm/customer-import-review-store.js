import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-078 — the review queue is a server-owned adapter boundary over the
// private target, with local Prisma fixtures and an explicit zuri_core runtime.
// An unconfigured target throws a distinct, stable 503 (never a silent
// fallback) so the surface can tell a deployment gap apart from a target that
// is configured and failing.
// @spec CDC-SG-CUSTOMER-DATA-001 v0.3.0B, ADR-018, ADR-033 D8.
// @tested tests/unit/customer-import-review-service.test.js, tests/unit/customer-import-review-store-contract.test.js

const { Pool } = pg

export const SMARTGIFT_REVIEW_SCOPE = Object.freeze({
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  tenantCode: 'TNT-ETOHGROUP',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  businessCode: 'BUS-SMARTGIFT',
})

function storeError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value
  try {
    return JSON.parse(value || '')
  } catch {
    return fallback
  }
}

function latestByProvenance(decisions) {
  const latest = new Map()
  for (const decision of decisions || []) {
    const current = latest.get(decision.provenanceId)
    if (!current || decision.decisionVersion > current.decisionVersion) latest.set(decision.provenanceId, decision)
  }
  return latest
}

function caseStatus(items, decisions) {
  const latest = latestByProvenance(decisions)
  const actions = items.map((item) => latest.get(item.id)?.action || null)
  if (!actions.some(Boolean)) return 'OPEN'
  if (actions.every((action) => action === 'DEFER')) return 'DEFERRED'
  if (actions.every((action) => ['CREATE_SEPARATE', 'LINK_EXISTING', 'REJECT'].includes(action))) return 'DECIDED'
  return 'PARTIALLY_DECIDED'
}

function mapCase(row) {
  const items = row.items || []
  const latest = latestByProvenance(row.decisions)
  return {
    reviewCaseId: row.id,
    batchId: row.batchId,
    reasonCode: row.reasonCode,
    status: row.status,
    itemCount: row.itemCount,
    evidenceSummary: parseJson(row.evidenceSummaryJson),
    version: row.version,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
    items: items.map((item) => ({
      reviewItemId: item.id,
      sourceRow: item.sourceRow,
      sourceSha256: item.sourceSha256,
      reasonCode: item.reviewReasonCode || row.reasonCode,
      evidence: parseJson(item.reviewEvidenceJson),
      latestDecision: latest.get(item.id)
        ? {
            decisionId: latest.get(item.id).id,
            action: latest.get(item.id).action,
            targetCustomerId: latest.get(item.id).targetCustomerId,
            decidedByPersonId: latest.get(item.id).decidedByPersonId,
            decidedAt: latest.get(item.id).decidedAt instanceof Date
              ? latest.get(item.id).decidedAt.toISOString()
              : latest.get(item.id).decidedAt,
            decisionVersion: latest.get(item.id).decisionVersion,
          }
        : null,
    })),
  }
}

function scopeOrFail(businessId) {
  if (businessId !== SMARTGIFT_REVIEW_SCOPE.businessId) throw storeError('Customer review scope is not available', 404)
  return SMARTGIFT_REVIEW_SCOPE
}

function validateDecisionInput(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) throw storeError('At least one review decision is required')
  const seen = new Set()
  return decisions.map((decision) => {
    if (!decision || typeof decision !== 'object') throw storeError('Invalid review decision')
    if (typeof decision.provenanceId !== 'string' || !decision.provenanceId) throw storeError('provenanceId is required')
    if (seen.has(decision.provenanceId)) throw storeError('A review item may appear only once per decision request')
    seen.add(decision.provenanceId)
    if (!['CREATE_SEPARATE', 'LINK_EXISTING', 'REJECT', 'DEFER'].includes(decision.action)) {
      throw storeError('Invalid review decision action')
    }
    const targetCustomerId = decision.targetCustomerId || null
    if (decision.action === 'LINK_EXISTING' && !targetCustomerId) throw storeError('LINK_EXISTING requires targetCustomerId')
    if (decision.action !== 'LINK_EXISTING' && targetCustomerId) throw storeError('Only LINK_EXISTING may set targetCustomerId')
    const note = decision.note == null ? null : String(decision.note).trim()
    if (note) throw storeError('Free-text decision notes are disabled for the no-raw-PII queue')
    return { provenanceId: decision.provenanceId, action: decision.action, targetCustomerId, note: note || null }
  })
}

function validateExpectedVersion(expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw storeError('expectedVersion is required')
  return expectedVersion
}

function nextDecisionVersion(previous) {
  const current = previous?.decisionVersion ?? previous?.decision_version ?? 0
  return Number(current) + 1
}

function mapTargetCustomer(row) {
  return {
    id: row.id,
    displayName: row.displayName ?? row.display_name,
  }
}

function targetSelect() {
  return { id: true, tenantId: true, businessId: true, deletedAt: true }
}

export function createPrismaCustomerReviewStore({ db = prisma } = {}) {
  return {
    resolveScope: async (businessId) => scopeOrFail(businessId),

    async listCases({ businessId, batchId = null, status = null }) {
      const scope = scopeOrFail(businessId)
      const rows = await db.customerImportReviewCase.findMany({
        where: {
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          ...(batchId ? { batchId } : {}),
          ...(status ? { status } : {}),
        },
        include: {
          items: { orderBy: { sourceRow: 'asc' } },
          decisions: { orderBy: [{ provenanceId: 'asc' }, { decisionVersion: 'desc' }] },
        },
        orderBy: { updatedAt: 'desc' },
      })
      return rows
    },

    async getCase({ businessId, caseId }) {
      const rows = await this.listCases({ businessId })
      return rows.find((row) => row.id === caseId) || null
    },

    async listTargetCustomers({ businessId, query = '', limit = 25 }) {
      const scope = scopeOrFail(businessId)
      const rows = await db.customer.findMany({
        where: {
          tenantId: scope.tenantId,
          businessId: scope.businessId,
          deletedAt: null,
          ...(query ? { displayName: { contains: query } } : {}),
        },
        select: { id: true, displayName: true },
        orderBy: { displayName: 'asc' },
        take: Math.min(Math.max(limit, 1), 50),
      })
      return rows
    },

    async appendDecisions({ businessId, caseId, expectedVersion, decisions, actorId }) {
      const scope = scopeOrFail(businessId)
      const normalized = validateDecisionInput(decisions)
      const expected = validateExpectedVersion(expectedVersion)
      if (!actorId) throw storeError('Decision actor is required', 403)

      return db.$transaction(async (tx) => {
        const reviewCase = await tx.customerImportReviewCase.findUnique({
          where: { id: caseId },
          include: { items: true, decisions: { orderBy: { decisionVersion: 'desc' } } },
        })
        if (!reviewCase || reviewCase.tenantId !== scope.tenantId || reviewCase.businessId !== scope.businessId) {
          throw storeError('Review case not found', 404)
        }
        if (reviewCase.version !== expected) throw storeError('Review case changed; reload before deciding', 409)

        const itemsById = new Map(reviewCase.items.map((item) => [item.id, item]))
        const latest = latestByProvenance(reviewCase.decisions)
        for (const decision of normalized) {
          const item = itemsById.get(decision.provenanceId)
          if (!item || item.reviewCaseId !== reviewCase.id) throw storeError('Review item does not belong to this case', 400)
          if (item.resolutionStatus !== 'REVIEW_REQUIRED' || item.disposition !== 'REVIEW') {
            throw storeError('Only held review items may receive a decision', 400)
          }
          if (decision.action === 'LINK_EXISTING') {
            const target = await tx.customer.findUnique({ where: { id: decision.targetCustomerId }, select: targetSelect() })
            if (!target || target.deletedAt || target.tenantId !== scope.tenantId || target.businessId !== scope.businessId) {
              throw storeError('Target Customer is outside the approved review scope', 403)
            }
          }
          const previous = latest.get(item.id)
          const decisionVersion = nextDecisionVersion(previous)
          const created = await tx.customerImportReviewDecision.create({
            data: {
              reviewCaseId: reviewCase.id,
              provenanceId: item.id,
              decisionVersion,
              action: decision.action,
              targetCustomerId: decision.targetCustomerId,
              decidedByPersonId: actorId,
              note: decision.note,
            },
          })
          latest.set(item.id, created)
        }

        const nextStatus = caseStatus(reviewCase.items, [...latest.values()])
        const updated = await tx.customerImportReviewCase.update({
          where: { id: reviewCase.id },
          data: { status: nextStatus, version: { increment: 1 } },
          include: {
            items: { orderBy: { sourceRow: 'asc' } },
            decisions: { orderBy: [{ provenanceId: 'asc' }, { decisionVersion: 'desc' }] },
          },
        })
        await recordAudit(tx, {
          entityType: 'CUSTOMER_IMPORT_REVIEW_CASE',
          entityId: reviewCase.id,
          action: 'CUSTOMER_IMPORT_REVIEW_DECISION_APPENDED',
          actorId,
          payload: {
            tenantId: scope.tenantId,
            businessId: scope.businessId,
            caseId: reviewCase.id,
            provenanceIds: normalized.map((decision) => decision.provenanceId),
            actions: normalized.map((decision) => decision.action),
            nextStatus,
          },
        })
        return updated
      })
    },
  }
}

function toDate(value) {
  return value instanceof Date ? value.toISOString() : value
}

function mapRemoteCase(row, items, decisions) {
  return {
    ...row,
    evidenceSummaryJson: row.evidence_summary_json,
    batchId: row.batch_id,
    reasonCode: row.reason_code,
    itemCount: row.item_count,
    updatedAt: toDate(row.updated_at),
    items: items.filter((item) => item.review_case_id === row.id).map((item) => ({
      id: item.id,
      sourceRow: item.source_row,
      sourceSha256: item.source_sha256,
      reviewCaseId: item.review_case_id,
      reviewReasonCode: item.review_reason_code,
      reviewEvidenceJson: item.review_evidence_json,
    })),
    decisions: decisions.filter((decision) => decision.review_case_id === row.id).map((decision) => ({
      id: decision.id,
      provenanceId: decision.provenance_id,
      decisionVersion: decision.decision_version,
      action: decision.action,
      targetCustomerId: decision.target_customer_id,
      decidedByPersonId: decision.decided_by_person_id,
      decidedAt: toDate(decision.decided_at),
      note: decision.note,
    })),
  }
}

async function withRuntimeRole(pool, callback) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('set local role zuri_app_runtime')
    const { rows: [identity] } = await client.query('select current_user, session_user')
    if (identity?.current_user !== 'zuri_app_runtime') {
      throw new Error('CUSTOMER_REVIEW_RUNTIME_ROLE_MISMATCH')
    }
    const result = await callback(client)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

export function createZuriCoreCustomerReviewStore({ pool, setRole = true } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new Error('CUSTOMER_REVIEW_POOL_REQUIRED')
  const run = async (callback) => {
    if (!setRole) return callback(pool)
    return withRuntimeRole(pool, callback)
  }

  return {
    resolveScope: async (businessId) => scopeOrFail(businessId),

    async listCases({ businessId, batchId = null, status = null }) {
      const scope = scopeOrFail(businessId)
      return run(async (client) => {
        const values = [scope.tenantId, scope.businessId]
        const filters = ['rc.tenant_id = $1', 'rc.business_id = $2']
        if (batchId) { values.push(batchId); filters.push(`rc.batch_id = $${values.length}`) }
        if (status) { values.push(status); filters.push(`rc.status = $${values.length}`) }
        const cases = (await client.query(`
          select rc.id, rc.batch_id, rc.reason_code, rc.status, rc.item_count,
                 rc.evidence_summary_json, rc.version, rc.updated_at
          from zuri_core.customer_import_review_case rc
          where ${filters.join(' and ')}
          order by rc.updated_at desc
        `, values)).rows
        if (!cases.length) return []
        const caseIds = cases.map((row) => row.id)
        const items = (await client.query(`
          select id, review_case_id, source_row, source_sha256,
                 review_reason_code, review_evidence_json
          from zuri_core.customer_import_provenance
          where review_case_id = any($1::text[])
          order by source_row asc nulls last, id asc
        `, [caseIds])).rows
        const decisions = (await client.query(`
          select id, review_case_id, provenance_id, decision_version, action,
                 target_customer_id, decided_by_person_id, decided_at, note
          from zuri_core.customer_import_review_decision
          where review_case_id = any($1::text[])
          order by provenance_id asc, decision_version desc
        `, [caseIds])).rows
        return cases.map((row) => mapRemoteCase(row, items, decisions))
      })
    },

    async getCase({ businessId, caseId }) {
      const rows = await this.listCases({ businessId })
      return rows.find((row) => row.id === caseId) || null
    },

    async listTargetCustomers({ businessId, query = '', limit = 25 }) {
      const scope = scopeOrFail(businessId)
      return run(async (client) => {
        const values = [scope.tenantId, scope.businessId]
        const filter = query ? 'and c.display_name ilike $3' : ''
        if (query) values.push(`%${query}%`)
        values.push(Math.min(Math.max(limit, 1), 50))
        const result = await client.query(`
          select c.id, c.display_name
          from zuri_core.customer c
          where c.tenant_id = $1 and c.business_id = $2 and c.deleted_at is null
            ${filter}
          order by c.display_name asc, c.id asc
          limit $${values.length}
        `, values)
        return result.rows.map(mapTargetCustomer)
      })
    },

    async appendDecisions({ businessId, caseId, expectedVersion, decisions, actorId }) {
      const scope = scopeOrFail(businessId)
      const normalized = validateDecisionInput(decisions)
      const expected = validateExpectedVersion(expectedVersion)
      if (!actorId) throw storeError('Decision actor is required', 403)
      return run(async (client) => {
        const reviewCase = (await client.query(`
          select id, batch_id, tenant_id, business_id, status, item_count, evidence_summary_json, version
          from zuri_core.customer_import_review_case
          where id = $1 and tenant_id = $2 and business_id = $3
          for update
        `, [caseId, scope.tenantId, scope.businessId])).rows[0]
        if (!reviewCase) throw storeError('Review case not found', 404)
        if (reviewCase.version !== expected) throw storeError('Review case changed; reload before deciding', 409)
        const items = (await client.query(`
          select id, review_case_id, resolution_status, disposition
          from zuri_core.customer_import_provenance
          where review_case_id = $1
          for update
        `, [caseId])).rows
        const itemsById = new Map(items.map((item) => [item.id, item]))
        const existing = (await client.query(`
          select distinct on (provenance_id) provenance_id, decision_version, action
          from zuri_core.customer_import_review_decision
          where review_case_id = $1
          order by provenance_id, decision_version desc
        `, [caseId])).rows.map((row) => ({
          provenanceId: row.provenance_id,
          decisionVersion: row.decision_version,
          action: row.action,
        }))
        const latest = new Map(existing.map((row) => [row.provenanceId, row]))
        for (const decision of normalized) {
          const item = itemsById.get(decision.provenanceId)
          if (!item || item.review_case_id !== caseId) throw storeError('Review item does not belong to this case', 400)
          if (item.resolution_status !== 'REVIEW_REQUIRED' || item.disposition !== 'REVIEW') {
            throw storeError('Only held review items may receive a decision', 400)
          }
          if (decision.action === 'LINK_EXISTING') {
            const target = (await client.query(`
              select id, tenant_id, business_id, deleted_at
              from zuri_core.customer
              where id = $1
            `, [decision.targetCustomerId])).rows[0]
            if (!target || target.deleted_at || target.tenant_id !== scope.tenantId || target.business_id !== scope.businessId) {
              throw storeError('Target Customer is outside the approved review scope', 403)
            }
          }
          const previous = latest.get(item.id)
          const decisionVersion = nextDecisionVersion(previous)
          const created = (await client.query(`
            insert into zuri_core.customer_import_review_decision (
              id, review_case_id, provenance_id, decision_version, action,
              target_customer_id, decided_by_person_id, note
            ) values ($1, $2, $3, $4, $5, $6, $7, $8)
            returning id, review_case_id, provenance_id, decision_version, action,
                      target_customer_id, decided_by_person_id, decided_at, note
          `, [randomUUID(), caseId, item.id, decisionVersion, decision.action, decision.targetCustomerId, actorId, decision.note])).rows[0]
          created.provenanceId = created.provenance_id
          created.decisionVersion = created.decision_version
          created.targetCustomerId = created.target_customer_id
          latest.set(item.id, created)
        }
        const nextStatus = caseStatus(items, [...latest.values()])
        return client.query(`
          update zuri_core.customer_import_review_case
          set status = $2, version = version + 1, updated_at = now()
          where id = $1
          returning id, batch_id, reason_code, status, item_count,
                    evidence_summary_json, version, updated_at
        `, [caseId, nextStatus]).then(async ({ rows }) => {
          const updated = rows[0]
          const allItems = (await client.query(`
            select id, review_case_id, source_row, source_sha256,
                   review_reason_code, review_evidence_json
            from zuri_core.customer_import_provenance
            where review_case_id = $1
            order by source_row asc nulls last, id asc
          `, [caseId])).rows
          const allDecisions = (await client.query(`
            select id, review_case_id, provenance_id, decision_version, action,
                   target_customer_id, decided_by_person_id, decided_at, note
            from zuri_core.customer_import_review_decision
            where review_case_id = $1
            order by provenance_id asc, decision_version desc
          `, [caseId])).rows
          return mapRemoteCase(updated, allItems, allDecisions)
        })
      })
    },
  }
}

let defaultPool

function runtimeSsl(env = process.env) {
  const caFile = env.ZURI_CUSTOMER_REVIEW_DB_CA_FILE
  if (!caFile) return undefined
  const ca = readFileSync(caFile, 'utf8')
  if (!ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
    throw new Error('CUSTOMER_REVIEW_DATABASE_CA_INVALID')
  }
  return { rejectUnauthorized: true, ca }
}

// Exported so the queue page can tell "no operator has pointed this
// deployment at a review target yet" apart from "the target is configured
// and something about talking to it failed" — the former is not fixable by
// re-fetching, the latter might be. The page can't `import` this store to
// reuse the constant (it is a 'use client' component; this file pulls in
// `pg`, `node:fs` and the Prisma client, none of which belong in a browser
// bundle), so `src/app/(pm)/platform/customer-import-reviews/page.jsx` keeps
// this exact string in sync by hand — tests/unit/customer-import-review-ui.test.js
// and tests/unit/customer-import-review-store-contract.test.js both assert on it.
export const CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED = 'Customer review target is not configured'

export function createDefaultCustomerReviewStore({ env = process.env } = {}) {
  if (env.ZURI_CUSTOMER_REVIEW_DATABASE_URL) {
    defaultPool ||= new Pool({
      connectionString: env.ZURI_CUSTOMER_REVIEW_DATABASE_URL,
      ssl: runtimeSsl(env),
      max: 4,
      connectionTimeoutMillis: 10_000,
    })
    return createZuriCoreCustomerReviewStore({ pool: defaultPool })
  }
  if (env.NODE_ENV !== 'production' && env.ZURI_CUSTOMER_REVIEW_MODE === 'local') return createPrismaCustomerReviewStore()
  throw storeError(CUSTOMER_REVIEW_TARGET_NOT_CONFIGURED, 503)
}

export {
  caseStatus,
  latestByProvenance,
  mapCase,
  mapTargetCustomer,
  nextDecisionVersion,
  parseJson,
  storeError,
  validateDecisionInput,
}
