// @req TASK-ZAI-011 — approval notices are durable, recipient-only, and read-idempotent.
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { createAgentApprovalRequest, decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'
import { defaultWriteTools } from '@/modules/agent/write-tools'
import { generateSessionToken, hashSessionToken } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import {
  listAgentApprovalNotifications,
  markAgentApprovalNotificationRead,
} from '@/modules/agent/approval-notifications'

vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return request.__viewer
  },
}))

const { GET: getNotifications } = await import('@/app/api/agent/approval-notifications/route')
const { POST: postReadAcknowledgement } = await import('@/app/api/agent/approval-notifications/[id]/route')

const SESSION_SECRET = 'approval-notification-csrf-secret-long-enough-0123456789'
const APP_ORIGIN = 'http://local'
const sessionIds = []

function viewer(personId) {
  return { principal: { id: personId } }
}

function requestWithViewer(url, personId) {
  const request = new Request(url)
  request.__viewer = viewer(personId)
  return request
}

async function requestWithCsrf(url, personId) {
  const sessionId = randomUUID()
  const cookie = generateSessionToken(personId, { secret: SESSION_SECRET, sessionId })
  await prisma.session.create({
    data: {
      id: sessionId,
      personId,
      tokenHash: hashSessionToken(cookie),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    },
  })
  sessionIds.push(sessionId)

  const headers = new Headers({ cookie: `zuri_session=${cookie}`, origin: APP_ORIGIN })
  const tokenRequest = new Request(url, { method: 'POST', headers })
  const session = await createSessionPort().read(tokenRequest)
  headers.set('x-csrf-token', issueApiWriteCsrfToken({ request: tokenRequest, session }).token)
  const request = new Request(url, { method: 'POST', headers })
  request.__viewer = viewer(personId)
  return request
}

