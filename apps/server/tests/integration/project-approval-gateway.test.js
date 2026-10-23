import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPmApprovalContext, createPmApprovalFixture, pmApprovalInput as approvalInput } from '../helpers/pm-approval-fixture'
import { ownsElsewhere } from '../factories/viewer'
import { replayProjectExecutionTrace } from '@/modules/project-manager/application/project-execution-trace-service'
import {
  admitApprovedStep,
  decideApproval,
  listApprovals,
  requestApproval,
} from '@/modules/project-manager/application/approval-gateway'

// @req FR-272 — PM approval request, exact digest, reviewer SoD, expiry,
// revocation, admission fencing and replay isolation.
// @spec ADR-103, PMR-013, PMT-013, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-approval-gateway.test.js

const HASH_B = 'b'.repeat(64)
let context, requester, reviewer, revokedReviewer
const freshRun = label => createPmApprovalFixture({ db: prisma, label, context })

describe('Project Manager approval gateway admission', () => {
  beforeAll(async () => {
    context = await createPmApprovalContext()
    ;({ requester, reviewer, revokedReviewer } = context)
  })

  it('does not create an approval row for READ_ONLY and is idempotent for the same digest', async () => {
    const fixture = await freshRun('IDEMPOTENT')
    const readOnly = await requestApproval({ ...approvalInput(fixture), actionClass: 'READ_ONLY' }, { viewer: requester })
    expect(readOnly).toEqual({ required: false, approval: null })
    expect(await prisma.projectApprovalRequest.count({ where: { executionRunId: fixture.run.executionRunId } })).toBe(0)

    const sameRequest = approvalInput(fixture, { expiresAt: new Date(Date.now() + 60 * 60 * 1000) })
    const first = await requestApproval(sameRequest, { viewer: requester })
    const second = await requestApproval(sameRequest, { viewer: requester })
    expect(first.approval.approvalRequestId).toBe(second.approval.approvalRequestId)
    expect(second.idempotent).toBe(true)
    expect(await prisma.projectApprovalRequest.count({ where: { executionRunId: fixture.run.executionRunId } })).toBe(1)
    expect((await prisma.projectExecutionStep.findUnique({ where: { id: fixture.step.id } })).status).toBe('WAITING_APPROVAL')
  })

  it('refuses requester self-approval and stale input admission', async () => {
    const fixture = await freshRun('SOD-HASH')
    const created = await requestApproval(approvalInput(fixture), { viewer: requester })
    await expect(decideApproval(created.approval.approvalRequestId, { decision: 'APPROVE' }, {
      viewer: requester,
      projectId: fixture.project.id,
      executionRunId: fixture.run.executionRunId,
    })).rejects.toMatchObject({ code: 'REVIEWER_CONFLICT', status: 409 })

    const approved = await decideApproval(created.approval.approvalRequestId, { decision: 'APPROVE' }, {
      viewer: reviewer,
      projectId: fixture.project.id,
      executionRunId: fixture.run.executionRunId,
    })
    expect(approved.approval.state).toBe('APPROVED')
    await prisma.projectExecutionStep.update({ where: { id: fixture.step.id }, data: { inputHash: HASH_B } })
    await expect(admitApprovedStep(
      created.approval.approvalRequestId,
      created.approval.requestDigest,
      fixture.step.attemptId,
      { viewer: reviewer, executorId: 'executor-hash' },
    )).rejects.toMatchObject({ code: 'INPUT_CHANGED', status: 409 })
    expect((await prisma.projectApprovalRequest.findUnique({ where: { approvalRequestId: created.approval.approvalRequestId } })).state)
      .toBe('APPROVED')
  })

  it('re-resolves reviewer capability at admission and refuses a revoked grant', async () => {
    const fixture = await freshRun('REVOKED')
    const created = await requestApproval(approvalInput(fixture), { viewer: requester })
    await decideApproval(created.approval.approvalRequestId, { decision: 'APPROVE' }, {
      viewer: reviewer,
      projectId: fixture.project.id,
      executionRunId: fixture.run.executionRunId,
    })
    await expect(admitApprovedStep(
      created.approval.approvalRequestId,
      created.approval.requestDigest,
      fixture.step.attemptId,
      { viewer: revokedReviewer, executorId: 'executor-revoked' },
    )).rejects.toMatchObject({ code: 'APPROVAL_REVOKED', status: 409 })
    expect((await prisma.projectApprovalRequest.findUnique({ where: { approvalRequestId: created.approval.approvalRequestId } })).state)
      .toBe('REVOKED')
  })

  it('expires before decision, fences stale lease, then issues one short-lived receipt', async () => {
    const fixture = await freshRun('EXPIRY-LEASE')
    const now = Date.now()
    const created = await requestApproval(approvalInput(fixture, {
      expiresAt: new Date(now + 1000),
    }), { viewer: requester, now })
    await expect(decideApproval(created.approval.approvalRequestId, { decision: 'APPROVE' }, {
      viewer: reviewer,
      projectId: fixture.project.id,
      executionRunId: fixture.run.executionRunId,
      now: now + 1001,
    })).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED', status: 409 })
    expect((await prisma.projectApprovalRequest.findUnique({ where: { approvalRequestId: created.approval.approvalRequestId } })).state)
      .toBe('EXPIRED')

    const admittedFixture = await freshRun('LEASE')
    const admitted = await requestApproval(approvalInput(admittedFixture), { viewer: requester, now })
    await decideApproval(admitted.approval.approvalRequestId, { decision: 'APPROVE' }, {
      viewer: reviewer,
      projectId: admittedFixture.project.id,
      executionRunId: admittedFixture.run.executionRunId,
      now,
    })
    await expect(admitApprovedStep(
      admitted.approval.approvalRequestId,
      admitted.approval.requestDigest,
      'stale-lease',
      { viewer: reviewer, executorId: 'executor-lease' },
      { now },
    )).rejects.toMatchObject({ code: 'APPROVAL_LEASE_MISMATCH', status: 409 })
    const receipt = await admitApprovedStep(
      admitted.approval.approvalRequestId,
      admitted.approval.requestDigest,
      admittedFixture.step.attemptId,
      { viewer: reviewer, executorId: 'executor-lease' },
      { now },
    )
    expect(receipt).toMatchObject({
      admitted: true,
      approvalRequestId: admitted.approval.approvalRequestId,
      executionRunId: admittedFixture.run.executionRunId,
      executionStepId: admittedFixture.step.executionStepId,
      leaseEpoch: admittedFixture.step.attemptId,
    })
    expect(receipt.admissionReceipt).toMatch(/^[a-f0-9]{64}$/)
    const stored = await prisma.projectApprovalRequest.findUnique({ where: { approvalRequestId: admitted.approval.approvalRequestId } })
    expect(stored).toMatchObject({ state: 'CONSUMED', admissionLeaseEpoch: admittedFixture.step.attemptId })
    expect(stored.admissionReceiptHash).not.toBe(receipt.admissionReceipt)
    await expect(admitApprovedStep(
      admitted.approval.approvalRequestId,
      admitted.approval.requestDigest,
      admittedFixture.step.attemptId,
      { viewer: reviewer, executorId: 'executor-lease' },
      { now },
    )).rejects.toMatchObject({ code: 'APPROVAL_ALREADY_DECIDED', status: 409 })
  })

  it('limits reviewer reads to the Project scope and never carries approval into replay', async () => {
    const fixture = await freshRun('REPLAY')
    const created = await requestApproval(approvalInput(fixture), { viewer: requester })
    await expect(listApprovals(fixture.project.id, fixture.run.executionRunId, {
      viewer: ownsElsewhere({ owns: 'business-other', sees: 'business-other' }),
    })).rejects.toMatchObject({ status: 404 })
    const listed = await listApprovals(fixture.project.id, fixture.run.executionRunId, { viewer: reviewer })
    expect(listed.approvals.map((row) => row.approvalRequestId)).toContain(created.approval.approvalRequestId)

    const replay = await replayProjectExecutionTrace(fixture.project.id, fixture.run.executionRunId, {
      viewer: requester,
      mode: 'full',
    })
    expect(replay.executionRunId).not.toBe(fixture.run.executionRunId)
    expect((await listApprovals(fixture.project.id, replay.executionRunId, { viewer: reviewer })).approvals).toEqual([])
  })
})
