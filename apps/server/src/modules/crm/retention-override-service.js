// @req FR-230 — a Tenant may declare a shorter retention window than the
//   installation default for a data class; an attempt to lengthen one is
//   refused outright rather than clamped, so a bad write is visible at the
//   point it happens instead of silently doing nothing later at sweep time
//   (ADR-091 D2, TASK-ZAI-089 success criterion).
// @spec BR-002, SEC-031
// @tested tests/integration/crm-retention-override-service.test.js, tests/integration/crm-retention-sweep.test.js
//
// This is the one writer of `TenantRetentionOverride`. `retention-sweep-service.js`
// only ever reads through `getEffectiveRetentionWindowDays`, and applies the same
// downward-only clamp again there as a second, defensive floor — belt and braces,
// not a place either rule is allowed to live only once.

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
 * The window (in days) actually in force for this Tenant and data class right
 * now: its override when one exists, else the installation default. Clamped at
 * the installation default defensively — see the module comment.
 */
export async function getEffectiveRetentionWindowDays({ tenantId, dataClass, db = prisma }) {
  const installationDefault = RETENTION_DEFAULT_WINDOW_DAYS[dataClass]
  if (installationDefault === undefined) throw failure(400, 'UNKNOWN_RETENTION_DATA_CLASS')
  if (!tenantId) return installationDefault
  const override = await db.tenantRetentionOverride.findUnique({ where: { tenantId_dataClass: { tenantId, dataClass } } })
  if (!override) return installationDefault
  return Math.min(override.windowDays, installationDefault)
}
