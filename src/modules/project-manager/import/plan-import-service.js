import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { normalizePlanEnvelope, zPlanEnvelope, validatePlanSemantics } from './plan-schema'
import { resolveEntityIdentity, syncExternalRefs } from './external-ref'
import { authorizeImportTarget } from './import-authorization'
import { recordAudit } from '../application/audit'

// @req FR-012, FR-019, FR-069, FR-070 — dry-run + transactional commit,
// stable execution/domain identity and trace receipt + audit,
// with identity resolved by external id before code (Salesforce-style upsert).
// @spec FR-069, SDD-006, SDD-009, SEC-002, BR-009 — single transaction; every surface
// converges on this one envelope pipeline
// @req FR-043 - imported Projects inherit and preserve the target Space owner
// @spec ADR-014, SDD-021, BR-001, SEC-001
// @req FR-065 — the target Workspace is authorized before the plan is parsed
// @spec SDD-037, SEC-001, SEC-008
// @req FR-106 — an Enterprise API key viewer is authorized by the target
// Business's Tenant, resolved from the database, never widened by the request
// @spec SEC-006
// @tested tests/integration/plan-import.test.js, tests/integration/external-ref-import.test.js, tests/integration/project-business-binding.test.js, tests/integration/import-target-authorization.test.js
// PlanEnvelope import pipeline:
//   authorize target → JSON → Zod validation → semantic validation → dry-run diff → transactional commit → AuditEvent.
// Imported plans are data only; nothing in a plan is ever executed.

const KIND_TO_ENDPOINT = {
  project: 'PROJECT',
  workstream: 'WORKSTREAM',
  milestone: 'MILESTONE',
  gate: 'GATE',
  container: 'WORK_CONTAINER',
  item: 'WORK_ITEM',
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) result[key] = canonicalize(value[key])
        return result
      }, {})
  }
  return value
}

function normalizedPayloadHash(plan) {
  return createHash('sha256').update(JSON.stringify(canonicalize(plan))).digest('hex')
}

function readAuditPayload(payloadJson) {
  try {
    return JSON.parse(payloadJson)
  } catch {
    return null
  }
}

/**
 * Resolve the target workspace for import requests: explicit workspaceId wins,
 * else fall back to the given project's workspace (project-scoped import page).
 */
export async function resolveImportWorkspaceId({ workspaceId, projectId } = {}) {
  if (workspaceId) return workspaceId
  if (projectId) {
    const project = await prisma.project.findUnique({ where: { id: projectId } })
    return project?.workspaceId || undefined
  }
  return undefined
}

/**
 * Resolve the target Workspace and decide whether this viewer may write to it.
 *
 * @req FR-065 / @spec SDD-037. Two properties this shape exists to hold:
 *
 *   1. **The authorized thing is the resolved thing.** The target can arrive as
 *      an explicit `workspaceId` OR as the plan's own `scope.workspaceCode`, so
 *      authorizing `workspaceId` in a route handler would leave the second path
 *      completely unguarded. Checking one representation while using another is
 *      this repository's most repeated defect; the check therefore lives where
 *      the Workspace is actually resolved, and there is only one such place.
 *   2. **Refusal is indistinguishable from absence.** A Business-scoped target
 *      the viewer does not own returns the identical message a missing Workspace
 *      returns, built by the same `missing()` closure so the two cannot drift
 *      apart. Otherwise the refusal is an oracle for enumerating other tenants'
 *      Workspace ids and codes.
 *
 * Only the field naming the target is read from `rawPlan` here — never the plan
 * body — so an unauthorized caller learns nothing about the envelope they sent.
 */
async function resolveAuthorizedTarget(rawPlan, { workspaceId, viewer, db = prisma }) {
  const workspaceCode =
    typeof rawPlan?.scope?.workspaceCode === 'string' ? rawPlan.scope.workspaceCode : null

  const missing = () =>
    workspaceId
      ? `Target workspace not found: ${workspaceId}`
      : `Plan scope.workspaceCode "${workspaceCode || '(none)'}" does not match an existing workspace — select a target workspace.`

  let workspace = null
  if (workspaceId) {
    workspace = await db.workspace.findUnique({ where: { id: workspaceId } })
  } else if (workspaceCode) {
    workspace = await db.workspace.findUnique({ where: { code: workspaceCode } })
  }
  if (!workspace) return { error: missing() }

  // @req FR-106 — an Enterprise API service-account viewer is authorized by the
  // target Business's own Tenant, so resolve that Tenant from the Business row
  // itself (never from anything the request claims) and hand it to the pure
  // authorizer. Only resolved for a key viewer: the session path never reads
  // it, so the human import flow gains no query and no new behaviour.
  let businessTenantId
  if (viewer?.isApiAccess === true && workspace.businessId) {
    const business = await db.business.findUnique({
      where: { id: workspace.businessId },
      select: { tenantId: true },
    })
    businessTenantId = business?.tenantId
  }

  const decision = authorizeImportTarget(viewer, { ...workspace, businessTenantId })
  if (decision.authorized) return { workspace }
  return { error: decision.reason ?? missing() }
}

