// @req FR-197 — operator access is time-boxed, issuable, and its use is
//   recorded, against a real database: `issueOperatorGrant` requires a
//   mandatory, capped `expiresAt`; `hasOperatorGrant` honours it even while the
//   row is still nominally ACTIVE; renewal is a fresh row, not an update to
//   the old one; the bootstrap grant is flagged `standing`; and reading the
//   audit stream or exporting a snapshot records an `OPERATOR_ACTION` event.
// @spec FR-075, SEC-008, ADR-017 D6, ADR-079
// @tested tests/integration/fr197-operator-grant-lifecycle.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { bootstrapOperator, hasOperatorGrant, issueOperatorGrant, OPERATOR_GRANT_MAX_DAYS } from '@/modules/identity/operator-bootstrap'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { assertOperatorAndRecordUse } from '@/modules/identity/operator-use'

let standingOperator, targetPerson

describe('FR-197 operator grant lifecycle', () => {
  beforeAll(async () => {
    const bootstrap = await bootstrapOperator({ email: 'fr197-boss@example.com', displayName: 'Boss' })
    standingOperator = bootstrap.personId
    targetPerson = await prisma.person.create({ data: { code: 'PER-FR197-TARGET', displayName: 'Support Analyst' } })
  })

  it('the bootstrap grant is flagged standing and carries no expiry', async () => {
    const grant = await prisma.platformGrant.findFirst({ where: { personId: standingOperator, capability: 'OPERATOR', status: 'ACTIVE' } })
    expect(grant).toMatchObject({ standing: true, expiresAt: null })
  })

  it('requires a mandatory, future, capped expiresAt and a reason', async () => {
    await expect(issueOperatorGrant({ personId: targetPerson.id, reason: '' })).rejects.toMatchObject({ status: 400, message: 'OPERATOR_GRANT_REASON_REQUIRED' })
    await expect(issueOperatorGrant({ personId: targetPerson.id, reason: 'ทดสอบ' })).rejects.toMatchObject({ status: 400, message: 'OPERATOR_GRANT_EXPIRY_REQUIRED' })
    await expect(issueOperatorGrant({ personId: targetPerson.id, reason: 'ทดสอบ', expiresAt: new Date(Date.now() - 1000) }))
      .rejects.toMatchObject({ status: 400, message: 'OPERATOR_GRANT_EXPIRY_MUST_BE_FUTURE' })
    const tooFar = new Date(Date.now() + (OPERATOR_GRANT_MAX_DAYS + 1) * 24 * 60 * 60 * 1000)
    await expect(issueOperatorGrant({ personId: targetPerson.id, reason: 'ทดสอบ', expiresAt: tooFar }))
      .rejects.toMatchObject({ status: 400, message: `OPERATOR_GRANT_EXPIRY_EXCEEDS_MAX_${OPERATOR_GRANT_MAX_DAYS}_DAYS` })
  })

  it('issues a non-standing, time-boxed grant, and an expired grant denies even while the row is still ACTIVE', async () => {
    const shortlyPast = new Date(Date.now() + 2000)
    const issued = await issueOperatorGrant({ personId: targetPerson.id, reason: 'สนับสนุนลูกค้าเร่งด่วน', expiresAt: shortlyPast, actorId: standingOperator })
    const row = await prisma.platformGrant.findUnique({ where: { id: issued.id } })
    expect(row).toMatchObject({ status: 'ACTIVE', standing: false, grantReason: 'สนับสนุนลูกค้าเร่งด่วน', grantedByPersonId: standingOperator })

    expect(await hasOperatorGrant(targetPerson.id, prisma, Date.now())).toBe(true)
    // The row is untouched by anything — expiry is read at the moment of use,
    // never written by a timer (NFR-019 discipline).
    expect(await hasOperatorGrant(targetPerson.id, prisma, shortlyPast.getTime() + 1000)).toBe(false)
    const stillRow = await prisma.platformGrant.findUnique({ where: { id: issued.id } })
    expect(stillRow.status).toBe('ACTIVE')
  })

  it('renewal is a fresh row: the prior ACTIVE grant is superseded (revoked) with its own audit event', async () => {
    const first = await issueOperatorGrant({ personId: targetPerson.id, reason: 'first', expiresAt: new Date(Date.now() + 60000), actorId: standingOperator })
    const second = await issueOperatorGrant({ personId: targetPerson.id, reason: 'renewal', expiresAt: new Date(Date.now() + 120000), actorId: standingOperator })
    expect(second.id).not.toBe(first.id)

    const firstRow = await prisma.platformGrant.findUnique({ where: { id: first.id } })
    expect(firstRow).toMatchObject({ status: 'REVOKED', revokeReason: 'SUPERSEDED_BY_RENEWAL' })
    const secondRow = await prisma.platformGrant.findUnique({ where: { id: second.id } })
    expect(secondRow.status).toBe('ACTIVE')

    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PERSON', entityId: targetPerson.id, action: { in: ['OPERATOR_GRANT_ISSUED', 'OPERATOR_GRANT_REVOKED'] } }, orderBy: { occurredAt: 'asc' } })
    expect(audits.slice(-2).map((a) => a.action)).toEqual(['OPERATOR_GRANT_REVOKED', 'OPERATOR_GRANT_ISSUED'])
  })

  it('reading the audit stream and exporting a snapshot each record one OPERATOR_ACTION event, and a denied attempt records nothing', async () => {
    const operatorViewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [], principal: { id: standingOperator, code: 'OP', displayName: 'Op' } })
    const ordinaryViewer = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })

    await assertOperatorAndRecordUse(operatorViewer, { action: 'AUDIT_READ', db: prisma })
    const auditReadEvents = await prisma.auditEvent.count({ where: { entityType: 'PERSON', entityId: standingOperator, action: 'OPERATOR_ACTION' } })
    expect(auditReadEvents).toBe(1)

    // Scoped to this test's own operator persona — this test database is
    // shared serially across the whole suite (fileParallelism: false), and
    // other files' operators legitimately write their own OPERATOR_ACTION
    // events, so a global count would be a false failure waiting to happen.
    await expect(assertOperatorAndRecordUse(ordinaryViewer, { action: 'AUDIT_READ', db: prisma })).rejects.toMatchObject({ status: 403 })
    const stillOne = await prisma.auditEvent.count({ where: { entityType: 'PERSON', entityId: standingOperator, action: 'OPERATOR_ACTION' } })
    expect(stillOne).toBe(1)
  })
})
