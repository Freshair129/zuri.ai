// @req FR-230 — a Tenant may declare a shorter retention window than the
//   installation default for a data class; an attempt to lengthen one is
//   refused outright rather than clamped, so a bad write is visible at the
//   point it happens instead of silently doing nothing later at sweep time
//   (ADR-091 D2, TASK-ZAI-089 success criterion).
// @spec BR-002, SEC-031
// @tested tests/integration/crm-retention-override-service.test.js, tests/integration/crm-retention-sweep.test.js, tests/unit/retention-override-resolver.test.js
//
// This is the one writer of `TenantRetentionOverride`. `retention-sweep-service.js`
// only ever reads through the resolver-backed `getEffectiveRetentionWindowDays`.
// That read path validates the floor and clamps to the installation default even
// when a restore or another trusted database path bypasses this writer.

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { RETENTION_DEFAULT_WINDOW_DAYS, RETENTION_DATA_CLASSES } from '@/lib/validation/enums'

function failure(status, message) {
  return Object.assign(new Error(message), { status })
}

/**
 * Set (or replace) this Tenant's override window for one retention data class.
 * Refuses any value greater than the installation default — an override may only
 * shorten, never lengthen.
 *
 * @param {{tenantId: string, dataClass: string, windowDays: number, actorId?: string|null, db?: object}} input
 */
export async function setTenantRetentionOverride({ tenantId, dataClass, windowDays, actorId = null, db = prisma }) {
  if (!tenantId) throw failure(400, 'TENANT_REQUIRED')
  if (!RETENTION_DATA_CLASSES.includes(dataClass)) throw failure(400, 'UNKNOWN_RETENTION_DATA_CLASS')
  const installationDefault = RETENTION_DEFAULT_WINDOW_DAYS[dataClass]
  const parsedWindow = Number(windowDays)
  if (!Number.isInteger(parsedWindow) || parsedWindow <= 0) throw failure(400, 'RETENTION_WINDOW_DAYS_INVALID')
  // @spec ADR-091 D2 — "may shorten but never lengthen" — refused, not clamped.
  if (parsedWindow > installationDefault) throw failure(422, 'RETENTION_OVERRIDE_CANNOT_LENGTHEN_WINDOW')

  const write = async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })
    if (!tenant) throw failure(404, 'TENANT_NOT_FOUND')

    const override = await tx.tenantRetentionOverride.upsert({
      where: { tenantId_dataClass: { tenantId, dataClass } },
      create: { tenantId, dataClass, windowDays: parsedWindow },
      update: { windowDays: parsedWindow, version: { increment: 1 } },
    })
    await recordAudit(tx, {
      entityType: 'TENANT_RETENTION_OVERRIDE',
      entityId: override.id,
      action: 'RETENTION_OVERRIDE_SET',
      actorType: actorId ? 'LOCAL_USER' : 'SYSTEM',
      actorId,
      tenantId,
      payload: { dataClass, windowDays: parsedWindow, installationDefault },
    })
    return override
  }
  return typeof db.$transaction === 'function' ? db.$transaction(write) : write(db)
}

/**
 * Resolve the window (in days) actually in force for this Tenant and data
 * class, including where it came from. Stored rows are checked when read because
 * snapshot restore and other trusted database paths can bypass the writer.
 */
export async function resolveEffectiveRetentionWindow({ tenantId, dataClass, db = prisma }) {
  if (!RETENTION_DATA_CLASSES.includes(dataClass)) throw failure(400, 'UNKNOWN_RETENTION_DATA_CLASS')
  const installationDefault = RETENTION_DEFAULT_WINDOW_DAYS[dataClass]
  if (!tenantId) return { windowDays: installationDefault, source: 'DEFAULT' }
  const override = await db.tenantRetentionOverride.findUnique({ where: { tenantId_dataClass: { tenantId, dataClass } } })
  if (!override) return { windowDays: installationDefault, source: 'DEFAULT' }
  if (!Number.isSafeInteger(override.windowDays) || override.windowDays < 1) {
    console.error(JSON.stringify({
      scope: 'retention-override-service',
      tenantId,
      dataClass,
      code: 'RETENTION_OVERRIDE_INVALID',
    }))
    return { windowDays: installationDefault, source: 'DEFAULT_INVALID_OVERRIDE' }
  }
  return { windowDays: Math.min(override.windowDays, installationDefault), source: 'OVERRIDE' }
}

/** Keep the established numeric reader contract for existing consumers. */
export async function getEffectiveRetentionWindowDays(input) {
  const result = await resolveEffectiveRetentionWindow(input)
  return result.windowDays
}
