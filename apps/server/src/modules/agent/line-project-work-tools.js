// @req FR-085 — held Work mutations are domain refusals, not infrastructure retries.
// @tested tests/integration/line-project-work-tools.test.js
import { withPipelineTransaction } from '@/modules/project-manager/application/pipeline-transaction'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { findChannelIdentity, channelIdentityIsVerified } from '@/modules/identity/channel-identity'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { authorizeAgentAction } from './action-gate'
import { createItem, updateItem } from '@/modules/project-manager/application/work-service'
import { assertWorkstreamWritable } from '@/modules/project-manager/application/project-authorization'
import { activeWorkstream } from '@/modules/project-manager/application/active-filters'
import { zWorkStatus } from '@/lib/validation/enums'
import { createMissionDraftPort } from './mission-draft'
import { DEFAULT_AGENT_ID, resolveAgentAuthorization } from './auth-context'
import { canonicalJson } from './execution-trace'

// @req FR-026, FR-072, FR-150 — scoped Project/Work reads and confirmation-gated LINE writes.
// @spec SEC-001, SEC-008, ADR-061 — identity comes from the durable signed-inbound job;
// canonical PM writers own mutations. Confirmation, write, and receipt share one transaction.
// @tested tests/integration/line-project-work-tools.test.js

const patchSchema = z.object({ title: z.string().trim().min(1).max(240).optional(), status: zWorkStatus.optional() }).strict()
  .refine(value => Object.keys(value).length > 0)
const createSchema = z.object({ title: z.string().trim().min(1).max(240) }).strict()
const idSchema = z.string().uuid()
const ttlMs = 5 * 60 * 1000
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const receiptId = proposalId => `line-work-executed:${proposalId}`
const fail = code => { throw Object.assign(new Error(code), { code }) }
const clock = now => new Date(typeof now === 'function' ? now() : now ?? Date.now())
const missionSchema = z.object({ title: z.string().trim().min(1).max(240), summary: z.string().trim().min(1).max(4096) }).strict()

// This seam is server-only. Never accept a job body, actor, viewer, or scope from an LLM.
async function contextFor(jobId, db, now, expectedClaim) {
  const job = await db.lineConversationJob.findUnique({ where: { id: jobId },
    include: { account: true, inbound: { include: { conversation: true } } } })
  const convo = job?.inbound?.conversation
  if (!job || job.audienceKind !== 'DIRECT' || job.recipientId !== job.sourceUserId
    || !convo || convo.channel !== 'LINE' || convo.tenantId !== job.tenantId
    || convo.businessId !== job.businessId || convo.channelAccountId !== job.channelAccountId
    || job.account.tenantId !== job.tenantId || job.account.businessId !== job.businessId
    || !job.account.serverEnabled || job.account.transportMode !== 'CLOUD' || job.account.status !== 'CONNECTED'
    // Admission uses the account id when a legacy row has no binding code;
    // apply the same effective-key rule here or every such job is denied after
    // admission, including a verified channel identity.
    || (job.account.bindingCode || job.account.id) !== job.channelAccountId || job.status !== 'CLAIMED' || !job.leaseExpiresAt || new Date(job.leaseExpiresAt).getTime() <= now.getTime()
    || new Date(job.expiresAt).getTime() <= now.getTime()
    || job.account.transportEpoch !== job.transportEpoch || job.errorCode === 'PDPA_ERASURE') fail('WORK_SCOPE_DENIED')
  const expectedMode = expectedClaim?.executionMode ?? (expectedClaim?.credentialId ? 'EDGE' : 'CONVERSATION_RUNTIME')
  const expectedClaimant = expectedClaim?.claimantId ?? expectedClaim?.credentialId
  if (expectedClaim && (job.executionMode !== expectedMode || job.version !== expectedClaim.version
    || job.executionId !== expectedClaim.executionId || job.claimantId !== expectedClaimant
    || job.tenantId !== expectedClaim.tenantId || job.businessId !== expectedClaim.businessId)) fail('WORK_CLAIM_STALE')
  const identity = await findChannelIdentity({ db, tenantId: job.tenantId,
    channelAccountId: job.channelAccountId, providerSubject: job.sourceUserId })
  if (!channelIdentityIsVerified(identity)) fail('WORK_IDENTITY_REQUIRED')
  const viewer = await resolveViewer({ principalId: identity.personId, db, now: now.getTime() })
  if (!viewer.visibleBusinessIds.includes(job.businessId)
    || !viewer.domainsByBusinessId[job.businessId]?.includes('projects')) fail('WORK_SCOPE_DENIED')
  return { job, viewer, binding: { tenantId: job.tenantId, businessId: job.businessId,
    accountId: job.accountId, channelAccountId: job.channelAccountId, transportEpoch: job.transportEpoch,
    conversationId: convo.id, actorId: identity.personId, identityId: identity.id,
    identityVersion: identity.version, identityLinkedAt: identity.linkedAt.toISOString() } }
}

