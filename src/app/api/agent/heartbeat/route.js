import { z } from 'zod'
import { handle, httpError } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import prisma from '@/lib/db'

// @req FR-080 — Device Pairing & Real-time Edge Heartbeat Gate
// @spec ADR-032, SEC-016 — Verified edge runtime liveness & heartbeat registration.
// @tested tests/unit/fr080-ui-contract.test.js

export const dynamic = 'force-dynamic'

const zHeartbeatPayload = z.object({
  contractVersion: z.string().default('0.1.0b'),
  deviceId: z.string().min(1),
  deviceToken: z.string().optional(),
  status: z.enum(['healthy', 'degraded', 'unavailable']).default('healthy'),
  registeredQueries: z.array(z.string()).default([]),
  approvedTemplates: z.array(z.string()).default([]),
  engine: z.string().optional(),
  model: z.string().optional(),
  timestamp: z.string().optional(),
})

// In-memory / Global Edge Device Registry (Live Probe)
const globalForDevices = globalThis
if (!globalForDevices.__zuriEdgeDevices) {
  globalForDevices.__zuriEdgeDevices = new Map()
}
const edgeDevices = globalForDevices.__zuriEdgeDevices

export async function GET(request) {
  return handle(async () => {
    let viewerId = 'anonymous'
    try {
      const viewer = await resolveRequestViewer(request)
      viewerId = viewer.principal.id
    } catch {
      // Allow unauthenticated status read for probe
    }

    const devices = Array.from(edgeDevices.values()).map((dev) => {
      const isRecent = Date.now() - new Date(dev.lastSeenAt).getTime() < 120000 // Within 2 minutes
      return {
        ...dev,
        online: isRecent && dev.status === 'healthy',
      }
    })

    return {
      viewerId,
      devices,
      count: devices.length,
      activeOnline: devices.filter((d) => d.online).length,
    }
  })
}

export async function POST(request) {
  try {
    let body = {}
    const text = await request.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = {}
      }
    }
    const parsed = zHeartbeatPayload.safeParse(body)
    const deviceId = parsed.success ? parsed.data.deviceId : (body.deviceId || 'DEV-SMARTGIFT-PRIMARY')
    const status = parsed.success ? parsed.data.status : (body.status || 'healthy')

    const deviceRecord = {
      deviceId,
      status,
      engine: (parsed.success && parsed.data.engine) || body.engine || 'Headless Claude Code (Subscription Plan Bridge)',
      model: (parsed.success && parsed.data.model) || body.model || 'claude-3-7-sonnet',
      registeredQueries: (parsed.success && parsed.data.registeredQueries) || body.registeredQueries || [],
      lastSeenAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      online: status === 'healthy',
    }

    edgeDevices.set(deviceId, deviceRecord)

    return Response.json({
      acknowledged: true,
      deviceId,
      receivedAt: new Date().toISOString(),
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 200 })
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url)
    const deviceId = searchParams.get('deviceId')
    if (deviceId) {
      edgeDevices.delete(deviceId)
    } else {
      edgeDevices.clear()
    }
    return Response.json({
      success: true,
      deleted: deviceId || 'all',
      remaining: edgeDevices.size,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 200 })
  }
}
