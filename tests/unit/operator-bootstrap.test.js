// @req FR-107 — first-operator bootstrap: empty-set-only, one transaction,
// password material never stored or audited, and the session port resolves the
// grant per request.
// @spec FR-075, SEC-008, SEC-014
// @tested tests/unit/operator-bootstrap.test.js
import { describe, expect, it, vi } from 'vitest'
import { bootstrapOperator, hashInitialPassword, hasOperatorGrant } from '@/modules/identity/operator-bootstrap'
import { verifyPassword, generateSessionToken } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'

function bootstrapDb({ standingGrant = null, existingPerson = null } = {}) {
  const created = { person: null, credential: null, grant: null, audit: null }
  const tx = {
    person: {
      create: vi.fn(async ({ data, select }) => {
        created.person = { id: 'per-new', code: data.code, displayName: data.displayName, email: data.email }
        return { id: 'per-new', code: data.code, displayName: data.displayName }
      }),
      findUnique: vi.fn(async ({ where }) =>
        existingPerson && where.id === existingPerson.id
          ? { id: existingPerson.id, code: existingPerson.code, displayName: existingPerson.displayName }
          : null),
    },
    personCredential: { create: vi.fn(async ({ data }) => { created.credential = data; return { id: 'cred-1', ...data } }) },
    platformGrant: { create: vi.fn(async ({ data }) => { created.grant = data; return { id: 'grant-1' } }) },
    auditEvent: { create: vi.fn(async ({ data }) => { created.audit = data; return { id: 'audit-1', ...data } }) },
  }
  const db = {
    platformGrant: { findFirst: vi.fn(async () => standingGrant) },
    person: {
      findFirst: vi.fn(async () => existingPerson),
      findUnique: vi.fn(async () => null), // uniqueHumanCode collision probe
    },
    $transaction: vi.fn(async (run) => run(tx)),
  }
  return { db, tx, created }
}

