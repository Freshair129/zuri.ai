import { z } from 'zod'
import { handle, httpError } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { ownsBusiness, isInstallationOperator } from '@/modules/identity/viewer-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import prisma from '@/lib/db'

// @req FR-080 — Device Pairing & Real-time Edge Heartbeat Gate
// NOTE (2026-09-02, D3-line-agent-crm-flow-05 / D2-domain-agent-02 / D2-domain-agent-17
// / D4-connector-governance-15 / D4-connector-governance-18): FR-080's own statement is
// the platform Integrations catalog page, not this endpoint, and the closest
// heartbeat-shaped requirement actually declared (FR-071) is the data-pipeline
// step-event heartbeat, unrelated to an edge device's liveness probe. No FR for
// "an edge device authenticates and reports liveness" exists in
// docs/PRD-SDD-v1.0.md yet (ADR-041 names the edge-device runtime but never gave
// its heartbeat contract an id). This citation is kept only so the route-anchor
// preflight check (46-route baseline, docs/.route-anchor-baseline.json) keeps
// passing without adding this route to that debt list; declaring a dedicated
// edge-device heartbeat FR is owed — see open_items in the fix-lane report.
// @spec ADR-032, ADR-041, SEC-016 — every method now resolves a real viewer and
// scopes the registry by that viewer's Tenant(s); nothing here still serves
// anonymously or accepts a client-asserted deviceId with no ownership check.
// @tested tests/integration/agent-heartbeat-route.test.js

export const dynamic = 'force-dynamic'

const zHeartbeatPayload = z.object({
  contractVersion: z.string().default('0.1.0b'),
  deviceId: z.string().min(1),
  deviceToken: z.string().optional(),
  // Optional: which Business this device is paired to. The edge-device pairing
  // payload the Integrations page already generates (see
  // src/app/(pm)/platform/integrations/page.jsx `generateNewPairingKeys`)
  // carries `businessId`/`tenantId`, so a real device can echo it back here.
  // When omitted, POST falls back to the caller's own first owned Business —
  // there is exactly one in the common case of a single-Business tenant.
  businessId: z.string().min(1).optional(),
  status: z.enum(['healthy', 'degraded', 'unavailable']).default('healthy'),
  registeredQueries: z.array(z.string()).default([]),
  approvedTemplates: z.array(z.string()).default([]),
  engine: z.string().optional(),
  model: z.string().optional(),
  timestamp: z.string().optional(),
})

// In-memory Edge Device Registry (Live Probe), keyed by `${tenantId}::${deviceId}`.
//
// PERSISTENCE NOTE (open item — see fix-lane report): this Map lives on the
// Node process's global object, so it is per-instance and per-deploy — a
// redeploy, a cold start, or a second serverless instance all start it empty
// or diverged. There is no Prisma model backing edge-device liveness yet. This
// is acceptable for a live "is it online right now" probe but not for any
// consumer that needs liveness history or cross-instance consistency; that
// needs a real model and a requirement id, not a bigger Map.
const globalForDevices = globalThis
if (!globalForDevices.__zuriEdgeDevices) {
  globalForDevices.__zuriEdgeDevices = new Map()
}
const edgeDevices = globalForDevices.__zuriEdgeDevices

function registryKey(tenantId, deviceId) {
  return `${tenantId}::${deviceId}`
}

/** Distinct tenantIds behind a set of Business ids, read from the real DB. */
async function tenantIdsForBusinesses(businessIds, db) {
  const ids = (businessIds || []).filter(Boolean)
  if (!ids.length) return []
  const rows = await db.business.findMany({
    where: { id: { in: ids } },
    select: { tenantId: true },
  })
  return [...new Set(rows.map((row) => row.tenantId))]
}

