import prisma from '@/lib/db'
import { zPlanEnvelope, validatePlanSemantics } from './plan-schema'
import { recordAudit } from '../application/audit'

// @req FR-012 — dry-run preview + transactional commit + audit
// @spec SDD-006, SEC-002, BR-009 — single transaction; unified intake pipeline
// @tested tests/integration/plan-import.test.js
// PlanEnvelope import pipeline:
//   JSON → Zod validation → semantic validation → dry-run diff → transactional commit → AuditEvent.
// Imported plans are data only; nothing in a plan is ever executed.

const KIND_TO_ENDPOINT = {
  project: 'PROJECT',
  workstream: 'WORKSTREAM',
  milestone: 'MILESTONE',
  gate: 'GATE',
  container: 'WORK_CONTAINER',
  item: 'WORK_ITEM',
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
 * Validate + diff a plan against the current database. Read-only.
 * Returns { valid, errors, plan, workspace, preview } where preview lists
 * inserts / updates / conflicts per entity kind.
 */
export async function dryRunPlan(rawPlan, { workspaceId } = {}) {
  const parsed = zPlanEnvelope.safeParse(rawPlan)
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      preview: null,
    }
  }
  const plan = parsed.data
  const semanticErrors = validatePlanSemantics(plan)
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors, preview: null }
  }

  // Resolve target workspace: explicit id wins, else scope.workspaceCode.
  let workspace = null
  if (workspaceId) {
    workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } })
  } else if (plan.scope?.workspaceCode) {
    workspace = await prisma.workspace.findUnique({ where: { code: plan.scope.workspaceCode } })
  }
  if (!workspace) {
    return {
      valid: false,
      errors: [
        workspaceId
          ? `Target workspace not found: ${workspaceId}`
          : `Plan scope.workspaceCode "${plan.scope?.workspaceCode || '(none)'}" does not match an existing workspace — select a target workspace.`,
      ],
      preview: null,
    }
  }

  const inserts = []
  const updates = []
  const conflicts = []

  const existingProject = await prisma.project.findUnique({ where: { code: plan.project.code } })
  if (existingProject) {
    if (existingProject.workspaceId !== workspace.id) {
      conflicts.push({
        kind: 'project',
        code: plan.project.code,
        reason: `Project code exists in a different workspace (${existingProject.workspaceId})`,
      })
    } else {
      updates.push({ kind: 'project', code: plan.project.code, title: plan.project.name })
    }
  } else {
    inserts.push({ kind: 'project', code: plan.project.code, title: plan.project.name })
  }

  const classify = async (model, kind, code, title, extraConflictCheck) => {
    const existing = await prisma[model].findUnique({ where: { code } })
    if (!existing) {
      inserts.push({ kind, code, title })
      return
    }
    const conflict = extraConflictCheck ? extraConflictCheck(existing) : null
    if (conflict) conflicts.push({ kind, code, reason: conflict })
    else updates.push({ kind, code, title })
  }

  for (const ws of plan.workstreams) {
    await classify('workstream', 'workstream', ws.code, ws.name, (existing) =>
      existingProject && existing.projectId !== existingProject.id
        ? 'Workstream code belongs to a different project'
        : null
    )
    for (const c of ws.containers || []) await classify('workContainer', 'container', c.code, c.title)
    for (const i of ws.items || []) await classify('workItem', 'item', i.code, i.title)
    for (const m of ws.milestones || []) await classify('milestone', 'milestone', m.code, m.title)
    for (const g of ws.gates || []) await classify('gate', 'gate', g.code, g.title)
  }
  for (const r of plan.repositories || []) await classify('repository', 'repository', r.code, r.fullName || r.code)

  const dependencyCount = (plan.dependencies || []).length

  return {
    valid: conflicts.length === 0,
    errors: conflicts.map((c) => `${c.kind} ${c.code}: ${c.reason}`),
    plan,
    workspace: { id: workspace.id, code: workspace.code, name: workspace.name },
    preview: {
      inserts,
      updates,
      conflicts,
      dependencyCount,
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
 */
export async function commitPlan(rawPlan, { workspaceId } = {}) {
  const dry = await dryRunPlan(rawPlan, { workspaceId })
  if (!dry.valid) {
    return { committed: false, errors: dry.errors, preview: dry.preview }
  }
  const { plan, workspace } = dry

  const result = await prisma.$transaction(async (tx) => {
    const codeToEntity = new Map() // code -> { kind, id }

    // Project (upsert by code).
    const project = await tx.project.upsert({
      where: { code: plan.project.code },
      update: {
        name: plan.project.name,
        description: plan.project.description ?? undefined,
        type: plan.project.type ?? undefined,
        status: plan.project.status ?? undefined,
        version: { increment: 1 },
      },
      create: {
        code: plan.project.code,
        workspaceId: workspace.id,
        name: plan.project.name,
        description: plan.project.description ?? null,
        type: plan.project.type || 'GENERAL',
        status: plan.project.status || 'PLANNED',
      },
    })
    codeToEntity.set(plan.project.code, { kind: 'project', id: project.id })

    for (const ws of plan.workstreams) {
      const workstream = await tx.workstream.upsert({
        where: { code: ws.code },
        update: {
          name: ws.name,
          executionMode: ws.executionMode,
          progressStrategy: ws.progressStrategy,
          progressWeight: ws.progressWeight ?? 1,
          version: { increment: 1 },
        },
        create: {
          code: ws.code,
          projectId: project.id,
          name: ws.name,
          executionMode: ws.executionMode,
          progressStrategy: ws.progressStrategy,
          progressWeight: ws.progressWeight ?? 1,
          status: 'PLANNED',
        },
      })
      codeToEntity.set(ws.code, { kind: 'workstream', id: workstream.id })

      const containerIdByCode = new Map()
      for (const c of ws.containers || []) {
        const container = await tx.workContainer.upsert({
          where: { code: c.code },
          update: {
            title: c.title,
            subtype: c.subtype,
            status: c.status ?? undefined,
            metadataJson: c.metadata ? JSON.stringify(c.metadata) : undefined,
            version: { increment: 1 },
          },
          create: {
            code: c.code,
            workstreamId: workstream.id,
            subtype: c.subtype,
            title: c.title,
            status: c.status || 'PLANNED',
            metadataJson: JSON.stringify(c.metadata || {}),
          },
        })
        containerIdByCode.set(c.code, container.id)
        codeToEntity.set(c.code, { kind: 'container', id: container.id })
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
        const item = await tx.workItem.upsert({
          where: { code: i.code },
          update: {
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
          create: {
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
          },
        })
        codeToEntity.set(i.code, { kind: 'item', id: item.id })
      }

      for (const m of ws.milestones || []) {
        const milestone = await tx.milestone.upsert({
          where: { code: m.code },
          update: { title: m.title, status: m.status ?? undefined, weight: m.weight ?? undefined },
          create: {
            code: m.code,
            projectId: project.id,
            workstreamId: workstream.id,
            title: m.title,
            status: m.status || 'PLANNED',
            weight: m.weight ?? 1,
          },
        })
        codeToEntity.set(m.code, { kind: 'milestone', id: milestone.id })
      }

      for (const g of ws.gates || []) {
        const gate = await tx.gate.upsert({
          where: { code: g.code },
          update: {
            title: g.title,
            status: g.status ?? undefined,
            required: g.required ?? undefined,
            evidenceJson: g.evidence ? JSON.stringify(g.evidence) : undefined,
          },
          create: {
            code: g.code,
            projectId: project.id,
            workstreamId: workstream.id,
            title: g.title,
            status: g.status || 'OPEN',
            required: g.required ?? true,
            evidenceJson: JSON.stringify(g.evidence || {}),
          },
        })
        codeToEntity.set(g.code, { kind: 'gate', id: gate.id })
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

    await recordAudit(tx, {
      entityType: 'PROJECT',
      entityId: project.id,
      action: 'PLAN_IMPORTED',
      actorType: 'AGENT_PLAN',
      payload: {
        projectCode: plan.project.code,
        generatedBy: plan.generatedBy || null,
        workstreams: plan.workstreams.length,
        inserts: dry.preview.summary.insertCount,
        updates: dry.preview.summary.updateCount,
      },
    })

    return { projectId: project.id, projectCode: project.code }
  })

  return { committed: true, ...result, preview: dry.preview }
}
