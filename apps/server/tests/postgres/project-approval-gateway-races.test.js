import { describe, expect, inject, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { revokeMembership } from '@/modules/identity/membership-lifecycle-service'
import { APPROVAL_ADMISSION_TTL_MS, admitApprovedStep, decideApproval, requestApproval } from '@/modules/project-manager/application/approval-gateway'
import { createPmApprovalFixture, deferred, independentApprovalClients, instrumentApprovalDb, waitForApprovalLock, withDecisionBarrier, withinDeadline } from '../helpers/pm-approval-fixture'

// @req FR-272 — deterministic PM decision/admission contention and audit rollback.
// @spec ADR-103, SEC-001, SEC-003, SEC-008
// @tested tests/postgres/project-approval-gateway-races.test.js

const url = inject('testDatabaseUrl')
const decision = (fixture, request, value, db, viewer = fixture.reviewer) => decideApproval(request.approval.approvalRequestId,
  { decision: value, reason: 'Reviewed exact bounded effect' }, { viewer, db, projectId: fixture.project.id, executionRunId: fixture.run.executionRunId })
const admit = (fixture, request, db, extra = {}) => admitApprovedStep(request.approval.approvalRequestId,
  request.approval.requestDigest, fixture.step.attemptId, fixture.executor, { db, ...extra })
const audits = (fixture, actions) => prisma.auditEvent.findMany({ where: { businessId: fixture.business.id, action: { in: actions } }, orderBy: { id: 'asc' } })
async function prepare(label, approved = false) {
  const fixture = await createPmApprovalFixture({ label })
  const request = await requestApproval(fixture.requestInput, { viewer: fixture.requester })
  if (approved) await decision(fixture, request, 'APPROVE', prisma)
  return { fixture, request }
}
async function snapshot(fixture, request) {
  return {
    approval: await prisma.projectApprovalRequest.findUnique({ where: { approvalRequestId: request.approval.approvalRequestId } }),
    run: await prisma.projectExecutionRun.findUnique({ where: { id: fixture.run.id } }),
    step: await prisma.projectExecutionStep.findUnique({ where: { id: fixture.step.id } }),
    audits: await audits(fixture, ['PM_APPROVAL_PENDING', 'PM_APPROVAL_APPROVED', 'PM_APPROVAL_REJECTED', 'PM_APPROVAL_CONSUMED']),
  }
}
async function race(fixture, request, secondDecision, admission = false) {
  const clients = await independentApprovalClients(url)
  return withDecisionBarrier({ clients, observer: prisma }, async barrier => {
    const pending = []
    try {
      const first = admission ? admit(fixture, request, barrier.firstDb) : decision(fixture, request, 'APPROVE', barrier.firstDb)
      // Install rejection handlers immediately; no unhandled loser promise.
      const firstSettled = Promise.allSettled([first])
      pending.push(firstSettled)
      await withinDeadline(barrier.held, 'first claim')
      const second = admission ? admit(fixture, request, barrier.secondDb) : decision(fixture, request, secondDecision, barrier.secondDb, fixture.otherReviewer)
      const secondSettled = Promise.allSettled([second])
      pending.push(secondSettled)
      const overlap = await barrier.waitForBlocked()
      expect(overlap.pids[0]).not.toBe(overlap.pids[1])
      expect(overlap.waitEvent).toBe('Lock')
      barrier.release()
      const results = [...await firstSettled, ...await secondSettled]
      console.info(`PM PostgreSQL overlap: ${overlap.pids.join(' -> ')} (${overlap.waitEvent})`)
      return results
    } finally { barrier.release(); await Promise.all(pending) }
  })
}

describe('PM approval PostgreSQL contention', () => {
  it('opposing_decisions_have_one_cas_winner', async () => {
    const { fixture, request } = await prepare('opposing')
    const results = await race(fixture, request, 'REJECT')
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(row => row.status === 'rejected').reason).toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED', status: 409 })
    expect(await audits(fixture, ['PM_APPROVAL_APPROVED', 'PM_APPROVAL_REJECTED'])).toHaveLength(1)
    expect((await audits(fixture, ['PM_APPROVAL_APPROVED', 'PM_APPROVAL_REJECTED']))[0]).toMatchObject({ action: 'PM_APPROVAL_APPROVED', actorId: fixture.reviewer.principal.id })
    expect((await snapshot(fixture, request)).approval).toMatchObject({ state: 'APPROVED', admissionReceiptHash: null })
    expect(await audits(fixture, ['PM_APPROVAL_CONSUMED'])).toHaveLength(0)
  })

  it('identical_decision_retry_has_one_transition', async () => {
    const { fixture, request } = await prepare('identical')
    const results = await race(fixture, request, 'APPROVE')
    expect(results.map(row => row.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(results[0].value.idempotent).toBe(false)
    expect(results[1].value.idempotent).toBe(true)
    expect(results[1].value.approval).toEqual(results[0].value.approval)
    expect(await audits(fixture, ['PM_APPROVAL_APPROVED'])).toHaveLength(1)
  })

  it('one_approved_step_yields_one_admission_under_contention', async () => {
    const { fixture, request } = await prepare('admission', true)
    const results = await race(fixture, request, null, true)
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(row => row.status === 'rejected').reason).toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED', status: 409 })
    const receipt = results.find(row => row.status === 'fulfilled').value
    const state = await snapshot(fixture, request)
    expect(receipt.admitted).toBe(true)
    expect(receipt.admissionReceipt).toMatch(/^[a-f0-9]{64}$/)
    expect(state.approval).toMatchObject({ state: 'CONSUMED', admissionLeaseEpoch: fixture.step.attemptId, auditEventId: receipt.auditEventId })
    expect(state.approval.admissionReceiptHash).not.toBe(receipt.admissionReceipt)
    expect(new Date(receipt.admissionExpiresAt).getTime() - state.approval.consumedAt.getTime()).toBe(APPROVAL_ADMISSION_TTL_MS)
    expect(state.run).toMatchObject({ status: 'RUNNING', auditEventId: receipt.auditEventId })
    expect(state.step).toMatchObject({ status: 'RUNNING', auditEventId: receipt.auditEventId })
    expect(await audits(fixture, ['PM_APPROVAL_CONSUMED'])).toHaveLength(1)
  })

  it.each(['decision', 'admission'])('audit_failure_rolls_back_%s_and_trace', async operation => {
    const { fixture, request } = await prepare(`rollback-${operation}`, operation === 'admission')
    const before = await snapshot(fixture, request)
    const clients = await independentApprovalClients(url)
    let claimed = false
    try {
      const db = instrumentApprovalDb(clients[0], { afterClaim: () => { claimed = true }, beforeAudit: () => { throw new Error('PM_AUDIT_STORAGE_FAILURE') } })
      await expect(operation === 'decision' ? decision(fixture, request, 'APPROVE', db) : admit(fixture, request, db)).rejects.toThrow('PM_AUDIT_STORAGE_FAILURE')
      expect(claimed).toBe(true)
      expect(await snapshot(fixture, request)).toEqual(before)
    } finally { await Promise.all(clients.map(client => client.$disconnect())) }
  })

  it.each([
    ['revoked', 'admission'], ['expired', 'admission'], ['request-expired', 'admission'],
    ['executor-revoked', 'admission'], ['executor-expired', 'admission'],
    ['revoked', 'decision'], ['expired', 'decision'], ['request-expired', 'decision'],
  ])('%s_authority_during_wait_cannot_pass_%s', async (change, operation) => {
    const { fixture, request } = await prepare(`${change}-${operation}-wait`, operation === 'admission')
    const baseTime = Date.now()
    const targetMembership = change.startsWith('executor-') ? fixture.otherReviewerMembership : fixture.reviewerMembership
    if (change === 'expired' || change === 'executor-expired') await prisma.membership.update({ where: { id: targetMembership.id }, data: { expiresAt: new Date(baseTime + 60000) } })
    // Withdraw either the ORIGINAL reviewer or the distinct executor, keeping
    // the other active. Both viewers remain stale pre-withdrawal snapshots.
    fixture.executor = { viewer: fixture.otherReviewer, executorId: 'independent-executor' }
    const clients = await independentApprovalClients(url)
    const locked = deferred(), release = deferred()
    let holder, clock, attempt
    const pids = []
    try {
      holder = clients[0].$transaction(async tx => {
        const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid')
        pids[0] = pid
        await tx.$queryRawUnsafe('SELECT id FROM "ProjectApprovalRequest" WHERE "approvalRequestId" = $1 FOR UPDATE', request.approval.approvalRequestId)
        locked.resolve()
        await release.promise
      }, { timeout: 30000 })
      await withinDeadline(locked.promise, 'approval row holder')
      const contender = instrumentApprovalDb(clients[1], { backend: pid => { pids[1] = pid } })
      const admission = Promise.allSettled([operation === 'admission' ? admit(fixture, request, contender) : decision(fixture, request, 'APPROVE', contender)])
      attempt = admission
      // Confirm a real lock wait before changing persisted Identity authority.
      await waitForApprovalLock(prisma, () => pids)
      if (change.endsWith('revoked')) {
        await revokeMembership({ membershipId: targetMembership.id, reason: 'Withdraw authority while PM waits' }, { db: prisma, resolve: async () => fixture.requester })
      } else {
        const afterExpiry = change === 'request-expired' ? new Date(request.approval.expiresAt).getTime() : baseTime + 60001
        clock = vi.spyOn(Date, 'now').mockReturnValue(afterExpiry)
      }
      release.resolve()
      await holder
      const [result] = await admission
      expect(result.status).toBe('rejected')
      const expected = change === 'request-expired' ? { code: 'APPROVAL_EXPIRED', status: 409 }
        : operation === 'decision' ? { code: 'REVIEWER_NOT_ELIGIBLE', status: 403 } : { code: 'APPROVAL_REVOKED', status: 409 }
      expect(result.reason).toMatchObject(expected)
      expect(await audits(fixture, ['PM_APPROVAL_CONSUMED'])).toHaveLength(0)
      const state = await snapshot(fixture, request)
      expect(state.approval.admissionReceiptHash).toBeNull()
      expect(state.step.status).toBe('WAITING_APPROVAL')
      expect(state.approval.state).toBe(change === 'request-expired' ? 'EXPIRED' : operation === 'admission' ? 'REVOKED' : 'PENDING')
      if (operation === 'decision') expect(await audits(fixture, ['PM_APPROVAL_APPROVED', 'PM_APPROVAL_REJECTED'])).toHaveLength(0)
      if (state.approval.state !== 'PENDING') {
        const transitionAudits = await audits(fixture, [`PM_APPROVAL_${state.approval.state}`])
        expect(transitionAudits).toHaveLength(1)
        expect(transitionAudits[0]).toMatchObject({ id: state.approval.auditEventId, entityId: state.approval.id })
        expect(JSON.parse(transitionAudits[0].afterJson)).toMatchObject({ state: state.approval.state, requestDigest: request.approval.requestDigest })
      }
    } finally {
      release.resolve()
      try { if (holder) await holder; if (attempt) await attempt }
      finally { clock?.mockRestore(); await Promise.all(clients.map(client => client.$disconnect())) }
    }
  })
})
