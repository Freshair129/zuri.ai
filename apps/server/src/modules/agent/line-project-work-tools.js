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
  if (expectedClaim && (job.executionMode !== 'EDGE' || job.version !== expectedClaim.version
    || job.executionId !== expectedClaim.executionId || job.claimantId !== expectedClaim.credentialId
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
  return db.$transaction(async tx => {
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
  return db.$transaction(async tx => {
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

export async function handleLineProjectWorkCommand(job, { db = prisma, now, expectedClaim } = {}) {
  const text = job?.inbound?.body?.trim()
  if (!isLineProjectWorkCommand(text)) return null
  try {
    if (text.startsWith('ยืนยันงาน ')) {
      const result = await confirmLineWork(job.id, text.slice('ยืนยันงาน '.length).trim(), { db, now, expectedClaim })
      return { text: result.duplicate ? 'คำสั่งนี้ยืนยันและดำเนินการแล้ว ไม่มีการทำซ้ำ' : `บันทึกงาน ${result.code} แล้ว สถานะ ${result.status}`, toolReceipt: result }
    }
    const mutation = text.match(/^\/work-(create|update)\s+(\S+)\s+([\s\S]+)$/u)
    if (mutation) {
      const args = mutation[1] === 'create' ? { title: mutation[3] } : JSON.parse(mutation[3])
      const result = await proposeLineWork(job.id, { action: `${mutation[1]}_work`, targetId: mutation[2], args }, { db, now, expectedClaim })
      return { text: `รอยืนยัน ${mutation[1] === 'create' ? 'สร้าง' : 'แก้ไข'}งาน\nเป้าหมาย: ${result.preview.target.title}\n${JSON.stringify(result.preview.args)}\nหมดอายุ ${result.preview.expiresAt}\nพิมพ์ ยืนยันงาน ${result.proposalId}`, toolReceipt: { proposalId: result.proposalId, status: 'AWAITING_CONFIRMATION' } }
    }
    const read = text.match(/^\/(projects|work)(?:\s+([\s\S]*))?$/u)
    if (!read) return { text: 'ใช้ /projects ค้นโครงการ, /work ค้นงาน, /work-create รหัสเวิร์กสตรีม ชื่องาน, /work-update รหัสงาน {"status":"DONE"}' }
    const result = await searchLineProjectWork(job.id, { kind: read[1], query: read[2] ?? '' }, { db, now, expectedClaim })
    return { text: result.items.length ? result.items.map(item => `${item.code}: ${item.title ?? item.name} — ${item.status}\n${item.id}${item.workstreams ? item.workstreams.map(s => `\n${s.name}: ${s.id}`).join('') : ''}`).join('\n\n') + (result.truncated ? '\nมีรายการเพิ่มเติม โปรดระบุคำค้น' : '') : 'ไม่พบรายการในธุรกิจที่คุณมีสิทธิ์เข้าถึง' }
  } catch (error) {
    // No raw database error or private target details go into the LINE answer.
    const code = ['WORK_CONFIRMATION_EXPIRED', 'WORK_VERSION_CONFLICT'].includes(error.code ?? error.message)
      ? error.code ?? error.message : 'WORK_ACTION_UNAVAILABLE'
    return { text: code === 'WORK_CONFIRMATION_EXPIRED' ? 'คำยืนยันหมดอายุ กรุณาสร้างคำขอใหม่' : code === 'WORK_VERSION_CONFLICT' ? 'งานมีการเปลี่ยนแปลงแล้ว กรุณาตรวจสอบและสร้างคำขอใหม่' : 'ไม่สามารถดำเนินการคำสั่งงานนี้ได้ กรุณาตรวจสอบรูปแบบคำสั่ง การเชื่อมตัวตน และสิทธิ์ของคุณ', errorCode: code }
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
  ]
}
