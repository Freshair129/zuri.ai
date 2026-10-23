import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { commitPlan } from '@/modules/project-manager/import/plan-import-service'

// @req FR-272 — persisted PM/Identity arrangements and observed PostgreSQL
// contention; all viewers pass the shared factory invariants.
// @spec ADR-103, SEC-001, SEC-003
// @tested tests/integration/project-approval-gateway.test.js
// @tested tests/postgres/project-approval-gateway-races.test.js
export const PM_APPROVAL_CAPABILITY = 'product.work.write'
export const PM_APPROVAL_HASH = 'a'.repeat(64)

export async function createPmApprovalContext({ db = prisma, label = 'approval' } = {}) {
  // Scope factories arrange through the suite's injected singleton. Independent
  // clients are for the contested operations, never for a second fixture target.
  if (db !== prisma) throw new Error('PM_APPROVAL_FIXTURE_REQUIRES_SUITE_DATABASE')
  const code = `APP-${randomUUID()}`
  const portfolio = await createPortfolio({ name: label, code: `PF-${code}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: label, code: `TNT-${code}` })
  const business = await createBusiness({ tenantId: tenant.id, name: label, code: `BUS-${code}` })
  const workspace = await createWorkspace({ name: label, code: `WS-${code}`, scopeType: 'BUSINESS', businessId: business.id })
  async function person(role, binding = false) {
    const row = await db.person.create({ data: { code: `PER-${randomUUID()}`, displayName: role } })
    const membership = await db.membership.create({ data: {
      personId: row.id, tenantId: tenant.id, businessId: business.id, role,
      domainKeysJson: JSON.stringify(['projects']),
    } })
    if (binding) await db.roleBinding.create({ data: {
      personId: row.id, tenantId: tenant.id, businessId: business.id, roleKey: 'PRODUCT_OWNER',
    } })
    const viewer = makeViewer(await resolveViewer({ principalId: row.id, db }))
    return { viewer, membership }
  }
  const requester = await person('OWNER')
  const reviewer = await person('MEMBER', true)
  const otherReviewer = await person('MEMBER', true)
  const revokedReviewer = await person('MEMBER')
  return { tenant, business, workspace, requester: requester.viewer, reviewer: reviewer.viewer,
    otherReviewer: otherReviewer.viewer, revokedReviewer: revokedReviewer.viewer,
    reviewerMembership: reviewer.membership, otherReviewerMembership: otherReviewer.membership }
}

export function pmApprovalInput(fixture, over = {}) {
  return {
    projectId: fixture.project.id, executionRunId: fixture.run.executionRunId,
    executionStepId: fixture.step.executionStepId, actionClass: 'PROJECT_WRITE',
    effectKey: `project-write:${fixture.run.executionRunId}`, manifestHash: PM_APPROVAL_HASH,
    inputHash: PM_APPROVAL_HASH, artifactHashes: [PM_APPROVAL_HASH], commitSha: 'c'.repeat(40),
    payloadSummary: { target: fixture.project.code, change: 'update bounded project state' },
    expectedEffects: { records: 1, externalCalls: 0 }, eligibleReviewerCapability: PM_APPROVAL_CAPABILITY,
    policyVersion: 'pm-approval-gateway.test.v1', expiresAt: new Date(Date.now() + 3600000), ...over,
  }
}

export async function createPmApprovalFixture({ db = prisma, label, context } = {}) {
  if (db !== prisma) throw new Error('PM_APPROVAL_FIXTURE_REQUIRES_SUITE_DATABASE')
  context ||= await createPmApprovalContext({ db, label })
  const code = `APP-${randomUUID()}`
  const committed = await commitPlan({
    schemaVersion: '1.2', generatedBy: 'approval-gateway-test',
    scope: { workspaceCode: context.workspace.code },
    project: { code: `PRJ-${code}`, name: label || code, status: 'ACTIVE' },
    trace: { correlationId: code, idempotencyKey: code },
    domainBinding: { primaryDomainId: 'DOM-DEVELOPMENT', supportingDomainIds: [], technicalOwnerDomainId: 'TD-PROJECT-MANAGER' },
    identityRefs: {}, workstreams: [{ code: `WST-${code}`, name: code,
      executionMode: 'SOFTWARE_SPRINT', executionModeId: 'EXM-SOFTWARE-SPRINT',
      executionContractId: 'EXC-SOFTWARE-SPRINT-V1', contractVersion: '1.0.0', progressStrategy: 'TASK_WEIGHT',
      items: [{ code: `TASK-${code}`, subtype: 'TASK', title: 'Approval test task' }],
    }],
  }, { viewer: context.requester, db })
  const project = await db.project.findUnique({ where: { id: committed.projectId } })
  const run = await db.projectExecutionRun.update({ where: { executionRunId: committed.executionRunId }, data: { status: 'RUNNING' }, include: { steps: true } })
  const step = await db.projectExecutionStep.update({ where: { id: run.steps.find(row => row.stepKey === 'plan.commit').id }, data: { status: 'READY', inputHash: PM_APPROVAL_HASH } })
  const fixture = { ...context, project, run, step, executor: { viewer: context.reviewer, executorId: 'pm-test-executor' } }
  return { ...fixture, requestInput: pmApprovalInput(fixture) }
}

export function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

export async function withinDeadline(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`PM_APPROVAL_BARRIER_TIMEOUT: ${label}`)), 10000)
    })])
  } finally { clearTimeout(timer) }
}

// Wrap only the DB seam: every read/CAS/transaction remains real. Hooks may
// pause after a claim or fault the audit write, never synthesize persistence.
export function instrumentApprovalDb(db, hooks = {}) {
  return new Proxy(db, { get(target, key) {
    if (key === '$transaction') return callback => target.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid')
      hooks.backend?.(pid)
      return callback(instrumentApprovalDb(tx, hooks))
    }, { timeout: 30000, maxWait: 10000 })
    if (key === 'projectApprovalRequest' || key === 'auditEvent') return new Proxy(target[key], { get(delegate, operation) {
      const value = delegate[operation]
      if (typeof value !== 'function') return value
      return async (...args) => {
        if (key === 'auditEvent' && operation === 'create') await hooks.beforeAudit?.(args[0])
        if (key === 'projectApprovalRequest' && operation === 'updateMany') await hooks.beforeClaim?.(args[0])
        const result = await value.apply(delegate, args)
        if (key === 'projectApprovalRequest' && operation === 'updateMany' && result.count === 1) await hooks.afterClaim?.(args[0])
        return result
      }
    } })
    const value = Reflect.get(target, key, target)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

export async function independentApprovalClients(url) {
  if (!/^postgres(?:ql)?:\/\//.test(url || '')) throw new Error('PM_APPROVAL_REQUIRES_INJECTED_POSTGRES')
  const { PrismaClient } = await import('@zuri/prisma-postgres')
  return [new PrismaClient({ datasources: { db: { url } } }), new PrismaClient({ datasources: { db: { url } } })]
}

export async function withDecisionBarrier({ clients, observer }, callback) {
  const held = deferred(), release = deferred()
  const pids = []
  const firstDb = instrumentApprovalDb(clients[0], { backend: pid => { pids[0] = pid }, afterClaim: async () => { held.resolve(); await release.promise } })
  const secondDb = instrumentApprovalDb(clients[1], { backend: pid => { pids[1] = pid } })
  async function waitForBlocked() {
    await waitForApprovalLock(observer, () => pids)
    return { pids: [...pids], waitEvent: 'Lock' }
  }
  try { return await callback({ firstDb, secondDb, held: held.promise, release: release.resolve, waitForBlocked }) }
  finally { release.resolve(); await Promise.all(clients.map(client => client.$disconnect())) }
}

export async function waitForApprovalLock(observer, getPids) {
  const deadline = performance.now() + 10000
  while (performance.now() < deadline) {
    const [holder, contender] = getPids()
    if (holder && contender && holder !== contender) {
      const rows = await observer.$queryRawUnsafe('SELECT wait_event_type, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity WHERE pid = $1', contender)
      if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers.includes(holder)) return
    }
    await new Promise(done => setTimeout(done, 10))
  }
  throw new Error('PM_APPROVAL_ROW_LOCK_OVERLAP_NOT_OBSERVED')
}
