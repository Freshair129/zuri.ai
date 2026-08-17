// @req FR-019 — resolve external ref lookup or human code to internal id
// @spec BR-002, SDD-003 — support both customer core-id mapping (system/value) and human-code lookup (type/code)
import { handle, httpError, queryParams } from '../_helpers'
import prisma from '@/lib/db'
import { lookupExternalRef, listExternalRefs } from '@/modules/project-manager/import/external-ref'

export const dynamic = 'force-dynamic'

const TYPE_MODEL = {
  PROJECT: 'project',
  WORKSTREAM: 'workstream',
  MILESTONE: 'milestone',
  GATE: 'gate',
  WORK_CONTAINER: 'workContainer',
  WORK_ITEM: 'workItem',
  WORKSPACE: 'workspace',
  REPOSITORY: 'repository',
}

// Resolve to an internal id, either by our human code (`type` + `code`) or by
// the customer's own core id (`system` + `value`) — FR-019.
export async function GET(request) {
  const { type, code, system, value } = queryParams(request)
  return handle(async () => {
    if (system || value) {
      if (!system || !value) throw httpError(400, 'Both system and value are required to resolve an external id')
      const hit = await lookupExternalRef(system, value)
      if (!hit) throw httpError(404, `External id ${system}:${value} is not mapped to any record`)
      if (!hit.record) throw httpError(410, `External id ${system}:${value} maps to a record that no longer exists`)
      return {
        id: hit.record.id,
        code: hit.record.code,
        type: hit.ref.entityType,
        externalRef: {
          system: hit.ref.system,
          value: hit.ref.value,
          labelAs: hit.ref.labelAs,
          verifiedAt: hit.ref.verifiedAt,
        },
      }
    }
    const model = TYPE_MODEL[type]
    if (!model) throw new Error(`Unknown entity type: ${type}`)
    const record = await prisma[model].findUnique({ where: { code } })
    if (!record) throw new Error(`${type} with code "${code}" not found`)
    return {
      id: record.id,
      code: record.code,
      type,
      externalRefs: await listExternalRefs({ entityType: type, entityId: record.id }),
    }
  })
}
