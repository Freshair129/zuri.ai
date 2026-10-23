import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { withdrawKnowledgeSource } from '../knowledge-corpus-service'

// @req FR-232 — the Knowledge-owned erasure port tombstones candidate rows and
//   withdraws any admitted LINE FAQ source through the existing corpus workflow.
//   Callers pass only internal Conversation/Message ids obtained from the
//   tenant-scoped CRM or Identity transaction; this module never writes an
//   external MSP/GKS store.
// @spec ADR-090 D6, D8; ADR-091 D6; ADR-072 D10-D11; SEC-001
// @tested tests/integration/fr236-knowledge-candidate.test.js

const CANDIDATE_SELECT = {
  id: true,
  tenantId: true,
  businessId: true,
  conversationId: true,
  sourceRefJson: true,
  status: true,
  admittedSourceId: true,
  admittedIngestionId: true,
  tombstonedAt: true,
  version: true,
}

const SOURCE_SELECT = {
  id: true,
  corpusId: true,
  sourceKey: true,
  kind: true,
  version: true,
  revokedAt: true,
  deletedAt: true,
  activeIngestionId: true,
  corpus: { select: { tenantId: true, businessId: true, projectId: true } },
}

const failure = (status, message, code, extra = {}) => Object.assign(new Error(message), { status, code, ...extra })

function asDate(now) {
  const value = typeof now === 'function' ? now() : now
  const date = value instanceof Date ? new Date(value) : new Date(value ?? Date.now())
  if (Number.isNaN(date.valueOf())) throw failure(400, 'Knowledge candidate erasure time is invalid', 'KNOWLEDGE_TIME_INVALID')
  return date
}

function parseSourceRef(value) {
  try {
    const parsed = JSON.parse(value || '')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed
  } catch {
    return null
  }
}

function validSourceRef(value) {
  return Boolean(value
    && typeof value.conversationId === 'string'
    && value.conversationId.trim()
    && Array.isArray(value.messageIds)
    && value.messageIds.every((id) => typeof id === 'string' && id.trim()))
}

function sourceScopeMatches(source, candidate) {
  return source?.sourceKey === `knowledge-candidate:${candidate.id}`
    && source.kind === 'LINE_FAQ_CANDIDATE'
    && source.corpus?.tenantId === candidate.tenantId
    && source.corpus?.businessId === candidate.businessId
    && source.corpus?.projectId == null
}

