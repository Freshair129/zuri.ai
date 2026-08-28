// @req FR-118 — Tier 1 stage composition: the seven Tier 1 knowledge-ingestion
// stages run as one in-process pass over one artifact, in ADR-050 D2 order.
// @req FR-119 — the same seven stages, run with per-stage failure attribution
// so a document that fails partway can be quarantined rather than reported as
// nothing having happened (BR-022).
// @spec SDD-068, SDD-072, ADR-050 D1-D2, docs/domains/knowledge/features/FR-109-knowledge-ingestion-stage-catalog.md
// @tested tests/unit/knowledge-stage-runner.test.js
// @tested tests/unit/knowledge-stage-runner-trace.test.js

import { buildSourceProvenance } from './provenance'
import { normalizeValue } from './normalization'
import { classifyKnowledgeObject } from './classification'
import { classifyAgainst } from './dedup'
import { parseDocument } from './parsing'
import { chunkDocument } from './chunking'
import { extractEntityCandidates } from './entity-extraction'

function validateInput({ documentId, artifact, policy }) {
  if (!documentId) throw new Error('runKnowledgeIngestionStages requires documentId')
  if (!artifact) throw new Error('runKnowledgeIngestionStages requires an artifact (FR-116/FR-117 identity)')
  if (!policy) throw new Error('runKnowledgeIngestionStages requires a policy (FR-111 classification fields)')
}

/** Applies the same defaults the original destructured signature gave every optional field. */
function resolveContext(input) {
  return {
    ...input,
    priorArtifacts: input.priorArtifacts || [],
    structuredFields: input.structuredFields || [],
    structuredRecords: input.structuredRecords || [],
  }
}

/**
 * The seven Tier 1 stages, in ADR-050 D2 order, as one shared definition
 * (SDD-072) both `runKnowledgeIngestionStages` and
 * `runKnowledgeIngestionStagesWithTrace` iterate — the field mappings below
 * are written once, not duplicated between a throwing caller and a
 * trace-collecting one.
 *
 * `run(ctx, results)` reads the validated input and every earlier stage's
 * RAW result (keyed by stage id in `results`, a `Map`) and returns this
 * stage's own raw result. `envelopeKey` and `toEnvelopeValue` say how that
 * raw result becomes the envelope's public shape — `chunkDocument` returns
 * `{chunks, warnings}`, for instance, but the envelope's `chunks` field is
 * the array alone; `warnings` is collected separately by whichever stages
 * declare `extractWarnings`. Nothing here catches — the two callers below
 * decide whether a thrown error stops everything or is recorded and
 * returned.
 */
const TIER1_STEPS = [
  {
    // Stage 2 — Parsing / Extraction (FR-115). `structure` IS Stage 7's
    // `blocks` argument (SDD-063); passed through unchanged below.
    id: 'DPS-KI-PARSE',
    envelopeKey: 'parsed',
    run: (ctx) => parseDocument({ documentId: ctx.documentId, rawArtifactId: ctx.artifact.artifact_id, text: ctx.text }),
    toEnvelopeValue: (raw) => raw,
    extractWarnings: (raw) => raw.warnings,
  },
  {
    // Stage 3 — Provenance Capture (FR-116). FR-116 names the artifact's
    // hash `checksum` (spec §8); FR-117 names the same value `content_hash`
    // (spec §29, BR-021). They are one fact under two module-local names, so
    // the caller states it once — as `content_hash` — and this is the only
    // place it is renamed, rather than asking every caller to keep two
    // copies in sync.
    id: 'DPS-KI-PROVENANCE',
    envelopeKey: 'provenance',
    run: (ctx) => buildSourceProvenance({
      source_id: ctx.artifact.source_id,
      source_type: ctx.artifact.source_type,
      source_uri: ctx.artifact.source_uri,
      source_version: ctx.artifact.source_version,
      artifact_id: ctx.artifact.artifact_id,
      ingested_at: ctx.artifact.ingested_at,
      parsed_at: ctx.artifact.parsed_at,
      pipeline_version: ctx.artifact.pipeline_version,
      extractor_version: ctx.artifact.extractor_version,
      checksum: ctx.artifact.content_hash,
    }),
    toEnvelopeValue: (raw) => raw,
  },
  {
    // Stage 4 — Normalization (FR-114). Applies only to caller-named
    // structured fields — a markdown/text document has no discrete fields to
    // normalize beyond organisation mentions, and Stage 8 already normalizes
    // those inline (FR-114's own PRD row: "Stage 8 imports that rule rather
    // than keeping a second copy"). An empty `structuredFields` is the
    // ordinary case for a prose document, not a gap.
    id: 'DPS-KI-NORMALIZE',
    envelopeKey: 'normalized_fields',
    run: (ctx) => ctx.structuredFields.map((field) => normalizeValue(field)),
    toEnvelopeValue: (raw) => raw,
  },
  {
    // Stage 5 — Classification / Access Scope (FR-111)
    id: 'DPS-KI-CLASSIFY',
    envelopeKey: 'classification',
    run: (ctx) => classifyKnowledgeObject({ scope: ctx.artifact.scope, ...ctx.policy }),
    toEnvelopeValue: (raw) => raw,
  },
  {
    // Stage 6 — Deduplication / Versioning (FR-117). `artifact` already
    // carries every field `classifyAgainst`'s identity needs — no mapping.
    id: 'DPS-KI-DEDUPE',
    envelopeKey: 'dedup',
    run: (ctx) => classifyAgainst(ctx.artifact, ctx.priorArtifacts),
    toEnvelopeValue: (raw) => raw,
    extractWarnings: (raw) => raw.warnings,
  },
  {
    // Stage 7 — Chunking (FR-112). `scope` is the classification's scope
    // alone (tenantId/businessId) — the exact shape the FR-111-into-FR-112
    // seam test already established (tests/unit/knowledge-classification.test.js)
    // — never the whole classification object, which would nest a `scope`
    // field inside a field named `scope`.
    id: 'DPS-KI-CHUNK',
    envelopeKey: 'chunks',
    run: (ctx, results) => chunkDocument({
      documentId: ctx.documentId,
      blocks: results.get('DPS-KI-PARSE').structure,
      scope: results.get('DPS-KI-CLASSIFY').scope,
      provenance: results.get('DPS-KI-PROVENANCE'),
      maxTokens: ctx.maxTokens,
    }),
    toEnvelopeValue: (raw) => raw.chunks,
    extractWarnings: (raw) => raw.warnings,
  },
  {
    // Stage 8 — Entity Extraction (FR-113)
    id: 'DPS-KI-ENTITY-EXTRACT',
    envelopeKey: 'entity_candidates',
    run: (ctx, results) => extractEntityCandidates({
      chunks: results.get('DPS-KI-CHUNK').chunks,
      records: ctx.structuredRecords,
      recognizer: ctx.recognizer,
    }),
    toEnvelopeValue: (raw) => raw.candidates,
    extractWarnings: (raw) => raw.warnings,
  },
]

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
 * `owns_models: []` is unaffected.
 *
 * **Fails closed, not partway.** A thrown error here is Stage N's own error,
 * unchanged, and nothing before it is returned. A caller that needs to know
 * which stage got how far — to quarantine a real document failure per
 * BR-022, rather than treat every failure as "nothing happened" — calls
 * `runKnowledgeIngestionStagesWithTrace` instead; the two share every field
 * mapping (SDD-072) and differ only in what they do when a stage throws.
 */
