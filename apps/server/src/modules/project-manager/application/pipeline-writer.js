// @req FR-084 — provider-owned graph serialization without identity or UI imports.
// @spec ADR-035
// @tested tests/postgres/pipeline-handoff-races.test.js
import { PIPELINE_GRAPH_LOCK } from './pipeline-lock'
export { PIPELINE_GRAPH_LOCK }
export const PIPELINE_TRANSACTION_OPTIONS = Object.freeze({maxWait:4000,timeout:120000,isolationLevel:'Serializable'})
const contexts = new WeakMap()
export const isPipelineTransaction = db => contexts.get(db)?.write === true
export function pipelineTransactionFacade(tx) {
  if (!contexts.has(tx)) throw pipelineError('GRAPH_BUSY', 503)
  let facade
  facade = new Proxy(tx, { get(target, key) {
    if (key === '$transaction') return async callback => callback(facade)
    const value = target[key]
    return typeof value === 'function' ? value.bind(target) : value
  } })
  contexts.set(facade, contexts.get(tx))
  return facade
}
export function pipelineError(code, status = 422, conflicts = []) {
  return Object.assign(new Error(code), { name: 'PipelineError', code, status, conflicts })
}
export const isPostgres = db => contexts.get(db)?.postgres ?? /postgres/i.test(db?._engineConfig?.activeProvider || db?._client?._engineConfig?.activeProvider || '')

export async function lockPipelineGraph(tx, postgres) {
  if (postgres) {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '4000ms'")
    // LOCK is a utility statement: it waits BEFORE Serializable establishes
    // its MVCC snapshot. A SELECT advisory-lock call alone establishes the
    // snapshot before waiting, permitting a stale Gate read to serialize
    // logically before the previous lock holder. Keep the adopted advisory
    // key as well, after this provider bootstrap mutex and before any reads.
    await tx.$executeRawUnsafe('LOCK TABLE "Dependency" IN EXCLUSIVE MODE')
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1::bigint)::text AS locked', PIPELINE_GRAPH_LOCK)
  } else {
    // The interactive transaction is already open. A no-row UPDATE upgrades its
    // deferred SQLite transaction to the single database writer BEFORE reads;
    // it changes no business row and never nests BEGIN.
    await tx.$executeRawUnsafe('UPDATE "Dependency" SET "id" = "id" WHERE 0 = 1')
  }
}

export async function withPipelineTransaction(db, callback, { write = true } = {}) {
  const existing = contexts.get(db)
  if (existing) {
    if (write && !existing.write) throw pipelineError('GRAPH_BUSY', 503)
    return callback(db, existing)
  }
  const postgres = isPostgres(db)
  const deadline = Date.now() + 5000
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        if (write) await lockPipelineGraph(tx, postgres)
        const settings = { postgres, write }
        contexts.set(tx, settings)
        return callback(tx, settings)
      }, postgres ? {...PIPELINE_TRANSACTION_OPTIONS,isolationLevel:'Serializable'} : PIPELINE_TRANSACTION_OPTIONS)
    } catch (error) {
      const retry = error?.code === 'P2034' || /serialization|could not serialize|deadlock|SQLITE_BUSY|SQLITE_LOCKED|database is locked|lock timeout/i.test(error?.message || '')
      if (!retry) throw error
      if (attempt === 2 || Date.now() >= deadline) throw pipelineError('GRAPH_BUSY', 503)
      await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)))
    }
  }
  throw pipelineError('GRAPH_BUSY', 503)
}

export function isPipelineReceiptConflict(error) {
  if(error?.code!=='P2002') return false
  const target=error.meta?.target
  return (error.meta?.modelName==='PlanImportReceipt' && (Array.isArray(target)?target.includes('idempotencyKey'):target==='PlanImportReceipt_pkey')) || target==='PlanImportReceipt_idempotencyKey_key'
}
export const pipelineReceiptActor = viewer => viewer?.isApiAccess === true ? 'api-access:'+viewer.serviceAccountId : 'person:'+viewer?.principal?.id
