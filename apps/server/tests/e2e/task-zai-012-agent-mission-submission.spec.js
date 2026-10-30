const { test, expect } = require('@playwright/test')
const { createHash, randomUUID } = require('node:crypto')
const { loginAsOwner } = require('./e2e-auth')

// TASK-ZAI-012's first HTTP acceptance on the integrated disposable SQLite.
// Source rows mimic only the persisted AgentMissionDraft + MISSION_DRAFT_CREATED
// + CONTEXT_COMMITTED contract; no provider or live LINE runtime is involved.
let prisma
let business
let ownerPersonId
let stream
let alternateStream
let origin
let api
let csrfToken
let runId

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function createVerifiedDraft({ title, customerForErasure = false } = {}) {
  const sourcePerson = await prisma.person.create({ data: {
    code: `MISSION-E2E-${randomUUID()}`,
    displayName: 'Disposable Agent source subject',
  } })
  const missionId = `mission-${randomUUID()}`
  const draftId = randomUUID()
  const sourceTurnId = `turn-${randomUUID()}`
  const executionId = `execution-${randomUUID()}`
  const sourceEventId = randomUUID()
  const sourceTraceEventId = randomUUID()
  const scope = {
    tenantId: business.tenantId,
    businessId: business.id,
    workspaceId: (await prisma.project.findUnique({ where: { id: stream.projectId }, select: { workspaceId: true } })).workspaceId,
    projectId: stream.projectId,
    workstreamId: stream.id,
  }
  const content = { title: title || `HTTP mission ${runId}`, summary: 'Disposable verified mission draft for PM intake.' }
  const digest = createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex')
  const eventPayload = {
    schemaVersion: 'agent-mission-draft-event.v1',
    eventType: 'MISSION_DRAFT_CREATED',
    missionId,
    draftId,
    revision: 1,
    sourceAgentRef: 'zuri-line-agent',
    sourceTurnId,
    executionId,
    sourceTraceEventId,
    actorPersonId: sourcePerson.id,
    scope,
    digest,
  }
  await prisma.$transaction(async tx => {
    await tx.agentTraceEvent.create({ data: {
      id: sourceTraceEventId,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      turnId: sourceTurnId,
      executionId,
      kind: 'CONTEXT_COMMITTED',
      idempotencyKey: `mission-http-e2e:${runId}:${sourceTraceEventId}`,
      payloadJson: canonicalJson({ contractVersion: '2', kind: 'CONTEXT_COMMITTED' }),
      occurredAt: new Date(),
    } })
    await tx.auditEvent.create({ data: {
      id: sourceEventId,
      entityType: 'AGENT_MISSION_DRAFT',
      entityId: missionId,
      action: 'MISSION_DRAFT_CREATED',
      actorType: 'LINE_USER',
      actorId: sourcePerson.id,
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      requestId: sourceTurnId,
      payloadJson: canonicalJson(eventPayload),
    } })
    await tx.agentMissionDraft.create({ data: {
      id: draftId,
      schemaVersion: 'agent-mission-draft.v1',
      sourceAgentRef: 'zuri-line-agent',
      missionId,
      revision: 1,
      ...scope,
      actorPersonId: sourcePerson.id,
      sourceTurnId,
      executionId,
      sourceEventId,
      sourceTraceEventId,
      digest,
      snapshotJson: canonicalJson(content),
      status: 'ACTIVE',
      version: 1,
    } })
  })

  let customerId = null
  if (customerForErasure) {
    await prisma.channelIdentity.create({ data: {
      personId: sourcePerson.id,
      tenantId: business.tenantId,
      channel: 'LINE',
      channelAccountId: `mission-e2e-account-${runId}`,
      providerSubject: `mission-e2e-subject-${randomUUID()}`,
      status: 'VERIFIED',
      verifiedAt: new Date(),
      linkedAt: new Date(),
    } })
    const customer = await prisma.customer.create({ data: {
      code: `MISSION-ERASURE-${randomUUID()}`,
      tenantId: business.tenantId,
      businessId: business.id,
      personId: sourcePerson.id,
      displayName: 'Disposable source subject',
    } })
    customerId = customer.id
  }
  return { missionId, draftId, revision: 1, digest, content, customerId }
}

async function postMission(draft, workstreamId = stream.id, overrides = {}, extraHeaders = {}) {
  return api.post('/api/work/agent-mission-submissions', {
    headers: { Origin: origin, 'x-csrf-token': csrfToken, ...extraHeaders },
    data: {
      missionId: draft.missionId,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      workstreamId,
      ...overrides,
    },
  })
}

