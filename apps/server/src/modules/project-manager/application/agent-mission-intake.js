import { z } from 'zod'
import prisma from '@/lib/db'
import { createItem } from './work-service'
import { assertWorkstreamWritable } from './project-authorization'
import { withPipelineTransaction } from './pipeline-transaction'
import { recordAudit } from './audit'

// @req TASK-ZAI-012 / PM-MISSION-01 — one human-submitted Agent draft creates
// one ordinary PLANNED WorkItem through the existing PM writer. Submission
// evidence is associated in that same transaction; it grants no execution,
// approval, or release authority.

export const zAgentMissionSubmission = z.object({
  missionId: z.string().trim().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  expectedDigest: z.string().regex(/^[a-f0-9]{64}$/i),
  workstreamId: z.string().trim().min(1),
  optionalContainerId: z.string().trim().min(1).nullable().optional(),
}).strict()

const SCOPE_FIELDS = ['tenantId', 'businessId', 'workspaceId', 'projectId', 'workstreamId']
const AGENT_ERRORS = new Set([
  'MISSION_NOT_FOUND', 'MISSION_FORBIDDEN', 'MISSION_SOURCE_UNAVAILABLE',
  'MISSION_SOURCE_CONFLICT', 'MISSION_SCOPE_INVALID', 'MISSION_TARGET_INVALID',
  'MISSION_ALREADY_SUBMITTED', 'MISSION_TRANSACTION_REQUIRED',
])

function refusal(code, status) {
  return Object.assign(new Error(code), { code, status })
}

function stableScope(scope) {
  return Object.fromEntries(SCOPE_FIELDS.map(key => [key, scope?.[key] ?? null]))
}

function sameScope(left, right) {
  const a = stableScope(left)
  const b = stableScope(right)
  return SCOPE_FIELDS.every(key => a[key] && a[key] === b[key])
}

function mapAgentError(error) {
  if (!AGENT_ERRORS.has(error?.code)) return error
  const status = error.code === 'MISSION_NOT_FOUND' ? 404
    : error.code === 'MISSION_FORBIDDEN' ? 403
      : ['MISSION_SOURCE_CONFLICT', 'MISSION_SCOPE_INVALID', 'MISSION_TARGET_INVALID', 'MISSION_ALREADY_SUBMITTED'].includes(error.code) ? 409
        : error.code === 'MISSION_TRANSACTION_REQUIRED' ? 500 : 503
  return refusal(error.code, status)
}

async function resolveTargetScope(db, workstreamId) {
  const workstream = await db.workstream.findUnique({ where: { id: workstreamId } })
  if (!workstream || workstream.deletedAt) throw refusal('WORKSTREAM_NOT_FOUND', 404)
  const project = await db.project.findUnique({
    where: { id: workstream.projectId },
    include: { business: true, workspace: { include: { business: true } } },
  })
  if (!project || project.deletedAt) throw refusal('PROJECT_NOT_FOUND', 404)
  const workspace = project.workspace
  const business = project.business || workspace?.business
  const tenantId = business?.tenantId || workspace?.tenantId
  if (!business?.id || !workspace?.id || !tenantId) throw refusal('MISSION_SCOPE_UNAVAILABLE', 404)
  return {
    tenantId,
    businessId: business.id,
    workspaceId: workspace.id,
    projectId: project.id,
    workstreamId: workstream.id,
  }
}

function validateDraft(draft, request, scope) {
  if (!draft || draft.missionId !== request.missionId || !draft.sourceAgentRef ||
      !Number.isInteger(draft.revision) || !/^[a-f0-9]{64}$/i.test(draft.digest || '') ||
      draft.revision !== request.expectedRevision || draft.digest.toLowerCase() !== request.expectedDigest.toLowerCase()) {
    throw refusal('MISSION_SOURCE_CONFLICT', 409)
  }
  if (!sameScope(draft.scope, scope)) throw refusal('MISSION_SCOPE_INVALID', 409)
  if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 240 ||
      typeof draft.summary !== 'string' || draft.summary.length > 4096) {
    throw refusal('MISSION_SOURCE_UNAVAILABLE', 503)
  }
  return {
    missionId: draft.missionId,
    sourceAgentRef: draft.sourceAgentRef,
    revision: draft.revision,
    digest: draft.digest.toLowerCase(),
    scope: stableScope(draft.scope),
    title: draft.title.trim(),
    summary: draft.summary,
  }
}