function assertWrite(context) {
  const { viewer, binding } = context
  const decision = authorizeAgentAction({
    principal: { personId: binding.actorId, principalType: 'STAFF', isStaff: true,
      roles: ownsBusiness(viewer, binding.businessId) ? ['OWNER'] : [] },
    action: { name: 'confirmed_work_mutation', sensitivity: 'LOW', allowRoles: ['OWNER'] },
    policyDecision: { allowed: ownsBusiness(viewer, binding.businessId), reason: 'Project write requires Business ownership' },
  })
  if (!decision.allowed) fail('WORK_SCOPE_DENIED')
}

async function targetFor(context, action, targetId, db) {
  const item = action === 'update_work' ? await db.workItem.findFirst({ where: { id: targetId, deletedAt: null } }) : null
  if (action === 'update_work' && !item) fail('WORK_TARGET_NOT_FOUND')
  const stream = await assertWorkstreamWritable(context.viewer, item?.workstreamId ?? targetId, { db })
  const project = await db.project.findUnique({ where: { id: stream.projectId } })
  if (project?.businessId !== context.binding.businessId || project.deletedAt) fail('WORK_TARGET_NOT_FOUND')
  return { version: item?.version ?? stream.version, workstreamId: stream.id, projectId: project.id,
    projectVersion: project.version, workstreamVersion: stream.version, title: item?.title ?? stream.name }
}

async function uniqueMissionScopeFor(context, db) {
  const streams = await db.workstream.findMany({
    where: { ...activeWorkstream(), project: { businessId: context.binding.businessId, deletedAt: null } },
    select: { id: true }, take: 2,
  })
  if (streams.length !== 1) fail('MISSION_SCOPE_INVALID')
  const target = await targetFor(context, 'create_work', streams[0].id, db)
  const project = await db.project.findUnique({ where: { id: target.projectId },
    select: { id: true, workspaceId: true, businessId: true, deletedAt: true } })
  if (!project || project.deletedAt || project.businessId !== context.binding.businessId) fail('MISSION_SCOPE_INVALID')
  return Object.freeze({
    tenantId: context.binding.tenantId,
    businessId: context.binding.businessId,
    workspaceId: project.workspaceId,
    projectId: project.id,
    workstreamId: target.workstreamId,
  })
}

function missionDraftRowFromDatabase(row) {
  if (!row) return null
  let content
  try { content = JSON.parse(row.snapshotJson) } catch { return null }
  return {
    draftId: row.id, missionId: row.missionId, revision: row.revision,
    schemaVersion: row.schemaVersion, tenantId: row.tenantId, businessId: row.businessId,
    workspaceId: row.workspaceId, projectId: row.projectId, workstreamId: row.workstreamId,
    scope: { tenantId: row.tenantId, businessId: row.businessId, workspaceId: row.workspaceId,
      projectId: row.projectId, workstreamId: row.workstreamId },
    sourceAgentRef: row.sourceAgentRef, actorPersonId: row.actorPersonId,
    sourceTurnId: row.sourceTurnId, executionId: row.executionId,
    sourceEventId: row.sourceEventId, sourceTraceEventId: row.sourceTraceEventId,
    digest: row.digest, content, status: row.status, createdAt: row.createdAt, version: row.version,
  }
}

