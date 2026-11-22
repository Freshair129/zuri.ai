import prisma from '@/lib/db'
import { randomUUID } from 'node:crypto'
import { retryOnCodeConflict, uniqueHumanCode } from '@/lib/ids'
import { hashPassword } from './auth-service'
import { auditEventCreateArgs } from '@/modules/project-manager/application/audit'

// @req FR-120 — self-serve account creation: the door FR-066 assumed existed.
//   FR-066 begins "after a provider-neutral local identity/session exists" and
//   never says how one comes to exist; FR-067's invite attaches membership to
//   somebody already authenticated; and before this the only credential writers
//   were prisma/seed.js and FR-107's operator bootstrap.
// @spec BR-002, SEC-008 — the human code comes from the shared generator, and
//   the password policy is FR-046's, called rather than restated here.
// @tested tests/unit/fr120-signup-service.test.js

/**
 * Signup grants nothing.
 *
 * It creates a `Person` and a `PersonCredential` and stops. No `PlatformGrant`,
 * no Tenant, Business, Space or Project, no `WorkspaceMembership`. What the new
 * Person may do next is exactly what FR-066 already grants any profiled Person
 * — the owner path of `createOnboardingWorkspace`, which is gated on
 * `profileCompletedAt` and nothing else — so this widens who can reach that
 * path without widening the path itself.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function failure(status, code) {
  const error = new Error(code)
  error.status = status
  error.code = code
  return error
}

/**
 * Trimmed and lowercased, because an address typed with a capital on Tuesday is
 * the same address as the one typed without it on Wednesday.
 *
 * `authenticateUser` matches the stored `email` exactly, so storing a
 * normalized form is only half the job: the login lookup normalizes the
 * submitted identifier the same way. Both halves are needed — normalizing here
 * alone would create accounts whose owners could not sign in with the casing
 * they typed.
 */
export function normalizeSignupEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * @param {object} input
 * @param {string} input.email identifier, not a channel — this installation has no mail transport
 * @param {string} input.displayName
 * @param {string} input.password
 * @param {object} [input.db] prisma client or transaction client
 * @returns {Promise<{id: string, code: string, displayName: string, email: string}>}
 * @throws an Error carrying `status` and `code`
 */
export async function createAccount({ email, displayName, password, db = prisma } = {}) {
  const normalizedEmail = normalizeSignupEmail(email)
  const name = typeof displayName === 'string' ? displayName.trim() : ''

  if (!EMAIL_SHAPE.test(normalizedEmail)) throw failure(400, 'EMAIL_INVALID')
  if (!name) throw failure(400, 'DISPLAY_NAME_REQUIRED')

  // The policy lives in `hashPassword` and is called rather than copied, so a
  // change to the minimum cannot apply to one door and not the other. Only the
  // one error it raises for a rejected password is translated; anything else a
  // crypto failure throws propagates, because reporting a broken scrypt as
  // "your password is too short" would send someone editing their password
  // forever.
  let passwordHash
  try {
    passwordHash = hashPassword(password)
  } catch (error) {
    if (error?.message === 'PASSWORD_INVALID') throw failure(400, 'PASSWORD_INVALID')
    throw error
  }

  const create = async () => {
    // BR-002: the human code is generated, never derived from anything external.
    const code = await uniqueHumanCode('PSN', name, async (candidate) =>
      Boolean(await db.person.findUnique({ where: { code: candidate }, select: { id: true } })))

    // **This is a check, not a constraint, and the difference is real.**
    // `Person.email` carries no unique index in either schema, so two requests
    // that arrive together can both find nothing here and both insert. SQLite
    // serializes writes and closes the window in dev and test; Postgres at READ
    // COMMITTED does not. The residual race is recorded in the FR-120 feature
    // note as requiring a `Person.email` unique index, which is a migration
    // against live data and deliberately not smuggled into this slice.
    const taken = await db.person.findFirst({ where: { email: normalizedEmail }, select: { id: true } })
    if (taken) throw failure(409, 'EMAIL_TAKEN')

    // The reads above stay outside the write. Prisma's SQLite connector runs one
    // interactive transaction at a time, so holding one open across reads queued
    // concurrent signups behind it until they passed the 5s limit and surfaced
    // as a 503 (P2028/P1008). The Person, its credential (nested, so the
    // credential cannot exist without it) and its audit event are one batch:
    // all-or-nothing as before, but with no interactive window to time out. The
    // Person id is chosen here so the audit row can name it without a read-back.
    const personId = randomUUID()
    const personCreate = db.person.create({
      data: { id: personId, code, displayName: name, email: normalizedEmail, credential: { create: { passwordHash } } },
      select: { id: true, code: true, displayName: true, email: true },
    })
    // No password material in any form, hashed or otherwise. The stream answers
    // "which accounts came into existence, when, and by which route" — which is
    // the compensating control FR-120 leans on, the rate limit being the weaker
    // of the two.
    const auditCreate = db.auditEvent.create(auditEventCreateArgs({
      entityType: 'PERSON',
      entityId: personId,
      action: 'ACCOUNT_SELF_CREATED',
      actorId: personId,
      payload: { personCode: code, via: 'signup' },
    }))

    if (typeof db.$transaction === 'function') {
      const [person] = await db.$transaction([personCreate, auditCreate])
      return person
    }
    // A caller-owned transaction client has no `$transaction`: its operations
    // already run inside the caller's transaction, in order.
    const person = await personCreate
    await auditCreate
    return person
  }
  // A caller-owned transaction cannot be retried here; its owner handles code conflicts.
  if (typeof db.$transaction !== 'function') return create()
  return retryOnCodeConflict(create, {
    exhausted: () => failure(409, 'PERSON_CODE_EXHAUSTED'),
  })
}
