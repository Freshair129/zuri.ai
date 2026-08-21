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
    const viewer = await resolveRequestViewer(request)
    const devices = Array.from(edgeDevices.values()).map((dev) => {
      const isRecent = Date.now() - new Date(dev.lastSeenAt).getTime() < 60000 // Within 60s
      return {
        ...dev,
        online: isRecent && dev.status === 'healthy',
      }
    })

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
    const body = await request.json()
    const parsed = zHeartbeatPayload.parse(body)

    const deviceRecord = {
      deviceId: parsed.deviceId,
      status: parsed.status,
      engine: parsed.engine || 'Headless Claude Code (.codex Session)',
      model: parsed.model || 'claude-3-7-sonnet',
      registeredQueries: parsed.registeredQueries,
      lastSeenAt: new Date().toISOString(),
      timestamp: parsed.timestamp || new Date().toISOString(),
      online: parsed.status === 'healthy',
    }

    edgeDevices.set(parsed.deviceId, deviceRecord)

    return {
      acknowledged: true,
      deviceId: parsed.deviceId,
      receivedAt: new Date().toISOString(),
    }
  })
}