function createLineMissionDraftRepository({ db, jobId, expectedClaim, at, authorization }) {
  const resolveCurrentAgentTurn = async (tx, { turnId, executionId, authClaims }) => {
    const context = await contextFor(jobId, tx, at, expectedClaim)
    assertWrite(context)
    const scope = await uniqueMissionScopeFor(context, tx)
    if (turnId !== context.job.id || executionId !== context.job.executionId
      || authClaims.sourceAgentRef !== DEFAULT_AGENT_ID
      || authClaims.actorPersonId !== context.binding.actorId
      || authClaims.tenantId !== context.binding.tenantId
      || authClaims.businessId !== context.binding.businessId
      || authClaims.workspaceId !== scope.workspaceId || authClaims.projectId !== scope.projectId
      || authorization?.authContext?.request?.agentId !== DEFAULT_AGENT_ID
      || authorization?.authContext?.actor?.principalId !== context.binding.actorId) fail('MISSION_SOURCE_UNAVAILABLE')
    const trace = await tx.agentTraceEvent.findFirst({
      where: { tenantId: context.binding.tenantId, businessId: context.binding.businessId,
        turnId: context.job.id, executionId: context.job.executionId, kind: 'CONTEXT_COMMITTED' },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, tenantId: true, businessId: true, turnId: true, executionId: true },
    })
    if (!trace || trace.turnId !== turnId || trace.executionId !== executionId
      || trace.tenantId !== scope.tenantId || trace.businessId !== scope.businessId) fail('MISSION_SOURCE_UNAVAILABLE')
    return {
      status: 'verified', agentVerified: true, turnExecutionVerified: true,
      traceLinked: true, scopeVerified: true, sourceAgentRef: DEFAULT_AGENT_ID,
      actorPersonId: context.binding.actorId, sourceTurnId: turnId, executionId,
      sourceTraceEventId: trace.id, scope,
    }
  }
  const sourceWhere = identity => ({
    tenantId: identity.tenantId, businessId: identity.businessId,
    sourceAgentRef: identity.sourceAgentRef, sourceTurnId: identity.sourceTurnId,
    executionId: identity.executionId,
  })
  const insertDraft = async (tx, row) => missionDraftRowFromDatabase(await tx.agentMissionDraft.create({ data: {
    id: row.draftId, schemaVersion: row.schemaVersion, missionId: row.missionId, revision: row.revision,
    tenantId: row.tenantId, businessId: row.businessId, workspaceId: row.workspaceId,
    projectId: row.projectId, workstreamId: row.workstreamId, sourceAgentRef: row.sourceAgentRef,
    actorPersonId: row.actorPersonId, sourceTurnId: row.sourceTurnId, executionId: row.executionId,
    sourceEventId: row.sourceEventId, sourceTraceEventId: row.sourceTraceEventId,
    digest: row.digest, snapshotJson: canonicalJson(row.content), status: row.status,
    createdAt: row.createdAt, version: row.version,
  } }))
  return {
    resolveAuthorizedMissionDraft: async () => ({ status: 'unavailable' }),
    transaction: callback => withPipelineTransaction(db, callback, { isolationLevel: 'Serializable' }),
    async findMissionDraftBySource(identity) {
      return missionDraftRowFromDatabase(await db.agentMissionDraft.findFirst({ where: sourceWhere(identity) }))
    },
    forTransaction(tx) {
      return {
        resolveCurrentAgentTurn: input => resolveCurrentAgentTurn(tx, input),
        async findMissionDraftBySource(identity) {
          return missionDraftRowFromDatabase(await tx.agentMissionDraft.findFirst({ where: sourceWhere(identity) }))
        },
        insertMissionDraft: row => insertDraft(tx, row),
      }
    },
  }
}

/** Persist a source-only mission draft for the active verified LINE OWNER turn.
 * It does not create a WorkItem or treat the LINE actor as an Agent principal.
 */
