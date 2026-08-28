// @req FR-119 — BR-022's quarantine envelope and classification for a Tier 1
// stage failure.
// @spec SDD-072, BR-022, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §27, §28
// @tested tests/unit/knowledge-quarantine.test.js

/**
 * BR-022's three-way vocabulary. `RETRYABLE` and `REVIEW_REQUIRED` are real
 * values with no current trigger in this repository — see
 * `classifyStageFailure`'s own doc comment for why — kept here so a caller
 * reads the whole vocabulary in one place rather than reconstructing it from
 * which strings happen to appear.
 */
export const QUARANTINE_CLASSIFICATIONS = Object.freeze(['RETRYABLE', 'NON_RETRYABLE', 'REVIEW_REQUIRED'])

/**
 * Classifies a Tier 1 stage failure. Always `NON_RETRYABLE`, and that is a
 * finding about this repository's actual failure modes, not a placeholder
 * standing in for real logic.
 *
 * Every one of the seven Tier 1 stage functions is pure: no I/O, no external
 * call, no clock, nothing transient. A thrown validation error — a missing
 * required field, a value outside an enum, an ordering violation — comes
 * from the shape of the artifact itself, and will throw identically on a
 * second attempt with the same artifact. Retrying achieves nothing a human
 * or a corrected re-ingestion (a new BR-021 identity) would not also need.
 *
 * `REVIEW_REQUIRED` has no trigger either, for a different reason: a value
 * this repository cannot decide does not reach this function at all.
 * FR-114's `normalizeValue` declines an ambiguous input by returning
 * `canonical: null` (SDD-061) rather than throwing — the ambiguity is
 * reported in the successful envelope, never as a quarantine-worthy error.
 * So the empty `REVIEW_REQUIRED` bucket is not an oversight; it is what
 * SDD-061's decision, made before this function existed, already implies.
 *
 * `RETRYABLE` stays real vocabulary rather than deleted, because it is
 * exactly the right classification for a *different* kind of failure this
 * repository does not yet have — a network call, an external service, Tier
 * 3/4 reporting (ADR-050 D3) — and inventing a fake trigger for it here
 * would be worse than an empty bucket: a caller that sees `RETRYABLE` would
 * reasonably act on it.
 */
export function classifyStageFailure() {
  return 'NON_RETRYABLE'
}

/**
 * Builds BR-022's quarantine envelope from a failed
 * `runKnowledgeIngestionStagesWithTrace` result.
 *
 * Two of BR-022's named fields are declined here, stated rather than
 * defaulted silently:
 *
 * - `retry_count` is always `0`. No retry-within-run mechanism exists for
 *   knowledge ingestion (SDD-071 names the same gap for NFR-020's identical
 *   field) — there is nothing to count.
 * - `first_failed_at` and `last_failed_at` are always the same instant. Both
 *   names exist for a failure that recurs over multiple attempts; with no
 *   retry mechanism, this is definitionally the first and the only attempt,
 *   so the two collapse rather than one being a copy of the other by
 *   coincidence.
 *
 * `error_message` is returned here, in the envelope this function returns
 * to its caller — it is deliberately NOT written onto the FR-071 ledger's
 * `errorRef` field. FR-071's own text describes `PipelineRecordEvent` as
 * carrying "redacted" evidence (its feature note, more than once, up to and
 * including an acceptance criterion), and this function honours that as a
 * convention rather than as something the schema enforced — see SDD-072/
 * SDD-073 for the exact state of contract enforcement at the time this
 * shipped. Either way, the caller of `buildQuarantineEnvelope` is the one
 * place the full message lives; `errorRef` gets a stable reference built
 * from the artifact identity and the failed stage, never the message
 * itself.
 */
export function buildQuarantineEnvelope({ jobId, artifactId, pipelineVersion, traceResult, now = () => new Date() }) {
  if (traceResult.success) {
    throw new Error('buildQuarantineEnvelope requires a failed runKnowledgeIngestionStagesWithTrace result')
  }
  const failedAt = now().toISOString()
  return Object.freeze({
    job_id: jobId,
    artifact_id: artifactId,
    stage: traceResult.failedStage,
    error_code: `${traceResult.failedStage}_VALIDATION_FAILED`,
    error_message: traceResult.error.message,
    retry_count: 0,
    first_failed_at: failedAt,
    last_failed_at: failedAt,
    pipeline_version: pipelineVersion,
    classification: classifyStageFailure(traceResult.error),
  })
}
