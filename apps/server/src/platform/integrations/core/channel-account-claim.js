// @req FR-226 — the installation-wide channel account claim: one external bot, by
//   the SHA-256 of its destination, is bound to at most one live connection, and
//   the claim is taken before any secret is stored.
// @spec ADR-089 D6; BR-002 (the raw destination never becomes the key)
// @tested tests/integration/channel-account-claim.test.js
//
// A conflict is answered truthfully and says as little as it can:
//
//   LINE_CHANNEL_ALREADY_CONNECTED  the bot is claimed in the caller's own Tenant.
//                                   The caller may be told which connection only
//                                   if the service decides the viewer can see it.
//   LINE_CHANNEL_CLAIMED_ELSEWHERE  claimed in another Tenant. Names no Tenant,
//                                   Business or connection. Acceptable to disclose
//                                   only because the caller has already proved
//                                   possession of the channel secret (D6), which is
//                                   why this runs after live validation.

import { createHash } from 'node:crypto'

export const CHANNEL_CLAIM_MESSAGES = Object.freeze({
  LINE_CHANNEL_ALREADY_CONNECTED: 'บัญชี LINE นี้เชื่อมต่อกับธุรกิจในพื้นที่ทำงานนี้แล้ว',
  LINE_CHANNEL_CLAIMED_ELSEWHERE: 'บัญชี LINE นี้เชื่อมต่ออยู่กับพื้นที่ทำงานอื่นแล้ว หากคุณเป็นเจ้าของ กรุณาติดต่อผู้ดูแลระบบเพื่อโอนย้าย',
})

/** sha256 hex of an external account id — the only form a claim ever stores. */
export function hashExternalAccount(externalAccountId) {
  if (typeof externalAccountId !== 'string' || externalAccountId.length === 0) throw new Error('EXTERNAL_ACCOUNT_ID_REQUIRED')
  return createHash('sha256').update(externalAccountId, 'utf8').digest('hex')
}

function conflict(code, existing = null) {
  const error = new Error(code)
  error.code = code
  error.status = 409
  // `details` is the only field the route error mapper passes through; it carries
  // the Thai sentence and, for the same Tenant, the id the service may disclose.
  error.details = [{ code, message: CHANNEL_CLAIM_MESSAGES[code] }]
  if (existing) Object.defineProperty(error, 'claim', { value: existing, enumerable: false })
  return error
}

function isUniqueViolation(error) {
  // Matched by name and code, never instanceof: the SQLite and Postgres clients
  // throw distinct classes (src/app/api/_helpers.js).
  return error?.name === 'PrismaClientKnownRequestError' && error?.code === 'P2002'
}

async function liveClaim(db, provider, externalAccountHash) {
  return db.channelAccountClaim.findFirst({ where: { provider, externalAccountHash, releasedAt: null } })
}

/**
 * Take the claim inside the caller's transaction. Throws 409 with one of the two
 * codes above when the bot is already claimed; a lost race reads the winner.
 */
export async function claimChannelAccount(db, { provider = 'LINE_OA', externalAccountId, tenantId, businessId, connectionId }) {
  const externalAccountHash = hashExternalAccount(externalAccountId)
  const refuse = existing => conflict(existing.tenantId === tenantId ? 'LINE_CHANNEL_ALREADY_CONNECTED' : 'LINE_CHANNEL_CLAIMED_ELSEWHERE', existing)
  const existing = await liveClaim(db, provider, externalAccountHash)
  if (existing) throw refuse(existing)
  try {
    return await db.channelAccountClaim.create({
      data: { provider, externalAccountHash, tenantId, businessId, connectionId },
    })
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    // On Postgres the violation has aborted the caller's transaction, so the winner
    // cannot be read here; the caller reads it after rollback (resolveClaimRace).
    const race = new Error('CHANNEL_CLAIM_RACE')
    race.code = 'CHANNEL_CLAIM_RACE'
    race.status = 409
    throw race
  }
}

/** After a lost race and its rollback, answer with the claim that won. */
export async function resolveClaimRace(db, { provider = 'LINE_OA', externalAccountId, tenantId }) {
  const winner = await liveClaim(db, provider, hashExternalAccount(externalAccountId))
  return conflict(!winner || winner.tenantId !== tenantId ? 'LINE_CHANNEL_CLAIMED_ELSEWHERE' : 'LINE_CHANNEL_ALREADY_CONNECTED', winner)
}

/**
 * Who holds a bot, for the caller's own decision about what it may disclose.
 * Returns null when nobody does.
 */
export async function readChannelAccountClaim(db, { provider = 'LINE_OA', externalAccountId }) {
  return liveClaim(db, provider, hashExternalAccount(externalAccountId))
}

/**
 * Remove a claim whose connection never came to exist (compensation). Deleting,
 * not releasing: SQLite keeps a plain unique on the pair, and a claim that never
 * served a connection has no history worth keeping.
 */
export async function abandonChannelAccountClaim(db, { connectionId }) {
  const { count } = await db.channelAccountClaim.deleteMany({ where: { connectionId } })
  return count
}
