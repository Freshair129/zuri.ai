import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { commitPlan } from '@/modules/project-manager/import/plan-import-service'
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

const CAPABILITY = 'project.execution.approve'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const COMMIT_SHA = 'c'.repeat(40)

let business
let workspace
let requester
let reviewer
let revokedReviewer
let sequence = 0

function approvalInput(fixture, over = {}) {
  return {
    projectId: fixture.project.id,
    executionRunId: fixture.run.executionRunId,
    executionStepId: fixture.step.executionStepId,
    actionClass: 'PROJECT_WRITE',
    effectKey: `project-write:${fixture.run.executionRunId}`,
    manifestHash: HASH_A,
    inputHash: HASH_A,
    artifactHashes: [HASH_A],
    commitSha: COMMIT_SHA,
    payloadSummary: { target: fixture.project.code, change: 'update bounded project state' },
    expectedEffects: { records: 1, externalCalls: 0 },
    eligibleReviewerCapability: CAPABILITY,
    policyVersion: 'pm-approval-gateway.test.v1',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    ...over,
  }
}

async function freshRun(label) {
  sequence += 1
  const code = `APP-${label}-${sequence}`
  const plan = {
    schemaVersion: '1.2',
    generatedBy: 'approval-gateway-test',
    scope: { workspaceCode: workspace.code },
    project: { code: `PRJ-${code}`, name: `Approval ${label} ${sequence}`, status: 'ACTIVE' },
    trace: { correlationId: `approval-${code}`, idempotencyKey: `approval-idem-${code}` },
    domainBinding: {
      primaryDomainId: 'DOM-DEVELOPMENT',
      supportingDomainIds: [],
      technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
    },
    identityRefs: {},
    workstreams: [{
      code: `WST-${code}`,
      name: `Approval workstream ${sequence}`,
      executionMode: 'SOFTWARE_SPRINT',
      executionModeId: 'EXM-SOFTWARE-SPRINT',
      executionContractId: 'EXC-SOFTWARE-SPRINT-V1',
      contractVersion: '1.0.0',
      progressStrategy: 'TASK_WEIGHT',
      items: [{ code: `TASK-${code}`, subtype: 'TASK', title: 'Approval test task' }],
    }],
  }
  const committed = await commitPlan(plan, { viewer: requester })
  const project = await prisma.project.findUnique({ where: { id: committed.projectId } })
  const run = await prisma.projectExecutionRun.findUnique({
    where: { executionRunId: committed.executionRunId },
    include: { steps: true },
  })
  const step = run.steps.find((row) => row.stepKey === 'plan.commit')
  await prisma.projectExecutionRun.update({ where: { id: run.id }, data: { status: 'RUNNING' } })
  const readyStep = await prisma.projectExecutionStep.update({
    where: { id: step.id },
    data: { status: 'READY', inputHash: HASH_A },
  })
  return { project, run: { ...run, status: 'RUNNING' }, step: readyStep }
}

describe('Project Manager approval gateway admission', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Approval Group', code: 'PF-APPROVAL' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Approval Tenant', code: 'TNT-APPROVAL' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Approval Business', code: 'BUS-APPROVAL' })
    workspace = await createWorkspace({
      name: 'Approval Workspace',
      scopeType: 'BUSINESS',
      businessId: business.id,
      code: 'WS-APPROVAL',
    })
    requester = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      principal: { id: 'person-approval-requester', code: 'PER-APP-REQ', displayName: 'Requester' },
    })
    reviewer = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      permissionsByBusinessId: { [business.id]: [CAPABILITY] },
      principal: { id: 'person-approval-reviewer', code: 'PER-APP-REV', displayName: 'Reviewer' },
    })
    revokedReviewer = makeViewer({
      visibleBusinessIds: [business.id],
      ownedBusinessIds: [business.id],
      principal: { id: 'person-approval-revoked', code: 'PER-APP-REVOKED', displayName: 'Revoked reviewer' },
    })
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
