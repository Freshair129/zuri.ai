import { z } from 'zod'
import {
  zExecutionMode,
  zProgressStrategy,
  zDependencyType,
  zProjectStatus,
  zContainerStatus,
  // No zWorkstreamStatus: the envelope carries no workstream status field, and
  // importing an enum this file does not use would be the first step toward one.
  zWorkStatus,
  zMilestoneStatus,
  zGateStatus,
  EXECUTION_MODE_CONTRACTS,
} from '@/lib/validation/enums'

// @req FR-012, FR-019 — PlanEnvelope validation (shape + semantics)
// @spec FR-069, BR-004, BR-007, SEC-002 — unknown modes rejected; plans are data, never executed
// @spec SDD-002 — every status here is the Zod enum from the single source of
// truth, never `z.string()`
// @tested tests/unit/plan-schema.test.js, tests/unit/plan-status-vocabulary.test.js
// Zod mirror of contracts/plan-envelope.schema.json (schemaVersion 1.0 / 1.1).
// strict() everywhere = additionalProperties:false. Never executes plan content.
//
// `status` was typed `z.string()` on all five entities while `executionMode`,
// `progressStrategy` and `dependencyType` beside it were enum-typed. An import
// could therefore commit `status: 'BANANA'` — proven, it persisted — and the
// consequence is not cosmetic: the FR-063 board derives its columns from
// `WORK_STATUSES`, so an item carrying a status outside that list has no column
// to land in and vanishes from the board entirely. That is the exact failure
// FR-063 exists to prevent, arriving through the intake surface instead of
// through a hand-written column list.
//
// The same rule, one level apart, enforced in one place and not the other — the
// shape this repository has now diagnosed nine times. The Excel template already
// constrained item/milestone/gate status from these enums; the schema that
// actually validates constrained none of them.
//
// `subtype` stays `z.string()` on purpose: CONTAINER_SUBTYPES and ITEM_SUBTYPES
// are documented as an OPEN set (enums.js), and the mode contract already
// restricts which subtypes a workstream may carry. `project.type` stays a string
// because no PROJECT_TYPES vocabulary is declared anywhere — inventing one here
// would be the hand-written list this rule forbids.

// FR-019 — the customer's own core id, carried alongside our code. It maps to
// an internal UUID and may act as the display label; it never becomes a key.
export const zExternalRef = z
  .object({
    system: z.string().min(1),
    id: z.string().min(1),
    labelAs: z.boolean().optional(),
  })
  .strict()

const externalRefs = z.array(zExternalRef).optional()

const zContainer = z
  .object({
    code: z.string().min(1),
    parentCode: z.string().optional(),
    subtype: z.string().min(1),
    title: z.string().min(1),
    status: zContainerStatus.optional(),
    metadata: z.record(z.any()).optional(),
    externalRefs,
  })
  .strict()

const zItem = z
  .object({
    code: z.string().min(1),
    containerCode: z.string().optional(),
    subtype: z.string().min(1),
    title: z.string().min(1),
    status: zWorkStatus.optional(),
    weight: z.number().optional(),
    numericValue: z.number().optional(),
    probability: z.number().min(0).max(1).optional(),
    metrics: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
    externalRefs,
  })
  .strict()

const zMilestone = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    status: zMilestoneStatus.optional(),
    weight: z.number().optional(),
    externalRefs,
  })
  .strict()

const zGate = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    status: zGateStatus.optional(),
    required: z.boolean().optional(),
    evidence: z.record(z.any()).optional(),
    externalRefs,
  })
  .strict()

const zWorkstream = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    executionMode: zExecutionMode,
    progressStrategy: zProgressStrategy,
    progressWeight: z.number().gt(0).optional(),
    containers: z.array(zContainer).optional(),
    items: z.array(zItem).optional(),
    milestones: z.array(zMilestone).optional(),
    gates: z.array(zGate).optional(),
    externalRefs,
  })
  .strict()

export const zPlanEnvelope = z
  .object({
    // 1.1 adds externalRefs; 1.0 envelopes stay valid (fields are optional).
    schemaVersion: z.enum(['1.0', '1.1']),
    generatedBy: z.string().optional(),
    generatedAt: z.string().optional(),
    scope: z
      .object({
        portfolioCode: z.string().optional(),
        tenantCode: z.string().optional(),
        businessCode: z.string().optional(),
        workspaceCode: z.string().optional(),
      })
      .strict()
      .optional(),
    project: z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        type: z.string().optional(),
        status: zProjectStatus.optional(),
        targetAt: z.union([z.string().datetime(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).optional(),
        // Optional links to existing BusinessGoal rows. The import service
        // resolves them inside the target Business and creates ProjectGoal
        // links transactionally; it never creates or copies a Goal.
        goalIds: z.array(z.string().min(1)).max(100).refine(
          (ids) => new Set(ids).size === ids.length,
          { message: 'goalIds must contain unique Business Goal ids' },
        ).optional(),
        externalRefs,
      })
      .strict(),
    workstreams: z.array(zWorkstream),
    repositories: z
      .array(
        z
          .object({
            code: z.string().min(1),
            provider: z.string().min(1),
            fullName: z.string().optional(),
            url: z.string().optional(),
            role: z.string().optional(),
            pathScope: z.string().optional(),
          })
          .strict()
      )
      .optional(),
    dependencies: z
      .array(
        z
          .object({
            sourceRef: z.string().min(1),
            targetRef: z.string().min(1),
            type: zDependencyType,
          })
          .strict()
      )
      .optional(),
  })
  .strict()

