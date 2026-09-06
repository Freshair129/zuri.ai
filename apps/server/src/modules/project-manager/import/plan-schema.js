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

// @req FR-012, FR-019, FR-069, FR-070 — PlanEnvelope validation, stable
// execution identities and semantics (shape + semantics)
// @spec FR-069, BR-004, BR-007, SEC-002 — unknown modes rejected; plans are data, never executed
// @spec SDD-002 — every status here is the Zod enum from the single source of
// truth, never `z.string()`
// @tested tests/unit/plan-schema.test.js, tests/unit/plan-status-vocabulary.test.js
// Zod mirror of contracts/plan-envelope.schema.json (schemaVersion 1.0 / 1.1 / 1.2).
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

const zTagRef = z.object({
  tagId: z.string().min(1).optional(),
  requestedTagCode: z.string().min(1).optional(),
}).strict().refine((value) => value.tagId || value.requestedTagCode, {
  message: 'tagRefs require tagId or requestedTagCode',
})

const zTrace = z.object({
  correlationId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  replayOfExecutionRunId: z.string().min(1).nullable().optional(),
  replayOfExecutionStepId: z.string().min(1).nullable().optional(),
}).strict()

const zDomainBinding = z.object({
  primaryDomainId: z.string().min(1).optional(),
  supportingDomainIds: z.array(z.string().min(1)).max(20).optional(),
  technicalOwnerDomainId: z.string().min(1).optional(),
}).strict()

const zIdentityRefs = z.object({
  gateIds: z.array(z.string().min(1)).max(100).optional(),
  artifactIds: z.array(z.string().min(1)).max(100).optional(),
  contractIds: z.array(z.string().min(1)).max(100).optional(),
  meetingIds: z.array(z.string().min(1)).max(100).optional(),
  callIds: z.array(z.string().min(1)).max(100).optional(),
  followupIds: z.array(z.string().min(1)).max(100).optional(),
  reqIds: z.array(z.string().min(1)).max(100).optional(),
  verifyIds: z.array(z.string().min(1)).max(100).optional(),
  integrationId: z.string().min(1).nullable().optional(),
  graphId: z.string().min(1).nullable().optional(),
  nodeIds: z.array(z.string().min(1)).max(100).optional(),
  edgeIds: z.array(z.string().min(1)).max(100).optional(),
  workflowContractId: z.string().min(1).nullable().optional(),
  workflowId: z.string().min(1).nullable().optional(),
  runbookId: z.string().min(1).nullable().optional(),
  runbookIds: z.array(z.string().min(1)).max(100).optional(),
  promotionId: z.string().min(1).nullable().optional(),
  promotionIds: z.array(z.string().min(1)).max(100).optional(),
  skillIds: z.array(z.string().min(1)).max(100).optional(),
  toolIds: z.array(z.string().min(1)).max(100).optional(),
}).strict()

const zWorkstream = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    executionMode: zExecutionMode,
    executionModeId: z.string().min(1).optional(),
    executionContractId: z.string().min(1).optional(),
    contractVersion: z.string().min(1).optional(),
    progressStrategy: zProgressStrategy,
    progressWeight: z.number().gt(0).optional(),
    containers: z.array(zContainer).optional(),
    items: z.array(zItem).optional(),
    milestones: z.array(zMilestone).optional(),
    gates: z.array(zGate).optional(),
    tagRefs: z.array(zTagRef).max(100).optional(),
    externalRefs,
  })
  .strict()

export const zPlanEnvelope = z
  .object({
    // 1.1 adds externalRefs; 1.2 adds stable identity and trace fields.
    schemaVersion: z.enum(['1.0', '1.1', '1.2']),
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
        riskIds: z.array(z.string().min(1)).max(100).refine(
          (ids) => new Set(ids).size === ids.length,
          { message: 'riskIds must contain unique Risk ids' },
        ).optional(),
        externalRefs,
      })
      .strict(),
    trace: zTrace.optional(),
    domainBinding: zDomainBinding.optional(),
    identityRefs: zIdentityRefs.optional(),
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

