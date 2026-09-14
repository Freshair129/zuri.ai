import { z } from 'zod'
import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertDomainVisible } from '@/modules/identity/viewer-domains'
import { hasPermission, LINE_OA_PUBLISH_PERMISSION } from '@/modules/identity/rbac'
import { getConversationThread } from '@/modules/crm/conversation-read-model'
import { readConversationConsentStatus } from '@/modules/crm/conversation-consent-reader'
import { zKnowledgeCandidateDecision } from '@/lib/validation/enums'
import { hashGenesisRag17Json } from '../genesisrag17-contract'
import { assertCandidateZeroPii } from '../knowledge-candidate-zero-pii'
import { admitKnowledge as defaultAdmitKnowledge } from '../knowledge-admission-service'

// @req FR-236 — the knowledge domain's one writer of KnowledgeCandidate: a
//   consent-gated extractor that drafts a locator-only Q/A from an existing
//   CRM read projection (`conversation-read-model.js` — crm gains no writer,
//   ADR-090 Consequences), a Business OWNER or LINE_OA_PUBLISHER who edits it,
//   and the audited APPROVE/REJECT decision that, on APPROVE only, admits it
//   through the ADR-072 admission service as one immutable LINE_FAQ_CANDIDATE
//   TEXT source — never a second write path into the corpus, and never a
//   Tier 1 call to `gks_knowledge_promote`. The decision re-checks consent
//   through crm's own narrow `readConversationConsentStatus` contract
//   (`conversation-consent-reader.js`) — never a raw cross-domain query —
//   and fails closed to refusal on any missing/unreadable/malformed source
//   reference, not only an explicit non-GRANTED status.
// @spec ADR-090 D6, D8; ADR-072; SEC-032; BR-002; SEC-001
// @tested tests/integration/fr236-knowledge-candidate.test.js, tests/unit/knowledge-candidate-migration.test.js, tests/unit/conversation-consent-reader.test.js

const ENTITY = 'KNOWLEDGE_CANDIDATE'
const GRANTED = 'GRANTED'

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const actorId = (viewer) => viewer?.principal?.id ?? null

const identifier = z.string().trim().min(1).max(200)
const prose = z.string().trim().min(1).max(4000)

export const zDraftKnowledgeCandidate = z.object({
  businessId: identifier,
  conversationId: identifier,
  // Internal Message.id values only — never externalMessageId (the raw
  // provider id). Validated against the conversation's own messages below.
  messageIds: z.array(identifier).max(50).default([]),
  question: prose,
  answer: prose,
  // Optional: a redelivered extraction that omits this gets a deterministic
  // key derived from (conversationId, messageIds), so re-running the
  // extractor over the same input cannot create a second candidate.
  idempotencyKey: identifier.optional(),
}).strict()

export const zUpdateKnowledgeCandidate = z.object({
  question: prose.optional(),
  answer: prose.optional(),
  version: z.number().int().positive(),
}).strict().refine((v) => v.question !== undefined || v.answer !== undefined, {
  message: 'At least one of question or answer must be given',
})