describe('hashInitialPassword', () => {
  it('produces a hash auth-service verifyPassword accepts — the format lock between the CLI and login', () => {
    const hash = hashInitialPassword('correct horse battery staple')
    expect(hash).toMatch(/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/)
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('bootstrapOperator', () => {
  it('refuses while any ACTIVE OPERATOR grant stands — later grants are issued by an operator, not bootstrap', async () => {
    const { db } = bootstrapDb({ standingGrant: { id: 'grant-existing' } })
    await expect(bootstrapOperator({ email: 'boss@example.com', displayName: 'Boss', db }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('BOOTSTRAP_REFUSED_OPERATOR_EXISTS') })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('never overwrites an existing credential', async () => {
    const { db } = bootstrapDb({
      existingPerson: { id: 'per-1', code: 'PER-X', displayName: 'X', credential: { id: 'cred-existing' } },
    })
    await expect(bootstrapOperator({ email: 'x@example.com', displayName: 'X', db }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('BOOTSTRAP_REFUSED_CREDENTIAL_EXISTS') })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('creates Person + credential + grant in one transaction, audits without password material, returns the password once', async () => {
    const { db, tx, created } = bootstrapDb()
    const result = await bootstrapOperator({ email: 'boss@example.com', displayName: 'Boss', db })

    expect(tx.person.create).toHaveBeenCalledTimes(1)
    expect(created.person.code).toMatch(/^PSN-/)
    expect(created.credential.passwordHash).toMatch(/^scrypt\$/)
    expect(created.grant).toMatchObject({ capability: 'OPERATOR', status: 'ACTIVE' })

    // the one place the password exists — and the audit row carries none of it
    expect(result.initialPassword).toHaveLength(16)
    expect(verifyPassword(result.initialPassword, created.credential.passwordHash)).toBe(true)
    expect(created.audit.action).toBe('OPERATOR_BOOTSTRAPPED')
    expect(JSON.stringify(created.audit)).not.toContain(result.initialPassword)
    expect(JSON.stringify(created.audit)).not.toContain(created.credential.passwordHash)
  })

  it('reuses a credential-less existing Person instead of minting a duplicate', async () => {
    const { db, tx } = bootstrapDb({
      existingPerson: { id: 'per-1', code: 'PER-KEEP', displayName: 'Keep', credential: null },
    })
    const result = await bootstrapOperator({ email: 'keep@example.com', displayName: 'Keep', db })
    expect(tx.person.create).not.toHaveBeenCalled()
    expect(result.personCode).toBe('PER-KEEP')
  })
})

describe('bootstrapOperator grant-only mode', () => {
  it('still refuses while any ACTIVE OPERATOR grant stands — grant-only serves the empty set only', async () => {
    const { db } = bootstrapDb({ standingGrant: { id: 'grant-existing' } })
    await expect(bootstrapOperator({ email: 'boss@example.com', grantOnly: true, db }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('BOOTSTRAP_REFUSED_OPERATOR_EXISTS') })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('refuses when the target Person does not exist — grant-only grants, it never creates', async () => {
    const { db } = bootstrapDb()
    await expect(bootstrapOperator({ email: 'ghost@example.com', grantOnly: true, db }))
      .rejects.toMatchObject({ status: 404, message: expect.stringContaining('BOOTSTRAP_GRANT_ONLY_PERSON_NOT_FOUND') })
    expect(db.$transaction).not.toHaveBeenCalled()
  })

  it('issues only the ACTIVE OPERATOR grant + audit for a Person who already holds a credential, and returns no password', async () => {
    const { db, tx, created } = bootstrapDb({
      existingPerson: { id: 'per-boss', code: 'PER-BOSS', displayName: 'Boss', credential: { id: 'cred-existing' } },
    })
    const result = await bootstrapOperator({ email: 'boss@example.com', grantOnly: true, db })

    expect(tx.person.create).not.toHaveBeenCalled()
    expect(tx.personCredential.create).not.toHaveBeenCalled()
    expect(created.grant).toMatchObject({ personId: 'per-boss', capability: 'OPERATOR', status: 'ACTIVE' })
    expect(created.audit.action).toBe('OPERATOR_BOOTSTRAPPED')
    expect(JSON.parse(created.audit.payloadJson)).toMatchObject({ personCode: 'PER-BOSS', grantId: 'grant-1', grantOnly: true })
    expect(result).toMatchObject({ personId: 'per-boss', personCode: 'PER-BOSS', displayName: 'Boss', grantId: 'grant-1' })
    expect(result.initialPassword).toBeUndefined()
  })

  it('never touches the credential of a credential-less Person either — no credential is minted on its behalf', async () => {
    const { db, tx } = bootstrapDb({
      existingPerson: { id: 'per-1', code: 'PER-KEEP', displayName: 'Keep', credential: null },
    })
    const result = await bootstrapOperator({ email: 'keep@example.com', grantOnly: true, db })
    expect(tx.personCredential.create).not.toHaveBeenCalled()
    expect(result.grantId).toBe('grant-1')
    expect(result.initialPassword).toBeUndefined()
  })
})

describe('hasOperatorGrant → session port', () => {
  it('is false when the store is absent (test doubles, pre-migration databases)', async () => {
    expect(await hasOperatorGrant('per-1', {})).toBe(false)
    expect(await hasOperatorGrant(null, { platformGrant: { findFirst: vi.fn() } })).toBe(false)
  })

  it('the session port resolves platformGrant per request from an ACTIVE grant', async () => {
    const secret = 'test-session-secret-that-is-long-enough-123456'
    const token = generateSessionToken('person-1', { secret, now: Date.now() })
    const findFirst = vi.fn(async () => ({ id: 'grant-1' }))
    const sessionPort = createSessionPort({
      env: { NODE_ENV: 'development', ZURI_SESSION_SECRET: secret },
      db: { platformGrant: { findFirst } },
    })

    const first = await sessionPort.read({ headers: { cookie: `zuri_session=${token}` } })
    expect(first).toMatchObject({ state: 'AUTHENTICATED', platformGrant: true })

    // revocation denies the very next request — nothing is snapshotted
    findFirst.mockResolvedValue(null)
    const second = await sessionPort.read({ headers: { cookie: `zuri_session=${token}` } })
    expect(second).toMatchObject({ state: 'AUTHENTICATED', platformGrant: false })
    expect(findFirst).toHaveBeenCalledTimes(2)
  })
})
