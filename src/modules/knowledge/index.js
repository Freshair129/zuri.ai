// @req FR-024 — the knowledge module's public surface (ADR-007 §P5).
// @spec ADR-007 §P5 — one entry point for projection (Zuri → GKS relations), the
//   read-side query, the sink seam, and the live-fact guard.
// @tested tests/integration/knowledge-project.test.js, tests/integration/knowledge-query.test.js

export { projectKnowledgeGraph } from './project-graph'
export { queryKnowledge } from './query'
export { writeGraph, createJsonSink } from './sink'
export { createGenesisBlockDBSink } from './genesisblockdb-sink'
export { createGraphKnowledgeReader } from './graph-query'
export { assertNoLiveFacts, LIVE_FACT_FIELDS } from './live-facts'
export {
  PUBLIC_BUSINESS_KNOWLEDGE_FIELDS,
  normalizeBusinessKnowledgeRecord,
  parseBusinessKnowledgeQuery,
  createInMemoryBusinessKnowledgeReader,
} from './business-contract'
export { createPostgresBusinessKnowledgeReader } from './postgres-business-knowledge'
// @req FR-054 — dedicated-login runtime isolation verification surface.
// @spec SDD-027, SEC-011 — secret-redacted probe always rolls back.
// @tested tests/unit/activation-readiness-integration.test.js, tests/unit/runtime-isolation-probe.test.js
export {
  parseRuntimeIsolationEnvironment,
  runRuntimeIsolationProbe,
  runRuntimeIsolationProbeFromEnv,
} from './runtime-isolation-probe'
