// @req FR-118 — Tier 1 stage composition: the seven Tier 1 knowledge-ingestion
// stages run as one in-process pass over one artifact, in ADR-050 D2 order.
// @spec SDD-068, ADR-050 D1-D2, docs/domains/knowledge/features/FR-109-knowledge-ingestion-stage-catalog.md
// @tested tests/unit/knowledge-stage-runner.test.js

import { buildSourceProvenance } from './provenance'
import { normalizeValue } from './normalization'
import { classifyKnowledgeObject } from './classification'
import { classifyAgainst } from './dedup'
import { parseDocument } from './parsing'
import { chunkDocument } from './chunking'
import { extractEntityCandidates } from './entity-extraction'

/**
 * Runs the seven Tier-1 stages ADR-050 D2 assigns to zuri-ai over one
 * artifact, in the catalog's own order — Parse(2), Provenance(3),
 * Normalize(4), Classify(5), Dedupe(6), Chunk(7), Entity Extraction(8).
 *
 * **What this proves, and what it does not.** Every prior slice in this lane
 * shipped one pure calculator with a seam test to its one neighbour: parsing
 * into chunking, chunking into entity extraction, classification into
 * chunking, dedup into the FR-109 run input. Four pairs, and — as the
 * knowledge charter now says outright — a chain of pairs is not a chain.
 * This function is the composition: one call, seven stages, one real
 * artifact, in the declared order.
 *
 * It is a pure function. No I/O, no clock, no randomness, no persistence — it
 * opens nothing and writes nothing, so the knowledge charter's
 * `owns_models: []` is unaffected. It therefore does **not** close any of
 * FR-109's ten remaining acceptance criteria: AC-109.2, .4, .7 and .13 each
 * require evidence on the FR-071 ledger (a registered run, `PipelineStep`
 * transitions, `PipelineRecordEvent` rows bound through `docId`/`picId`/
 * `factId`), and calling seven functions in memory produces none of that. A
 * caller that wants ledger evidence wraps each stage's result with
 * `recordPipelineEvent` — that wiring is a further slice, named and not
 * built here, the same way `knowledgeIngestionRunInput` (FR-109) computes a
 * run's identity without itself calling `createPipelineRun`.
 *
 * Failure is not caught or classified. BR-022's quarantine vocabulary
 * (retryable / non-retryable / review-required) is declared and unbuilt, and
 * building half of it inside this function — catching an error without a
 * place to put the classification — would be worse than not catching it: a
 * caller reading a swallowed exception as "handled" when nothing downstream
 * acts on it. A thrown error here is Stage N's own error, unchanged.
 */
export function runKnowledgeIngestionStages({
  documentId,
  text,
  artifact,
  policy,
  priorArtifacts = [],
  structuredFields = [],
  structuredRecords = [],
  recognizer,
  maxTokens,
}) {
  if (!documentId) throw new Error('runKnowledgeIngestionStages requires documentId')
  if (!artifact) throw new Error('runKnowledgeIngestionStages requires an artifact (FR-116/FR-117 identity)')
  if (!policy) throw new Error('runKnowledgeIngestionStages requires a policy (FR-111 classification fields)')

  // Stage 2 — Parsing / Extraction (FR-115). `structure` IS Stage 7's
  // `blocks` argument (SDD-063); passed through unchanged below.
  const parsed = parseDocument({ documentId, rawArtifactId: artifact.artifact_id, text })

  // Stage 3 — Provenance Capture (FR-116). FR-116 names the artifact's hash
  // `checksum` (spec §8); FR-117 names the same value `content_hash` (spec
  // §29, BR-021). They are one fact under two module-local names, so the
  // caller states it once — as `content_hash` — and this is the only place
  // it is renamed, rather than asking every caller to keep two copies in
  // sync.
  const provenance = buildSourceProvenance({
    source_id: artifact.source_id,
    source_type: artifact.source_type,
    source_uri: artifact.source_uri,
    source_version: artifact.source_version,
    artifact_id: artifact.artifact_id,
    ingested_at: artifact.ingested_at,
    parsed_at: artifact.parsed_at,
    pipeline_version: artifact.pipeline_version,
    extractor_version: artifact.extractor_version,
    checksum: artifact.content_hash,
  })

  // Stage 4 — Normalization (FR-114). Applies only to caller-named
  // structured fields — a markdown/text document has no discrete fields to
  // normalize beyond organisation mentions, and Stage 8 already normalizes
  // those inline (FR-114's own PRD row: "Stage 8 imports that rule rather
  // than keeping a second copy"). An empty `structuredFields` is the
  // ordinary case for a prose document, not a gap.
  const normalizedFields = structuredFields.map((field) => normalizeValue(field))

  // Stage 5 — Classification / Access Scope (FR-111)
  const classification = classifyKnowledgeObject({ scope: artifact.scope, ...policy })

  // Stage 6 — Deduplication / Versioning (FR-117). `artifact` already
  // carries every field `classifyAgainst`'s identity needs — no mapping.
  const dedup = classifyAgainst(artifact, priorArtifacts)

  // Stage 7 — Chunking (FR-112). `scope` is the classification's scope
  // alone (tenantId/businessId) — the exact shape the FR-111-into-FR-112
  // seam test already established (tests/unit/knowledge-classification.test.js)
  // — never the whole classification object, which would nest a `scope`
  // field inside a field named `scope`.
  const { chunks, warnings: chunkWarnings } = chunkDocument({
    documentId,
    blocks: parsed.structure,
    scope: classification.scope,
    provenance,
    maxTokens,
  })

  // Stage 8 — Entity Extraction (FR-113)
  const { candidates: entityCandidates, warnings: entityWarnings } = extractEntityCandidates({
    chunks,
    records: structuredRecords,
    recognizer,
  })

  return Object.freeze({
    document_id: documentId,
    provenance,
    classification,
    dedup,
    parsed,
    normalized_fields: normalizedFields,
    chunks,
    entity_candidates: entityCandidates,
    warnings: [...parsed.warnings, ...dedup.warnings, ...chunkWarnings, ...entityWarnings],
  })
}