export const zDecideKnowledgeCandidate = z.object({
  decision: zKnowledgeCandidateDecision,
  version: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict()

const SELECT = {
  id: true, tenantId: true, businessId: true, conversationId: true, status: true,
  question: true, answer: true, contentHash: true, sourceRefJson: true,
  consentStatusAtDraft: true, idempotencyKey: true, requestHash: true,
  createdByPersonId: true, createdAt: true, updatedAt: true,
  decidedByPersonId: true, decidedAt: true, decisionReason: true,
  admittedSourceId: true, admittedIngestionId: true, tombstonedAt: true, version: true,
}

function toDto(row) {
  return { ...row, sourceRef: JSON.parse(row.sourceRefJson || '{}') }
}

/** OWNER or LINE_OA_PUBLISHER — the one authority ADR-090 D6 names for edit/decide. */
function mayReviewCandidates(viewer, businessId) {
  return ownsBusiness(viewer, businessId) || hasPermission(viewer, businessId, LINE_OA_PUBLISH_PERMISSION)
}

function assertMayReview(viewer, businessId) {
  assertDomainVisible(viewer, businessId, 'knowledge')
  if (!mayReviewCandidates(viewer, businessId)) {
    throw failure(403, 'Reviewing knowledge candidates requires owner or LINE_OA_PUBLISHER authority over this Business', 'KNOWLEDGE_CANDIDATE_FORBIDDEN')
  }
}

async function loadCandidate(db, id) {
  const candidateId = typeof id === 'string' ? id.trim() : ''
  if (!candidateId) throw failure(404, 'Knowledge candidate not found', 'KNOWLEDGE_CANDIDATE_NOT_FOUND')
  const row = await db.knowledgeCandidate.findUnique({ where: { id: candidateId }, select: SELECT })
  if (!row) throw failure(404, 'Knowledge candidate not found', 'KNOWLEDGE_CANDIDATE_NOT_FOUND')
  return row
}

/**
 * Draft one candidate from a CRM conversation. Consent is checked here, once,
 * against the live Customer — never re-derived from a caller-supplied flag —
 * and the GRANTED value is snapshotted onto the row as evidence, not trusted
 * again later without re-reading the live Customer (`decideKnowledgeCandidate`
 * re-checks it). Anything other than exactly GRANTED refuses (fail closed):
 * PENDING, DECLINED, GRANDFATHERED and an unknown/missing conversation alike.
 */
export async function draftKnowledgeCandidate(input, { viewer, db = prisma, now = new Date() } = {}) {
  const data = zDraftKnowledgeCandidate.parse(input)
  assertMayReview(viewer, data.businessId)

  // The consent-gated CRM read projection (ADR-090 Consequences): crm owns
  // this reader and gains no writer for this feature.
  const thread = await getConversationThread({ viewer, businessId: data.businessId, conversationId: data.conversationId })
  const consentStatus = thread.conversation.customer.consentStatus
  if (consentStatus !== GRANTED) {
    throw failure(409, `Conversation consent is ${consentStatus}, not GRANTED`, 'KNOWLEDGE_CANDIDATE_CONSENT_NOT_GRANTED')
  }
  const knownMessageIds = new Set(thread.messages.map((message) => message.id))
  const unknown = data.messageIds.filter((id) => !knownMessageIds.has(id))
  if (unknown.length) throw failure(422, 'One or more messageIds do not belong to this conversation', 'KNOWLEDGE_CANDIDATE_MESSAGE_NOT_FOUND')

  // Zero-PII at creation (ADR-090 D6, first of its two checks).
  assertCandidateZeroPii({ question: data.question, answer: data.answer })

  const sortedMessageIds = [...data.messageIds].sort()
  const idempotencyKey = data.idempotencyKey || hashGenesisRag17Json({ conversationId: data.conversationId, messageIds: sortedMessageIds })
  const sourceRef = { conversationId: data.conversationId, messageIds: sortedMessageIds }
  const contentHash = hashGenesisRag17Json({ question: data.question, answer: data.answer })
  const requestHash = hashGenesisRag17Json({ businessId: data.businessId, sourceRef, question: data.question, answer: data.answer })

  return db.$transaction(async (tx) => {
    const existing = await tx.knowledgeCandidate.findUnique({ where: { businessId_idempotencyKey: { businessId: data.businessId, idempotencyKey } } })
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw failure(409, 'Idempotency key was already used for a different candidate', 'KNOWLEDGE_CANDIDATE_IDEMPOTENCY_CONFLICT')
      }
      return toDto(existing)
    }
    const created = await tx.knowledgeCandidate.create({
      data: {
        tenantId: thread.scope.tenantId,
        businessId: data.businessId,
        conversationId: data.conversationId,
        status: 'PENDING_REVIEW',
        question: data.question,
        answer: data.answer,
        contentHash,
        sourceRefJson: JSON.stringify(sourceRef),
        consentStatusAtDraft: consentStatus,
        idempotencyKey,
        requestHash,
        createdByPersonId: actorId(viewer),
      },
      select: SELECT,
    })
    await recordAudit(tx, {
      entityType: ENTITY, entityId: created.id, action: 'KNOWLEDGE_CANDIDATE_DRAFTED', actorId: actorId(viewer),
      payload: { businessId: data.businessId, conversationId: data.conversationId, messageCount: sortedMessageIds.length },
    })
    return toDto(created)
  })
}

