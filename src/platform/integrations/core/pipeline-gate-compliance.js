import { DATA_PIPELINE_DEFINITION_ID } from './pipeline-tracking-contract'

// @req FR-129 — the catalog publication gate is a precondition the executing
// worker observes and this ledger makes checkable afterwards: a run whose
// DPS-PUBLISH step succeeded with no prior APPROVED decision is a detectable
// violation, reported on the same monitor response that already returns
// `gates` alongside `steps`.
// @spec SDD-075, ADR-043 D2.1, ADR-050 D3 — Tier 1 records runs it does not
// execute, so this detects and does not prevent.
// @tested tests/unit/platform/fr129-catalog-publication-gate.test.js
// @tested tests/integration/fr129-catalog-publication-gate.test.js

/** The stage FR-129 gates. Its label has always read "Publish approved projection". */
export const PUBLISH_STAGE_ID = 'DPS-PUBLISH'

/**
 * Only `DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1` is gated by FR-129.
 *
 * `DPL-KNOWLEDGE-INGEST-V1` shares these six tables (SDD-066) and has its own
 * gate — FR-110's automated Stage 17 quality verdict — which is a different
 * decision about a different artifact. Reporting an FR-129 violation against a
 * knowledge run would be this repository's own union-catalog mistake, made in
 * the reporting layer instead of the validator.
 */
export function isCatalogPublicationDefinition(dataPipelineDefinitionId) {
  return dataPipelineDefinitionId === DATA_PIPELINE_DEFINITION_ID
}

function millis(value) {
  if (!value) return null
  const at = new Date(value).valueOf()
  return Number.isNaN(at) ? null : at
}

/** When a succeeded publish step actually finished, best evidence first. */
function publishedAtOf(step) {
  return millis(step.finishedAt) ?? millis(step.updatedAt) ?? millis(step.createdAt)
}

/**
 * FR-129's detectable violation, as a pure function over rows the monitor has
 * already loaded.
 *
 * `steps` and `gates` may be raw Prisma rows or their summaries — only fields
 * both carry are read.
 *
 * **Every succeeded publish step is checked, not the latest one per stage.**
 * `(runId, pipelineStageId)` has no uniqueness constraint (SDD-071), so a run
 * can hold more than one DPS-PUBLISH row; collapsing to the latest would hide
 * an unapproved publish behind a later approved retry, which is precisely the
 * event this exists to surface.
 *
 * **WAIVED does not satisfy the gate here, and that is deliberate.** FR-129
 * states the detectable condition as "no prior APPROVED decision", and whether
 * a gate is required per definition or per run is the named unmade product
 * decision. Treating a waiver as satisfying would answer that question in the
 * permissive direction inside a detector, invisibly to the person whose
 * decision it is. So every gate status observed on the run is reported in the
 * finding instead: a reader who is looking at a waiver can see it is a waiver.
 */
export function detectGateViolations({ dataPipelineDefinitionId, steps = [], gates = [] } = {}) {
  if (!isCatalogPublicationDefinition(dataPipelineDefinitionId)) return []

  const approvals = gates
    .filter((gate) => gate.status === 'APPROVED')
    .map((gate) => ({ gate, at: millis(gate.createdAt) }))
  const observedGateStatuses = [...new Set(gates.map((gate) => gate.status))].sort()

  return steps
    .filter((step) => step.pipelineStageId === PUBLISH_STAGE_ID && step.status === 'SUCCEEDED')
    .map((step) => {
      const publishedAt = publishedAtOf(step)
      // An approval with no readable timestamp, or a publish with none, cannot
      // be ordered. Counting it as prior is the conservative reading in one
      // direction only — it silences the report — so it is reported as
      // `ordered: false` rather than being resolved silently either way.
      const priorApprovals = approvals.filter(({ at }) => (
        publishedAt === null || at === null || at <= publishedAt
      ))
      if (priorApprovals.length > 0) return null
      return {
        code: 'PUBLISH_WITHOUT_APPROVAL',
        requirement: 'FR-129',
        pipelineStageId: step.pipelineStageId,
        executionStepId: step.executionStepId || null,
        attemptId: step.attemptId || null,
        publishedAt: step.finishedAt || step.updatedAt || step.createdAt || null,
        ordered: publishedAt !== null,
        // An approval recorded AFTER the publish succeeded is still a
        // violation of FR-129 and is the case most likely to be mistaken for
        // compliance by anyone who only checks that an APPROVED row exists.
        approvalsAfterPublish: approvals.length,
        observedGateStatuses,
      }
    })
    .filter(Boolean)
}

/**
 * The monitor's compliance block. `gated: false` is not "compliant" — it is
 * "FR-129 does not speak to this run" — and the two are kept apart so a reader
 * cannot take a knowledge run's empty violation list as a clean bill.
 */
export function gateCompliance({ dataPipelineDefinitionId, steps = [], gates = [] } = {}) {
  const gated = isCatalogPublicationDefinition(dataPipelineDefinitionId)
  const violations = detectGateViolations({ dataPipelineDefinitionId, steps, gates })
  return {
    requirement: 'FR-129',
    gated,
    enforced: false, // ADR-043 D2.1 / ADR-050 D3 — detection, never prevention.
    publishStageId: gated ? PUBLISH_STAGE_ID : null,
    violations,
  }
}