/**
 * Semantic validation beyond shape:
 * - duplicate codes inside the envelope
 * - item.containerCode must reference a container in the same workstream
 * - container.parentCode must reference a container in the same workstream
 * - dependency refs must resolve to codes defined in the envelope (or the project)
 * Returns array of error strings (empty = valid).
 */
export function validatePlanSemantics(plan) {
  const errors = []
  const allCodes = new Map() // code -> kind
  const externalIds = new Map() // "SYSTEM|value" -> code that claimed it

  // FR-019 — one external id may point at exactly one record. Two entities in
  // the same batch claiming it is ambiguous, so it is rejected, never guessed.
  const claimExternal = (entity, code) => {
    for (const ref of entity.externalRefs || []) {
      const key = `${ref.system}|${ref.id}`
      if (externalIds.has(key)) {
        errors.push(
          `External id ${ref.system}:${ref.id} is claimed twice in this plan ("${externalIds.get(key)}" and "${code}")`
        )
      } else {
        externalIds.set(key, code)
      }
    }
  }

  const claim = (code, kind, entity) => {
    if (allCodes.has(code)) {
      errors.push(`Duplicate code "${code}" (${allCodes.get(code)} vs ${kind})`)
    } else {
      allCodes.set(code, kind)
    }
    if (entity) claimExternal(entity, code)
  }

  claim(plan.project.code, 'project', plan.project)
  for (const ws of plan.workstreams) {
    const modeContract = EXECUTION_MODE_CONTRACTS[ws.executionMode]
    if (ws.progressStrategy !== modeContract.progressStrategy) {
      errors.push(`Workstream "${ws.code}" mode ${ws.executionMode} requires progressStrategy ${modeContract.progressStrategy}`)
    }
    claim(ws.code, 'workstream', ws)
    const containerCodes = new Set()
    for (const c of ws.containers || []) {
      if (!modeContract.containerSubtypes.includes(c.subtype)) {
        errors.push(`Workstream "${ws.code}" mode ${ws.executionMode} does not allow container subtype "${c.subtype}"; expected one of ${modeContract.containerSubtypes.join(', ')}`)
      }
      claim(c.code, 'container', c)
      containerCodes.add(c.code)
    }
    for (const c of ws.containers || []) {
      if (c.parentCode && !containerCodes.has(c.parentCode)) {
        errors.push(`Container "${c.code}" references unknown parent "${c.parentCode}"`)
      }
      if (c.parentCode === c.code) {
        errors.push(`Container "${c.code}" cannot be its own parent`)
      }
    }
    for (const i of ws.items || []) {
      if (!modeContract.itemSubtypes.includes(i.subtype)) {
        errors.push(`Workstream "${ws.code}" mode ${ws.executionMode} does not allow item subtype "${i.subtype}"; expected one of ${modeContract.itemSubtypes.join(', ')}`)
      }
      const unknownMetricKeys = Object.keys(i.metrics || {}).filter((key) => !modeContract.metricKeys.includes(key))
      for (const key of unknownMetricKeys) {
        errors.push(`Workstream "${ws.code}" mode ${ws.executionMode} does not allow metric key "${key}"`)
      }
      claim(i.code, 'item', i)
      if (i.containerCode && !containerCodes.has(i.containerCode)) {
        errors.push(`Item "${i.code}" references unknown container "${i.containerCode}" in workstream "${ws.code}"`)
      }
    }
    for (const m of ws.milestones || []) claim(m.code, 'milestone', m)
    for (const g of ws.gates || []) claim(g.code, 'gate', g)
  }
  for (const r of plan.repositories || []) claim(r.code, 'repository')

  for (const d of plan.dependencies || []) {
    if (!allCodes.has(d.sourceRef)) errors.push(`Dependency sourceRef "${d.sourceRef}" does not resolve to any code in the plan`)
    if (!allCodes.has(d.targetRef)) errors.push(`Dependency targetRef "${d.targetRef}" does not resolve to any code in the plan`)
    if (d.sourceRef === d.targetRef) errors.push(`Dependency cannot reference itself ("${d.sourceRef}")`)
    if (allCodes.get(d.sourceRef) === 'repository' || allCodes.get(d.targetRef) === 'repository') {
      errors.push(`Dependencies cannot target repositories ("${d.sourceRef}" → "${d.targetRef}")`)
    }
  }
  return errors
}