export const EXECUTION_MODE_IDS = Object.freeze({
  SOFTWARE_SPRINT: 'EXM-SOFTWARE-SPRINT',
  DATA_MIGRATION: 'EXM-DATA-MIGRATION',
  B2B_SALES: 'EXM-B2B-SALES',
  B2C_CAMPAIGN: 'EXM-B2C-CAMPAIGN',
  PRODUCT_LAUNCH: 'EXM-PRODUCT-LAUNCH',
  OPERATIONS: 'EXM-OPERATIONS',
  BUSINESS_EXPANSION: 'EXM-BUSINESS-EXPANSION',
})

export const EXECUTION_CONTRACT_IDS = Object.freeze({
  SOFTWARE_SPRINT: 'EXC-SOFTWARE-SPRINT-V1',
  DATA_MIGRATION: 'EXC-DATA-MIGRATION-V1',
  B2B_SALES: 'EXC-B2B-SALES-V1',
  B2C_CAMPAIGN: 'EXC-B2C-CAMPAIGN-V1',
  PRODUCT_LAUNCH: 'EXC-PRODUCT-LAUNCH-V1',
  OPERATIONS: 'EXC-OPERATIONS-V1',
  BUSINESS_EXPANSION: 'EXC-BUSINESS-EXPANSION-V1',
})

const MODE_BY_ID = Object.fromEntries(Object.entries(EXECUTION_MODE_IDS).map(([mode, id]) => [id, mode]))
const DEFAULT_DOMAIN_BINDINGS = Object.freeze({
  SOFTWARE_SPRINT: { primaryDomainId: 'DOM-DEVELOPMENT', supportingDomainIds: [] },
  DATA_MIGRATION: { primaryDomainId: 'DOM-DEVELOPMENT', supportingDomainIds: [] },
  B2B_SALES: { primaryDomainId: 'DOM-COMMERCE', supportingDomainIds: ['DOM-CRM'] },
  B2C_CAMPAIGN: { primaryDomainId: 'DOM-MARKETING', supportingDomainIds: ['DOM-CRM'] },
  PRODUCT_LAUNCH: { primaryDomainId: 'DOM-DEVELOPMENT', supportingDomainIds: ['DOM-COMMERCE', 'DOM-MARKETING', 'DOM-OPERATIONS'] },
  OPERATIONS: { primaryDomainId: 'DOM-OPERATIONS', supportingDomainIds: ['DOM-PEOPLE', 'DOM-COMMERCE'] },
  BUSINESS_EXPANSION: { primaryDomainId: 'DOM-OPERATIONS', supportingDomainIds: ['DOM-COMMERCE', 'DOM-PEOPLE', 'DOM-PLATFORM'] },
})

const EMPTY_IDENTITY_REFS = Object.freeze({
  gateIds: [], artifactIds: [], contractIds: [], meetingIds: [], callIds: [], followupIds: [], reqIds: [], verifyIds: [],
  integrationId: null, graphId: null, nodeIds: [], edgeIds: [], workflowContractId: null, workflowId: null,
  runbookId: null, runbookIds: [], promotionId: null, promotionIds: [], skillIds: [], toolIds: [],
})

function domainBindingForMode(mode) {
  const binding = DEFAULT_DOMAIN_BINDINGS[mode]
  return {
    primaryDomainId: binding.primaryDomainId,
    supportingDomainIds: [...binding.supportingDomainIds],
    technicalOwnerDomainId: 'TD-PROJECT-MANAGER',
  }
}

export function normalizePlanEnvelope(plan) {
  const normalized = {
    ...plan,
    project: { ...plan.project },
    workstreams: plan.workstreams.map((workstream) => {
      const mode = workstream.executionMode || MODE_BY_ID[workstream.executionModeId]
      return {
        ...workstream,
        executionMode: mode,
        executionModeId: workstream.executionModeId || EXECUTION_MODE_IDS[mode],
        executionContractId: workstream.executionContractId || EXECUTION_CONTRACT_IDS[mode],
        contractVersion: workstream.contractVersion || '1.0.0',
      }
    }),
    identityRefs: { ...EMPTY_IDENTITY_REFS, ...(plan.identityRefs || {}) },
  }
  if (!normalized.domainBinding) {
    normalized.domainBinding = domainBindingForMode(normalized.workstreams[0]?.executionMode || 'SOFTWARE_SPRINT')
  } else {
    normalized.domainBinding = {
      ...normalized.domainBinding,
      supportingDomainIds: normalized.domainBinding.supportingDomainIds || [],
    }
  }
  normalized.project.goalIds = normalized.project.goalIds || []
  normalized.project.riskIds = normalized.project.riskIds || []
  return normalized
}

