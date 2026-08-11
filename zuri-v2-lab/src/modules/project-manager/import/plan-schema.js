import { z } from 'zod'
import { zExecutionMode, zProgressStrategy, zDependencyType } from '@/lib/validation/enums'

// @req FR-012 — PlanEnvelope validation (shape + semantics)
// @spec BR-004, BR-007, SEC-002 — unknown modes rejected; plans are data, never executed
// @tested tests/unit/plan-schema.test.js
// Zod mirror of contracts/plan-envelope.schema.json (schemaVersion 1.0).
// strict() everywhere = additionalProperties:false. Never executes plan content.

const zContainer = z
  .object({
    code: z.string().min(1),
    parentCode: z.string().optional(),
    subtype: z.string().min(1),
    title: z.string().min(1),
    status: z.string().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict()

const zItem = z
  .object({
    code: z.string().min(1),
    containerCode: z.string().optional(),
    subtype: z.string().min(1),
    title: z.string().min(1),
    status: z.string().optional(),
    weight: z.number().optional(),
    numericValue: z.number().optional(),
    probability: z.number().min(0).max(1).optional(),
    metrics: z.record(z.any()).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict()

const zMilestone = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    status: z.string().optional(),
    weight: z.number().optional(),
  })
  .strict()

const zGate = z
  .object({
    code: z.string().min(1),
    title: z.string().min(1),
    status: z.string().optional(),
    required: z.boolean().optional(),
    evidence: z.record(z.any()).optional(),
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
  })
  .strict()

export const zPlanEnvelope = z
  .object({
    schemaVersion: z.literal('1.0'),
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
        status: z.string().optional(),
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

  const claim = (code, kind) => {
    if (allCodes.has(code)) {
      errors.push(`Duplicate code "${code}" (${allCodes.get(code)} vs ${kind})`)
    } else {
      allCodes.set(code, kind)
    }
  }

  claim(plan.project.code, 'project')
  for (const ws of plan.workstreams) {
    claim(ws.code, 'workstream')
    const containerCodes = new Set()
    for (const c of ws.containers || []) {
      claim(c.code, 'container')
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
      claim(i.code, 'item')
      if (i.containerCode && !containerCodes.has(i.containerCode)) {
        errors.push(`Item "${i.code}" references unknown container "${i.containerCode}" in workstream "${ws.code}"`)
      }
    }
    for (const m of ws.milestones || []) claim(m.code, 'milestone')
    for (const g of ws.gates || []) claim(g.code, 'gate')
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