export async function createLineMissionDraft(jobId, mission, {
  db = prisma, now, expectedClaim, authorizationResolver = resolveAgentAuthorization,
} = {}) {
  if (!expectedClaim) fail('WORK_CLAIM_STALE')
  const at = clock(now)
  const normalizedMission = missionSchema.strict().parse(mission)
  const context = await contextFor(jobId, db, at, expectedClaim)
  assertWrite(context)
  const scope = await uniqueMissionScopeFor(context, db)
  const authorization = await authorizationResolver({
    tenantId: context.binding.tenantId, businessId: context.binding.businessId,
    lineUserId: context.job.sourceUserId,
    serverScope: {
      agentId: DEFAULT_AGENT_ID, transportVerified: true,
      channelAccountId: context.binding.channelAccountId, audienceKind: context.job.audienceKind,
      workspaceId: scope.workspaceId, projectId: scope.projectId,
    },
  })
  const repository = createLineMissionDraftRepository({ db, jobId, expectedClaim, at, authorization })
  const port = createMissionDraftPort({ repository, now: () => at })
  return port.createMissionDraftFromTurn({
    authorization, turnId: context.job.id, executionId: context.job.executionId, mission: normalizedMission,
  })
}

export async function searchLineProjectWork(jobId, { kind = 'work', query = '' } = {}, { db = prisma, now, expectedClaim } = {}) {
  const context = await contextFor(jobId, db, clock(now), expectedClaim)
  const q = z.string().max(120).parse(query).trim()
  const projectWhere = { businessId: context.binding.businessId, deletedAt: null }
  const rows = kind === 'projects'
    ? await db.project.findMany({ where: { ...projectWhere, ...(q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : {}) },
      select: { id: true, code: true, name: true, status: true, version: true, workstreams: { where: activeWorkstream(), take: 5, select: { id: true, name: true } } }, orderBy: { updatedAt: 'desc' }, take: 11 })
    : await db.workItem.findMany({ where: { deletedAt: null, workstream: { ...activeWorkstream(), project: projectWhere },
      ...(q ? { OR: [{ title: { contains: q } }, { code: { contains: q } }] } : {}) },
      select: { id: true, code: true, title: true, status: true, version: true, workstreamId: true }, orderBy: { updatedAt: 'desc' }, take: 11 })
  return { source: 'PROJECT_MANAGER', observedAt: clock(now).toISOString(),
    items: rows.slice(0, 10).map(item => ({ ...item, sourceRef: item.id })), truncated: rows.length > 10, limit: 10 }
}

export async function proposeLineWork(jobId, { action, targetId, args }, { db = prisma, now, expectedClaim } = {}) {
  const at = clock(now)
  idSchema.parse(targetId)
  if (!['create_work', 'update_work'].includes(action)) fail('WORK_ACTION_DENIED')
  const payload = (action === 'create_work' ? createSchema : patchSchema).parse(args)
  return withPipelineTransaction(db, async tx => {
    const context = await contextFor(jobId, tx, at, expectedClaim)
    assertWrite(context)
    const target = await targetFor(context, action, targetId, tx)
    const proposal = { ...context.binding, action, targetId, target, args: payload, argsHash: digest(payload),
      idempotencyKey: jobId, expiresAt: new Date(at.getTime() + ttlMs).toISOString() }
    // One proposal per durable inbound: worker retries return the same exact preview.
    const existing = await tx.auditEvent.findUnique({ where: { id: jobId } })
    if (existing) {
      if (existing.entityType !== 'LINE_WORK_PROPOSAL' || existing.actorId !== context.binding.actorId) fail('WORK_PROPOSAL_CONFLICT')
      const saved = JSON.parse(existing.payloadJson)
      if (saved.action !== action || saved.targetId !== targetId || saved.argsHash !== digest(payload)) fail('WORK_PROPOSAL_CONFLICT')
      return { proposalId: existing.id, preview: saved }
    }
    await tx.auditEvent.create({ data: { id: jobId, entityType: 'LINE_WORK_PROPOSAL', entityId: targetId,
      action: 'PROPOSED', actorType: 'AGENT', actorId: context.binding.actorId,
      tenantId: context.binding.tenantId, businessId: context.binding.businessId,
      requestId: jobId, sessionId: context.job.sessionId, payloadJson: JSON.stringify(proposal) } })
    return { proposalId: jobId, preview: proposal }
  }, { isolationLevel: 'Serializable' })
}