async function findEvidence(db, sourceAgentRef, missionId) {
  if (!db?.agentMissionEvidence?.findFirst) throw refusal('MISSION_EVIDENCE_UNAVAILABLE', 503)
  return db.agentMissionEvidence.findFirst({ where: { sourceAgentRef, missionId } })
}

async function assertActiveBusinessMembership(db, scope, personId) {
  const membership = await db.membership.findFirst({
    where: {
      tenantId: scope.tenantId,
      businessId: scope.businessId,
      personId,
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      suspendedAt: null,
      revokedAt: null,
    },
    select: { id: true },
  })
  if (!membership) throw refusal('MISSION_SUBMITTER_NOT_IN_BUSINESS', 403)
}

function evidenceScope(evidence) {
  return evidence?.scope || Object.fromEntries(SCOPE_FIELDS.map(key => [key, evidence?.[key] ?? null]))
}

async function readBoundWorkItem(db, evidence, scope) {
  if (!evidence || evidence.status !== 'ACTIVE' || !evidence.workItemId ||
      evidence.origin !== 'AGENT_DRAFT_HUMAN_CONFIRMED' || evidence.confirmationKind !== 'PM_SUBMISSION' ||
      evidence.sourceRevision === undefined || !evidence.sourceDigest || !sameScope(evidenceScope(evidence), scope)) {
    throw refusal('MISSION_ALREADY_SUBMITTED', 409)
  }
  const item = await db.workItem.findFirst({
    where: { id: evidence.workItemId, workstreamId: scope.workstreamId, deletedAt: null },
  })
  if (!item) throw refusal('MISSION_SUBMISSION_UNAVAILABLE', 409)
  return item
}

function isUniqueConflict(error) {
  return error?.code === 'P2002'
}

/**
 * PM-side Agent Mission submission. All Agent and database coupling is
 * explicit so the service can be contract-tested before shared Prisma and the
 * Agent adapter land in this checkout. Missing seams fail closed at runtime.
 */