async function resolveCandidateSource(candidate, db) {
  const expectedKey = `knowledge-candidate:${candidate.id}`
  if (candidate.admittedSourceId) {
    const source = await db.knowledgeSource.findUnique({ where: { id: candidate.admittedSourceId }, select: SOURCE_SELECT })
    if (!sourceScopeMatches(source, candidate)) {
      throw failure(409, 'Knowledge candidate source link is outside its tenant or Business scope', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
    }
    return source
  }

  // Older approval attempts could durably admit a source before linking the
  // candidate. Resolve any such legacy crash-window record by its deterministic
  // source key, then validate the tenant, Business, project and kind.
  const rows = await db.knowledgeSource.findMany({ where: { sourceKey: expectedKey }, select: SOURCE_SELECT })
  const inScope = rows.filter((source) => sourceScopeMatches(source, candidate))
  if (inScope.length > 1) {
    throw failure(409, 'Knowledge candidate resolves to multiple admitted sources', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
  }
  if (inScope.length === 1) return inScope[0]

  if (rows.length > 0 || candidate.status === 'APPROVED' || candidate.admittedIngestionId) {
    throw failure(409, 'Knowledge candidate admitted source is missing or outside its tenant or Business scope', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
  }
  return null
}

async function withdrawCandidateIngestion(candidate, source, db) {
  // Source withdrawal closes `activeIngestionId` only after a source has been
  // published; queued/running candidate admissions therefore need this
  // Knowledge-owned, source-bound cleanup as well. The deterministic lookup
  // also covers any legacy admission/link gap left by the pre-fence flow.
  const linkedId = candidate.admittedIngestionId ?? source.activeIngestionId ?? null
  const ingestion = linkedId
    ? await db.knowledgeIngestion.findUnique({
      where: { id: linkedId },
      select: { id: true, sourceId: true, corpusId: true, status: true, version: true },
    })
    : await db.knowledgeIngestion.findFirst({
      where: { sourceId: source.id, sourceVersion: '1' },
      select: { id: true, sourceId: true, corpusId: true, status: true, version: true },
    })
  if (!ingestion) {
    if (candidate.admittedIngestionId) {
      throw failure(409, 'Knowledge candidate admission is missing during withdrawal', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
    }
    return false
  }
  if (ingestion.sourceId !== source.id || ingestion.corpusId !== source.corpusId) {
    throw failure(409, 'Knowledge candidate ingestion link is outside its source scope', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
  }
  if (!['QUEUED', 'RUNNING', 'PUBLISHED'].includes(ingestion.status)) return false
  const changed = await db.knowledgeIngestion.updateMany({
    where: { id: ingestion.id, sourceId: source.id, version: ingestion.version, status: ingestion.status },
    data: { status: 'WITHDRAWN', failureCode: 'KNOWLEDGE_SOURCE_WITHDRAWN', version: { increment: 1 } },
  })
  if (changed.count === 1) return true
  const current = await db.knowledgeIngestion.findUnique({ where: { id: ingestion.id }, select: { sourceId: true, corpusId: true, status: true } })
  if (current?.sourceId === source.id && current.corpusId === source.corpusId && current.status === 'WITHDRAWN') return false
  throw failure(409, 'Knowledge candidate ingestion changed during withdrawal; retry the erasure', 'KNOWLEDGE_CANDIDATE_ERASURE_CONFLICT', { retryable: true })
}

/**
 * Knowledge-owned cleanup used when an admission finished before erasure or
 * rejection won. It also repairs a legacy admission/link gap by looking up the
 * deterministic candidate source key.
 */
export async function withdrawKnowledgeCandidateSource(candidateId, {
  db = prisma,
  viewer = null,
  now = new Date(),
  candidateSnapshot = null,
} = {}) {
  const candidate = await db.knowledgeCandidate.findUnique({ where: { id: candidateId }, select: CANDIDATE_SELECT })
    ?? (candidateSnapshot?.id === candidateId ? candidateSnapshot : null)
  if (!candidate) return { status: 'UNCHANGED', source: null }
  const source = await resolveCandidateSource(candidate, db)
  if (!source) return { status: 'UNCHANGED', source: null }

  const result = await withdrawKnowledgeSource(source.id, { expectedVersion: source.version }, {
    db,
    viewer,
    now: () => asDate(now),
    authorization: async ({ businessId, projectId }) => ({
      authorized: businessId === candidate.businessId && projectId == null,
    }),
  })
  await withdrawCandidateIngestion(candidate, source, db)
  return result
}

function isAffected(candidate, { wholeConversationIds, partialConversationIds, erasedMessageIds }) {
  const whole = new Set(wholeConversationIds)
  const partial = new Set(partialConversationIds)
  const sourceRef = parseSourceRef(candidate.sourceRefJson)
  const hasValidSourceRef = validSourceRef(sourceRef)
  const topLevelConversationId = typeof candidate.conversationId === 'string' ? candidate.conversationId : null
  const sourceConversationId = hasValidSourceRef ? sourceRef.conversationId : null
  const rawMatches = [...wholeConversationIds, ...partialConversationIds]
    .some((id) => candidate.sourceRefJson?.includes(JSON.stringify(id)))
  const namedConversationIds = new Set([topLevelConversationId, sourceConversationId].filter(Boolean))

  if ([...namedConversationIds].some((id) => whole.has(id))) return true

  const partialMatches = [...namedConversationIds].filter((id) => partial.has(id))
  if (partialMatches.length === 0) {
    // A malformed sourceRef that textually names the affected conversation is
    // ambiguous. Erasure fails closed for that candidate instead of retaining
    // content whose message lineage cannot be trusted.
    return rawMatches && !hasValidSourceRef
  }

  if (!hasValidSourceRef) return true
  if (topLevelConversationId && topLevelConversationId !== sourceRef.conversationId) return true

  // An empty source message list is conversation-level provenance: it cannot
  // prove the admitted answer was independent of the erased speaker. Non-empty
  // complete lineage may safely retain a shared-thread candidate when none of
  // its source messages were erased.
  if (sourceRef.messageIds.length === 0) return true
  const erased = new Set(erasedMessageIds)
  return sourceRef.messageIds.some((messageId) => erased.has(messageId))
}

async function findCandidates(db, tenantId, conversationIds) {
  const uniqueIds = [...new Set(conversationIds)]
  const found = new Map()
  // The sourceRef fallback is a string search followed by exact JSON parsing;
  // chunk it to keep SQLite/Postgres bind counts bounded for large erasures.
  for (let start = 0; start < uniqueIds.length; start += 50) {
    const ids = uniqueIds.slice(start, start + 50)
    const rows = await db.knowledgeCandidate.findMany({
      where: {
        tenantId,
        OR: [
          { conversationId: { in: ids } },
          ...ids.map((id) => ({ sourceRefJson: { contains: JSON.stringify(id) } })),
        ],
      },
      select: CANDIDATE_SELECT,
    })
    for (const row of rows) found.set(row.id, row)
  }
  return [...found.values()]
}

/**
 * Tombstone candidates sourced by erased CRM conversations and withdraw any
 * admitted source in the caller's transaction. For shared conversations,
 * complete message lineage lets unrelated speakers' candidates remain live.
 */
export async function tombstoneKnowledgeCandidatesForErasure({
  tenantId,
  wholeConversationIds = [],
  partialConversationIds = [],
  erasedMessageIds = [],
  reason,
} = {}, {
  db = prisma,
  viewer = null,
  now = new Date(),
} = {}) {
  if (typeof tenantId !== 'string' || !tenantId.trim()) {
    throw failure(400, 'Knowledge candidate erasure requires tenantId', 'KNOWLEDGE_CANDIDATE_ERASURE_SCOPE_REQUIRED')
  }
  if (!['PRINCIPAL_ERASURE', 'CONSENT_DECLINED'].includes(reason)) {
    throw failure(400, 'Knowledge candidate erasure reason is invalid', 'KNOWLEDGE_CANDIDATE_ERASURE_REASON_INVALID')
  }

  const wholeIds = [...new Set(wholeConversationIds.filter((id) => typeof id === 'string' && id.trim()))]
  const partialIds = [...new Set(partialConversationIds.filter((id) => typeof id === 'string' && id.trim()))]
  const erasedIds = [...new Set(erasedMessageIds.filter((id) => typeof id === 'string' && id.trim()))]
  const affectedIds = [...new Set([...wholeIds, ...partialIds])]
  if (affectedIds.length === 0) return { tombstonedKnowledgeCandidates: 0, withdrawnKnowledgeSources: 0 }

  const execute = async (tx) => {
    const sourceConversations = await tx.conversation.findMany({
      where: { tenantId, id: { in: affectedIds } },
      select: { id: true, businessId: true },
    })
    const conversationsById = new Map(sourceConversations.map((conversation) => [conversation.id, conversation]))
    const candidates = await findCandidates(tx, tenantId, affectedIds)
    const timestamp = asDate(now)
    let tombstonedKnowledgeCandidates = 0
    let withdrawnKnowledgeSources = 0

    for (const candidate of candidates) {
      if (candidate.tenantId !== tenantId) {
        throw failure(409, 'Knowledge candidate tenant scope changed during erasure', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
      }
      const parsedSourceRef = parseSourceRef(candidate.sourceRefJson)
      for (const conversationId of [candidate.conversationId, parsedSourceRef?.conversationId]) {
        const conversation = conversationId ? conversationsById.get(conversationId) : null
        if (conversation && conversation.businessId !== candidate.businessId) {
          throw failure(409, 'Knowledge candidate Business scope does not match its source conversation', 'KNOWLEDGE_CANDIDATE_SOURCE_SCOPE_MISMATCH')
        }
      }
      if (!isAffected(candidate, {
        wholeConversationIds: wholeIds,
        partialConversationIds: partialIds,
        erasedMessageIds: erasedIds,
      })) continue

      let newlyTombstoned = false
      if (candidate.status !== 'TOMBSTONED' || !candidate.tombstonedAt) {
        const changed = await tx.knowledgeCandidate.updateMany({
          where: { id: candidate.id, version: candidate.version },
          data: { status: 'TOMBSTONED', tombstonedAt: timestamp, version: { increment: 1 } },
        })
        if (changed.count !== 1) {
          throw failure(409, 'Knowledge candidate changed during erasure; retry the erasure', 'KNOWLEDGE_CANDIDATE_ERASURE_CONFLICT', { retryable: true })
        }
        newlyTombstoned = true
        tombstonedKnowledgeCandidates += 1
      }

      const source = await resolveCandidateSource(candidate, tx)
      let sourceWithdrawn = false
      if (source) {
        const result = await withdrawKnowledgeCandidateSource(candidate.id, {
          db: tx, viewer, now: timestamp, candidateSnapshot: candidate,
        })
        sourceWithdrawn = result.status === 'WITHDRAWN'
        if (sourceWithdrawn) withdrawnKnowledgeSources += 1
      }

      if (newlyTombstoned) {
        await recordAudit(tx, {
          entityType: 'KNOWLEDGE_CANDIDATE',
          entityId: candidate.id,
          action: 'KNOWLEDGE_CANDIDATE_TOMBSTONED',
          actorType: 'SYSTEM',
          actorId: viewer?.principal?.id ?? null,
          tenantId,
          businessId: candidate.businessId,
          reason,
          payload: { reason, sourceWithdrawn },
        })
      }
    }

    return { tombstonedKnowledgeCandidates, withdrawnKnowledgeSources }
  }

  // Keep candidate state, source membership and correction generation atomic.
  // A Prisma transaction client has no `$transaction`, so nested callers stay
  // in their existing Identity/CRM transaction without opening another one.
  return typeof db.$transaction === 'function'
    ? db.$transaction(execute, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 })
    : execute(db)
}