export async function confirmLineWork(jobId, proposalId, { db = prisma, now, expectedClaim } = {}) {
  idSchema.parse(proposalId)
  return withPipelineTransaction(db, async tx => {
    const context = await contextFor(jobId, tx, clock(now), expectedClaim)
    // Only explicit human text in a new signed inbound can consume a proposal;
    // models cannot manufacture confirmation by calling this function.
    if (context.job.inbound.body.trim() !== `ยืนยันงาน ${proposalId}` || jobId === proposalId) fail('WORK_CONFIRMATION_REQUIRED')
    assertWrite(context)
    const event = await tx.auditEvent.findUnique({ where: { id: proposalId } })
    if (!event || event.entityType !== 'LINE_WORK_PROPOSAL') fail('WORK_CONFIRMATION_INVALID')
    const proposal = JSON.parse(event.payloadJson)
    for (const [key, value] of Object.entries(context.binding)) if (proposal[key] !== value) fail('WORK_CONFIRMATION_INVALID')
    if (proposal.argsHash !== digest(proposal.args)) fail('WORK_CONFIRMATION_INVALID')
    const existing = await tx.auditEvent.findUnique({ where: { id: receiptId(proposalId) } })
    if (existing) {
      const result = await tx.auditEvent.findUnique({ where: { id: `line-work-result:${proposalId}` } })
      if (!result) fail('WORK_RECEIPT_UNAVAILABLE')
      return { ...JSON.parse(result.payloadJson), duplicate: true }
    }
    if (clock(now).getTime() >= Date.parse(proposal.expiresAt)) fail('WORK_CONFIRMATION_EXPIRED')
    const target = await targetFor(context, proposal.action, proposal.targetId, tx)
    if (digest(target) !== digest(proposal.target)) fail('WORK_VERSION_CONFLICT')
    // Unique receipt PK is acquired BEFORE the canonical write. Concurrent duplicate
    // confirmations cannot both commit, and a failed write rolls back this claim.
    await tx.auditEvent.create({ data: { id: receiptId(proposalId), entityType: 'AGENT_ACTION',
      entityId: proposalId, action: 'CONFIRMED', actorType: 'LINE_USER', actorId: context.binding.actorId,
      tenantId: context.binding.tenantId, businessId: context.binding.businessId, requestId: jobId,
      payloadJson: JSON.stringify({ proposalId, action: proposal.action, argsHash: proposal.argsHash }) } })
    const result = proposal.action === 'create_work'
      ? await createItem({ ...proposal.args, subtype: 'TASK', workstreamId: target.workstreamId }, { db: tx, viewer: context.viewer, expectedVersion: target.version })
      : await updateItem(proposal.targetId, proposal.args, { db: tx, viewer: context.viewer, expectedVersion: target.version })
    const receipt = { proposalId, action: proposal.action, itemId: result.id, code: result.code, status: result.status, version: result.version }
    // Keep audit append-only; execution result has its own deterministic id.
    await tx.auditEvent.create({ data: { id: `line-work-result:${proposalId}`, entityType: 'AGENT_ACTION',
      entityId: proposalId, action: 'EXECUTED', actorType: 'AGENT', actorId: context.binding.actorId,
      tenantId: context.binding.tenantId, businessId: context.binding.businessId, requestId: jobId,
      payloadJson: JSON.stringify(receipt) } })
    // Canonical writers await target/code/audit work. Re-resolve authority after
    // that work, inside the same transaction: expiry/revocation rolls everything
    // back, including the unique receipt. A reclaimed job is a different owner.
    const fresh = await contextFor(jobId, tx, clock(now), expectedClaim)
    assertWrite(fresh)
    if (digest(fresh.binding) !== digest(context.binding)) fail('WORK_CONFIRMATION_INVALID')
    if (fresh.job.version !== context.job.version || fresh.job.executionId !== context.job.executionId
      || fresh.job.claimantId !== context.job.claimantId) fail('WORK_CLAIM_STALE')
    const finishedAt = clock(now).getTime()
    if (finishedAt >= Date.parse(proposal.expiresAt)) fail('WORK_CONFIRMATION_EXPIRED')
    if (finishedAt >= new Date(fresh.job.leaseExpiresAt).getTime()
      || finishedAt >= new Date(fresh.job.expiresAt).getTime()) fail('WORK_SCOPE_DENIED')
    return receipt
  }, { isolationLevel: 'Serializable' })
}

