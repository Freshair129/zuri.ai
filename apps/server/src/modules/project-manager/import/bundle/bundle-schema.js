import { z } from 'zod'
import { zPlanEnvelope } from '../plan-schema'
import { DEPENDENCY_TYPES } from '@/lib/validation/enums'

// @req FR-108 — ExecutionPlanBundle runtime validator: the Zod mirror of
// contracts/execution-plan-bundle.schema.json, plus the bundle-level semantic
// checks (unique refs, reference integrity, dependency graph sanity) that a
// JSON Schema cannot express.
// @spec ADR-049, SDD-056, BR-007, BR-009, SEC-002 — strict() everywhere =
// additionalProperties:false; a bundle is data only and nothing in it is ever
// executed; nested plans stay the canonical zPlanEnvelope, never a fork.
// @tested tests/unit/bundle-schema.test.js, tests/integration/execution-plan-bundle.test.js

// ^[A-Za-z0-9][A-Za-z0-9._:-]*$ — same pattern as the JSON Schema $defs/ref and
// $defs/code (they are intentionally identical there too).
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

const zRef = z.string().min(1).max(128).regex(REF_PATTERN, 'must match ^[A-Za-z0-9][A-Za-z0-9._:-]*$')
const zCode = zRef

// JSON Schema `maxProperties` has no direct Zod counterpart; refine keeps the
// two contracts equivalent rather than silently weaker here.
const boundedRecord = (max) =>
  z.record(z.any()).refine((value) => Object.keys(value).length <= max, {
    message: `must not carry more than ${max} properties`,
  })

const zManifest = z
  .object({
    code: zCode,
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    createdBy: z.string().max(300).optional(),
  })
  .strict()

const zScope = z
  .object({
    // Selector inside the trusted viewer's authorization ceiling; never proof
    // of authority (ADR-049 D5).
    businessCode: zCode,
    defaultWorkspaceCode: zCode.optional(),
  })
  .strict()

const zHorizon = z
  .object({
    ref: zRef,
    key: z.string().min(1).max(100),
    label: z.string().min(1).max(300),
    position: z.number().int().min(0).max(10000),
  })
  .strict()

const zGoal = z
  .object({
    ref: zRef,
    code: zCode,
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    horizonRef: zRef.optional(),
    metadata: boundedRecord(50).optional(),
  })
  .strict()

const zRoadmap = z
  .object({
    code: zCode,
    title: z.string().min(1).max(300),
    description: z.string().max(5000).optional(),
  })
  .strict()

const zStrategy = z
  .object({
    roadmap: zRoadmap.optional(),
    horizons: z.array(zHorizon).max(100).default([]),
    goals: z.array(zGoal).max(1000).default([]),
  })
  .strict()

const zProjectEntry = z
  .object({
    bundleProjectRef: zRef,
    workspaceCode: zCode.optional(),
    goalRefs: z
      .array(zRef)
      .max(100)
      .refine((refs) => new Set(refs).size === refs.length, { message: 'goalRefs must be unique' })
      .default([]),
    plan: zPlanEnvelope,
  })
  .strict()

const zCrossProjectDependency = z
  .object({
    sourceProjectRef: zRef,
    targetProjectRef: zRef,
    // The JSON Schema keeps `relation` an open string and defers vocabulary to
    // the Project Manager's canonical dependency contract; that contract is the
    // DEPENDENCY_TYPES enum (src/lib/validation/enums.js), enforced here.
    relation: z.enum(DEPENDENCY_TYPES),
    description: z.string().max(2000).optional(),
    metadata: boundedRecord(50).optional(),
  })
  .strict()

const zTrace = z
  .object({
    correlationId: z.string().min(1).max(256).optional(),
    idempotencyKey: z.string().min(1).max(256).optional(),
    sourceType: z.enum(['HUMAN', 'AGENT', 'API', 'MCP', 'IMPORT', 'OTHER']).optional(),
    sourceRef: z.string().max(1000).optional(),
    replayOfBundleRunId: z.string().max(256).optional(),
  })
  .strict()

export const zExecutionPlanBundle = z
  .object({
    kind: z.literal('EXECUTION_PLAN_BUNDLE'),
    schemaVersion: z.literal('1.0'),
    manifest: zManifest,
    scope: zScope,
    strategy: zStrategy.optional(),
    projects: z.array(zProjectEntry).min(1).max(100),
    dependencies: z.array(zCrossProjectDependency).max(1000).default([]),
    trace: zTrace.optional(),
    // Non-authoritative package metadata. Never executed, never an authority
    // input — the orchestrator does not read it at all.
    metadata: boundedRecord(50).optional(),
  })
  .strict()