/**
 * Validate + diff a plan against the current database. Read-only.
 * Returns { valid, errors, plan, workspace, preview } where preview lists
 * inserts / updates / conflicts per entity kind.
 *
 * `viewer` is REQUIRED (@req FR-065) — a read-only preview of a scope you were
 * not given is the same leak as writing to it, so the dry run is authorized
 * identically to the commit.
 *
 * `db` (@req FR-108) lets the ExecutionPlanBundle orchestrator run this same
 * pipeline inside its own single transaction. It defaults to the shared client,
 * so every existing caller is byte-for-byte unchanged.
 */
export async function dryRunPlan(rawPlan, { workspaceId, viewer, db = prisma } = {}) {
  // Authorize the target BEFORE parsing the plan.
  const target = await resolveAuthorizedTarget(rawPlan, { workspaceId, viewer, db })
  if (target.error) return { valid: false, errors: [target.error], preview: null }
  const workspace = target.workspace

  const parsed = zPlanEnvelope.safeParse(rawPlan)
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      preview: null,
    }
  }
  const plan = normalizePlanEnvelope(parsed.data)
  const semanticErrors = validatePlanSemantics(plan)
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors, preview: null }
  }

  // The target was resolved and authorized above, before this plan was parsed.

  const inserts = []
  const updates = []
  const conflicts = []
  // Identity decision per plan code, reused verbatim by commit so the preview
  // can never disagree with what is actually written.
  const resolution = {}

  /**
   * Classify one entity: external id first, then code, then insert.
   *
   * `scope` is mandatory and names the foreign key(s) a candidate row must
   * carry — e.g. `{ workstreamId }` for a container/item, `{ projectId,
   * workstreamId }` for a milestone/gate. This is what makes an out-of-scope
   * match structurally impossible rather than something each call site has
   * to remember to check by hand:
   *
   *   - The code-matched lookup is never a global `findUnique` followed by a
   *     judgment call. It is a `findFirst` whose WHERE clause already
   *     includes `scope`, so a row outside the target scope is never even
   *     read as a candidate.
   *   - A `scope` value that is itself unresolved — the plan's own parent
   *     (project/workstream) is a fresh insert with no id yet — makes an
   *     in-scope match structurally impossible by definition (nothing in the
   *     database can already belong to a record that does not exist yet).
   *     That case is detected explicitly rather than handed to Prisma as
   *     `undefined`, which would silently drop the filter and defeat the
   *     whole scope.
   *   - The external-id match path (FR-019) resolves an id to a record
   *     independently of `scope`, so it is checked against the same `scope`
   *     before it may be treated as an update — an external ref cannot be
   *     used to reach a record `scope` would otherwise exclude.
   *   - If the code exists but not in scope, that is reported as a
   *     `conflicts` entry naming the violation, never silently downgraded to
   *     an insert (which would collide with the column's global-unique
   *     constraint at commit) and never silently skipped (which would make
   *     the preview lie about what the plan does).
   *
   * A missing `scope` throws immediately — wiring a new entity kind through
   * `classify` without stating its scope is a bug at declaration time, not a
   * silent hole discovered later.
   */
  const classify = async (model, kind, entity, title, scope, extraConflictCheck) => {
    if (!scope || typeof scope !== 'object') {
      throw new Error(
        `classify(): "${kind}" was called without a scope — every import match must be constrained to the plan's target scope`
      )
    }
    const code = entity.code
    const decided = await resolveEntityIdentity({ kind, code, externalRefs: entity.externalRefs }, db)
    resolution[code] = decided
    if (decided.conflict) {
      conflicts.push({ kind, code, reason: decided.conflict })
      return null
    }

    // Reason a row falls outside `scope`, or null when it is inside it. A
    // scope field with no resolved value means the plan's own parent has no
    // id yet, so nothing existing can belong to it — always a violation.
    const scopeViolation = (row) => {
      for (const [field, value] of Object.entries(scope)) {
        const parentNoun = field.replace(/Id$/, '')
        if (!value) return `${kind} "${code}" cannot match an existing record: its ${parentNoun} in this plan has not been created yet`
        if (row[field] !== value) return `${kind} "${code}" belongs to a different ${parentNoun} than this plan targets`
      }
      return null
    }

    if (decided.matchedBy === 'externalRef') {
      const existing = await db[model].findUnique({ where: { id: decided.entityId } })
      const conflict = (existing && scopeViolation(existing)) || (extraConflictCheck ? extraConflictCheck(existing) : null)
      if (conflict) conflicts.push({ kind, code, reason: conflict })
      else
        updates.push({
          kind,
          code: decided.matchedCode,
          title,
          matchedBy: 'externalRef',
          planCode: code !== decided.matchedCode ? code : undefined,
        })
      return existing
    }

    // Every scope value resolved → look for the row inside scope only.
    // Any unresolved value means the query cannot match anything (see
    // above), so skip it rather than let Prisma treat `undefined` as "field
    // not filtered", which would silently widen the search back to global.
    const scopeResolved = Object.values(scope).every(Boolean)
    const existing = scopeResolved ? await db[model].findFirst({ where: { code, ...scope } }) : null
    if (!existing) {
      // Not found inside scope. Before calling it an insert, make sure the
      // code is not already claimed by a row somewhere else — that must
      // surface as a conflict, not a silent insert that would collide with
      // the database's global-unique code at commit.
      const elsewhere = await db[model].findUnique({ where: { code } })
      if (elsewhere) {
        conflicts.push({ kind, code, reason: scopeViolation(elsewhere) || `${kind} code "${code}" already exists outside the target scope` })
        return null
      }
      inserts.push({ kind, code, title, matchedBy: decided.refs.length > 0 ? 'newMapping' : undefined })
      return null
    }
    const conflict = extraConflictCheck ? extraConflictCheck(existing) : null
    if (conflict) conflicts.push({ kind, code, reason: conflict })
    else updates.push({ kind, code, title })
    return existing
  }

  const targetBusinessId = workspace.businessId || null
  const existingProject = await classify(
    'project',
    'project',
    plan.project,
    plan.project.name,
    { workspaceId: workspace.id },
    (existing) => {
      if ((existing.businessId || null) !== targetBusinessId) return 'Project Business owner does not match the target Space'
      return null
    }
  )

  // FR-069 / FR-070 — Business Goals are existing strategic records. Resolve
  // every requested id inside the target Business before preview and carry the
  // same decision into commit. A missing or cross-Business id is a conflict,
  // never a silently ignored link.
  const goalIds = plan.project.goalIds || []
  const goals = goalIds.length && targetBusinessId
    ? await db.businessGoal.findMany({
      where: { id: { in: goalIds }, businessId: targetBusinessId },
      select: { id: true, code: true, title: true },
    })
    : []
  const goalById = new Map(goals.map((goal) => [goal.id, goal]))
  const existingGoalLinks = existingProject && goalIds.length
    ? await db.projectGoal.findMany({
      where: { projectId: existingProject.id, goalId: { in: goalIds } },
      select: { goalId: true },
    })
    : []
  const existingGoalIds = new Set(existingGoalLinks.map((link) => link.goalId))
  for (const goalId of goalIds) {
    const goal = goalById.get(goalId)
    if (!goal) {
      conflicts.push({ kind: 'projectGoal', code: goalId, reason: 'Business Goal is missing or does not belong to the target Business' })
    } else if (existingGoalIds.has(goalId)) {
      updates.push({ kind: 'projectGoal', code: goalId, title: goal.title })
    } else {
      inserts.push({ kind: 'projectGoal', code: goalId, title: goal.title })
    }
  }

  for (const ws of plan.workstreams) {
    const existingWorkstream = await classify('workstream', 'workstream', ws, ws.name, { projectId: existingProject?.id })
    const wsScope = { workstreamId: existingWorkstream?.id }
    const msGateScope = { projectId: existingProject?.id, workstreamId: existingWorkstream?.id }
    for (const c of ws.containers || []) await classify('workContainer', 'container', c, c.title, wsScope)
    for (const i of ws.items || []) await classify('workItem', 'item', i, i.title, wsScope)
    for (const m of ws.milestones || []) await classify('milestone', 'milestone', m, m.title, msGateScope)
    for (const g of ws.gates || []) await classify('gate', 'gate', g, g.title, msGateScope)
  }
  // Repositories keep code-only identity (they are our own registry, not a
  // customer record), so they are classified without external refs.
  for (const r of plan.repositories || []) {
    const existing = await db.repository.findUnique({ where: { code: r.code } })
    if (existing) updates.push({ kind: 'repository', code: r.code, title: r.fullName || r.code })
    else inserts.push({ kind: 'repository', code: r.code, title: r.fullName || r.code })
  }

  const dependencyCount = (plan.dependencies || []).length
  const externalRefCount = Object.values(resolution).reduce((s, r) => s + r.refs.length, 0)

  return {
    valid: conflicts.length === 0,
    errors: conflicts.map((c) => `${c.kind} ${c.code}: ${c.reason}`),
    plan,
    workspace: { id: workspace.id, code: workspace.code, name: workspace.name, businessId: targetBusinessId },
    resolution,
    preview: {
      inserts,
      updates,
      conflicts,
      dependencyCount,
      goalLinkCount: goalIds.length,
      externalRefCount,
      matchedByExternalId: updates.filter((u) => u.matchedBy === 'externalRef').length,
      summary: {
        insertCount: inserts.length,
        updateCount: updates.length,
        conflictCount: conflicts.length,
      },
    },
  }
}

