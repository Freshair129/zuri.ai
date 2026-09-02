import { z } from 'zod'
import { handle, httpError, queryParams } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import {
  listEdgeDevices,
  recordEdgeDeviceHeartbeat,
  removeEdgeDevices,
} from '@/modules/agent/edge-device-registry'

// @req FR-141 — Edge Device heartbeat registry: every method resolves one
//   trusted viewer before any work, the registry is scoped to Businesses the
//   viewer owns, a bad payload is 400 (never a default device), an absent
//   `?businessId=`/`?deviceId=` means no narrowing while a present-but-empty
//   or malformed one is a 400 rather than being silently treated as absent
//   (`businessId || null` used to fold both into "no narrowing"), and every
//   failure returns its real status code.
// @spec ADR-041 D3, SEC-001, SEC-008
// @tested tests/unit/fr141-edge-device-heartbeat.test.js
//
// The route is thin on purpose: scope, validation, audit and the liveness rule
// live in src/modules/agent/edge-device-registry.js — including the written
// reason the registry is process-local and what that costs per instance.

export const dynamic = 'force-dynamic'

const zGetQuery = z.object({
  businessId: z.string().trim().min(1, 'businessId must not be empty').max(200).optional(),
})

const zDeleteQuery = z.object({
  deviceId: z.string().trim().min(1, 'deviceId must not be empty').max(200).optional(),
  businessId: z.string().trim().min(1, 'businessId must not be empty').max(200).optional(),
})

async function readJsonObject(request) {
  const text = await request.text()
  let parsed
  try {
    parsed = text.trim() ? JSON.parse(text) : undefined
  } catch {
    parsed = undefined
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw httpError(400, 'Request body must be a JSON object')
  }
  return parsed
}

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = zGetQuery.parse(queryParams(request))
    return listEdgeDevices({ viewer, businessId: businessId ?? null })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await readJsonObject(request)
    return recordEdgeDeviceHeartbeat(body, { viewer })
  })
}

export async function DELETE(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { deviceId, businessId } = zDeleteQuery.parse(queryParams(request))
    return removeEdgeDevices({ viewer, deviceId: deviceId ?? null, businessId: businessId ?? null })
  })
}
