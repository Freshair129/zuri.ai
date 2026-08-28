// @req FR-109 — an ingestion occurrence is registered on the FR-071 execution
// ledger as a run of DPL-KNOWLEDGE-INGEST-V1, keyed by BR-021 ingestion identity.
// @spec SDD-067, SDD-066, SDD-057, BR-021, SEC-021, ADR-050 D4
// @tested tests/unit/knowledge-ingestion-job.test.js

import {
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import { ingestionIdentity } from './dedup'

const SHA256_HEX = /^[a-f0-9]{64}$/i

/**
 * Turns an artifact into the run input FR-071's `createPipelineRun` persists,
 * so BR-021's dedup key stops being a value a pure function returns and becomes
 * a uniqueness the database holds: `PipelineRun.idempotencyKey` is `@unique`,
 * so a second ingestion of the same artifact cannot create a second run.
 *
 * **Every field is derived from the artifact, the correlation id included, and
 * that is the whole point rather than a shortcut** (SDD-067). `createPipelineRun`
 * returns `UNCHANGED` for a repeated key only when `requestHash` also matches,
 * and that hash covers the entire parsed input — so an input carrying a fresh
 * correlation id per attempt would make the second ingestion raise 409 "reused
 * with different input" instead of the no-op BR-021 requires. Deriving the
 * whole input makes re-ingestion byte-identical by construction rather than by
 * the caller remembering to make it so.
 *
 * The cost is stated rather than hidden: the second, no-op attempt's own
 * correlation is not recorded. There is one run, and it was correlated once.
 *
 * This function is pure and writes nothing. The write is `createPipelineRun`,
 * owned by the integrations lane, so the knowledge charter's `owns_models: []`
 * stays true and there is no second persistence path (SDD-057, ADR-050 D4).
 */
export function knowledgeIngestionRunInput(artifact) {
  // Throws on a missing tenant or a missing part of the key. Called first so an
  // incomplete artifact is refused before anything is built from it — a hole in
  // a key is not an absence but a value every artifact missing that part shares.
  const identity = ingestionIdentity(artifact)

  const businessId = artifact?.scope?.businessId
  if (!businessId) {
    throw new Error(
      `knowledge ingestion requires a scope naming a businessId (source_id ${artifact.source_id}); the ledger attributes every run to one`,
    )
  }

  return {
    dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    businessId,
    sourceRef: artifact.source_uri ?? null,
    // BR-021 does not require content_hash to be a SHA-256, but FR-071's
    // envelope requires sourceSha256 to be one. A non-digest is withheld rather
    // than reshaped into something that would fail validation downstream.
    sourceSha256: SHA256_HEX.test(String(artifact.content_hash)) ? String(artifact.content_hash) : null,
    artifactRef: artifact.artifact_id ?? null,
    artifactSha256: null,
    expectedCount: 0,
    bootstrapBatchId: null,
    correlationId: `ki:${identity}`,
    idempotencyKey: identity,
    // Where FR-109's identity contract says artifact_id lives.
    identityRefs: {
      ...IDENTITY_REFS_EMPTY,
      artifactIds: artifact.artifact_id ? [artifact.artifact_id] : [],
    },
    tagIds: [],
  }
}