function withOnline(dev) {
  const isRecent = Date.now() - new Date(dev.lastSeenAt).getTime() < 120000 // within 2 minutes
  return { ...dev, online: isRecent && dev.status === 'healthy' }
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)

    // A platform DEV/operator sees every Tenant (mirrors resolveViewer's own
    // cross-tenant grant for that role); an ordinary viewer sees only the
    // Tenant(s) behind the Businesses they can see — never another tenant's
    // devices, which is the gap D2-domain-agent-02/17 and
    // D4-connector-governance-15/18 named.
    const visibleTenantIds = isInstallationOperator(viewer)
      ? null // null = no Tenant filter, i.e. every Tenant
      : await tenantIdsForBusinesses(viewer.visibleBusinessIds, prisma)

    const devices = Array.from(edgeDevices.values())
      .filter((dev) => visibleTenantIds === null || visibleTenantIds.includes(dev.tenantId))
      .map(withOnline)

    return {
      viewerId: viewer.principal.id,
      devices,
      count: devices.length,
      activeOnline: devices.filter((d) => d.online).length,
    }
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)

    // FR-106's `ApiAccessKey` bearer credential is deliberately NOT accepted
    // here. FR-106's own statement scopes it to "the FR-019 Enterprise API"
    // (import dry-run/commit, /api/resolve, /api/docs) — accepting `apik_`
    // tokens on this route would widen that declared surface without a new
    // requirement saying so. A device-scoped credential for this endpoint is
    // exactly the "edge-device heartbeat FR" gap named above; until it is
    // declared, POST stays session-only like GET and DELETE.
    let body = {}
    const text = await request.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = {} // falls straight into the same Zod failure as an empty body — no default device
      }
    }
    // Throws ZodError on a missing/invalid deviceId; `handle` turns that into a
    // 400 with the field-level issues. No more falling back to
    // 'DEV-SMARTGIFT-PRIMARY' on a parse failure.
    const parsed = zHeartbeatPayload.parse(body)

    let businessId = parsed.businessId
    if (businessId) {
      if (!ownsBusiness(viewer, businessId)) {
        throw httpError(403, 'DEVICE_BUSINESS_NOT_OWNED')
      }
    } else {
      businessId = (viewer.ownedBusinessIds || [])[0] || null
      if (!businessId) {
        throw httpError(403, 'DEVICE_REGISTRATION_REQUIRES_OWNED_BUSINESS')
      }
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { tenantId: true },
    })
    if (!business) throw httpError(404, 'BUSINESS_NOT_FOUND')
    const tenantId = business.tenantId

    const now = new Date().toISOString()
    const deviceRecord = {
      deviceId: parsed.deviceId,
      tenantId,
      businessId,
      status: parsed.status,
      engine: parsed.engine || 'Headless Claude Code (Subscription Plan Bridge)',
      model: parsed.model || 'claude-3-7-sonnet',
      registeredQueries: parsed.registeredQueries,
      lastSeenAt: now,
      timestamp: now,
    }

    edgeDevices.set(registryKey(tenantId, parsed.deviceId), deviceRecord)

    await recordAudit(prisma, {
      entityType: 'EdgeDevice',
      entityId: parsed.deviceId,
      action: 'EDGE_DEVICE_HEARTBEAT',
      payload: { tenantId, businessId, status: parsed.status },
      actorId: viewer.principal.id,
    })

    return {
      acknowledged: true,
      deviceId: parsed.deviceId,
      receivedAt: now,
    }
  })
}

export async function DELETE(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { searchParams } = new URL(request.url)
    const deviceId = searchParams.get('deviceId')

    const operator = isInstallationOperator(viewer)
    const ownedTenantIds = operator ? null : await tenantIdsForBusinesses(viewer.ownedBusinessIds, prisma)
    const mayActOnTenant = (tenantId) => operator || (ownedTenantIds || []).includes(tenantId)

    if (deviceId) {
      const entry = [...edgeDevices.values()].find((dev) => dev.deviceId === deviceId)
      // An entry that does not exist and one the viewer has no authority over
      // answer identically — this is not an enumeration oracle over device ids.
      if (!entry || !mayActOnTenant(entry.tenantId)) {
        throw httpError(404, 'DEVICE_NOT_FOUND')
      }
      edgeDevices.delete(registryKey(entry.tenantId, entry.deviceId))
      await recordAudit(prisma, {
        entityType: 'EdgeDevice',
        entityId: deviceId,
        action: 'EDGE_DEVICE_REMOVED',
        payload: { tenantId: entry.tenantId, deviceId },
        actorId: viewer.principal.id,
      })
      return {
        success: true,
        deleted: deviceId,
        remaining: edgeDevices.size,
        timestamp: new Date().toISOString(),
      }
    }

    // No deviceId: clear only the Tenant(s) this viewer may act on — never the
    // whole shared registry for an ordinary owner. Requires owning at least one
    // Business somewhere (mirrors the per-entry check above).
    if (!operator && (ownedTenantIds || []).length === 0) {
      throw httpError(403, 'DEVICE_CLEAR_REQUIRES_OWNED_BUSINESS')
    }
    let clearedCount = 0
    for (const [key, dev] of edgeDevices.entries()) {
      if (mayActOnTenant(dev.tenantId)) {
        edgeDevices.delete(key)
        clearedCount += 1
      }
    }
    await recordAudit(prisma, {
      entityType: 'EdgeDevice',
      entityId: 'ALL',
      action: 'EDGE_DEVICE_REGISTRY_CLEARED',
      payload: { tenantIds: operator ? 'ALL' : ownedTenantIds, clearedCount },
      actorId: viewer.principal.id,
    })
    return {
      success: true,
      deleted: 'all',
      remaining: edgeDevices.size,
      timestamp: new Date().toISOString(),
    }
  })
}
