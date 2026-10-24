import { GATE_STATUSES } from '../../../lib/validation/enums.js'
// @req FR-084 — declared handoffs, immutable manual evidence and content CAS.
// @spec ADR-035, BR-017, SDD-046
// @tested tests/unit/handoff-contract.test.js
import { z } from 'zod'
import { createHash } from 'node:crypto'

import { zHandoffContractV1, uuid, text, gate, manual } from './handoff-contract-schema'
export { zHandoffContractV1 } from './handoff-contract-schema'
const storedManual = manual.extend({
  actorPersonId: uuid, decisionAuditEventId: uuid,
  decisionAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    .refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value),
}).strict()
export const zStoredHandoffContractV1 = z.object({
  version: z.literal(1), deliverable: text,
  acceptance: z.discriminatedUnion('kind', [storedManual, gate]),
}).strict()

export function persistHandoffContract(input, provenance) {
  const result = zHandoffContractV1.parse(input)
  if (result.acceptance.kind === 'MANUAL') {
    result.acceptance = { ...result.acceptance, ...provenance }
  }
  return zStoredHandoffContractV1.parse(result)
}

export function readStoredHandoff(value) {
  if (value === null) return null
  try { return zStoredHandoffContractV1.parse(typeof value === 'string' ? JSON.parse(value) : value) }
  catch { return undefined }
}

export function handoffContractState(value, { gate: currentGate, actor, audit, dependency } = {}) {
  if (value === null) return 'UNDECLARED'
  const contract = readStoredHandoff(value)
  if (!contract) return 'INVALID'
  const acceptance = contract.acceptance
  if (acceptance.kind === 'GATE') {
    if (!currentGate || currentGate.id !== acceptance.gateId || !GATE_STATUSES.includes(currentGate.status)) return 'INVALID'
    return ['PASSED', 'WAIVED'].includes(currentGate.status) ? 'SATISFIED' : 'DECLARED'
  }
  if (actor?.id !== acceptance.actorPersonId || audit?.id !== acceptance.decisionAuditEventId || audit.actorId !== actor.id) return 'INVALID'
  // A reference to an audit UUID is not evidence of its decision. Bind the
  // exact persisted contract and endpoints to the immutable accepted image.
  // This also makes tampered/cross-edge provenance fail closed after recovery.
  let evidence
  try { evidence = JSON.parse(audit.payloadJson).stateImages?.find(image => image.type === 'DEPENDENCY' && image.id === dependency?.id)?.after } catch { return 'INVALID' }
  if (!dependency || !evidence || !['PLAN_DELTA_COMMITTED', 'BUNDLE_IMPORTED'].includes(audit.action) || !audit.tenantId || !audit.businessId) return 'INVALID'
  for (const key of ['id', 'sourceType', 'sourceId', 'targetType', 'targetId', 'dependencyType', 'contractJson']) {
    if (evidence[key] !== dependency[key]) return 'INVALID'
  }
  return acceptance.satisfied ? 'SATISFIED' : 'DECLARED'
}

function compareKeys(a, b) {
  const aa = [...a], bb = [...b]
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const difference = aa[i].codePointAt(0) - bb[i].codePointAt(0)
    if (difference) return difference
  }
  return aa.length - bb.length
}
export function canonicalJSON(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value === null || typeof value !== 'object') {
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError('Noncanonical JSON value')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  return '{' + Object.keys(value).sort(compareKeys).map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}'
}
export const handoffHash = (label, value) => createHash('sha256').update(label + '\n' + canonicalJSON(value)).digest('hex')
export function dependencyHash(row) {
  const projected = Object.fromEntries(['id', 'sourceType', 'sourceId', 'targetType', 'targetId', 'dependencyType', 'createdAt', 'contractJson'].map(key => [key, row[key] ?? null]))
  return handoffHash('pm-dependency:v1', projected)
}
export const entityHash = (type, row) => type === 'DEPENDENCY' ? dependencyHash(row) : handoffHash('pm-entity:v1', { type, id: row.id, row })
