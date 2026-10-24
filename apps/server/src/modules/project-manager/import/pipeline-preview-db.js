// @req FR-084 — read-only projection through the existing full-plan writer.
// @spec ADR-035, SDD-046, SEC-002
// @tested tests/integration/pipeline-bundle-handoff.test.js
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { clonePipelineValue, PIPELINE_MODELS, pipelineKey } from '../application/pipeline-state'
import { pipelineError } from '../application/pipeline-transaction'

const graphTypes = Object.fromEntries(Object.entries(PIPELINE_MODELS).map(([type, delegate]) => [delegate, type]))
const simulated = new Set(['auditEvent', 'planImportReceipt', 'projectExecutionRun', 'projectExecutionStep', 'projectGoal', 'repository', 'projectRepository', 'externalRef'])
const primary = row => row.id || row.idempotencyKey
function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(part => matches(row, part))
    if (key === 'OR') return value.some(part => matches(row, part))
    if (key === 'NOT') return !matches(row, value)
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if (Object.hasOwn(value, 'in')) return value.in.includes(row[key])
      if (Object.hasOwn(value, 'not')) return row[key] !== value.not
      if (Object.hasOwn(value, 'equals')) return row[key] === value.equals
      // Prisma compound unique key, e.g. projectId_goalId.
      return matches(row, value)
    }
    return (row[key] ?? null) === value
  })
}

/**
 * All queries delegate to the caller's read transaction or its virtual graph.
 * The allow-listed write methods only change private memory. Unknown methods,
 * raw SQL, grants and unlisted write families refuse; none fall through to a
 * real delegate. Thus the canonical full-plan writer supplies the mapping for
 * preview without executing a transaction to be rolled back as a "dry run".
 */
export function createPipelinePreviewDb(db, state) {
  const overlay = new Map()
  const model = delegate => Prisma.dmmf.datamodel.models.find(model => model.name[0].toLowerCase() + model.name.slice(1) === delegate)
  async function rows(delegate,where) {
    if (graphTypes[delegate]) return [...state.values()].filter(entry => entry.type === graphTypes[delegate]).map(entry => entry.row)
    if(!overlay.has(delegate)) overlay.set(delegate,new Map())
    for(const row of await db[delegate].findMany({where:where && Object.fromEntries(Object.entries(where).flatMap(([key,value])=>!model(delegate).fields.some(field=>field.name===key) && !['AND','OR','NOT'].includes(key) && value && typeof value==='object' ? Object.entries(value) : [[key,value]]))})) if(!overlay.get(delegate).has(primary(row))) overlay.get(delegate).set(primary(row),clonePipelineValue(row))
    return [...overlay.get(delegate).values()]
  }
  function store(delegate, row) {
    if (graphTypes[delegate]) state.set(pipelineKey(graphTypes[delegate], row.id), { type: graphTypes[delegate], id: row.id, row })
    else {if(!overlay.has(delegate))overlay.set(delegate,new Map());overlay.get(delegate).set(primary(row), row)}
    return clonePipelineValue(row)
  }
  function defaults(delegate, data) {
    const row = {}
    for (const field of model(delegate).fields.filter(field => field.kind !== 'object')) {
      if (data[field.name] !== undefined) row[field.name] = data[field.name]
      else if (field.name === 'id') row.id = randomUUID()
      else if (field.type === 'DateTime' || !field.isRequired) row[field.name] = null
      else if (field.hasDefaultValue && typeof field.default !== 'object') row[field.name] = field.default
      else if (field.hasDefaultValue) row[field.name] = null
    }
    return row
  }
  function patched(delegate, original, data) {
    const row = { ...original }
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue
      row[key] = value && typeof value === 'object' && Object.hasOwn(value, 'increment') ? row[key] + value.increment : value
      if (typeof row[key] === 'number' && (!Number.isFinite(row[key]) || (model(delegate).fields.find(field => field.name === key)?.type === 'Int' && Math.abs(row[key]) > 2147483647))) throw pipelineError('NUMERIC_OVERFLOW')
    }
    if (Object.hasOwn(row, 'updatedAt')) row.updatedAt = null
    return clonePipelineValue(row)
  }
  async function projection(row, args) {
    if (!row) return null
    const result = args.select ? {} : { ...row }
    for (const [key, selected] of Object.entries(args.select || args.include || {})) {
      if (!selected) continue
      if (Object.hasOwn(row, key)) result[key] = row[key]
      else if (row[key + 'Id'] && db[key]?.findUnique) result[key] = await db[key].findUnique({ where: { id: row[key + 'Id'] }, ...(selected === true ? {} : selected) })
    }
    return result
  }
  let proxy
  proxy = new Proxy({}, { get(_, delegate) {
    if (delegate === '$transaction') return async callback => callback(proxy)
    if (delegate === '_engineConfig') return { activeProvider: 'sqlite' }
    if (delegate === '$queryRawUnsafe') return async (sql,...values) => {
      if (!sql.startsWith('SELECT a."id",a."occurredAt",')) throw pipelineError('UPGRADE_REQUIRED',409)
      return db.$queryRawUnsafe(sql,...values)
    }
    if (delegate === '$executeRawUnsafe') return async sql => {
      if (sql === 'UPDATE "Dependency" SET "id" = "id" WHERE 0 = 1') return 0
      throw pipelineError('UPGRADE_REQUIRED', 409)
    }
    if (typeof delegate !== 'string' || delegate.startsWith('$')) throw pipelineError('UPGRADE_REQUIRED', 409)
    if (!db[delegate]) return undefined
    if (!graphTypes[delegate] && !simulated.has(delegate)) return new Proxy(db[delegate], { get(real, method) {
      if (!['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'].includes(method)) throw pipelineError('UPGRADE_REQUIRED', 409)
      return real[method].bind(real)
    } })
    return new Proxy({}, { get(_, method) { return async (args = {}) => {
      const current = ['create','createMany'].includes(method) ? [] : await rows(delegate,args.where)
      if (method === 'findMany') return Promise.all(current.filter(row => matches(row, args.where)).map(row => projection(row, args)))
      const existing = current.find(row => matches(row, args.where))
      if (method === 'findUnique' || method === 'findFirst') return projection(existing, args)
      if (method === 'count') return current.filter(row => matches(row, args.where)).length
      if (method === 'create') return store(delegate, patched(delegate, defaults(delegate, args.data), args.data))
      if (method === 'upsert') return existing ? store(delegate, patched(delegate, existing, args.update)) : store(delegate, patched(delegate, defaults(delegate, args.create), args.create))
      if (method === 'update') {
        if (!existing) throw pipelineError('STALE_ENTITY', 409)
        return store(delegate, patched(delegate, existing, args.data))
      }
      if (method === 'createMany') {
        for (const data of args.data) store(delegate, patched(delegate, defaults(delegate, data), data))
        return { count: args.data.length }
      }
      throw pipelineError('UPGRADE_REQUIRED', 409)
    } } })
  } })
  return proxy
}