/**
 * Transactional commit. Re-runs dry-run first; refuses on conflicts.
 *
 * `viewer` is REQUIRED (@req FR-065) and is authorized by the dry run this
 * delegates to — one decision point, not two that could disagree.
 */
export async function commitPlan(rawPlan, { workspaceId, viewer, db = prisma } = {}) {
  const dry = await dryRunPlan(rawPlan, { workspaceId, viewer, db })
  if (!dry.valid) {
    return { committed: false, errors: dry.errors, preview: dry.preview }
  }
  const { plan, workspace, resolution } = dry
  const idempotencyKey = plan.schemaVersion === '1.2' ? plan.trace?.idempotencyKey : null
  const correlationId = plan.schemaVersion === '1.2' ? plan.trace?.correlationId : null
  const payloadHash = idempotencyKey ? normalizedPayloadHash(plan) : null
  const executionRunId = randomUUID()
  const executionStepId = randomUUID()
  const attemptId = randomUUID()
  const stepKey = 'plan.import.commit'
  const replayOfExecutionRunId = plan.trace?.replayOfExecutionRunId || null
  const replayOfExecutionStepId = plan.trace?.replayOfExecutionStepId || null

  const result = await db.$transaction(async (tx) => {
    if (idempotencyKey) {
      const existingReceipt = await tx.planImportReceipt.findUnique({
        where: { idempotencyKey },
        include: { project: true },
      })
      if (existingReceipt) {
        if (existingReceipt.payloadHash !== payloadHash) {
          return {
            idempotencyConflict: true,
            errors: [`Idempotency key "${idempotencyKey}" was already used with a different payload`],
          }
        }

        const auditEvents = await tx.auditEvent.findMany({
          where: { action: 'PLAN_IMPORTED', entityId: existingReceipt.projectId },
          orderBy: { occurredAt: 'asc' },
        })
        const originalAudit = auditEvents
          .map((event) => ({ event, payload: readAuditPayload(event.payloadJson) }))
          .find(({ payload }) => payload?.idempotencyKey === idempotencyKey && payload?.executionRunId === existingReceipt.executionRunId)

        return {
          replay: true,
          projectId: existingReceipt.projectId,
          projectCode: existingReceipt.project.code,
          executionRunId: existingReceipt.executionRunId,
          executionStepId: existingReceipt.executionStepId,
          attemptId: existingReceipt.attemptId,
          stepKey: existingReceipt.stepKey,
          status: existingReceipt.status,
          auditEventId: existingReceipt.auditEventId,
          replayOfExecutionRunId: existingReceipt.replayOfExecutionRunId,
          replayOfExecutionStepId: existingReceipt.replayOfExecutionStepId,
          preview: originalAudit?.payload?.resultPreview || dry.preview,
        }
      }
    }

    const codeToEntity = new Map() // code -> { kind, id }
    const now = new Date()

    /**
     * Write one entity through the identity decided in the dry run:
     * an external-id match updates that exact record (our code is left alone),
     * everything else upserts by code. Mappings are then (re)attached.
     */
    const write = async (model, kind, code, update, create) => {
      const decided = resolution[code]
      const record =
        decided?.matchedBy === 'externalRef'
          ? await tx[model].update({ where: { id: decided.entityId }, data: update })
          : await tx[model].upsert({ where: { code }, update, create })
      if (decided?.refs?.length) {
        await syncExternalRefs(tx, { kind, entityId: record.id, refs: decided.refs }, now)
      }
      codeToEntity.set(code, { kind, id: record.id })
      return record
    }

    // Project (external id first, then code).
    const project = await write(
      'project',
      'project',
      plan.project.code,
      {
        businessId: workspace.businessId || null,
        workspaceId: workspace.id,
        name: plan.project.name,
        description: plan.project.description ?? undefined,
        type: plan.project.type ?? undefined,
        status: plan.project.status ?? undefined,
        targetAt: plan.project.targetAt ? new Date(plan.project.targetAt) : undefined,
        version: { increment: 1 },
      },
      {
        code: plan.project.code,
        businessId: workspace.businessId || null,
        workspaceId: workspace.id,
        name: plan.project.name,
        description: plan.project.description ?? null,
        type: plan.project.type || 'GENERAL',
        status: plan.project.status || 'PLANNED',
        targetAt: plan.project.targetAt ? new Date(plan.project.targetAt) : null,
      }
    )

    for (const goalId of plan.project.goalIds || []) {
      await tx.projectGoal.upsert({
        where: { projectId_goalId: { projectId: project.id, goalId } },
        update: {},
        create: { projectId: project.id, goalId },
      })
    }

    for (const ws of plan.workstreams) {
      const workstreamIdentity = {
        executionModeId: ws.executionModeId ?? null,
        executionContractId: ws.executionContractId ?? null,
        contractVersion: ws.contractVersion ?? null,
        primaryDomainId: plan.domainBinding?.primaryDomainId ?? null,
        supportingDomainIdsJson: JSON.stringify(plan.domainBinding?.supportingDomainIds || []),
        technicalOwnerDomainId: plan.domainBinding?.technicalOwnerDomainId ?? null,
        identityRefsJson: JSON.stringify(plan.identityRefs || {}),
      }
      const workstream = await write(
        'workstream',
        'workstream',
        ws.code,
        {
          name: ws.name,
          executionMode: ws.executionMode,
          progressStrategy: ws.progressStrategy,
          progressWeight: ws.progressWeight ?? 1,
          ...workstreamIdentity,
          version: { increment: 1 },
        },
        {
          code: ws.code,
          projectId: project.id,
          name: ws.name,
          executionMode: ws.executionMode,
          ...workstreamIdentity,
          progressStrategy: ws.progressStrategy,
          progressWeight: ws.progressWeight ?? 1,
          status: 'PLANNED',
        }
      )

      const containerIdByCode = new Map()
      for (const c of ws.containers || []) {
        const container = await write(
          'workContainer',
          'container',
          c.code,
          {
            title: c.title,
            subtype: c.subtype,
            status: c.status ?? undefined,
            metadataJson: c.metadata ? JSON.stringify(c.metadata) : undefined,
            version: { increment: 1 },
          },
          {
            code: c.code,
            workstreamId: workstream.id,
            subtype: c.subtype,
            title: c.title,
            status: c.status || 'PLANNED',
            metadataJson: JSON.stringify(c.metadata || {}),
          }
        )
        containerIdByCode.set(c.code, container.id)
      }
      // Second pass: parent linkage.
      for (const c of ws.containers || []) {
        if (c.parentCode) {
          await tx.workContainer.update({
            where: { code: c.code },
            data: { parentId: containerIdByCode.get(c.parentCode) },
          })
        }
      }

      for (const i of ws.items || []) {
        await write(
          'workItem',
          'item',
          i.code,
          {
            title: i.title,
            subtype: i.subtype,
            status: i.status ?? undefined,
            containerId: i.containerCode ? containerIdByCode.get(i.containerCode) : undefined,
            weight: i.weight ?? undefined,
            numericValue: i.numericValue ?? undefined,
            probability: i.probability ?? undefined,
            metricDataJson: i.metrics ? JSON.stringify(i.metrics) : undefined,
            metadataJson: i.metadata ? JSON.stringify(i.metadata) : undefined,
            version: { increment: 1 },
          },
          {
            code: i.code,
            workstreamId: workstream.id,
            containerId: i.containerCode ? containerIdByCode.get(i.containerCode) : null,
            subtype: i.subtype,
            title: i.title,
            status: i.status || 'PLANNED',
            weight: i.weight ?? 1,
            numericValue: i.numericValue ?? null,
            probability: i.probability ?? null,
            metricDataJson: JSON.stringify(i.metrics || {}),
            metadataJson: JSON.stringify(i.metadata || {}),
          }
        )
      }

      for (const m of ws.milestones || []) {
        await write(
          'milestone',
          'milestone',
          m.code,
          { title: m.title, status: m.status ?? undefined, weight: m.weight ?? undefined },
          {
            code: m.code,
            projectId: project.id,
            workstreamId: workstream.id,
            title: m.title,
            status: m.status || 'PLANNED',
            weight: m.weight ?? 1,
          }
        )
      }

      for (const g of ws.gates || []) {
        await write(
          'gate',
          'gate',
          g.code,
          {
            title: g.title,
            status: g.status ?? undefined,
            required: g.required ?? undefined,
            evidenceJson: g.evidence ? JSON.stringify(g.evidence) : undefined,
          },
          {
            code: g.code,
            projectId: project.id,
            workstreamId: workstream.id,
            title: g.title,
            status: g.status || 'OPEN',
            required: g.required ?? true,
            evidenceJson: JSON.stringify(g.evidence || {}),
          }
        )
      }
    }

    for (const r of plan.repositories || []) {
      const [ownerName, repoName] = (r.fullName || '').split('/')
      const repo = await tx.repository.upsert({
        where: { code: r.code },
        update: { provider: r.provider, fullName: r.fullName ?? undefined, url: r.url ?? undefined },
        create: {
          code: r.code,
          provider: r.provider,
          fullName: r.fullName ?? null,
          ownerName: ownerName || null,
          repoName: repoName || null,
          url: r.url ?? null,
        },
      })
      const role = r.role || 'REFERENCE'
      const existingLink = await tx.projectRepository.findFirst({
        where: { projectId: project.id, repoId: repo.id, role },
      })
      if (!existingLink) {
        await tx.projectRepository.create({
          data: { projectId: project.id, repoId: repo.id, role, pathScope: r.pathScope ?? null },
        })
      }
    }

    for (const d of plan.dependencies || []) {
      const source = codeToEntity.get(d.sourceRef)
      const target = codeToEntity.get(d.targetRef)
      if (!source || !target) continue // semantically validated already; belt-and-braces
      const data = {
        sourceType: KIND_TO_ENDPOINT[source.kind],
        sourceId: source.id,
        targetType: KIND_TO_ENDPOINT[target.kind],
        targetId: target.id,
        dependencyType: d.type,
      }
      const existing = await tx.dependency.findFirst({ where: data })
      if (!existing) await tx.dependency.create({ data })
    }

    const auditEvent = await recordAudit(tx, {
      entityType: 'PROJECT',
      entityId: project.id,
      action: 'PLAN_IMPORTED',
      actorType: 'AGENT_PLAN',
      payload: {
        projectCode: plan.project.code,
        generatedBy: plan.generatedBy || null,
        schemaVersion: plan.schemaVersion,
        correlationId,
        idempotencyKey,
        executionRunId,
        executionStepId,
        attemptId,
        stepKey,
        replayOfExecutionRunId,
        replayOfExecutionStepId,
        workstreams: plan.workstreams.length,
        goalLinks: (plan.project.goalIds || []).length,
        inserts: dry.preview.summary.insertCount,
        updates: dry.preview.summary.updateCount,
        externalRefs: dry.preview.externalRefCount,
        matchedByExternalId: dry.preview.matchedByExternalId,
        resultPreview: dry.preview,
      },
    })

    if (idempotencyKey) {
      await tx.planImportReceipt.create({
        data: {
          idempotencyKey,
          payloadHash,
          executionRunId,
          executionStepId,
          attemptId,
          stepKey,
          status: 'SUCCEEDED',
          correlationId,
          schemaVersion: plan.schemaVersion,
          projectId: project.id,
          replayOfExecutionRunId,
          replayOfExecutionStepId,
          auditEventId: auditEvent.id,
        },
      })
    }

    return {
      projectId: project.id,
      projectCode: project.code,
      executionRunId,
      executionStepId,
      attemptId,
      stepKey,
      status: 'SUCCEEDED',
      auditEventId: auditEvent.id,
      replayOfExecutionRunId,
      replayOfExecutionStepId,
      preview: dry.preview,
    }
  })

  if (result.idempotencyConflict) {
    return { committed: false, errors: result.errors, preview: dry.preview }
  }
  return { committed: true, ...result }
}
