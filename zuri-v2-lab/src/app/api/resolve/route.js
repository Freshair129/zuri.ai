import { handle, queryParams } from '../_helpers'
import prisma from '@/lib/db'

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

// Resolve a human code to an internal id for a given entity type.
export async function GET(request) {
  const { type, code } = queryParams(request)
  return handle(async () => {
    const model = TYPE_MODEL[type]
    if (!model) throw new Error(`Unknown entity type: ${type}`)
    const record = await prisma[model].findUnique({ where: { code } })
    if (!record) throw new Error(`${type} with code "${code}" not found`)
    return { id: record.id, code: record.code, type }
  })
}
