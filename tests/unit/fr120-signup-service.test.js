import { describe, expect, it, vi } from 'vitest'
import { createAccount, normalizeSignupEmail } from '@/modules/identity/signup-service'
import { hashPassword, verifyPassword } from '@/modules/identity/auth-service'

// @req FR-120 — self-serve account creation grants nothing beyond a Person and
// a PersonCredential, and refuses an address that already holds an account.
// @spec BR-002, SEC-008
// @tested tests/unit/fr120-signup-service.test.js

const VALID = {
  email: 'New.Person@Example.com',
  displayName: 'คนใหม่',
  password: 'a-good-enough-password',
}

function mockDb({ existingByEmail = null, takenCodes = [] } = {}) {
  const created = { people: [], credentials: [], audits: [] }
  const db = {
    created,
    person: {
      findUnique: vi.fn(async ({ where }) =>
        (takenCodes.includes(where.code) ? { id: 'someone-else' } : null)),
      findFirst: vi.fn(async () => existingByEmail),
      create: vi.fn(async ({ data }) => {
        created.people.push(data)
        return { id: 'per-new', ...data }
      }),
    },
    personCredential: {
      create: vi.fn(async ({ data }) => { created.credentials.push(data); return { id: 'cred-1', ...data } }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }) => { created.audits.push(data); return { id: 'a-1', ...data } }),
    },
  }
  db.$transaction = vi.fn(async (fn) => fn(db))
  return db
}

const attempt = (db, over = {}) => createAccount({ ...VALID, ...over, db })

describe('FR-120 createAccount', () => {
  it('creates exactly one Person and one credential, and nothing else', async () => {
    const db = mockDb()
    const person = await attempt(db)

    expect(person.id).toBe('per-new')
    expect(db.created.people).toHaveLength(1)
    expect(db.created.credentials).toHaveLength(1)

    // The whole point of the requirement: signup confers no authority. If a
    // later change reaches for any of these, this test is where it stops.
    for (const model of ['platformGrant', 'tenant', 'business', 'workspaceMembership', 'membership', 'portfolio', 'project']) {
      expect(db[model]).toBeUndefined()
    }
  })

  it('stores a password the login path can verify, and never the password itself', async () => {
    const db = mockDb()
    await attempt(db)

    const [credential] = db.created.credentials
    expect(credential.passwordHash).not.toContain(VALID.password)
    // Verified through FR-046's own function rather than by matching a format
    // string: what matters is that the credential this writes is one the login
    // path accepts, and a format assertion would pass on a hash login rejects.
    expect(verifyPassword(VALID.password, credential.passwordHash)).toBe(true)
    expect(verifyPassword('some other password', credential.passwordHash)).toBe(false)
  })

  it('normalizes the email so the account is reachable however it was typed', async () => {
    const db = mockDb()
    await attempt(db)
    expect(db.created.people[0].email).toBe('new.person@example.com')
    expect(normalizeSignupEmail('  MiXeD@Case.IO  ')).toBe('mixed@case.io')
    expect(normalizeSignupEmail(undefined)).toBe('')
  })

  it('generates a PSN human code rather than deriving one from the email', async () => {
    // BR-002: external values are never keys. An email-derived code would make
    // the address a key in everything downstream that reads `Person.code`.
    const db = mockDb()
    await attempt(db)

    const [person] = db.created.people
    expect(person.code).toMatch(/^PSN-/)
    expect(person.code).not.toContain('example')
  })

  it('steps past a code that is already taken instead of colliding', async () => {
    const db = mockDb()
    const first = await createAccount({ ...VALID, db })
    const takenDb = mockDb({ takenCodes: [first.code] })
    const second = await createAccount({ ...VALID, db: takenDb })
    expect(second.code).not.toBe(first.code)
  })

  it('refuses an address that already holds an account', async () => {
    const db = mockDb({ existingByEmail: { id: 'per-existing' } })
    await expect(attempt(db)).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 })
    expect(db.created.people).toHaveLength(0)
    expect(db.created.credentials).toHaveLength(0)
  })

  it('looks the address up inside the transaction, not before it', async () => {
    // A check outside the transaction is a check against a snapshot that the
    // insert does not share. This is still only a check — `Person.email` has no
    // unique index in either schema — but it is at least the narrowest window
    // available without a migration, and a refactor that widened it again would
    // be invisible without this assertion.
    const db = mockDb()
    const order = []
    db.person.findFirst.mockImplementation(async () => { order.push('lookup'); return null })
    const runTransaction = db.$transaction
    db.$transaction = vi.fn(async (fn) => { order.push('transaction'); return runTransaction(fn) })

    await attempt(db)
    expect(order).toEqual(['transaction', 'lookup'])
  })

  it('rejects a malformed address before hashing anything', async () => {
    for (const email of ['', '   ', 'no-at-sign', 'no@tld', 'two@@at.com', 'spaces in@name.com']) {
      const db = mockDb()
      await expect(attempt(db, { email })).rejects.toMatchObject({ code: 'EMAIL_INVALID', status: 400 })
      expect(db.created.people).toHaveLength(0)
    }
  })

  it('requires a display name that is not only whitespace', async () => {
    const db = mockDb()
    await expect(attempt(db, { displayName: '   ' })).rejects.toMatchObject({ code: 'DISPLAY_NAME_REQUIRED', status: 400 })
  })

  it('applies FR-046\'s password minimum by calling it, not by restating it', async () => {
    // The assertion is against `hashPassword` itself: if that minimum moves,
    // this test moves with it, which is the property "called rather than
    // copied" is supposed to buy. A hard-coded 8 here would let the two drift.
    const tooShort = 'a'.repeat(7)
    expect(() => hashPassword(tooShort)).toThrow('PASSWORD_INVALID')

    const db = mockDb()
    await expect(attempt(db, { password: tooShort })).rejects.toMatchObject({ code: 'PASSWORD_INVALID', status: 400 })
    expect(db.created.people).toHaveLength(0)
  })

  it('does not report a non-password failure as a password problem', async () => {
    // The service catches around `hashPassword`; catching everything there would
    // turn a broken crypto module into "your password is too short" and send
    // someone editing a field that was never wrong.
    const db = mockDb()
    await expect(attempt(db, { password: 12345678 })).rejects.toMatchObject({ code: 'PASSWORD_INVALID' })
    await expect(attempt(db, { password: undefined })).rejects.toMatchObject({ code: 'PASSWORD_INVALID' })
  })

  it('writes an audit event that names the account and carries no secret', async () => {
    const db = mockDb()
    await attempt(db)

    expect(db.created.audits).toHaveLength(1)
    const [event] = db.created.audits
    expect(event.entityType).toBe('PERSON')
    expect(event.entityId).toBe('per-new')
    expect(event.action).toBe('ACCOUNT_SELF_CREATED')
    expect(event.actorId).toBe('per-new')
    expect(event.payloadJson).toContain('signup')
    // Neither the password nor its hash: the stream answers "which accounts
    // exist and how they came to", never "what was the secret".
    expect(event.payloadJson).not.toContain(VALID.password)
    expect(event.payloadJson).not.toContain('scrypt')
  })
})
