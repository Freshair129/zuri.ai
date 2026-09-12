// @req FR-094, FR-095 — Single-use challenge store for WebAuthn ceremonies
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/unit/identity/webauthn.test.js

import { randomBytes } from 'node:crypto'

/**
 * Transient in-memory challenge store.
 * Maps challenge (base64url) -> { challenge, personId, type, expiresAt }
 */
const challengeCache = new Map()

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes

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
 * @returns {string} Base64URL-encoded challenge
 */
export function createChallenge({ personId, type, ttlMs = DEFAULT_TTL_MS }) {
  pruneExpired()
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
