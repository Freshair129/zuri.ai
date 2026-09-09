import { createHash, randomBytes } from 'node:crypto'
import { isInstallationOperator, ownsBusiness } from './viewer-authority.js'

// @req FR-144 — one-use browser approval hands a scoped device credential only to its initiating Desktop.
// @spec SEC-025, SEC-001, SEC-008
// @tested tests/unit/edge-pairing.test.js
const digest = value => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : ''
const governs = (viewer, id) => isInstallationOperator(viewer) || ownsBusiness(viewer, id)
export const PAIRING_TTL_MS = 300_000

// Bounded single-process capabilities, not a persistent/multi-replica session store.
// No credential exists until redemption; no raw key is kept after the response.
export function createEdgePairingService({ mint, refreshViewer, businesses, now = Date.now, capacity = 200 } = {}) {
  const requests = new Map()
  let windowAt = now(), starts = 0
  function prune() {
    for (const [id, row] of requests) if (row.expiresAt <= now()) requests.delete(id)
  }
  function find({ requestId, deviceSecret, code } = {}) {
    prune()
    const row = code && /^[\w-]{43}$/.test(code)
      ? [...requests.values()].find(item => item.browserHash === digest(code))
      : requests.get(requestId)
    if (!row || (!code && (typeof deviceSecret !== 'string' || deviceSecret.length !== 43 || digest(deviceSecret) !== row.deviceHash))) {
      fail(410, 'PAIRING_EXPIRED_OR_UNAVAILABLE')
    }
    return row
  }
  const publicRow = row => ({
    state: row.state, deviceId: row.deviceId, label: row.label,
    checkCode: row.checkCode, expiresAt: new Date(row.expiresAt).toISOString(),
  })
  return {
    start({ deviceId, label, origin }) {
      prune()
      if (now() - windowAt >= 60_000) { starts = 0; windowAt = now() }
      // A global cap does not trust attacker-controlled forwarded IP headers.
      if (++starts > 30 || requests.size >= capacity) fail(429, 'PAIRING_BUSY_TRY_LATER')
      const id = text(deviceId, 120), name = text(label, 80)
      if (!id || !name) fail(400, 'PAIRING_DEVICE_REQUIRED')
      const requestId = secret(), deviceSecret = secret(), code = secret()
      const row = {
        requestId, deviceId: id, label: name, origin,
        deviceHash: digest(deviceSecret), browserHash: digest(code),
        checkCode: randomBytes(3).toString('hex').toUpperCase(),
        state: 'PENDING', expiresAt: now() + PAIRING_TTL_MS, nextPollAt: 0,
      }
      requests.set(requestId, row)
      return { ...publicRow(row), requestId, deviceSecret, approvalUrl: origin + '/edge/pair#' + code, pollIntervalMs: 2000 }
    },
    async inspect({ code, viewer }) {
      if (!viewer?.principal?.id) fail(401, 'AUTH_REQUIRED')
      const row = find({ code })
      const choices = row.state === 'PENDING' ? await businesses(viewer) : []
      return { ...publicRow(row), businesses: choices }
    },
    async decide({ code, businessId, action, viewer }) {
      if (!viewer?.principal?.id) fail(401, 'AUTH_REQUIRED')
      const row = find({ code })
      if (row.state !== 'PENDING') fail(409, 'PAIRING_ALREADY_DECIDED')
      if (action === 'deny') { row.state = 'DENIED'; return publicRow(row) }
      if (action !== 'approve') fail(400, 'PAIRING_ACTION_INVALID')
      const id = text(businessId, 200)
      if (!id || !governs(viewer, id)) fail(404, 'Business not found')
      const choices = await businesses(viewer)
      if (!choices.some(item => item.id === id)) fail(404, 'Business not found')
      // Awaiting the scoped query must not allow a competing approval/expiry to win twice.
      if (row.expiresAt <= now()) fail(410, 'PAIRING_EXPIRED_OR_UNAVAILABLE')
      if (row.state !== 'PENDING') fail(409, 'PAIRING_ALREADY_DECIDED')
      row.businessId = id
      row.businessName = choices.find(item => item.id === id).name
      row.approver = { principalId: viewer.principal.id, platformGrant: viewer.isPlatform === true }
      row.state = 'APPROVED'
      return publicRow(row)
    },
    async poll({ requestId, deviceSecret, cancel = false }) {
      const row = find({ requestId, deviceSecret })
      if (cancel && ['PENDING', 'APPROVED'].includes(row.state)) row.state = 'CANCELLED'
      if (row.state === 'REDEEMING') return { state: 'REDEEMING' }
      if (['CONSUMED', 'FAILED'].includes(row.state)) fail(410, 'PAIRING_ALREADY_USED_START_AGAIN')
      if (row.state !== 'APPROVED') {
        if (!cancel && row.nextPollAt > now()) fail(429, 'PAIRING_POLL_TOO_FAST')
        row.nextPollAt = now() + 1500
        return publicRow(row)
      }
      row.state = 'REDEEMING' // synchronous reservation before any I/O
      try {
        const viewer = await refreshViewer(row.approver)
        if (!governs(viewer, row.businessId)) fail(404, 'Business not found')
        if (row.expiresAt <= now()) fail(410, 'PAIRING_EXPIRED_OR_UNAVAILABLE')
        const result = await mint({ viewer, businessId: row.businessId, deviceId: row.deviceId, label: row.label })
        row.state = 'CONSUMED'
        return {
          state: 'PAIRED',
          pairing: { deviceId: row.deviceId, key: result.key, apiBaseUrl: row.origin, businessId: row.businessId, businessName: row.businessName },
        }
      } catch (error) {
        row.state = 'FAILED'
        // Never leak database errors, credentials or principal details.
        fail(Number(error?.status) === 404 ? 403 : 503, 'PAIRING_REDEMPTION_FAILED')
      }
    },
  }
}
