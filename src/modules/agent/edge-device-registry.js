import { z } from 'zod'
import prisma from '@/lib/db'
import { httpError } from '@/app/api/_helpers'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-141 — Business-scoped Edge Device heartbeat registry: the cloud-side
//   liveness view ADR-041 D3 promises the console, keyed by (businessId, deviceId),
//   readable and writable only for Businesses the viewer owns.
// @spec ADR-041 D1/D3, SEC-001, SEC-008 — zero edge secrets in the cloud; every
//   read and write behind one trusted viewer; fail closed.
// @tested tests/unit/fr141-edge-device-heartbeat.test.js
//
// ── Why this is a process-local Map, and what that costs ─────────────────────
//
// This registry is deliberately NOT a Prisma model, and the choice is recorded
// here so nobody mistakes it for an oversight (the 2026-09-02 gap analysis
// proposed persisting it — see docs/domains/agent/features/FR-141-*.md):
//
//   1. The agent charter owns no Prisma models by design; its durable state
//      lives behind ports in the production Postgres runtime. Adding the first
//      table to this domain is a charter decision for the owner, not a side
//      effect of a security fix.
//   2. A heartbeat is a cache, not a record. Its meaning expires in
//      EDGE_DEVICE_ONLINE_WINDOW_MS. Persisting the last tick would buy a
//      "last seen" that survives a restart and nothing else — the pairing
//      relationship itself (device ↔ Business, token *reference*) does not
//      exist anywhere in this repository today and is a separate declaration.
//   3. The cost, stated plainly: the registry is empty after a cold start, and
//      on Vercel it is PER INSTANCE. Two instances may disagree until each has
//      heard from the device, and the console shows "not paired" until the next
//      tick reaches the instance that happens to serve the page. The card is a
//      liveness pulse, never an inventory.
//
// The Map hangs off globalThis so Next.js dev-mode module reloads do not wipe
// it between requests. The key is new (`__zuriEdgeDeviceRegistry`) rather than
// the pre-FR-141 `__zuriEdgeDevices`: entries written by the old,
// unscoped route carried no businessId and must never be served to anyone.

export const EDGE_DEVICE_ONLINE_WINDOW_MS = 120_000
export const EDGE_DEVICE_STATUSES = ['healthy', 'degraded', 'unavailable']
export const EDGE_DEVICE_AUDIT_ENTITY = 'EDGE_DEVICE'

const label = z.string().trim().min(1).max(200)

/**
 * The heartbeat a device posts. Unknown keys are stripped (never persisted);
 * `deviceToken` is accepted so an existing device does not break, and is then
 * discarded — ADR-041 D3: the cloud never stores or displays edge credentials.
 */
export const zEdgeDeviceHeartbeat = z.object({
  contractVersion: z.string().trim().min(1).max(40).default('0.1.0b'),
  businessId: label,
  deviceId: z.string().trim().min(1).max(120),
  deviceToken: z.string().optional(),
  status: z.enum(EDGE_DEVICE_STATUSES).default('healthy'),
  registeredQueries: z.array(label).max(500).default([]),
  approvedTemplates: z.array(label).max(500).default([]),
  engine: label.optional(),
  model: label.optional(),
  timestamp: z.string().trim().max(64).optional(),
})

const GLOBAL_KEY = '__zuriEdgeDeviceRegistry'

function registry() {
  const existing = globalThis[GLOBAL_KEY]
  if (existing instanceof Map) return existing
  const created = new Map()
  globalThis[GLOBAL_KEY] = created
  return created
}

// NUL-separated: neither id can contain it, so two different pairs can never
// share a key however the ids are spelled.
const keyOf = (businessId, deviceId) => `${businessId}\u0000${deviceId}`

/** Test/dev hook: forget every device on this instance. */
export function resetEdgeDeviceRegistry() {
  registry().clear()
}

function assertOwned(viewer, businessId) {
  if (!ownsBusiness(viewer, businessId)) {
    throw httpError(403, 'Business is outside your owned scope')
  }
}

/** Every Business the viewer may read or write devices for, narrowed if asked. */
function ownedScope(viewer, businessId) {
  if (businessId) {
    assertOwned(viewer, businessId)
    return [businessId]
  }
  const owned = Array.isArray(viewer?.ownedBusinessIds) ? viewer.ownedBusinessIds.filter(Boolean) : []
  return [...new Set(owned)]
}

function isOnline(record, now) {
  return record.status === 'healthy' && now - Date.parse(record.lastSeenAt) < EDGE_DEVICE_ONLINE_WINDOW_MS
}

