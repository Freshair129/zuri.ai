// @req FR-111 — knowledge sensitivity lattice and processing policy fields
// @spec SDD-062, SDD-058, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §10, §3.3
// @tested tests/unit/knowledge-classification.test.js

import { KNOWLEDGE_SENSITIVITY_LEVELS } from '@/lib/validation/enums'

/**
 * Every field a knowledge object must state before anything may index it.
 *
 * There are no defaults here, and that is the design. A default for a
 * classification field is a decision made on behalf of data nobody looked at,
 * and the convenient default is always the permissive one — which is how an
 * unclassified object becomes public. Absent is refused; `false` is a stated
 * value and is kept.
 */
const REQUIRED_POLICY = Object.freeze([
  'sensitivity',
  'retention_policy',
  'export_policy',
  'cloud_processing_allowed',
  'embedding_allowed',
])

export function classifyKnowledgeObject(input = {}) {
  const scope = input.scope || {}
  if (!scope.tenantId || !scope.businessId) {
    throw new Error('knowledge classification requires a scope naming both tenantId and businessId')
  }

  for (const field of REQUIRED_POLICY) {
    if (input[field] === undefined || input[field] === null) {
      throw new Error(`knowledge classification requires ${field} to be stated`)
    }
  }

  if (!KNOWLEDGE_SENSITIVITY_LEVELS.includes(input.sensitivity)) {
    throw new Error(
      `sensitivity ${JSON.stringify(input.sensitivity)} is not one of ${KNOWLEDGE_SENSITIVITY_LEVELS.join(', ')}`,
    )
  }

  return Object.freeze({
    scope: Object.freeze({ tenantId: scope.tenantId, businessId: scope.businessId }),
    sensitivity: input.sensitivity,
    retention_policy: input.retention_policy,
    export_policy: input.export_policy,
    cloud_processing_allowed: input.cloud_processing_allowed,
    embedding_allowed: input.embedding_allowed,
  })
}

/**
 * Where this object's stages may run (SDD-058).
 *
 * There is no parameter for deployment topology, and the tests pin the absence by
 * passing one anyway — with a force flag — and requiring the same answer. A
 * deployment preference is configuration; the classification is the data's own
 * statement about itself, and a boundary that configuration can widen is not a
 * boundary.
 */
export function resolveExecutionLocation(classification) {
  return classification.cloud_processing_allowed ? 'ANY' : 'LOCAL'
}

/**
 * The gate between classification and indexing (§3.3, AC-111.3).
 *
 * The specification refuses the index-everything-then-filter shape, and the
 * reason is that the two patterns fail differently. In filter-after-retrieval a
 * scope mistake is a disclosure; in classify-before-index it is an object that
 * never got indexed. One is a bug report, the other is an incident.
 *
 * It re-runs the whole check rather than trusting a `classification` field to
 * mean what it says. An object arriving here has crossed module boundaries, and
 * a hand-assembled classification that is short a field looks exactly like a
 * real one until the field is needed.
 */
export function assertIndexable(object) {
  if (!object || !object.classification) {
    throw new Error(`knowledge object ${object?.id ?? '<unidentified>'} has no classification and cannot be indexed`)
  }
  classifyKnowledgeObject(object.classification)
  return object
}