test.beforeAll(async () => {
  runId = randomUUID().slice(0, 8)
  const port = Number(process.env.E2E_PORT || 3100)
  process.env.DATABASE_URL = `file:./e2e-${port}.db`
  const { PrismaClient } = require('@prisma/client')
  prisma = new PrismaClient()
  business = await prisma.business.findUnique({ where: { code: 'BUS-001' } })
  if (!business) throw new Error('Disposable E2E seed lacks BUS-001')
  const owner = await prisma.membership.findFirst({
    where: { businessId: business.id, role: 'OWNER', status: 'ACTIVE' },
    select: { personId: true },
  })
  if (!owner) throw new Error('Disposable E2E seed lacks a Business 01 owner')
  ownerPersonId = owner.personId
  const projects = await prisma.project.findMany({ where: { businessId: business.id }, select: { id: true } })
  const streams = await prisma.workstream.findMany({
    where: { projectId: { in: projects.map(project => project.id) }, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  if (!streams.length) throw new Error('Disposable E2E seed lacks an owned Workstream')
  stream = streams[0]
  alternateStream = streams.find(row => row.id !== stream.id) || null
  if (!alternateStream) {
    alternateStream = await prisma.workstream.create({ data: {
      code: `MISSION-E2E-${runId}`,
      projectId: stream.projectId,
      name: `Mission scope probe ${runId}`,
      executionMode: stream.executionMode,
      progressStrategy: stream.progressStrategy,
      status: 'PLANNED',
    } })
  }
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

test('authenticated HTTP intake creates one PLANNED WorkItem and refuses invalid source or scope', async ({ page, browser }) => {
  await loginAsOwner(page)
  origin = new URL(page.url()).origin
  api = page.context().request
  const csrfResponse = await api.get('/api/auth/csrf', { headers: { Origin: origin } })
  expect(csrfResponse.status()).toBe(200)
  csrfToken = (await csrfResponse.json()).token
  expect(typeof csrfToken).toBe('string')

  const valid = await createVerifiedDraft()
  const before = await prisma.workItem.count({ where: { workstreamId: stream.id } })
  const firstResponse = await postMission(valid)
  expect(firstResponse.status()).toBe(200)
  const first = await firstResponse.json()
  expect(first.replayed).toBe(false)
  expect(first.workItem).toMatchObject({ title: valid.content.title, subtype: 'TASK', status: 'PLANNED', assigneeRef: null })
  expect(first.evidence).toMatchObject({ sourceMissionId: valid.missionId, sourceRevision: 1, sourceDigest: valid.digest, workItemId: first.workItem.id })
  expect(await prisma.auditEvent.findFirst({ where: {
    entityType: 'WORK_ITEM', entityId: first.workItem.id, action: 'MISSION_SUBMITTED',
  } })).toMatchObject({ actorType: 'LOCAL_USER', actorId: ownerPersonId })
  expect(await prisma.workItem.count({ where: { workstreamId: stream.id } })).toBe(before + 1)

  const replayResponse = await postMission(valid)
  expect(replayResponse.status()).toBe(200)
  const replay = await replayResponse.json()
  expect(replay.replayed).toBe(true)
  expect(replay.workItem.id).toBe(first.workItem.id)
  expect(replay.evidence.evidenceId || replay.evidence.id).toBe(first.evidence.evidenceId || first.evidence.id)
  expect(await prisma.workItem.count({ where: { workstreamId: stream.id } })).toBe(before + 1)

  const anonymous = await browser.newContext()
  try {
    const unauthenticated = await anonymous.request.post(`${origin}/api/work/agent-mission-submissions`, {
      headers: { Origin: origin },
      data: { missionId: valid.missionId, expectedRevision: 1, expectedDigest: valid.digest, workstreamId: stream.id },
    })
    expect(unauthenticated.status()).toBe(401)
  } finally {
    await anonymous.close()
  }

  const wrongOrigin = await postMission(await createVerifiedDraft({ title: `Origin refusal ${runId}` }), stream.id, {}, { Origin: 'https://invalid.example' })
  expect(wrongOrigin.status()).toBe(403)

  const wrongScopeDraft = await createVerifiedDraft({ title: `Scope refusal ${runId}` })
  const wrongScope = await postMission(wrongScopeDraft, alternateStream.id)
  expect(wrongScope.status()).toBe(409)
  expect(await prisma.agentMissionEvidence.count({ where: { missionId: wrongScopeDraft.missionId } })).toBe(0)

  const stale = await createVerifiedDraft({ title: `Stale source ${runId}` })
  const staleRevision = await postMission(stale, stream.id, { expectedRevision: 2 })
  expect(staleRevision.status()).toBe(409)
  const staleDigest = await postMission(stale, stream.id, { expectedDigest: '0'.repeat(64) })
  expect(staleDigest.status()).toBe(409)
  expect(await prisma.agentMissionEvidence.count({ where: { missionId: stale.missionId } })).toBe(0)

  const revoked = await createVerifiedDraft({ title: `Revoked source ${runId}` })
  await prisma.agentMissionDraft.update({ where: { id: revoked.draftId }, data: { status: 'REVOKED', revokedAt: new Date() } })
  const revokedResponse = await postMission(revoked)
  expect(revokedResponse.status()).toBe(409)
  expect(await prisma.agentMissionEvidence.count({ where: { missionId: revoked.missionId } })).toBe(0)

  const erased = await createVerifiedDraft({ title: `Erased source ${runId}`, customerForErasure: true })
  const erasureResponse = await api.post(`/api/crm/customers/${erased.customerId}/erasure`, {
    headers: { Origin: origin, 'x-csrf-token': csrfToken },
    data: { businessId: business.id, confirmation: 'ERASE' },
  })
  expect(erasureResponse.status()).toBe(200)
  const erasedRow = await prisma.agentMissionDraft.findUnique({ where: { id: erased.draftId } })
  expect(erasedRow).toMatchObject({ status: 'ERASED', missionId: null, erasedAt: expect.any(Date) })
  const erasedResponse = await postMission(erased)
  expect(erasedResponse.status()).toBe(409)
  expect(await prisma.agentMissionEvidence.count({ where: { draftId: erased.draftId } })).toBe(0)
})