export function isLineProjectWorkCommand(text) {
  return typeof text === 'string' && /^(?:\/projects|\/work(?:-create|-update)?|ยืนยันงาน)(?:\s|$)/u.test(text.trim())
}

export function parseLineProjectWorkCommand(text) {
  if (typeof text !== 'string') return null
  const value = text.trim()
  // A literal space after the keyword, as the legacy dispatch in
  // handleLineProjectWorkCommand requires; a tab or newline there gets the usage text.
  const confirmation = value.match(/^ยืนยันงาน \s*(\S+)$/u)
  if (confirmation && idSchema.safeParse(confirmation[1]).success) return { operation: 'confirm-execute', input: { proposalId: confirmation[1] } }
  const mutation = value.match(/^\/work-(create|update)\s+(\S+)\s+([\s\S]+)$/u)
  if (mutation) {
    if (!idSchema.safeParse(mutation[2]).success) return null
    let args
    try { args = mutation[1] === 'create' ? { title: mutation[3] } : JSON.parse(mutation[3]) }
    catch { return null }
    if (!(mutation[1] === 'create' ? createSchema : patchSchema).safeParse(args).success) return null
    return { operation: 'propose', input: { action: `${mutation[1]}_work`, targetId: mutation[2], args } }
  }
  const read = value.match(/^\/(projects|work)(?:\s+([\s\S]*))?$/u)
  if (read && (read[2] ?? '').length <= 120) return { operation: 'read', input: { kind: read[1], query: read[2] ?? '' } }
  return null
}

// @req FR-026, FR-149 — the user-facing Work texts have one source. The legacy
// Server handler below and the Conversation Runtime Core façade
// (conversation-runtime-core.js) both render replies with these functions, so a
// Work command answers the same whichever executor cohort owns the job.
export const LINE_WORK_USAGE_TEXT = 'ใช้ /projects ค้นโครงการ, /work ค้นงาน, /work-create รหัสเวิร์กสตรีม ชื่องาน, /work-update รหัสงาน {"status":"DONE"}'
export const LINE_WORK_DUPLICATE_TEXT = 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ'
const LINE_WORK_ERROR_TEXT = Object.freeze({
  WORK_CONFIRMATION_EXPIRED: 'คำยืนยันหมดอายุ กรุณาสร้างคำขอใหม่',
  WORK_VERSION_CONFLICT: 'งานมีการเปลี่ยนแปลงแล้ว กรุณาตรวจสอบและสร้างคำขอใหม่',
  RELEASE_HELD: 'งานนี้ยังรอหลักฐานรับมอบงานก่อนเริ่มหรือปิดงาน กรุณาตรวจสอบ Handoff ใน Board',
  WORK_ACTION_UNAVAILABLE: 'ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ',
})
// Refusals the Work writers raise about the request itself: its scope, identity,
// target, confirmation or arguments. Anything else (a database, transaction or
// transport failure, a stale claim, a missing receipt) is not in this set.
const LINE_WORK_DOMAIN_CODES = new Set(['WORK_CONFIRMATION_EXPIRED', 'WORK_VERSION_CONFLICT', 'WORK_SCOPE_DENIED',
  'WORK_IDENTITY_REQUIRED', 'WORK_TARGET_NOT_FOUND', 'WORK_ACTION_DENIED', 'WORK_PROPOSAL_CONFLICT',
  'WORK_CONFIRMATION_REQUIRED', 'WORK_CONFIRMATION_INVALID', 'RELEASE_HELD', 'SCOPE_UNAVAILABLE',
  'MISSION_SCOPE_INVALID', 'MISSION_SOURCE_UNAVAILABLE', 'MISSION_SOURCE_CONFLICT', 'MISSION_DRAFT_IDEMPOTENCY_CONFLICT'])
