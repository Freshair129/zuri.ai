// @req FR-094, FR-095 — Single-use challenge store for WebAuthn ceremonies
// @spec ADR-045 D2, D5, SDD-052, SEC-018, SEC-026
// @tested tests/unit/identity/webauthn.test.js

import { randomBytes } from 'node:crypto'

/**
 * Per-process transient challenge store. A restart loses in-flight challenges,
 * and a second replica never sees them; the user retries the ceremony. The
 * store is bounded at 10,000 entries and evicts the oldest insertion when full
 * without refusing new challenges. Passkey login rate limits in rate-limit.js
 * control how quickly anonymous callers can fill it. Horizontal scaling must
 * move challenges to a shared store first.
 *
 * Maps challenge (base64url) -> { challenge, personId, type, expiresAt }
 */
const challengeCache = new Map()

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const WEBAUTHN_CHALLENGE_MAX_ENTRIES = 10_000

/**
 * Prune expired challenges to avoid memory accumulation.
 */
function pruneExpired() {
  const now = Date.now()
  for (const [challenge, record] of challengeCache.entries()) {
    if (record.expiresAt < now) {
      challengeCache.delete(challenge)
    }
  }
}

/**
 * Create and register a cryptographically random challenge.
 *
 * @param {object} params
 * @param {string} [params.personId]
 * @param {'registration'|'authentication'|'step-up'} params.type
 * @param {number} [params.ttlMs]
 * @param {number} [params.maxEntries] Test seam for the bounded-store behavior.
 * @returns {string} Base64URL-encoded challenge
 */
export function createChallenge({ personId, type, ttlMs = DEFAULT_TTL_MS, maxEntries = WEBAUTHN_CHALLENGE_MAX_ENTRIES }) {
  pruneExpired()
  const capacity = Number.isSafeInteger(maxEntries) && maxEntries > 0
    ? Math.min(maxEntries, WEBAUTHN_CHALLENGE_MAX_ENTRIES)
    : WEBAUTHN_CHALLENGE_MAX_ENTRIES
  while (challengeCache.size >= capacity) {
    const oldestChallenge = challengeCache.keys().next().value
    if (oldestChallenge === undefined) break
    challengeCache.delete(oldestChallenge)
  }

  const raw = randomBytes(32)
  const challenge = raw.toString('base64url')

  challengeCache.set(challenge, {
    challenge,
    personId: personId ?? null,
    type,
    expiresAt: Date.now() + ttlMs,
  })

  return challenge
}

/**
 * Atomically consume a challenge. Returns true if valid and not expired, false otherwise.
 * A consumed challenge cannot be used again (replay protection).
 *
 * @param {object} params
 * @param {string} params.challenge
 * @param {'registration'|'authentication'|'step-up'} params.type
 * @param {string} [params.personId]
 * @returns {boolean}
 */
export function consumeChallenge({ challenge, type, personId }) {
  pruneExpired()
  if (!challenge || typeof challenge !== 'string') return false

  const record = challengeCache.get(challenge)
  if (!record) return false

  // Consume immediately
  challengeCache.delete(challenge)

  if (record.expiresAt < Date.now()) return false
  if (record.type !== type) return false
  if (personId && record.personId && record.personId !== personId) return false

  return true
}

/**
 * Clear all challenges (useful for testing).
 */
export function clearAllChallenges() {
  challengeCache.clear()
}