export function createAgentMissionIntakeService({
  db = prisma,
  agentMissionPort = null,
  workItemWriter = createItem,
  authorizeWorkstream = assertWorkstreamWritable,
  resolveScope = resolveTargetScope,
  findExistingSubmission = findEvidence,
  transaction = withPipelineTransaction,
  auditWriter = recordAudit,
} = {}) {
  async function authorizedScope(viewer, workstreamId, database) {
    await authorizeWorkstream(viewer, workstreamId, { db: database })
    return resolveScope(database, workstreamId)
  }

  async function readDraft(request, personId) {
    if (!agentMissionPort || typeof agentMissionPort.readMissionDraft !== 'function' ||
        typeof agentMissionPort.recordPmSubmissionInTransaction !== 'function') {
      throw refusal('MISSION_SOURCE_UNAVAILABLE', 503)
    }
    try {
      return await agentMissionPort.readMissionDraft({ missionId: request.missionId, requesterPersonId: personId })
    } catch (error) {
      throw mapAgentError(error)
    }
  }

  function ensureSameSubmittedDraft(evidence, draft) {
    if (!evidence || evidence.sourceRevision !== draft.revision ||
        evidence.sourceDigest?.toLowerCase() !== draft.digest ||
        evidence.sourceAgentRef !== draft.sourceAgentRef || evidence.missionId !== draft.missionId) {
      throw refusal('MISSION_SOURCE_CONFLICT', 409)
    }
    if (!sameScope(evidenceScope(evidence), draft.scope)) throw refusal('MISSION_SCOPE_INVALID', 409)
  }

  function validateRecordedEvidence(evidence, draft, workItem) {
    if (!evidence?.evidenceId || evidence.sourceMissionId !== draft.missionId ||
        evidence.sourceRevision !== draft.revision || evidence.sourceDigest?.toLowerCase() !== draft.digest ||
        evidence.workItemId !== workItem.id || !Number.isInteger(evidence.workItemVersion)) {
      throw refusal('MISSION_SOURCE_UNAVAILABLE', 503)
    }
    return {
      evidenceId: evidence.evidenceId,
      sourceMissionId: evidence.sourceMissionId,
      sourceRevision: evidence.sourceRevision,
      sourceDigest: evidence.sourceDigest.toLowerCase(),
      workItemId: evidence.workItemId,
      workItemVersion: evidence.workItemVersion,
    }
  }

  async function replay(existing, draft, request, viewer, personId, scope, database) {
    ensureSameSubmittedDraft(existing, draft)
    if (existing.workstreamId !== undefined && existing.workstreamId !== scope.workstreamId) {
      throw refusal('MISSION_SCOPE_INVALID', 409)
    }
    if (existing.submittedByPersonId && existing.submittedByPersonId !== personId) {
      // The caller must have current visibility; attribution is immutable and
      // is not used as an authorization grant.
      await authorizeWorkstream(viewer, scope.workstreamId, { db: database })
    }
    const item = await readBoundWorkItem(database, existing, scope)
    return { workItem: item, evidence: existing, replayed: true }
  }

  async function submit(input, { viewer } = {}) {
    const parsed = zAgentMissionSubmission.safeParse(input)
    if (!parsed.success) throw refusal('MISSION_INPUT_INVALID', 400)
    const request = parsed.data
    const personId = viewer?.principal?.id
    if (!personId) throw refusal('UNAUTHENTICATED', 401)

    // PM authorization runs before the Agent reader so a mission ID cannot be
    // used to probe drafts from a target the Human cannot write to.
    const initialScope = await authorizedScope(viewer, request.workstreamId, db)
    const draft = validateDraft(await readDraft(request, personId), request, initialScope)

    const execute = async tx => {
      const currentScope = await authorizedScope(viewer, request.workstreamId, tx)
      if (!sameScope(currentScope, initialScope)) throw refusal('MISSION_SCOPE_INVALID', 409)
      await assertActiveBusinessMembership(tx, currentScope, personId)
      const existing = await findExistingSubmission(tx, draft.sourceAgentRef, draft.missionId)
      if (existing) return replay(existing, draft, request, viewer, personId, currentScope, tx)

      const workItem = await workItemWriter({
        workstreamId: currentScope.workstreamId,
        containerId: request.optionalContainerId ?? null,
        subtype: 'TASK',
        title: draft.title,
        status: 'PLANNED',
        assigneeRef: null,
      }, { viewer, db: tx })

      let recordedEvidence
      try {
        recordedEvidence = await agentMissionPort.recordPmSubmissionInTransaction(tx, {
          missionId: draft.missionId,
          expectedRevision: draft.revision,
          expectedDigest: draft.digest,
          submittedByPersonId: personId,
          workItemId: workItem.id,
        })
      } catch (error) {
        throw mapAgentError(error)
      }
      const evidence = validateRecordedEvidence(recordedEvidence, draft, workItem)
      await auditWriter(tx, {
        entityType: 'WORK_ITEM',
        entityId: workItem.id,
        action: 'MISSION_SUBMITTED',
        payload: { evidenceId: evidence.evidenceId, sourceRevision: evidence.sourceRevision },
        actorType: 'LOCAL_USER',
        actorId: personId,
        tenantId: currentScope.tenantId,
        businessId: currentScope.businessId,
      })

      // Final authority check shares the transaction and its commit boundary.
      await authorizeWorkstream(viewer, request.workstreamId, { db: tx })
      const finalScope = await resolveScope(tx, request.workstreamId)
      if (!sameScope(finalScope, currentScope)) throw refusal('MISSION_SCOPE_INVALID', 409)
      return { workItem, evidence, replayed: false }
    }

    try {
      return await transaction(db, execute)
    } catch (error) {
      if (!isUniqueConflict(error)) throw error
      // The losing transaction has rolled back. Resolve the stable-source
      // winner outside it; never retry a WorkItem insert in the failed tx.
      const freshScope = await authorizedScope(viewer, request.workstreamId, db)
      const freshDraft = validateDraft(await readDraft(request, personId), request, freshScope)
      const winner = await findExistingSubmission(db, freshDraft.sourceAgentRef, freshDraft.missionId)
      if (!winner) throw error
      return replay(winner, freshDraft, request, viewer, personId, freshScope, db)
    }
  }

  return { submit }
}
