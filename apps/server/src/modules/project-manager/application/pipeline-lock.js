// @req FR-084 — one graph serialization key, shared with process recovery.
// @spec ADR-035
// @tested tests/postgres/pipeline-handoff-races.test.js
import { createHash } from 'node:crypto'
export const PIPELINE_GRAPH_LOCK = createHash('sha256').update('pm.pipeline.graph:v1').digest().readBigInt64BE(0).toString()
