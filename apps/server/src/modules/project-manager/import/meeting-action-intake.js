import { zMeetingActionIntake } from './meeting-contracts'
import { commitPlan, dryRunPlan } from './plan-import-service'
import { authorizeImportTarget } from './import-authorization'
import { isInstallationOperator, ownsTenant } from '@/modules/identity/viewer-authority'
import { MODE_DEFAULT_STRATEGY } from '@/lib/validation/enums'
import prisma from '@/lib/db'
import { inboxProjectFor, inboxWorkstreamFor, generalWorkstreamFor, allowedItemSubtypes } from './task-envelope'
import { uniqueCode } from './human-plan-builder'
import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-069 — meeting action candidates converge on PlanEnvelope before any
// WorkItem write; PM remains the single writer and review owner.
// @req FR-065 — target Workspace and source identity are resolved and scoped
// before the shared dry-run/commit pipeline is allowed to write.
// @spec BR-009, SEC-001, SEC-003, SDD-009 — no caller-supplied Person.id or
// display name is trusted as assignment authority.
// @tested tests/unit/meeting-action-intake.test.js

const MEETING_IDENTITY_PROVIDERS = Object.freeze({ FUNG: 'FUNG', LALIN_AI: 'LALIN_AI' })
const MEETING_ACTION_EXTERNAL_SYSTEM = 'MEETING_ACTION'