const LINE_WORK_TARGET_MISSING_MESSAGES = new Set(['Work item not found', 'Workstream not found'])

export function lineWorkReadText(result) {
  return result.items.length ? result.items.map(item => `${item.code}: ${item.title ?? item.name} — ${item.status}\n${item.id}${item.workstreams ? item.workstreams.map(s => `\n${s.name}: ${s.id}`).join('') : ''}`).join('\n\n') + (result.truncated ? '\nมีรายการเพิ่มเติม โปรดระบุคำค้น' : '') : 'ไม่พบรายการในธุรกิจที่คุณมีสิทธิ์เข้าถึง'
}

export function lineWorkProposalText(action, preview, proposalId) {
  return `รอยืนยัน ${action === 'create_work' ? 'สร้าง' : 'แก้ไข'}งาน\nเป้าหมาย: ${preview.target.title}\n${JSON.stringify(preview.args)}\nหมดอายุ ${preview.expiresAt}\nพิมพ์ ยืนยันงาน ${proposalId}`
}

export function lineWorkConfirmText(result) {
  return result.duplicate ? LINE_WORK_DUPLICATE_TEXT : `บันทึกงาน ${result.code} แล้ว สถานะ ${result.status}`
}

/** The legacy reply for a failed Work command. No raw database error or private target detail reaches it. */
export function lineWorkErrorReply(error) {
  const cause = error?.code ?? error?.message
  // Preserve the adopted WorkToolPort rejection enum; held-specific wording is
  // presentation, not a new machine code or protocol version.
  const code = ['WORK_CONFIRMATION_EXPIRED', 'WORK_VERSION_CONFLICT'].includes(cause)
    ? cause : 'WORK_ACTION_UNAVAILABLE'
  return { text: LINE_WORK_ERROR_TEXT[cause === 'RELEASE_HELD' ? 'RELEASE_HELD' : code], errorCode: code }
}

/** True for a refusal of the Work request itself, which the legacy handler answers with a fixed text. */
export function isLineWorkDomainError(error) {
  if (error instanceof z.ZodError) return true
  const code = error?.code ?? error?.message
  if (typeof code === 'string' && LINE_WORK_DOMAIN_CODES.has(code)) return true
  // Canonical Project Manager refusals: authorization refusals carry an HTTP status
  // and no code; work-service reports a missing target with these plain messages,
  // thrown before any write. Both are answered as WORK_ACTION_UNAVAILABLE.
  if (error?.code !== undefined) return false
  return [403, 404].includes(error?.status) || LINE_WORK_TARGET_MISSING_MESSAGES.has(error?.message)
}

/**
 * The legacy reply for command text that `parseLineProjectWorkCommand` rejects, or
 * null. It follows the dispatch of handleLineProjectWorkCommand: a confirmation,
 * mutation or read shape reaches a Work call that refuses its input, and any other
 * command text gets the usage text. Pure: no Work call, no database access.
 */
export function lineProjectWorkSyntaxReply(text) {
  if (!isLineProjectWorkCommand(text) || parseLineProjectWorkCommand(text)) return null
  const value = text.trim()
  if (value.startsWith('ยืนยันงาน ') || /^\/work-(create|update)\s+(\S+)\s+([\s\S]+)$/u.test(value)
    || /^\/(projects|work)(?:\s+([\s\S]*))?$/u.test(value)) return lineWorkErrorReply(null)
  return { text: LINE_WORK_USAGE_TEXT }
}

