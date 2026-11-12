// @req FR-230 — the Integration-owned RAW_LINE_PAYLOAD slice of ADR-091 D2.
// @spec SEC-031, SEC-001, ADR-091 D2
// @tested tests/integration/raw-line-retention-sweep.test.js, tests/unit/retention-sweeper-job-statuses.test.js
//
// Work is committed one page at a time, with no Tenant-wide transaction. If a
// page fails, that Tenant stops there: earlier committed pages stay redacted,
// later rows stay intact, the audit names { tenantId, code }, and later Tenants
// still run. The next invocation safely resumes because tombstones are excluded.

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { getEffectiveRetentionWindowDays } from '@/modules/crm/retention-override-service'
import { LINE_OA_PROVIDER_CODE } from './integration-registry'
import {
  RAW_RECORD_TOMBSTONE_PREFIXES,
  rawRecordRetentionTombstone,
} from './raw-record-redaction'

const CLASS = 'RAW_LINE_PAYLOAD'
export const RAW_LINE_RETENTION_AUDIT_ENTITY = 'INTEGRATION_RAW_LINE_RETENTION_SWEEP'
export const RAW_LINE_RETENTION_AUDIT_ACTION = 'RAW_LINE_RETENTION_SWEEP_COMPLETED'
export const RAW_RETENTION_SWEEP_CHUNK_SIZE = 100

// Keep this list local to the sweepers rather than enums.js: it is the
// purpose-specific safety subset also held by the CRM sweep.
export const RAW_LINE_NON_TERMINAL_JOB_STATUSES = Object.freeze([
  'QUEUED', 'CLAIMED', 'READY', 'SENDING', 'ACCEPTED', 'UNKNOWN',
])

function safeFailureCode(error) {
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(error?.code || '') ? error.code : 'TENANT_SWEEP_FAILED'
}

function notTombstoned() {
  return { NOT: RAW_RECORD_TOMBSTONE_PREFIXES.map(prefix => ({ payloadJson: { startsWith: prefix } })) }
}

async function sweepTenantPages(db, { tenantId, now, counts }) {
  const windowDays = await getEffectiveRetentionWindowDays({ tenantId, dataClass: CLASS, db })
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)
  let afterId = null

  while (true) {
    // Never select payloadJson. Tombstones are filtered in SQL so a mostly
    // redacted table does not consume a page one row at a time on every run.
    const page = await db.rawExternalRecord.findMany({
      where: {
        tenantId,
        provider: LINE_OA_PROVIDER_CODE,
        receivedAt: { lt: cutoff },
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...notTombstoned(),
      },
      select: { id: true, externalId: true, processingStatus: true },
      orderBy: { id: 'asc' },
      take: RAW_RETENTION_SWEEP_CHUNK_SIZE,
    })
    if (page.length === 0) break

    const jobs = await db.lineConversationJob.findMany({
      where: {
        tenantId,
        eventId: { in: [...new Set(page.map(row => row.externalId))] },
        status: { in: RAW_LINE_NON_TERMINAL_JOB_STATUSES },
      },
      select: { eventId: true },
    })
    const activeEventIds = new Set(jobs.map(job => job.eventId))
    const eligibleIds = []

    for (const row of page) {
      // The admission reconciler reparses ADMITTING rows to recreate the job;
      // keep that durable outbox input intact until admission settles.
      if (row.processingStatus === 'ADMITTING') {
        counts.skippedAdmitting += 1
      } else if (activeEventIds.has(row.externalId)) {
        counts.skippedNonTerminalJob += 1
      } else {
        eligibleIds.push(row.id)
      }
    }

    if (eligibleIds.length) {
      // One atomic statement per page. Repeat every eligibility guard so a
      // concurrent erasure, admission, or receivedAt change cannot be undone.
      const result = await db.rawExternalRecord.updateMany({
        where: {
          id: { in: eligibleIds },
          tenantId,
          provider: LINE_OA_PROVIDER_CODE,
          receivedAt: { lt: cutoff },
          processingStatus: { not: 'ADMITTING' },
          ...notTombstoned(),
        },
        data: { payloadJson: rawRecordRetentionTombstone(now) },
      })
      counts.redactedRawRecords += result.count
    }

    afterId = page[page.length - 1].id
    if (page.length < RAW_RETENTION_SWEEP_CHUNK_SIZE) break
  }
  return counts
}

/** Sweep one Tenant without writing a run-level audit event. */
export async function sweepRawLinePayloadsForTenant(db, { tenantId, now = new Date() } = {}) {
  const counts = { redactedRawRecords: 0, skippedNonTerminalJob: 0, skippedAdmitting: 0 }
  try {
    await sweepTenantPages(db, { tenantId, now, counts })
  } catch (error) {
    // Pages committed before this point remain due and idempotent; no later page
    // for this Tenant is attempted. The caller continues with the next Tenant.
    return { ...counts, tenantFailure: { tenantId, code: safeFailureCode(error) } }
  }
  return counts
}

/** Run the Integration-owned raw LINE payload sweep across all Tenants. */
export async function runRawLineRetentionSweep({ db = prisma, now = new Date() } = {}) {
  const totals = { redactedRawRecords: 0, skippedNonTerminalJob: 0, skippedAdmitting: 0 }
  const tenantFailures = []
  const tenants = await db.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  for (const tenant of tenants) {
    const counts = await sweepRawLinePayloadsForTenant(db, { tenantId: tenant.id, now })
    for (const key of Object.keys(totals)) totals[key] += counts[key]
    if (counts.tenantFailure) tenantFailures.push(counts.tenantFailure)
  }

  const countsByClass = {
    [CLASS]: { ...totals, ...(tenantFailures.length ? { tenantFailures } : {}) },
  }
  const event = await recordAudit(db, {
    entityType: RAW_LINE_RETENTION_AUDIT_ENTITY,
    entityId: `raw-line-retention:${now.toISOString()}`,
    action: RAW_LINE_RETENTION_AUDIT_ACTION,
    actorType: 'SYSTEM',
    payload: { ranAt: now.toISOString(), countsByClass },
  })
  return { auditEventId: event.id, countsByClass, alreadyRanToday: false }
}