function failure(status, message, code = message) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function parseIntake(raw) {
  const parsed = zMeetingActionIntake.safeParse(raw)
  if (!parsed.success) {
    throw failure(400, parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '), 'MEETING_ACTION_CONTRACT_INVALID')
  }
  return parsed.data
}

function activeMembershipWhere({ tenantId, businessId, personId }) {
  return {
    personId,
    tenantId,
    status: 'ACTIVE',
    ...(businessId ? { OR: [{ businessId }, { businessId: null }] } : {}),
  }
}

/**
 * Resolve a source app subject to the canonical Person only after an explicit
 * verified binding. This never creates a Person and never resolves by name.
 */
export async function resolveMeetingIdentity({ tenantId, businessId, sourceApp, sourceUserId, db = prisma }) {
  const provider = MEETING_IDENTITY_PROVIDERS[sourceApp]
  if (!provider) return { status: 'UNSUPPORTED_SOURCE_APP' }

  const identity = await db.externalIdentity.findUnique({
    where: { tenantId_provider_providerSubject: { tenantId, provider, providerSubject: sourceUserId } },
  })
  if (!identity || identity.revokedAt || !identity.verifiedAt || !identity.linkedAt) {
    return { status: 'UNBOUND' }
  }

  const person = await db.person.findUnique({ where: { id: identity.personId }, select: { id: true, accessDisabledAt: true } })
  if (!person || person.accessDisabledAt) return { status: 'DISABLED' }

  const membership = await db.membership.findFirst({ where: activeMembershipWhere({ tenantId, businessId, personId: identity.personId }) })
  if (!membership) return { status: 'OUT_OF_SCOPE', personId: identity.personId }

  return { status: 'RESOLVED', personId: identity.personId, externalIdentityId: identity.id }
}

async function resolveTarget({ intake, workspaceId, projectId, viewer, db }) {
  let project = null
  let workspace = null

  if (projectId) {
    project = await db.project.findUnique({ where: { id: projectId } })
    workspace = project?.workspaceId ? await db.workspace.findUnique({ where: { id: project.workspaceId } }) : null
  } else if (workspaceId) {
    workspace = await db.workspace.findUnique({ where: { id: workspaceId } })
  } else {
    workspace = await db.workspace.findUnique({ where: { code: intake.scope.workspaceCode } })
  }

  if (!workspace) throw failure(404, 'Workspace not found', 'MEETING_TARGET_NOT_FOUND')
  if (workspace.code !== intake.scope.workspaceCode) {
    throw failure(400, 'scope.workspaceCode does not match the target workspace', 'MEETING_SCOPE_MISMATCH')
  }

  let businessTenantId
  if (workspace.businessId) {
    const business = await db.business.findUnique({ where: { id: workspace.businessId }, select: { id: true, code: true, name: true, tenantId: true } })
    if (!business) throw failure(404, 'Workspace not found', 'MEETING_TARGET_NOT_FOUND')
    businessTenantId = business.tenantId
    workspace = { ...workspace, business }
  }

  const decision = authorizeImportTarget(viewer, { ...workspace, businessTenantId })
  if (!decision.authorized) {
    throw failure(decision.reason ? 403 : 404, decision.reason || 'Workspace not found', 'MEETING_TARGET_NOT_AUTHORIZED')
  }
  if (!workspace.businessId || !workspace.business) {
    throw failure(403, 'Meeting actions require a Business-scoped workspace', 'MEETING_BUSINESS_SCOPE_REQUIRED')
  }

  if (projectId && (!project || project.workspaceId !== workspace.id || project.deletedAt)) {
    throw failure(404, 'Project not found', 'MEETING_PROJECT_NOT_FOUND')
  }
  if (intake.scope.projectCode) {
    const scopedProject = await db.project.findFirst({
      where: { code: intake.scope.projectCode, workspaceId: workspace.id, deletedAt: null },
    })
    if (!scopedProject) throw failure(404, 'Project not found', 'MEETING_PROJECT_NOT_FOUND')
    if (project && scopedProject.id !== project.id) throw failure(400, 'scope.projectCode does not match the target project', 'MEETING_SCOPE_MISMATCH')
    project = scopedProject
  }

  let workstream = null
  if (intake.scope.workstreamCode) {
    if (!project) throw failure(400, 'scope.workstreamCode requires scope.projectCode or projectId', 'MEETING_SCOPE_INVALID')
    workstream = await db.workstream.findFirst({
      where: { code: intake.scope.workstreamCode, projectId: project.id, deletedAt: null },
    })
    if (!workstream) throw failure(404, 'Workstream not found', 'MEETING_WORKSTREAM_NOT_FOUND')
  }

  return { workspace, business: workspace.business, project, workstream }
}

function metadataForAction({ intake, action, assignment }) {
  return {
    intakeKind: 'MEETING_ACTION',
    meetingId: intake.meeting.meetingId,
    recordingId: intake.meeting.recordingId,
    transcriptRevision: intake.meeting.transcriptRevision,
    sourceApp: intake.source.app,
    sourceUserId: intake.source.userId,
    ...(action.description ? { description: action.description } : {}),
    ...(action.tags?.length ? { tags: action.tags } : {}),
    ...(action.evidence?.length ? { evidence: action.evidence } : {}),
    ...(action.confidence !== undefined ? { confidence: action.confidence } : {}),
    assignment: {
      resolution: assignment?.status || 'NOT_PROPOSED',
      ...(action.assignee ? {
        proposedSourceUserId: action.assignee.sourceUserId,
        ...(action.assignee.displayName ? { proposedDisplayName: action.assignee.displayName } : {}),
      } : {}),
    },
  }
}

/** Build the one canonical PM envelope after identity decisions are explicit. */
export function buildMeetingActionPlan({ intake, target, assignments, generatedAt = new Date().toISOString() }) {
  const targetProject = target.project
    ? { code: target.project.code, name: target.project.name }
    : inboxProjectFor(target.business)
  const targetWorkstream = target.workstream
    ? {
        code: target.workstream.code,
        name: target.workstream.name,
        executionMode: target.workstream.executionMode,
        progressStrategy: target.workstream.progressStrategy || MODE_DEFAULT_STRATEGY[target.workstream.executionMode],
        progressWeight: target.workstream.progressWeight ?? 1,
      }
    : target.project
      ? generalWorkstreamFor(target.project)
      : inboxWorkstreamFor(target.business)

  const itemSubtypes = allowedItemSubtypes(targetWorkstream.executionMode)
  const subtype = itemSubtypes[0]
  if (!subtype) throw failure(400, `No item subtype is allowed for mode ${targetWorkstream.executionMode}`, 'MEETING_MODE_UNSUPPORTED')

  const usedCodes = new Set([targetProject.code, targetWorkstream.code])
  const items = intake.actions.map((action, index) => {
    const assignment = assignments[index]
    const actionKey = `${intake.meeting.meetingId}-${action.actionId}`
    const item = {
      code: uniqueCode('WI', actionKey, usedCodes, 'MTG'),
      subtype,
      title: action.title,
      status: 'PLANNED',
      metadata: metadataForAction({ intake, action, assignment }),
      // ExternalRef is installation-global, so include the resolved Business
      // and meeting identity. A bare source action id could collide across
      // tenants, meetings or the two producer apps.
      externalRefs: [{
        system: MEETING_ACTION_EXTERNAL_SYSTEM,
        id: `${target.business.code}:${intake.source.app}:${intake.meeting.meetingId}:${action.actionId}`,
      }],
    }
    if (assignment?.personId) item.assigneeRef = assignment.personId
    if (action.targetAt) item.targetAt = action.targetAt
    return item
  })

  return {
    schemaVersion: '1.2',
    generatedBy: 'meeting-action-intake.v1',
    generatedAt,
    scope: { workspaceCode: target.workspace.code },
    trace: {
      correlationId: intake.trace.correlationId,
      idempotencyKey: intake.trace.idempotencyKey,
    },
    project: target.project
      ? targetProject
      : { ...targetProject, description: 'Meeting actions awaiting Project Manager triage.' },
    workstreams: [{ ...targetWorkstream, items }],
  }
}

async function prepare(rawIntake, { workspaceId, projectId, viewer, db = prisma } = {}) {
  if (!viewer) throw failure(401, 'Authentication required', 'AUTH_REQUIRED')
  const intake = parseIntake(rawIntake)
  const target = await resolveTarget({ intake, workspaceId, projectId, viewer, db })
  const actor = await resolveMeetingIdentity({
    tenantId: target.business.tenantId,
    businessId: target.business.id,
    sourceApp: intake.source.app,
    sourceUserId: intake.source.userId,
    db,
  })
  if (actor.status !== 'RESOLVED') {
    throw failure(403, `Meeting source identity is not linked to an active member (${actor.status})`, 'MEETING_SOURCE_IDENTITY_NOT_LINKED')
  }

  const assignments = []
  const warnings = []
  for (const action of intake.actions) {
    if (!action.assignee) {
      assignments.push({ status: 'NOT_PROPOSED' })
      continue
    }
    const assignment = await resolveMeetingIdentity({
      tenantId: target.business.tenantId,
      businessId: target.business.id,
      sourceApp: intake.source.app,
      sourceUserId: action.assignee.sourceUserId,
      db,
    })
    assignments.push(assignment)
    if (assignment.status !== 'RESOLVED') {
      warnings.push({
        code: `ASSIGNEE_${assignment.status}`,
        actionId: action.actionId,
        sourceUserId: action.assignee.sourceUserId,
        message: 'Assignee proposal was kept for PM review and no Person was auto-assigned.',
      })
    }
  }

  return {
    intake,
    target,
    actor,
    assignments,
    warnings,
    plan: buildMeetingActionPlan({ intake, target, assignments }),
  }
}

export async function dryRunMeetingActions(rawIntake, options = {}) {
  const prepared = await prepare(rawIntake, options)
  const result = await dryRunPlan(prepared.plan, {
    workspaceId: prepared.target.workspace.id,
    viewer: options.viewer,
    db: options.db || prisma,
  })
  return {
    ...result,
    contract: 'meeting-action-intake.v1',
    warnings: prepared.warnings,
    plan: prepared.plan,
    source: { app: prepared.intake.source.app, personId: prepared.actor.personId },
  }
}

export async function commitMeetingActions(rawIntake, options = {}) {
  const prepared = await prepare(rawIntake, options)
  const result = await commitPlan(prepared.plan, {
    workspaceId: prepared.target.workspace.id,
    viewer: options.viewer,
    db: options.db || prisma,
  })
  return {
    ...result,
    contract: 'meeting-action-intake.v1',
    warnings: prepared.warnings,
    source: { app: prepared.intake.source.app, personId: prepared.actor.personId },
  }
}

/**
 * Bind a provider subject to an existing Person. This is an owner-attested
 * provisioning operation; meeting intake never creates or reassigns bindings.
 */
export async function linkMeetingIdentity({ tenantId, personId, sourceApp, sourceUserId, viewer, db = prisma }) {
  const provider = MEETING_IDENTITY_PROVIDERS[sourceApp]
  if (!provider || !sourceUserId || !personId || !tenantId) throw failure(400, 'tenantId, personId, sourceApp and sourceUserId are required', 'MEETING_BINDING_INVALID')
  if (!isInstallationOperator(viewer) && !ownsTenant(viewer, tenantId)) {
    throw failure(404, 'Identity target not found', 'MEETING_BINDING_NOT_AUTHORIZED')
  }

  const [tenant, person, membership] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId } }),
    db.person.findUnique({ where: { id: personId } }),
    db.membership.findFirst({ where: { tenantId, personId, status: 'ACTIVE' } }),
  ])
  if (!tenant || !person || !membership) throw failure(404, 'Identity target not found', 'MEETING_BINDING_NOT_FOUND')

  const key = { tenantId_provider_providerSubject: { tenantId, provider, providerSubject: sourceUserId } }
  const existing = await db.externalIdentity.findUnique({ where: key })
  if (existing && existing.personId !== personId) {
    throw failure(409, 'Source identity is already linked to another Person', 'MEETING_BINDING_CONFLICT')
  }

  const now = new Date()
  const write = async (tx) => {
    const identity = existing
      ? await tx.externalIdentity.update({ where: { id: existing.id }, data: { personId, verifiedAt: now, linkedAt: now, revokedAt: null } })
      : await tx.externalIdentity.create({ data: { tenantId, personId, provider, providerSubject: sourceUserId, verifiedAt: now, linkedAt: now } })
    await recordAudit(tx, {
      entityType: 'EXTERNAL_IDENTITY',
      entityId: identity.id,
      action: existing?.revokedAt ? 'RELINKED' : existing ? 'LINK_CONFIRMED' : 'LINKED',
      actorType: 'MEETING_IDENTITY_ADMIN',
      payload: { tenantId, provider, personId, sourceUserId },
    })
    return identity
  }
  const identity = typeof db.$transaction === 'function' ? await db.$transaction(write) : await write(db)
  return { provider, sourceApp, personId: identity.personId, externalIdentityId: identity.id, linked: true }
}