async function createFixture(ownerCount = 3) {
  const suffix = randomUUID().slice(0, 8).toUpperCase()
  const portfolio = await createPortfolio({ name: `Approval notices ${suffix}`, code: `PF-AN-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: `Approval notices ${suffix}`, code: `TNT-AN-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: `Approval notices ${suffix}`, code: `BUS-AN-${suffix}` })
  const requester = await prisma.person.create({ data: { code: `PSN-AN-R-${suffix}`, displayName: `Requester ${suffix}` } })
  await prisma.membership.create({
    data: { personId: requester.id, tenantId: tenant.id, scopeType: 'TENANT', role: 'MANAGER' },
  })
  const requesterIdentity = await prisma.externalIdentity.create({
    data: {
      tenantId: tenant.id,
      personId: requester.id,
      provider: 'LINE',
      providerSubject: `U-AN-R-${suffix}`,
    },
  })
  const target = await ingestLineMessage({
    tenantId: tenant.id,
    businessId: business.id,
    lineUserId: `U-AN-C-${suffix}`,
    threadId: `T-AN-${suffix}`,
    text: 'approval notification fixture',
  })
  const owners = []
  for (let index = 0; index < ownerCount; index += 1) {
    const person = await prisma.person.create({
      data: { code: `PSN-AN-O${index}-${suffix}`, displayName: `Owner ${index} ${suffix}` },
    })
    await prisma.membership.create({
      data: {
        personId: person.id,
        tenantId: tenant.id,
        businessId: business.id,
        scopeType: 'BUSINESS',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    })
    owners.push(person)
  }
  const action = defaultWriteTools().get('set_customer_lifecycle')
  const approvalRequest = await prisma.$transaction((tx) => createAgentApprovalRequest(tx, {
    tenantId: tenant.id,
    requesterPersonId: requester.id,
    requesterExternalIdentityId: requesterIdentity.id,
    action,
    target: { customerId: target.customerId },
    payload: { lifecycleStage: 'ACTIVE' },
  }))
  return { tenant, business, requester, owners, approvalRequest }
}

function withOneNotificationWriteFailure(db) {
  let failed = false
  return new Proxy(db, {
    get(target, property) {
      if (property === '$transaction') {
        return (callback, ...options) => target.$transaction((tx) => callback(new Proxy(tx, {
          get(txTarget, txProperty) {
            if (txProperty !== 'agentApprovalNotification') return Reflect.get(txTarget, txProperty, txTarget)
            const model = Reflect.get(txTarget, txProperty, txTarget)
            return new Proxy(model, {
              get(modelTarget, method) {
                if (method === 'create') return async (args) => {
                  if (!failed) {
                    failed = true
                    throw new Error('TEST_NOTIFICATION_WRITE_FAILURE')
                  }
                  return modelTarget.create(args)
                }
                const value = Reflect.get(modelTarget, method, modelTarget)
                return typeof value === 'function' ? value.bind(modelTarget) : value
              },
            })
          },
        })), ...options)
      }
      return Reflect.get(target, property, target)
    },
  })
}

describe('Agent approval notifications (TASK-ZAI-011)', () => {
  beforeAll(() => {
    vi.stubEnv('ZURI_SESSION_SECRET', SESSION_SECRET)
    vi.stubEnv('PUBLIC_BASE_URL', APP_ORIGIN)
  })

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } })
    vi.unstubAllEnvs()
  })

  it('notifies the requester and unvoted same-Business owners at each quorum step', async () => {
    const { requester, owners, approvalRequest } = await createFixture(3)
    const [first, second, remaining] = owners

    const firstVote = await decideAgentApprovalRequest(prisma, {
      requestId: approvalRequest.id, personId: first.id, decision: 'APPROVE',
    })
    expect(firstVote.request.status).toBe('PENDING')
    const firstNotices = await prisma.agentApprovalNotification.findMany({
      where: { decisionId: firstVote.decision.id }, orderBy: { recipientPersonId: 'asc' },
    })
    expect(firstNotices.map(({ recipientPersonId, notificationType, approvalStatus }) => ({ recipientPersonId, notificationType, approvalStatus })))
      .toEqual(expect.arrayContaining([
        { recipientPersonId: requester.id, notificationType: 'REQUESTER_OUTCOME', approvalStatus: 'PENDING' },
        { recipientPersonId: second.id, notificationType: 'OWNER_NEXT_ACTION', approvalStatus: 'PENDING' },
        { recipientPersonId: remaining.id, notificationType: 'OWNER_NEXT_ACTION', approvalStatus: 'PENDING' },
      ]))
    expect(firstNotices).toHaveLength(3)
    expect(firstNotices.some(({ recipientPersonId }) => recipientPersonId === first.id)).toBe(false)

    const secondVote = await decideAgentApprovalRequest(prisma, {
      requestId: approvalRequest.id, personId: second.id, decision: 'APPROVE',
    })
    expect(secondVote.request.status).toBe('APPROVED')
    const requesterRows = await listAgentApprovalNotifications(prisma, { personId: requester.id })
    expect(requesterRows).toHaveLength(2)
    expect(requesterRows.every(({ notificationType }) => notificationType === 'REQUESTER_OUTCOME')).toBe(true)
    const secondNotices = await prisma.agentApprovalNotification.findMany({ where: { decisionId: secondVote.decision.id } })
    expect(secondNotices.map(({ recipientPersonId, notificationType, approvalStatus }) => ({ recipientPersonId, notificationType, approvalStatus })))
      .toEqual(expect.arrayContaining([
        { recipientPersonId: requester.id, notificationType: 'REQUESTER_OUTCOME', approvalStatus: 'APPROVED' },
        { recipientPersonId: remaining.id, notificationType: 'OWNER_OUTCOME', approvalStatus: 'APPROVED' },
      ]))
    expect(secondNotices).toHaveLength(2)
    expect(await prisma.agentApprovalNotification.count({ where: { decisionId: { in: [firstVote.decision.id, secondVote.decision.id] } } }))
      .toBe(5)
  })

  it('filters inbox and acknowledgement by the authenticated recipient and keeps mark-read idempotent', async () => {
    const { owners, requester, approvalRequest } = await createFixture(2)
    const [voter, recipient] = owners
    await decideAgentApprovalRequest(prisma, {
      requestId: approvalRequest.id, personId: voter.id, decision: 'APPROVE',
    })
    const ownRows = await listAgentApprovalNotifications(prisma, { personId: recipient.id })
    const notice = ownRows.find(({ approvalRequestId }) => approvalRequestId === approvalRequest.id)
    expect(notice).toBeTruthy()

    const emptyForOther = await getNotifications(requestWithViewer('http://local/api/agent/approval-notifications', voter.id))
    expect(emptyForOther.status).toBe(200)
    expect((await emptyForOther.json()).notifications.some(({ id }) => id === notice.id)).toBe(false)

    const outsider = await prisma.person.create({
      data: { code: `PSN-AN-X-${randomUUID().slice(0, 8).toUpperCase()}`, displayName: 'Unrelated person' },
    })
    const firstAck = await postReadAcknowledgement(
      await requestWithCsrf(`http://local/api/agent/approval-notifications/${notice.id}`, recipient.id),
      { params: { id: notice.id } },
    )
    expect(firstAck.status).toBe(200)
    const firstRow = (await firstAck.json()).notification
    expect(firstRow.readAt).toBeTruthy()

    const repeatedAck = await postReadAcknowledgement(
      await requestWithCsrf(`http://local/api/agent/approval-notifications/${notice.id}`, recipient.id),
      { params: { id: notice.id } },
    )
    expect(repeatedAck.status).toBe(200)
    expect((await repeatedAck.json()).notification.readAt).toBe(firstRow.readAt)

    const foreignAck = await postReadAcknowledgement(
      await requestWithCsrf(`http://local/api/agent/approval-notifications/${notice.id}`, outsider.id),
      { params: { id: notice.id } },
    )
    expect(foreignAck.status).toBe(404)
    expect((await markAgentApprovalNotificationRead(prisma, { notificationId: notice.id, personId: recipient.id })).readAt)
      .toEqual(new Date(firstRow.readAt))
  })

  it('rolls back a vote when notification persistence fails and retries without duplicates', async () => {
    const { requester, owners, approvalRequest } = await createFixture(2)
    const failing = withOneNotificationWriteFailure(prisma)
    await expect(decideAgentApprovalRequest(failing, {
      requestId: approvalRequest.id, personId: owners[0].id, decision: 'APPROVE',
    })).rejects.toThrow('TEST_NOTIFICATION_WRITE_FAILURE')

    expect((await prisma.agentApprovalRequest.findUnique({ where: { id: approvalRequest.id } })).status).toBe('PENDING')
    expect(await prisma.agentApprovalDecision.count({ where: { requestId: approvalRequest.id } })).toBe(0)
    expect(await prisma.agentApprovalNotification.count({ where: { approvalRequestId: approvalRequest.id } })).toBe(0)

    const retried = await decideAgentApprovalRequest(prisma, {
      requestId: approvalRequest.id, personId: owners[0].id, decision: 'APPROVE',
    })
    expect(retried.decision.personId).toBe(owners[0].id)
    expect(await prisma.agentApprovalDecision.count({ where: { requestId: approvalRequest.id } })).toBe(1)
    const notifications = await prisma.agentApprovalNotification.findMany({ where: { approvalRequestId: approvalRequest.id } })
    expect(notifications.map(({ recipientPersonId }) => recipientPersonId).sort()).toEqual([requester.id, owners[1].id].sort())
    expect(new Set(notifications.map(({ decisionId, recipientPersonId }) => `${decisionId}:${recipientPersonId}`)).size)
      .toBe(notifications.length)
  })
})
