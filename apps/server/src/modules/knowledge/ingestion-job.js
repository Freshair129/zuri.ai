// @req FR-109 — an ingestion occurrence is registered on the FR-071 execution
// ledger as a run of DPL-KNOWLEDGE-INGEST-V1, keyed by BR-021 ingestion identity;
// its §5 job lifecycle is a projection over that ledger's facts (AC-109.11).
// @req FR-110 — a run closes only from what Stages 2–17 actually reported, and
// PUBLISHED is never inferred from anything but a closed run behind an approved
// Stage 17 gate.
// @spec SDD-067, SDD-066, SDD-057, BR-021, SEC-021, ADR-050 D4, ADR-067 D3, ADR-067 D4
// @tested tests/unit/knowledge-ingestion-job.test.js

import {
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_INGESTION_STAGE_CATALOG,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
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

/**
 * The specification's §5 job states (FR-109 "Job lifecycle"). `SUPERSEDED` is
 * declared and never emitted: nothing yet acts on a `REVISION_OF` result
 * (AC-109.13), and a state this function cannot derive is not one it invents.
 */
export const KNOWLEDGE_JOB_STATES = Object.freeze([
  'RECEIVED',
  'PROCESSING',
  'VALIDATING',
  'READY_TO_PUBLISH',
  'PUBLISHED',
  'RETRYABLE_FAILED',
  'QUARANTINED',
  'REJECTED',
  'SUPERSEDED',
])

const PUBLISHABLE_VERDICTS = new Set(['PASS', 'PASS_WITH_WARNINGS'])

/**
 * Stages 2–8: what Tier 1 executes and reports (FR-118, SDD-069). Stage 1
 * (`DPS-KI-INGEST`, sequence 10) is deliberately outside every rule below —
 * its evidence is the run's own `artifactRef` (FR-081 delivered the artifact
 * before the run existed), and its step row stays `NOT_STARTED` on every run
 * this repository has ever written. Reading that row as "Stage 1 never ran"
 * would block every finalization for a stage that cannot fail.
 */
export const KNOWLEDGE_TIER1_STAGE_IDS = Object.freeze(
  KNOWLEDGE_INGESTION_STAGE_CATALOG
    .filter(({ sequence }) => sequence >= 20 && sequence <= 80)
    .map(({ pipelineStageId }) => pipelineStageId),
)

const EXECUTED_STAGE_IDS = Object.freeze([
  ...KNOWLEDGE_TIER1_STAGE_IDS,
  ...KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
])

function stageIndex(stages) {
  const index = {}
  for (const stage of stages || []) index[stage.pipelineStageId] = stage
  return index
}

/**
 * The gate that speaks for this run: the newest decision carrying FR-110's
 * Stage 17 evidence shape, or — when no decision carries one — the newest
 * decision at all, so an FR-071 `REJECTED` written without knowledge evidence
 * still counts as a rejection rather than as silence.
 */
export function latestKnowledgeGate(gates) {
  const ordered = [...(gates || [])].sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
  const withVerdict = ordered.find((gate) => gate?.evidence && typeof gate.evidence.verdict === 'string')
  const gate = withVerdict || ordered[0] || null
  if (!gate) return null
  return {
    status: gate.status,
    verdict: gate.evidence?.verdict ?? null,
    snapshotId: gate.evidence?.snapshot?.knowledge_snapshot_id ?? null,
  }
}

function failedStage(index) {
  for (const id of KNOWLEDGE_TIER1_STAGE_IDS) if (index[id]?.status === 'FAILED') return { id, tier: 1, retryable: index[id].retryable === true }
  for (const id of KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS) if (index[id]?.status === 'FAILED') return { id, tier: 3, retryable: index[id].retryable === true }
  if (index[KNOWLEDGE_QUALITY_GATE_STAGE_ID]?.status === 'FAILED') return { id: KNOWLEDGE_QUALITY_GATE_STAGE_ID, tier: 3, retryable: false }
  return null
}

/**
 * The §5 job state, derived from ledger facts and nothing else (ADR-067 D4).
 *
 * `ledgerStatus` is the run's stored FR-071 status — never the monitor's
 * effective status, which turns `UNKNOWN` on a stale heartbeat. That is the
 * point of taking it as a plain argument: this function has no clock and no
 * heartbeat to read, so `PUBLISHED` can only ever mean "the run closed
 * `SUCCEEDED` behind an `APPROVED` Stage 17 gate with a publishable verdict",
 * exactly as AC-109.11 requires, and a run that merely went quiet reads as
 * whatever its evidence last said.
 *
 * Precedence is the more specific fact first: a failed stage over a gate, a
 * gate over the run status, the run status over the stage board. A run an
 * operator closed `SUCCEEDED` with no approved gate is reported as still
 * `VALIDATING` with the reason named — the corpus was never gated, so it was
 * never published, whatever the run row says.
 */
export function knowledgeJobState({ ledgerStatus, stages, gates }) {
  const index = stageIndex(stages)
  const gate = latestKnowledgeGate(gates)
  const failed = failedStage(index)

  if (failed && failed.tier === 1) {
    return { state: 'QUARANTINED', reason: `TIER1_STAGE_FAILED:${failed.id}`, gate, failedStage: failed.id }
  }
  if (failed) {
    return failed.retryable
      ? { state: 'RETRYABLE_FAILED', reason: `STAGE_FAILED_RETRYABLE:${failed.id}`, gate, failedStage: failed.id }
      : { state: 'QUARANTINED', reason: `STAGE_FAILED:${failed.id}`, gate, failedStage: failed.id }
  }
  if (gate?.status === 'REJECTED') {
    return gate.verdict === 'QUARANTINE'
      ? { state: 'QUARANTINED', reason: 'GATE_VERDICT_QUARANTINE', gate, failedStage: null }
      : { state: 'REJECTED', reason: gate.verdict ? `GATE_VERDICT_${gate.verdict}` : 'GATE_REJECTED', gate, failedStage: null }
  }
  if (gate?.status === 'APPROVED' && PUBLISHABLE_VERDICTS.has(gate.verdict)) {
    return ledgerStatus === 'SUCCEEDED'
      ? { state: 'PUBLISHED', reason: 'RUN_SUCCEEDED_BEHIND_APPROVED_GATE', gate, failedStage: null }
      : { state: 'READY_TO_PUBLISH', reason: 'GATE_APPROVED_RUN_OPEN', gate, failedStage: null }
  }
  if (['FAILED', 'CANCELLED', 'ROLLED_BACK', 'PARTIAL'].includes(ledgerStatus)) {
    return { state: 'REJECTED', reason: `RUN_${ledgerStatus}_WITHOUT_PUBLICATION`, gate, failedStage: null }
  }
  if (gate && ['PENDING', 'WAIVED', 'APPROVED'].includes(gate.status)) {
    // A gate that exists but does not publish is the more specific fact than
    // the run row, whatever that row says. APPROVED lands here only with a
    // non-publishable verdict, which the envelope refuses to write; kept so
    // the branch is total rather than trusting that refusal from another file.
    return { state: 'VALIDATING', reason: `GATE_${gate.status}`, gate, failedStage: null }
  }
  if (ledgerStatus === 'SUCCEEDED') {
    return { state: 'VALIDATING', reason: 'RUN_SUCCEEDED_WITHOUT_APPROVED_GATE', gate, failedStage: null }
  }
  const stage17 = index[KNOWLEDGE_QUALITY_GATE_STAGE_ID]?.status
  const externalDone = KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS.every((id) => index[id]?.status === 'SUCCEEDED')
  if (stage17 === 'RUNNING' || externalDone) {
    return { state: 'VALIDATING', reason: externalDone ? 'EXTERNAL_STAGES_COMPLETE' : 'QUALITY_GATE_RUNNING', gate, failedStage: null }
  }
  const started = EXECUTED_STAGE_IDS.some((id) => ['RUNNING', 'SUCCEEDED', 'REPLAYING'].includes(index[id]?.status))
  return started
    ? { state: 'PROCESSING', reason: 'STAGES_IN_PROGRESS', gate, failedStage: null }
    : { state: 'RECEIVED', reason: 'NO_STAGE_EVIDENCE', gate, failedStage: null }
}

/**
 * What closing the run may write, derived from the same facts (ADR-067 D3).
 *
 * Returns `{ status: 'SUCCEEDED' | 'FAILED' }` when the ledger admits a
 * terminal state, or `{ status: null, blocking: [...] }` naming exactly what
 * is still owed. A failed stage or a rejected gate closes the run `FAILED`
 * even while other stages have no evidence — nothing after a failure changes
 * the outcome. `SUCCEEDED` needs every executed stage (2–17) `SUCCEEDED` and
 * an `APPROVED` gate with a publishable verdict. `PENDING` is not a decision
 * and `WAIVED` is not a verdict (FR-110 §23 names four, and a waiver is none
 * of them), so neither closes a knowledge run.
 */
export function knowledgeRunOutcome({ stages, gates }) {
  const index = stageIndex(stages)
  const gate = latestKnowledgeGate(gates)
  const failed = failedStage(index)

  if (failed) {
    return { status: 'FAILED', failureCode: `KI_STAGE_FAILED:${failed.id}`, failedStage: failed.id, gate, blocking: [] }
  }
  if (gate?.status === 'REJECTED') {
    return { status: 'FAILED', failureCode: `KI_GATE_REJECTED:${gate.verdict || 'NO_VERDICT'}`, failedStage: null, gate, blocking: [] }
  }

  const blocking = EXECUTED_STAGE_IDS
    .filter((id) => index[id]?.status !== 'SUCCEEDED')
    .map((id) => `STAGE_NOT_SUCCEEDED:${id}`)
  if (!gate) blocking.push('GATE_MISSING')
  else if (gate.status === 'PENDING') blocking.push('GATE_PENDING')
  else if (gate.status === 'WAIVED') blocking.push('GATE_WAIVED_IS_NOT_A_VERDICT')
  else if (!PUBLISHABLE_VERDICTS.has(gate.verdict)) blocking.push(`GATE_VERDICT_NOT_PUBLISHABLE:${gate.verdict}`)

  return blocking.length
    ? { status: null, failureCode: null, failedStage: null, gate, blocking }
    : { status: 'SUCCEEDED', failureCode: null, failedStage: null, gate, blocking: [] }
}