/**
 * Bundle-level semantic validation, beyond shape (ADR-049 D3 "validate
 * bundle-level semantics and unique refs"). Pure — no I/O, no clock.
 * Returns an array of error strings; empty = valid.
 *
 * Everything here fails closed: an unknown or duplicate symbol is an error,
 * never a guess (D4). Cycles are checked over the bundle's own dependency
 * edges; edges already in the database are re-checked against the combined
 * graph by the dry-run, which can read.
 */
export function validateBundleSemantics(bundle) {
  const errors = []
  const strategy = bundle.strategy

  // -- strategy symbols ------------------------------------------------------
  const horizonRefs = new Map() // ref -> horizon
  if (strategy) {
    if ((strategy.horizons.length > 0 || strategy.goals.length > 0) && !strategy.roadmap) {
      errors.push('strategy.horizons/goals require strategy.roadmap — horizons and goals live on a Roadmap')
    }
    const horizonKeys = new Set()
    const horizonPositions = new Set()
    for (const horizon of strategy.horizons) {
      if (horizonRefs.has(horizon.ref)) errors.push(`Duplicate horizon ref "${horizon.ref}"`)
      else horizonRefs.set(horizon.ref, horizon)
      if (horizonKeys.has(horizon.key)) errors.push(`Duplicate horizon key "${horizon.key}"`)
      horizonKeys.add(horizon.key)
      if (horizonPositions.has(horizon.position)) errors.push(`Duplicate horizon position ${horizon.position}`)
      horizonPositions.add(horizon.position)
    }
    const goalRefs = new Set()
    const goalCodes = new Set()
    for (const goal of strategy.goals) {
      if (goalRefs.has(goal.ref)) errors.push(`Duplicate goal ref "${goal.ref}"`)
      goalRefs.add(goal.ref)
      if (goalCodes.has(goal.code)) errors.push(`Duplicate goal code "${goal.code}"`)
      goalCodes.add(goal.code)
      if (goal.horizonRef && !horizonRefs.has(goal.horizonRef)) {
        errors.push(`Goal "${goal.ref}" references unknown horizonRef "${goal.horizonRef}"`)
      }
    }
  }

  // -- project symbols -------------------------------------------------------
  const projectRefs = new Set()
  const projectCodes = new Set()
  const declaredGoalRefs = new Set((strategy?.goals || []).map((goal) => goal.ref))
  for (const entry of bundle.projects) {
    if (projectRefs.has(entry.bundleProjectRef)) {
      errors.push(`Duplicate bundleProjectRef "${entry.bundleProjectRef}"`)
    }
    projectRefs.add(entry.bundleProjectRef)
    const code = entry.plan?.project?.code
    if (code) {
      if (projectCodes.has(code)) errors.push(`Two bundle Project entries carry the same project code "${code}"`)
      projectCodes.add(code)
    }
    for (const goalRef of entry.goalRefs) {
      if (!declaredGoalRefs.has(goalRef)) {
        errors.push(`Project "${entry.bundleProjectRef}" references unknown goalRef "${goalRef}"`)
      }
    }
  }

  // -- cross-project dependencies -------------------------------------------
  const seenEdges = new Set()
  const adjacency = new Map() // sourceRef -> Set(targetRef)
  for (const dependency of bundle.dependencies) {
    const { sourceProjectRef: source, targetProjectRef: target, relation } = dependency
    if (!projectRefs.has(source)) errors.push(`Dependency sourceProjectRef "${source}" does not resolve to any bundle Project`)
    if (!projectRefs.has(target)) errors.push(`Dependency targetProjectRef "${target}" does not resolve to any bundle Project`)
    if (source === target) errors.push(`Cross-project dependency cannot reference itself ("${source}")`)
    const edgeKey = `${source}→${target}:${relation}`
    if (seenEdges.has(edgeKey)) errors.push(`Duplicate cross-project dependency ${edgeKey}`)
    seenEdges.add(edgeKey)
    if (!adjacency.has(source)) adjacency.set(source, new Set())
    adjacency.get(source).add(target)
  }

  // Intra-bundle cycle detection (DFS with colors). A programme that blocks
  // itself cannot be ordered, so it is refused before any preview math.
  const state = new Map() // ref -> 'visiting' | 'done'
  const visit = (node, path) => {
    if (state.get(node) === 'done') return
    if (state.get(node) === 'visiting') {
      errors.push(`Cross-project dependencies form a cycle: ${[...path, node].join(' → ')}`)
      return
    }
    state.set(node, 'visiting')
    for (const next of adjacency.get(node) || []) visit(next, [...path, node])
    state.set(node, 'done')
  }
  for (const node of adjacency.keys()) visit(node, [])

  return errors
}
