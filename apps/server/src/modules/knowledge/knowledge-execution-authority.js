import { isDeepStrictEqual } from 'node:util'
import { parseGenesisRag17Scope } from './genesisrag17-contract'
import { KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-172 — non-serializable, scope-bound authority for the admitted source runtime.
// @spec ADR-072, SEC-003
// @tested tests/unit/knowledge-runtime.test.js
const authorities = new WeakMap()

/** Internal runtime only. This object is never a user identity or a stored credential. */
export function createKnowledgeExecutionAuthority(scope, operation = 'execute', executionRunId = null) {
  if (!['execute', 'query'].includes(operation)) throw new Error('Invalid knowledge runtime operation')
  const authority = Object.freeze({})
  authorities.set(authority, { scope: Object.freeze(parseGenesisRag17Scope(scope)), operation, executionRunId })
  return authority
}

export function isKnowledgeExecutionAuthority(authority) {
  return authorities.get(authority)?.operation === 'execute'
}

export function hasKnowledgeScopeAuthority(authority, scope, operation = 'execute') {
  const binding = authorities.get(authority)
  if (!binding || binding.operation !== operation) return false
  try { return isDeepStrictEqual(binding.scope, parseGenesisRag17Scope(scope)) } catch { return false }
}

export function hasKnowledgeRunAuthority(authority, run) {
  const binding = authorities.get(authority)
  return binding?.operation === 'execute' && run?.dataPipelineDefinitionId === KNOWLEDGE_INGESTION_DEFINITION_ID &&
    run.businessId === binding.scope.businessId && run.tenantId === binding.scope.tenantId &&
    !!binding.executionRunId && run.executionRunId === binding.executionRunId
}

export function bindKnowledgeExecutionRun(authority, run) {
  const binding = authorities.get(authority)
  if (!binding) return
  if (binding.operation !== 'execute' || run.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID || run.businessId !== binding.scope.businessId || run.tenantId !== binding.scope.tenantId || (binding.executionRunId && binding.executionRunId !== run.executionRunId)) throw Object.assign(new Error('Knowledge runtime run binding mismatch'), { status: 403 })
  binding.executionRunId = run.executionRunId
}

export function hasKnowledgeRunCreationAuthority(authority, input) {
  const binding = authorities.get(authority)
  return binding?.operation === 'execute' && input?.dataPipelineDefinitionId === KNOWLEDGE_INGESTION_DEFINITION_ID && input.businessId === binding.scope.businessId
}