/**
 * Semantic validation beyond shape:
 * - duplicate codes inside the envelope
 * - item.containerCode must reference a container in the same workstream
 * - container.parentCode must reference a container in the same workstream
 * - dependency refs must resolve to codes defined in the envelope (or the project)
 * Returns array of error strings (empty = valid).
 */
export function validatePlanSemantics(plan) {
  const normalized = normalizePlanEnvelope(plan)
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

  claim(normalized.project.code, 'project', normalized.project)
  if (normalized.schemaVersion === '1.2') {
    if (!normalized.trace?.correlationId) errors.push('trace.correlationId is required for schemaVersion 1.2')
    if (!normalized.trace?.idempotencyKey) errors.push('trace.idempotencyKey is required for schemaVersion 1.2')
    const binding = normalized.domainBinding
    if (!binding?.primaryDomainId) errors.push('domainBinding.primaryDomainId is required for schemaVersion 1.2')
    if (!binding?.technicalOwnerDomainId) errors.push('domainBinding.technicalOwnerDomainId is required for schemaVersion 1.2')
    if (binding?.technicalOwnerDomainId && binding.technicalOwnerDomainId !== 'TD-PROJECT-MANAGER') {
      errors.push('domainBinding.technicalOwnerDomainId must be TD-PROJECT-MANAGER')
    }
    const unsupportedRefs = Object.entries(normalized.identityRefs || {}).filter(([key, value]) => {
      if (Array.isArray(value)) return value.length > 0
      return value != null
    }).map(([key]) => key)
    if (unsupportedRefs.length) errors.push(`Supporting identity refs are unavailable in this slice: ${unsupportedRefs.join(', ')}`)
    if ((normalized.project.riskIds || []).length) errors.push('Risk ids are unavailable because no Project Manager Risk owner exists')
  }
  for (const ws of normalized.workstreams) {
    const modeContract = EXECUTION_MODE_CONTRACTS[ws.executionMode]
    const expectedModeId = EXECUTION_MODE_IDS[ws.executionMode]
    const expectedContractId = EXECUTION_CONTRACT_IDS[ws.executionMode]
    if (ws.executionModeId && ws.executionModeId !== expectedModeId) {
      errors.push(`Workstream "${ws.code}" executionModeId ${ws.executionModeId} does not match executionMode ${ws.executionMode}`)
    }
    if (ws.executionContractId && ws.executionContractId !== expectedContractId) {
      errors.push(`Workstream "${ws.code}" executionContractId ${ws.executionContractId} does not match executionMode ${ws.executionMode}`)
    }
    if (normalized.schemaVersion === '1.2' && (!ws.executionModeId || !ws.executionContractId || !ws.contractVersion)) {
      errors.push(`Workstream "${ws.code}" requires executionModeId, executionContractId and contractVersion for schemaVersion 1.2`)
    }
    if (normalized.schemaVersion === '1.2') {
      const expectedBinding = DEFAULT_DOMAIN_BINDINGS[ws.executionMode]
      const actualPrimary = normalized.domainBinding?.primaryDomainId
      if (expectedBinding && actualPrimary !== expectedBinding.primaryDomainId && ws.executionMode !== 'PRODUCT_LAUNCH') {
        errors.push(`Workstream "${ws.code}" primaryDomainId ${actualPrimary || '(missing)'} does not match ${expectedBinding.primaryDomainId}`)
      }
    }
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
  for (const r of normalized.repositories || []) claim(r.code, 'repository')

  for (const d of normalized.dependencies || []) {
    if (!allCodes.has(d.sourceRef)) errors.push(`Dependency sourceRef "${d.sourceRef}" does not resolve to any code in the plan`)
    if (!allCodes.has(d.targetRef)) errors.push(`Dependency targetRef "${d.targetRef}" does not resolve to any code in the plan`)
    if (d.sourceRef === d.targetRef) errors.push(`Dependency cannot reference itself ("${d.sourceRef}")`)
    if (allCodes.get(d.sourceRef) === 'repository' || allCodes.get(d.targetRef) === 'repository') {
      errors.push(`Dependencies cannot target repositories ("${d.sourceRef}" → "${d.targetRef}")`)
    }
  }
  return errors
}
