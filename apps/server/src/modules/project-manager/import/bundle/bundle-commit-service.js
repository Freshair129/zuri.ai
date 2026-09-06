import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import {
  createGoal,
  createRoadmap,
  updateGoal,
  updateRoadmap,
} from '../../application/business-strategy-mutation-service'
import { commitPlan } from '../plan-import-service'
import { dryRunBundle } from './bundle-dry-run'
import { findBundleReplay, normalizedBundleHash, recordBundleReceipt } from './bundle-receipt'

// @req FR-108 — Phase G: the confirmed bundle commit (ADR-049 D3/D8/D9).
// @spec ADR-049, SDD-056, BR-007, BR-009, SEC-001, SEC-002, SEC-003
// @tested tests/integration/execution-plan-bundle.test.js
//
// COMMIT MODE: **ATOMIC** (ADR-049 D8, first implementation). Every model this
// bundle touches — BusinessRoadmap, BusinessRoadmapHorizon, BusinessGoal,
// ProjectGoal, Project, Workstream, WorkContainer, WorkItem, Milestone, Gate,
// Repository, Dependency, AuditEvent, PlanImportReceipt — lives in the one
// Project Manager database, so ONE interactive Prisma transaction owns all
// writes: strategy → N × PlanEnvelope commit → cross-Project dependencies →
// bundle receipt/audit, in reference order. A failure anywhere rolls the whole
// programme back; there is no partial state to report and no coordinated state
// machine to run. A future bundle that must span an external owning service
// cannot reuse this path as-is — it must implement D8's coordinated mode
// (explicit step receipts, COMMITTED/PARTIAL_FAILURE/ROLLED_BACK) instead of
// pretending distributed atomicity.
//
// This orchestrator writes NO table directly except through the services it
// composes: strategy rows through the FR-059 mutation service, Projects and
// their trees through the existing FR-012/069 commitPlan, receipts through
// bundle-receipt. The single exception is the cross-Project Dependency edge,
// which is written here with the same findFirst-then-create discipline
// plan-import-service itself uses for in-plan edges — the import lane is the
// sanctioned dependency writer for edges arriving in an import artifact
// (BR-009: one intake pipeline), and both endpoints are Projects this same
// transaction just committed inside the one authorized Business.
//
// Bundles are data only (BR-007/SEC-002/D6): nothing in the artifact is
// executed; only contract fields are interpreted and only the services above
// are ever invoked.

/**
 * Present a Prisma interactive-transaction client as a `db` a composed
 * service can use even when that service wraps its own writes in
 * `db.$transaction(fn)`: the nested call simply continues on THIS transaction
 * (the outer transaction is the unit of atomicity, per the D8 comment above).
 */