export function runKnowledgeIngestionStages(rawInput) {
  validateInput(rawInput)
  const input = resolveContext(rawInput)
  const results = new Map()
  const warnings = []
  for (const step of TIER1_STEPS) {
    const raw = step.run(input, results)
    results.set(step.id, raw)
    if (step.extractWarnings) warnings.push(...step.extractWarnings(raw))
  }
  return Object.freeze({
    document_id: input.documentId,
    ...Object.fromEntries(TIER1_STEPS.map((step) => [step.envelopeKey, step.toEnvelopeValue(results.get(step.id))])),
    warnings,
  })
}

/**
 * The same seven stages, with per-stage failure attribution (FR-119, SDD-072)
 * for BR-022's quarantine envelope, which needs to know WHICH stage failed —
 * something `runKnowledgeIngestionStages` cannot say without losing its own
 * simplicity for every caller that does not need it.
 *
 * Returns `{ success, stages, envelope, partialEnvelope, failedStage, error }`.
 * On success, `envelope` is exactly what `runKnowledgeIngestionStages` would
 * have returned, `stages` names all seven as `SUCCEEDED` in order, and
 * `partialEnvelope` is `null` — there is nothing partial about a full
 * success. On failure, `stages` names every stage up to and including the
 * failing one, `envelope` is `null`, `partialEnvelope` carries the
 * envelope-shaped result of every stage that succeeded before the failure
 * (so a caller can still hash and count what actually completed rather than
 * losing it), `failedStage` names the one `pipelineStageId` that threw, and
 * `error` is that stage's own error, unchanged.
 *
 * Never throws itself: a stage's exception is data here, not a control
 * -flow event, because the whole reason to call this instead of the
 * throwing version is to keep going long enough to report where it stopped.
 */
export function runKnowledgeIngestionStagesWithTrace(rawInput) {
  validateInput(rawInput)
  const input = resolveContext(rawInput)
  const results = new Map()
  const warnings = []
  const stages = []
  const partial = {}
  for (const step of TIER1_STEPS) {
    try {
      const raw = step.run(input, results)
      results.set(step.id, raw)
      if (step.extractWarnings) warnings.push(...step.extractWarnings(raw))
      partial[step.envelopeKey] = step.toEnvelopeValue(raw)
      stages.push({ id: step.id, status: 'SUCCEEDED' })
    } catch (error) {
      stages.push({ id: step.id, status: 'FAILED' })
      return {
        success: false,
        stages,
        envelope: null,
        partialEnvelope: Object.freeze({ document_id: input.documentId, ...partial, warnings }),
        failedStage: step.id,
        error,
      }
    }
  }
  return {
    success: true,
    stages,
    envelope: Object.freeze({ document_id: input.documentId, ...partial, warnings }),
    partialEnvelope: null,
    failedStage: null,
    error: null,
  }
}
