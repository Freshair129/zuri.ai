import { createHash, randomBytes } from 'node:crypto'
import { HARNESSES, mayApproveHarnessPairing } from './harness-credential.js'

// @req FR-220 — a harness pairs one installation the way a Zuri Edge Device does
// (FR-144): an anonymous bounded start, a signed-in person who sees the same
// check code and device label and approves for themselves, and a single
// redemption by the harness that holds the device secret. No credential exists
// until redemption, and no raw secret is kept after a response.
// @spec ADR-087 D1, D2; SEC-025, SEC-001, SEC-008
// @tested tests/unit/harness-pairing.test.js
const digest = (value) => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
const text = (value, max) => (typeof value === 'string' && value.trim().length <= max ? value.trim() : '')
export const HARNESS_PAIRING_TTL_MS = 300_000

// Bounded single-process capability store, like FR-144's: the deployment is one
// long-running web container (ADR-058), and a restart simply expires every
// pending request.
export function createHarnessPairingService({ mint, refreshViewer, now = Date.now, capacity = 200 } = {}) {
  const requests = new Map()
  let windowAt = now()
  let starts = 0
  function prune() {
    for (const [id, row] of requests) if (row.expiresAt <= now()) requests.delete(id)
  }
  function find({ requestId, deviceSecret, code } = {}) {
    prune()
    const row = code && /^[\w-]{43}$/.test(code)
      ? [...requests.values()].find((item) => item.browserHash === digest(code))
      : requests.get(requestId)
    if (!row || (!code && (typeof deviceSecret !== 'string' || deviceSecret.length !== 43 || digest(deviceSecret) !== row.deviceHash))) {
      fail(410, 'PAIRING_EXPIRED_OR_UNAVAILABLE')
    }
    return row
  }
  const publicRow = (row) => ({
    state: row.state,
    harness: row.harness,
    deviceLabel: row.deviceLabel,
    osUser: row.osUser,
    checkCode: row.checkCode,
    expiresAt: new Date(row.expiresAt).toISOString(),
  })
  return {
    start({ harness, deviceLabel, osUser, origin }) {
      prune()
      if (now() - windowAt >= 60_000) { starts = 0; windowAt = now() }
      if (++starts > 30 || requests.size >= capacity) fail(429, 'PAIRING_BUSY_TRY_LATER')
      if (!HARNESSES.includes(harness)) fail(400, 'HARNESS_REQUIRED')
      const label = text(deviceLabel, 80)
      if (!label) fail(400, 'HARNESS_DEVICE_LABEL_REQUIRED')
      const requestId = secret()
      const deviceSecret = secret()
      const code = secret()
      const row = {
        requestId, harness, deviceLabel: label, osUser: text(osUser, 80) || null, origin,
        deviceHash: digest(deviceSecret), browserHash: digest(code),
        checkCode: randomBytes(3).toString('hex').toUpperCase(),
        state: 'PENDING', expiresAt: now() + HARNESS_PAIRING_TTL_MS, nextPollAt: 0,
      }
      requests.set(requestId, row)
      return { ...publicRow(row), requestId, deviceSecret, approvalUrl: `${origin}/harness/pair#${code}`, pollIntervalMs: 2000 }
    },
    inspect({ code, viewer }) {
      if (!viewer?.principal?.id) fail(401, 'AUTH_REQUIRED')
      const row = find({ code })
      return { ...publicRow(row), person: viewer.principal.displayName || null, allowed: mayApproveHarnessPairing(viewer) }
    },
    decide({ code, action, viewer }) {
      if (!viewer?.principal?.id) fail(401, 'AUTH_REQUIRED')
      const row = find({ code })
      if (row.state !== 'PENDING') fail(409, 'PAIRING_ALREADY_DECIDED')
      if (action === 'deny') { row.state = 'DENIED'; return publicRow(row) }
      if (action !== 'approve') fail(400, 'PAIRING_ACTION_INVALID')
      if (!mayApproveHarnessPairing(viewer)) fail(403, 'HARNESS_PAIRING_NOT_ALLOWED')
      if (row.expiresAt <= now()) fail(410, 'PAIRING_EXPIRED_OR_UNAVAILABLE')
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
        // Authority is re-read at redemption: a person who lost every Business
        // between approving and the poll no longer mints anything.
        const viewer = await refreshViewer(row.approver)
        if (!mayApproveHarnessPairing(viewer)) fail(403, 'HARNESS_PAIRING_NOT_ALLOWED')
        if (row.expiresAt <= now()) fail(410, 'PAIRING_EXPIRED_OR_UNAVAILABLE')
        const { key, credential } = await mint({ viewer, harness: row.harness, deviceLabel: row.deviceLabel, osUser: row.osUser })
        row.state = 'CONSUMED'
        return {
          state: 'PAIRED',
          pairing: {
            key,
            installationId: credential.installationId,
            personDisplayName: credential.personDisplayName,
            status: credential.status,
            deviceLabel: credential.deviceLabel,
            apiBaseUrl: row.origin,
          },
        }
      } catch (error) {
        row.state = 'FAILED'
        fail(Number(error?.status) === 403 ? 403 : 503, 'PAIRING_REDEMPTION_FAILED')
      }
    },
  }
}