export async function handleLineProjectWorkCommand(job, { db = prisma, now, expectedClaim } = {}) {
  const text = job?.inbound?.body?.trim()
  if (!isLineProjectWorkCommand(text)) return null
  try {
    if (text.startsWith('ยืนยันงาน ')) {
      const result = await confirmLineWork(job.id, text.slice('ยืนยันงาน '.length).trim(), { db, now, expectedClaim })
      return { text: lineWorkConfirmText(result), toolReceipt: result }
    }
    const mutation = text.match(/^\/work-(create|update)\s+(\S+)\s+([\s\S]+)$/u)
    if (mutation) {
      const args = mutation[1] === 'create' ? { title: mutation[3] } : JSON.parse(mutation[3])
      const result = await proposeLineWork(job.id, { action: `${mutation[1]}_work`, targetId: mutation[2], args }, { db, now, expectedClaim })
      return { text: lineWorkProposalText(`${mutation[1]}_work`, result.preview, result.proposalId), toolReceipt: { proposalId: result.proposalId, status: 'AWAITING_CONFIRMATION' } }
    }
    const read = text.match(/^\/(projects|work)(?:\s+([\s\S]*))?$/u)
    if (!read) return { text: LINE_WORK_USAGE_TEXT }
    const result = await searchLineProjectWork(job.id, { kind: read[1], query: read[2] ?? '' }, { db, now, expectedClaim })
    return { text: lineWorkReadText(result) }
  } catch (error) {
    // No raw database error or private target details go into the LINE answer.
    return lineWorkErrorReply(error)
  }
}

/** Server-bound model tools: model arguments can name resources, never identity or scope.
 * Propose writes an audit preview only. Confirmation is intentionally absent from this registry.
 */
export function createLineProjectWorkTools(jobId, options = {}) {
  return [
    { name: 'search_project_work', effect: 'READ', description: 'Search authorized Projects or Work and read their current status.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['projects', 'work'] }, query: { type: 'string', maxLength: 120 } }, additionalProperties: false },
      handler: args => searchLineProjectWork(jobId, z.object({ kind: z.enum(['projects', 'work']).default('work'), query: z.string().max(120).default('') }).strict().parse(args), options) },
    { name: 'propose_work_change', effect: 'PREVIEW', description: 'Preview creation of a Work task in a workstream, or a title/status update of an existing task. Return the exact preview and ask the human to type ยืนยันงาน followed by proposalId. Does not mutate Work.',
      parameters: { type: 'object', properties: { action: { type: 'string', enum: ['create_work', 'update_work'] }, targetId: { type: 'string' },
        args: { type: 'object', properties: { title: { type: 'string', maxLength: 240 }, status: { type: 'string', enum: zWorkStatus.options } }, additionalProperties: false } }, required: ['action', 'targetId', 'args'], additionalProperties: false },
      handler: async args => {
        const { proposalId, preview } = await proposeLineWork(jobId, z.object({ action: z.enum(['create_work', 'update_work']), targetId: idSchema, args: z.record(z.unknown()) }).strict().parse(args), options)
        return { proposalId, action: preview.action, targetId: preview.targetId, targetTitle: preview.target.title,
          targetVersion: preview.target.version, args: preview.args, argsHash: preview.argsHash, expiresAt: preview.expiresAt,
          confirmationCommand: `ยืนยันงาน ${proposalId}`, status: 'AWAITING_CONFIRMATION' }
      } },
    { name: 'create_mission_draft', effect: 'PREVIEW',
      description: 'Create an immutable Agent source draft for human PM review. This does not create or assign a WorkItem; a human must submit it through the authenticated PM intake.',
      parameters: { type: 'object', properties: {
        title: { type: 'string', minLength: 1, maxLength: 240 },
        summary: { type: 'string', minLength: 1, maxLength: 4096 },
      }, required: ['title', 'summary'], additionalProperties: false },
      handler: args => {
        let mission
        try { mission = missionSchema.parse(args) } catch { fail('MISSION_SOURCE_CONFLICT') }
        return createLineMissionDraft(jobId, mission, options)
      } },
  ]
}