export async function listKnowledgeCandidates({ businessId, status } = {}, { viewer, db = prisma } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) throw failure(404, 'Business not found', 'KNOWLEDGE_CANDIDATE_NOT_FOUND')
  assertDomainVisible(viewer, id, 'knowledge')
  const rows = await db.knowledgeCandidate.findMany({
    where: { businessId: id, ...(status ? { status } : {}) },
    orderBy: { createdAt: 'desc' },
    select: SELECT,
  })
  return rows.map(toDto)
}

export async function getKnowledgeCandidate(id, { viewer, db = prisma } = {}) {
  const row = await loadCandidate(db, id)
  assertDomainVisible(viewer, row.businessId, 'knowledge')
  return toDto(row)
}

/** Edit the draft's question/answer while it is still PENDING_REVIEW. Zero-PII re-runs (an owner's edit can re-introduce PII as easily as the first draft could). */
export async function updateKnowledgeCandidate(id, input, { viewer, db = prisma } = {}) {
  const data = zUpdateKnowledgeCandidate.parse(input)
  return db.$transaction(async (tx) => {
    const row = await loadCandidate(tx, id)
    assertMayReview(viewer, row.businessId)
    if (row.status !== 'PENDING_REVIEW') {
      throw failure(409, `Candidate is ${row.status}, not PENDING_REVIEW`, 'KNOWLEDGE_CANDIDATE_NOT_PENDING')
    }
    if (row.version !== data.version) throw failure(409, 'Candidate version conflict', 'KNOWLEDGE_CANDIDATE_VERSION_CONFLICT')
    const question = data.question ?? row.question
    const answer = data.answer ?? row.answer
    assertCandidateZeroPii({ question, answer })
    const contentHash = hashGenesisRag17Json({ question, answer })
    const result = await tx.knowledgeCandidate.updateMany({
      where: { id: row.id, version: row.version },
      data: { question, answer, contentHash, version: { increment: 1 } },
    })
    if (result.count !== 1) throw failure(409, 'Candidate version conflict', 'KNOWLEDGE_CANDIDATE_VERSION_CONFLICT')
    await recordAudit(tx, {
      entityType: ENTITY, entityId: row.id, action: 'KNOWLEDGE_CANDIDATE_EDITED', actorId: actorId(viewer),
      payload: { businessId: row.businessId, fields: Object.keys(data).filter((k) => k !== 'version') },
    })
    return toDto(await tx.knowledgeCandidate.findUnique({ where: { id: row.id }, select: SELECT }))
  })
}

/**
 * APPROVE admits the candidate through the existing ADR-072 admission
 * service — the only write path into the corpus — as one immutable
 * LINE_FAQ_CANDIDATE TEXT source; REJECT never calls it. Both are audited.
 *
 * Idempotency has two independent layers: the `status !== PENDING_REVIEW`
 * check below refuses a second decision on the fast path, and even a narrow
 * race that lets two calls past it cannot admit twice — `admitKnowledge`'s
 * own idempotency key (namespaced from this candidate's id) makes the second
 * admission call `unchanged: true`, and the compare-and-set update afterwards
 * lets only one of the two callers actually flip the row's status.
 */