/** The record as the console may see it — never carries a token. */
function present(record, now) {
  return { ...record, online: isOnline(record, now) }
}

function recordsIn(businessIds) {
  const wanted = new Set(businessIds)
  return Array.from(registry().values()).filter((record) => wanted.has(record.businessId))
}

/**
 * Devices of every Business the viewer owns (or of one owned Business).
 * A viewer who owns nothing sees an empty list, not an error.
 */
export function listEdgeDevices({ viewer, businessId = null, now = Date.now() } = {}) {
  const businessIds = ownedScope(viewer, businessId)
  const devices = recordsIn(businessIds)
    .map((record) => present(record, now))
    .sort((a, b) => a.businessId.localeCompare(b.businessId) || a.deviceId.localeCompare(b.deviceId))
  return {
    businessIds,
    devices,
    count: devices.length,
    activeOnline: devices.filter((device) => device.online).length,
  }
}

/**
 * Record one heartbeat for a device of a Business the viewer owns.
 *
 * Audit is written on first sight of a (businessId, deviceId) and on every
 * status transition — never on a tick that changes nothing, or a device
 * reporting every minute would bury the audit log. The audit payload is the
 * record minus anything a device could leak: the token is never in it because
 * it is never in the record.
 */
export async function recordEdgeDeviceHeartbeat(input, { viewer, db = prisma, now = () => new Date() } = {}) {
  const { deviceToken: _ignored, timestamp, ...heartbeat } = zEdgeDeviceHeartbeat.parse(input)
  assertOwned(viewer, heartbeat.businessId)

  const seenAt = now()
  const key = keyOf(heartbeat.businessId, heartbeat.deviceId)
  const previous = registry().get(key) || null
  const record = {
    businessId: heartbeat.businessId,
    deviceId: heartbeat.deviceId,
    contractVersion: heartbeat.contractVersion,
    status: heartbeat.status,
    engine: heartbeat.engine ?? null,
    model: heartbeat.model ?? null,
    registeredQueries: heartbeat.registeredQueries,
    approvedTemplates: heartbeat.approvedTemplates,
    deviceReportedAt: timestamp ?? null,
    firstSeenAt: previous?.firstSeenAt ?? seenAt.toISOString(),
    lastSeenAt: seenAt.toISOString(),
    registeredBy: previous?.registeredBy ?? viewer?.principal?.id ?? null,
  }

  const registered = previous === null
  const statusChanged = previous !== null && previous.status !== record.status
  if (registered || statusChanged) {
    await recordAudit(db, {
      entityType: EDGE_DEVICE_AUDIT_ENTITY,
      entityId: record.deviceId,
      action: registered ? 'REGISTERED' : 'STATUS_CHANGED',
      actorId: viewer?.principal?.id ?? null,
      payload: {
        businessId: record.businessId,
        status: record.status,
        previousStatus: previous?.status ?? null,
        engine: record.engine,
        model: record.model,
        contractVersion: record.contractVersion,
      },
    })
  }

  registry().set(key, record)
  return {
    acknowledged: true,
    businessId: record.businessId,
    deviceId: record.deviceId,
    status: record.status,
    online: isOnline(record, seenAt.getTime()),
    registered,
    receivedAt: record.lastSeenAt,
  }
}

/**
 * Remove one device (`deviceId`) from the viewer's owned scope, or every device
 * in that scope when no `deviceId` is given. `businessId` narrows either form.
 * A named device that is not in scope is 404 — whether it exists under another
 * Business is not this viewer's to learn.
 */
export async function removeEdgeDevices({ viewer, deviceId = null, businessId = null, db = prisma } = {}) {
  const businessIds = ownedScope(viewer, businessId)
  const candidates = recordsIn(businessIds).filter((record) => !deviceId || record.deviceId === deviceId)
  if (deviceId && candidates.length === 0) {
    throw httpError(404, 'Edge device not found in your owned scope')
  }

  const removed = []
  for (const record of candidates) {
    await recordAudit(db, {
      entityType: EDGE_DEVICE_AUDIT_ENTITY,
      entityId: record.deviceId,
      action: 'UNREGISTERED',
      actorId: viewer?.principal?.id ?? null,
      payload: { businessId: record.businessId, lastStatus: record.status, lastSeenAt: record.lastSeenAt },
    })
    registry().delete(keyOf(record.businessId, record.deviceId))
    removed.push({ businessId: record.businessId, deviceId: record.deviceId })
  }

  return {
    removed,
    remaining: recordsIn(businessIds).length,
    receivedAt: new Date().toISOString(),
  }
}
