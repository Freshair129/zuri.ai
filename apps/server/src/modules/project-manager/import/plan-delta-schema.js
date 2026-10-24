// @req FR-084 — strict, bounded additive intake commands, not executable patches.
// @spec ADR-035, SDD-046, BR-017
// @tested tests/integration/plan-delta.test.js
import { z } from 'zod'
import { DEPENDENCY_ENDPOINT_TYPES, DEPENDENCY_TYPES, EXECUTION_MODES, WORK_STATUSES, WORKSTREAM_STATUSES, CONTAINER_STATUSES, PIPELINE_NODE_TYPES } from '@/lib/validation/enums'
import { zHandoffContractV1 } from '../application/handoff-contract'

const id = z.string().uuid().transform(value => value.toLowerCase())
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const clientRef = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)
const type = z.enum(DEPENDENCY_ENDPOINT_TYPES)
const ref = z.union([z.object({ type, id }).strict(), z.object({ type, ref: clientRef }).strict()])
const trace = z.object({ correlationId: id, idempotencyKey: id }).strict()
const name = z.string().transform(value => value.trim().normalize('NFC')).refine(value => [...value].length >= 1 && [...value].length <= 240)
const code = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
const decimal = z.number().finite().refine(value => {
  const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e')
  return Math.max(0, (coefficient.split('.')[1]?.length || 0) - Number(exponent)) <= 6
})
const weight = decimal.refine(value => value > 0 && value <= 1e6)
const date = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString()).nullable().optional().default(null)
const subtype = z.string().trim().min(1).max(100)
const fields = {
  WORKSTREAM: z.object({ code, name, executionMode: z.enum(EXECUTION_MODES), progressStrategy: z.string().optional(), progressWeight: weight.default(1), status: z.enum(WORKSTREAM_STATUSES).default('PLANNED') }).strict(),
  WORK_CONTAINER: z.object({ code, title: name, subtype, status: z.enum(CONTAINER_STATUSES).default('PLANNED'), startAt: date, targetAt: date }).strict(),
  WORK_ITEM: z.object({ code, title: name, subtype, status: z.enum(WORK_STATUSES).default('PLANNED'), assigneeRef: id.nullable().default(null), weight: weight.default(1), numericValue: decimal.refine(value => Math.abs(value) <= 1e12).nullable().default(null), probability: decimal.refine(value => value >= 0 && value <= 1).nullable().default(null), startAt: date, targetAt: date }).strict(),
}
const edgeCreate = z.object({ op: z.literal('dependency.create'), clientRef, source: ref, target: ref, dependencyType: z.enum(DEPENDENCY_TYPES), contract: zHandoffContractV1 }).strict()
const contract = z.object({ op: z.literal('dependency.contract'), id, expectedDependencyHash: hash, contract: zHandoffContractV1 }).strict()
const remove = z.object({ op: z.literal('dependency.remove'), id, expectedDependencyHash: hash }).strict()
const move = z.object({ op: z.literal('node.move'), type: z.enum(PIPELINE_NODE_TYPES), id, expectedEntityHash: hash, parent: ref, expectedParentHash: hash.nullable() }).strict()
const undo = z.object({ op: z.literal('undo'), originalAuditEventId: id, expectedAfterHash: hash }).strict()
const creates = Object.entries(fields).map(([nodeType, shape]) => z.object({ op: z.literal('node.create'), clientRef, type: z.literal(nodeType), parent: ref, fields: shape }).strict())
const command = z.union([edgeCreate, contract, remove, move, undo, ...creates])
const project = z.object({ schemaVersion: z.literal('1.3'), kind: z.literal('PROJECT_DELTA'), projectId: id, trace, expectedPreviewHash: hash.nullable(), commands: z.array(command).min(1).max(50) }).strict()
const register = z.object({ schemaVersion: z.literal('1.3'), kind: z.literal('DEPENDENCY_REGISTER'), projectIds: z.array(id).min(1).max(2).refine(ids => new Set(ids).size === ids.length && [...ids].sort().join() === ids.join()), trace, expectedPreviewHash: hash.nullable(), commands: z.array(z.union([edgeCreate, contract, remove])).length(1) }).strict()

function references(plan, context) {
  const refs = new Map(), all = new Set()
  for (const [index, item] of plan.commands.entries()) {
    for (const reference of [item.source, item.target, item.parent].filter(Boolean)) {
      if (reference.ref && (refs.get(reference.ref) !== reference.type || plan.kind === 'DEPENDENCY_REGISTER')) context.addIssue({ code: 'custom', path: ['commands', index], message: 'Reference must name an earlier node of the same type' })
      if (reference.type === 'PROJECT' && !reference.id) context.addIssue({ code: 'custom', path: ['commands', index], message: 'Project requires an existing id' })
    }
    if (item.clientRef) {
      if (all.has(item.clientRef)) context.addIssue({ code: 'custom', path: ['commands', index, 'clientRef'], message: 'Duplicate clientRef' })
      all.add(item.clientRef)
      if (item.op === 'node.create') refs.set(item.clientRef, item.type)
    }
    if (item.op === 'undo' && plan.commands.length !== 1) context.addIssue({ code: 'custom', path: ['commands'], message: 'Undo must be the only command' })
  }
}
export const zPlanDelta = project.superRefine(references)
export const zRegisterDelta = register.superRefine(references)