export async function decideKnowledgeCandidate(id, input, { viewer, db = prisma, now = new Date(), admit = defaultAdmitKnowledge } = {}) {
  const data = zDecideKnowledgeCandidate.parse(input)
  const row = await loadCandidate(db, id)
  assertMayReview(viewer, row.businessId)
  if (row.status !== 'PENDING_REVIEW') {
    throw failure(409, `Candidate is ${row.status}, not PENDING_REVIEW`, 'KNOWLEDGE_CANDIDATE_NOT_PENDING')
  }
  if (row.version !== data.version) throw failure(409, 'Candidate version conflict', 'KNOWLEDGE_CANDIDATE_VERSION_CONFLICT')

  // Fail closed: consent may have changed since the draft (a withdrawal
  // between draft and decision must stop the admission, not merely the next
  // draft), and a missing or malformed sourceRef must refuse exactly like a
  // withdrawn one — never silently admit. The read goes through crm's own
  // narrow, internal consent contract (`conversation-consent-reader.js`), not
  // another call through the CRM's viewer-facing read model: the reviewer
  // here has already proven OWNER/LINE_OA_PUBLISHER authority over this exact
  // Business above, and requiring the separate `customer` domain grant on top
  // of that would refuse a LINE_OA_PUBLISHER who was never granted the CRM
  // inbox, for a reason unrelated to their authority to decide a candidate.
  // Zero-PII re-runs a second time either way, per ADR-090 D6.
  const sourceRef = JSON.parse(row.sourceRefJson || '{}')
  const consentStatus = await readConversationConsentStatus(
    { tenantId: row.tenantId, businessId: row.businessId, conversationId: sourceRef.conversationId },
    { db },
  )
  if (consentStatus !== GRANTED) {
    throw failure(
      409,
      consentStatus ? `Conversation consent is ${consentStatus}, not GRANTED` : 'Source conversation is not readable',
      'KNOWLEDGE_CANDIDATE_CONSENT_NOT_GRANTED',
    )
  }
  assertCandidateZeroPii({ question: row.question, answer: row.answer })

  const decidedAt = typeof now === 'function' ? now() : (now || new Date())
  const actor = actorId(viewer)

  if (data.decision === 'REJECT') {
    return db.$transaction(async (tx) => {
      const result = await tx.knowledgeCandidate.updateMany({
        where: { id: row.id, version: row.version, status: 'PENDING_REVIEW' },
        data: { status: 'REJECTED', decidedByPersonId: actor, decidedAt, decisionReason: data.reason ?? null, version: { increment: 1 } },
      })
      if (result.count !== 1) throw failure(409, 'Candidate was already decided', 'KNOWLEDGE_CANDIDATE_ALREADY_DECIDED')
      await recordAudit(tx, {
        entityType: ENTITY, entityId: row.id, action: 'KNOWLEDGE_CANDIDATE_REJECTED', actorId: actor,
        payload: { businessId: row.businessId, reason: data.reason ?? null },
      })
      return toDto(await tx.knowledgeCandidate.findUnique({ where: { id: row.id }, select: SELECT }))
    })
  }

  // APPROVE — admit first (idempotent on its own key), then flip the row.
  // This is deliberately not one Prisma transaction spanning both services:
  // admitKnowledge already commits its own durable, resumable state, exactly
  // like every other admission caller (knowledge-runtime.js never wraps it in
  // a caller transaction either). A crash between the two steps leaves a
  // recoverable state — the source is admitted and the next `decideKnowledge
  // Candidate` retry with the same input reaches the identical `unchanged:
  // true` admission and completes the row flip.
  const content = JSON.stringify({ question: row.question, answer: row.answer })
  const admission = await admit({
    businessId: row.businessId,
    idempotencyKey: `knowledge-candidate:${row.id}`,
    source: {
      kind: 'LINE_FAQ_CANDIDATE',
      sourceKey: `knowledge-candidate:${row.id}`,
      version: '1',
      title: row.question.length > 120 ? `${row.question.slice(0, 117)}...` : row.question,
      content,
    },
  }, {
    db, viewer, now,
    // The candidate service is the sole caller and has already authorized
    // OWNER/LINE_OA_PUBLISHER and validated Business scope above; the generic
    // knowledge-write authorization (owner-only) would otherwise refuse a
    // LINE_OA_PUBLISHER who is not the Business owner.
    authorization: async () => ({ authorized: true }),
  })

  return db.$transaction(async (tx) => {
    const result = await tx.knowledgeCandidate.updateMany({
      where: { id: row.id, version: row.version, status: 'PENDING_REVIEW' },
      data: {
        status: 'APPROVED', decidedByPersonId: actor, decidedAt, decisionReason: data.reason ?? null,
        admittedSourceId: admission.source?.id ?? null, admittedIngestionId: admission.id ?? admission.admissionId ?? null,
        version: { increment: 1 },
      },
    })
    if (result.count !== 1) throw failure(409, 'Candidate was already decided', 'KNOWLEDGE_CANDIDATE_ALREADY_DECIDED')
    await recordAudit(tx, {
      entityType: ENTITY, entityId: row.id, action: 'KNOWLEDGE_CANDIDATE_APPROVED', actorId: actor,
      payload: { businessId: row.businessId, admittedSourceId: admission.source?.id ?? null, admittedIngestionId: admission.id ?? admission.admissionId ?? null },
    })
    return toDto(await tx.knowledgeCandidate.findUnique({ where: { id: row.id }, select: SELECT }))
  })
}