function asTransactionDb(tx) {
  const proxy = new Proxy(tx, {
    get(target, prop) {
      if (prop === '$transaction') return async (fn) => fn(proxy)
      const value = target[prop]
      // Bind against the real client so Prisma's own internals keep their
      // `this`; only $transaction is virtualized.
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return proxy
}

// A 100-Project bundle is thousands of upserts; the 5s interactive-transaction
// default is sized for a single envelope, not a programme.
const BUNDLE_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 120_000 }

class BundleCommitError extends Error {
  constructor(errors) {
    super(errors[0] ?? 'Bundle commit failed')
    this.errors = errors
  }
}

/** Apply the strategy section through the FR-059 services; returns ref → goal id. */
async function applyStrategy(bundle, { strategy, business, viewer, db }) {
  const goalIdByRef = new Map()
  for (const [ref, symbol] of strategy.goalsByRef) {
    if (symbol.status === 'EXISTING') goalIdByRef.set(ref, symbol.id)
  }
  if (!strategy.roadmap && strategy.goals.length === 0) return goalIdByRef

  const roadmapInput = bundle.strategy.roadmap
  const horizonInputs = bundle.strategy.horizons.map((horizon) => ({
    key: horizon.key,
    label: horizon.label,
    position: horizon.position,
  }))

  let roadmapDto = null
  if (strategy.roadmap?.action === 'INSERT') {
    roadmapDto = await createRoadmap(
      {
        businessId: business.id,
        code: roadmapInput.code,
        title: roadmapInput.title,
        description: roadmapInput.description,
        horizons: horizonInputs,
      },
      { db, viewer }
    )
  } else if (strategy.roadmap?.action === 'UPDATE') {
    roadmapDto = await updateRoadmap(
      strategy.roadmap.id,
      {
        title: roadmapInput.title,
        ...(roadmapInput.description !== undefined ? { description: roadmapInput.description } : {}),
        ...(horizonInputs.length > 0 ? { horizons: horizonInputs } : {}),
      },
      { db, viewer }
    )
  }

  const horizonIdByKey = new Map((roadmapDto?.horizons || []).map((horizon) => [horizon.key, horizon.id]))
  const horizonKeyByRef = new Map(bundle.strategy.horizons.map((horizon) => [horizon.ref, horizon.key]))
  const goalByRef = new Map(bundle.strategy.goals.map((goal) => [goal.ref, goal]))

  for (const action of strategy.goals) {
    const goal = goalByRef.get(action.ref)
    const horizonId = goal.horizonRef ? horizonIdByKey.get(horizonKeyByRef.get(goal.horizonRef)) : undefined
    if (action.action === 'INSERT') {
      if (!horizonId) throw new BundleCommitError([`Goal "${goal.ref}": horizonRef "${goal.horizonRef}" did not resolve to a committed horizon`])
      const created = await createGoal(
        {
          businessId: business.id,
          code: goal.code,
          horizonId,
          title: goal.title,
          description: goal.description,
        },
        { db, viewer }
      )
      goalIdByRef.set(action.ref, created.id)
    } else {
      await updateGoal(
        action.id,
        {
          title: goal.title,
          ...(goal.description !== undefined ? { description: goal.description } : {}),
          ...(horizonId ? { horizonId } : {}),
        },
        { db, viewer }
      )
      goalIdByRef.set(action.ref, action.id)
    }
  }

  return goalIdByRef
}

/**
 * Commit a whole ExecutionPlanBundle after one explicit confirmation (D7):
 * calling this endpoint IS the confirmation, exactly as it is for the
 * per-Project commit. Re-runs the bundle dry-run first and refuses on any
 * conflict — one decision point, not a stored preview that could go stale.
 */
export async function commitBundle(rawBundle, { viewer } = {}) {
  const dry = await dryRunBundle(rawBundle, { viewer })
  if (!dry.valid) {
    return { committed: false, errors: dry.errors, preview: dry.preview }
  }
  const { bundle, business, strategy } = dry
  const idempotencyKey = bundle.trace?.idempotencyKey ?? null
  const payloadHash = normalizedBundleHash(bundle)
  const bundleRunId = randomUUID()

  let result
  try {
    result = await prisma.$transaction(async (tx) => {
      const db = asTransactionDb(tx)

      if (idempotencyKey) {
        const prior = await findBundleReplay(tx, { idempotencyKey, payloadHash })
        if (prior?.conflict) return { idempotencyConflict: true, errors: prior.errors }
        if (prior?.replay) return { replay: true, receipt: prior.receipt }
      }

      // 1. Strategy, so every symbol has a canonical id before any plan needs it.
      const goalIdByRef = await applyStrategy(bundle, { strategy, business, viewer, db })

      // 2. Every Project through the EXISTING PlanEnvelope commit, inside this
      //    same transaction, with ALL goal refs now resolved to real UUIDs.
      const projects = []
      for (const entry of bundle.projects) {
        const projectPreview = dry.projects.find((project) => project.bundleProjectRef === entry.bundleProjectRef)
        const plan = structuredClone(entry.plan)
        const injectedGoalIds = entry.goalRefs.map((ref) => goalIdByRef.get(ref)).filter(Boolean)
        if (injectedGoalIds.length) {
          plan.project.goalIds = [...new Set([...(plan.project.goalIds || []), ...injectedGoalIds])]
        }
        const committed = await commitPlan(plan, { workspaceId: projectPreview?.workspaceId, viewer, db })
        if (!committed.committed) {
          throw new BundleCommitError(
            (committed.errors || ['commit refused']).map((error) => `Project "${entry.bundleProjectRef}": ${error}`)
          )
        }
        projects.push({
          bundleProjectRef: entry.bundleProjectRef,
          projectId: committed.projectId,
          projectCode: committed.projectCode,
          executionRunId: committed.executionRunId,
          auditEventId: committed.auditEventId,
          receiptIdempotencyKey: plan.schemaVersion === '1.2' ? plan.trace?.idempotencyKey ?? null : null,
          replay: committed.replay === true,
        })
      }

      // 3. Cross-Project dependency edges (see the file-top note on why this
      //    write lives in the import lane).
      const projectIdByRef = new Map(projects.map((project) => [project.bundleProjectRef, project.projectId]))
      const dependencies = []
      for (const dependency of bundle.dependencies) {
        const data = {
          sourceType: 'PROJECT',
          sourceId: projectIdByRef.get(dependency.sourceProjectRef),
          targetType: 'PROJECT',
          targetId: projectIdByRef.get(dependency.targetProjectRef),
          dependencyType: dependency.relation,
        }
        const existing = await tx.dependency.findFirst({ where: data })
        const row = existing ?? await tx.dependency.create({ data })
        dependencies.push({
          id: row.id,
          sourceProjectRef: dependency.sourceProjectRef,
          targetProjectRef: dependency.targetProjectRef,
          relation: dependency.relation,
          existed: Boolean(existing),
        })
      }

      // 4. Receipt + audit lineage (D9): the bundle occurrence, connected to
      //    every per-Project run it caused.
      const receipt = {
        bundleRunId,
        manifestCode: bundle.manifest.code,
        idempotencyKey,
        correlationId: bundle.trace?.correlationId ?? null,
        payloadHash,
        status: 'SUCCEEDED',
        business: { id: business.id, code: business.code },
        strategy: {
          roadmap: strategy.roadmap,
          goals: [...goalIdByRef.entries()].map(([ref, goalId]) => ({ ref, goalId })),
        },
        projects,
        dependencies,
      }
      const auditEvent = await recordBundleReceipt(tx, { bundle, business, payloadHash, receipt })
      return { receipt: { ...receipt, auditEventId: auditEvent.id } }
    }, BUNDLE_TRANSACTION_OPTIONS)
  } catch (error) {
    if (error instanceof BundleCommitError) {
      return { committed: false, errors: error.errors, preview: dry.preview }
    }
    // FR-059 services throw status-carrying errors for refusals the dry-run
    // could not fully anticipate (e.g. a concurrent write); surface them as a
    // refused commit, not a 500 — the transaction has already rolled back.
    if (error?.status && error.status < 500) {
      return { committed: false, errors: [error.message], preview: dry.preview }
    }
    throw error
  }

  if (result.idempotencyConflict) {
    return { committed: false, errors: result.errors, preview: dry.preview }
  }
  if (result.replay) {
    return { committed: true, replay: true, receipt: result.receipt, preview: dry.preview }
  }
  return { committed: true, replay: false, receipt: result.receipt, preview: dry.preview }
}
