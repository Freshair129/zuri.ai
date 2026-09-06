// @req FR-107 — revoking a PlatformGrant denies the very next request. This
// is the real-database proof: an ACTIVE grant resolves `platformGrant: true`
// through the session port, revokeOperatorGrant flips it to REVOKED against
// the real store, and the next resolution for the same session reads
// `platformGrant: false` — nothing was snapshotted.
// @spec FR-075, SEC-008, SEC-014, NFR-019
// @tested tests/integration/platform-grant-revoke.test.js
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { OPERATOR_CAPABILITY, hasOperatorGrant, listOperatorGrants, revokeOperatorGrant } from '@/modules/identity/operator-bootstrap'
import { createSessionPort } from '@/modules/identity/session-port'
import { generateSessionToken } from '@/modules/identity/auth-service'

async function makeOperatorPerson(codeSuffix) {
  return prisma.person.create({
    data: { code: `PSN-PGREVOKE-${codeSuffix}`, displayName: `Operator ${codeSuffix}` },
  })
}

describe('PlatformGrant revocation (real database)', () => {
  it('hasOperatorGrant reads true for an ACTIVE grant and false once revoked', async () => {
    const person = await makeOperatorPerson('A')
    const grant = await prisma.platformGrant.create({
      data: { personId: person.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
    })
    // a second standing ACTIVE OPERATOR grant so this one isn't "the last"
    const guard = await makeOperatorPerson('A-GUARD')
    await prisma.platformGrant.create({ data: { personId: guard.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' } })

    expect(await hasOperatorGrant(person.id, prisma)).toBe(true)

    const result = await revokeOperatorGrant(grant.id, { reason: 'integration test', db: prisma })
    expect(result).toMatchObject({ id: grant.id, personId: person.id, revoked: true, status: 'REVOKED' })

    expect(await hasOperatorGrant(person.id, prisma)).toBe(false)

    const row = await prisma.platformGrant.findUnique({ where: { id: grant.id } })
    expect(row.status).toBe('REVOKED')
    expect(row.revokedAt).toBeInstanceOf(Date)
    expect(row.revokeReason).toBe('integration test')

    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'PERSON', entityId: person.id, action: 'OPERATOR_GRANT_REVOKED' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(audit).toBeTruthy()
    expect(audit.payloadJson).not.toMatch(/scrypt\$/)
  })

  it('the session port resolves platformGrant true then false across the same session, on the very next request', async () => {
    const person = await makeOperatorPerson('B')
    const grant = await prisma.platformGrant.create({
      data: { personId: person.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' },
    })
    const guard = await makeOperatorPerson('B-GUARD')
    await prisma.platformGrant.create({ data: { personId: guard.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' } })

    const secret = 'integration-test-session-secret-long-enough-123456'
    const token = generateSessionToken(person.id, { secret, now: Date.now() })
    const sessionPort = createSessionPort({ env: { NODE_ENV: 'development', ZURI_SESSION_SECRET: secret }, db: prisma })
    const request = { headers: { cookie: `zuri_session=${token}` } }

    const before = await sessionPort.read(request)
    expect(before).toMatchObject({ state: 'AUTHENTICATED', principalId: person.id, platformGrant: true })

    await revokeOperatorGrant(grant.id, { db: prisma })

    const after = await sessionPort.read(request)
    expect(after).toMatchObject({ state: 'AUTHENTICATED', principalId: person.id, platformGrant: false })
  })

  it('refuses to revoke the LAST ACTIVE OPERATOR grant without --allow-last, and allows it with the flag', async () => {
    const person = await makeOperatorPerson('C')
    // isolate: revoke every other ACTIVE OPERATOR grant this suite created so far is not
    // reliable across parallel files, so count is scoped by creating a fresh, deterministic pair
    const other = await makeOperatorPerson('C-OTHER')
    const soleGrant = await prisma.platformGrant.create({ data: { personId: person.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' } })
    const otherGrant = await prisma.platformGrant.create({ data: { personId: other.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' } })

    // Revoke every other ACTIVE OPERATOR grant already in this test database so
    // `soleGrant` really is the last one, then exercise the refusal and the override.
    await prisma.platformGrant.updateMany({
      where: { capability: OPERATOR_CAPABILITY, status: 'ACTIVE', id: { notIn: [soleGrant.id, otherGrant.id] } },
      data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'test isolation' },
    })
    await revokeOperatorGrant(otherGrant.id, { db: prisma, allowLast: true })

    await expect(revokeOperatorGrant(soleGrant.id, { db: prisma }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('OPERATOR_GRANT_REFUSED_LAST_ACTIVE_OPERATOR') })

    const result = await revokeOperatorGrant(soleGrant.id, { db: prisma, allowLast: true })
    expect(result).toMatchObject({ revoked: true, status: 'REVOKED' })
  })

  it('listOperatorGrants defaults to ACTIVE and finds the grant id needed to revoke it', async () => {
    const person = await makeOperatorPerson('D')
    const grant = await prisma.platformGrant.create({ data: { personId: person.id, capability: OPERATOR_CAPABILITY, status: 'ACTIVE' } })

    const active = await listOperatorGrants({ db: prisma })
    expect(active.map((row) => row.id)).toContain(grant.id)
    expect(active.find((row) => row.id === grant.id)).toMatchObject({ personId: person.id, personCode: person.code, status: 'ACTIVE' })

    await revokeOperatorGrant(grant.id, { db: prisma, allowLast: true })

    const activeAfter = await listOperatorGrants({ db: prisma })
    expect(activeAfter.map((row) => row.id)).not.toContain(grant.id)

    const all = await listOperatorGrants({ status: 'ALL', db: prisma })
    expect(all.find((row) => row.id === grant.id)).toMatchObject({ status: 'REVOKED' })
  })
})
